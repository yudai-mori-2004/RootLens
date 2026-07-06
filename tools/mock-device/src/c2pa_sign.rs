// C2PA 2 段署名 (D1 / D2)。
//
// DATA_SPECS §2.4 に従う:
//   D1: 生 MP4 への ed25519 署名 (= c2pa.actions.v2 = [c2pa.created])
//   D2: ぼかし済 MP4 への ed25519 署名 (= ingredient parentOf で D1 を参照、
//       c2pa.actions.v2 = [c2pa.placed (= Apple Vision 顔ぼかし)])
//
// 本 mock は Title Protocol の dev fixture (= ed25519 Test EE + Test CA) を使う。
// 実機 iOS では Secure Enclave 鍵 + Apple Attest + RFC 3161 TSA + 端末ごとに発行された
// device cert chain (= Root → iOS ICA → Device) に差し替える。

use anyhow::{anyhow, Context, Result};
use std::fs::{File, OpenOptions};
use std::io::Cursor;
use std::path::Path;

const CERTS_PEM: &[u8] = include_bytes!("../fixtures/chain.pem");
const KEY_PEM: &[u8] = include_bytes!("../fixtures/ee.key");

const MIME_MP4: &str = "video/mp4";

/// D1 manifest JSON を構築する。 c2pa.actions.v2 の 1 action `c2pa.created` が必須
/// (= c2pa-rs に reject されない最小要件)。
fn build_d1_manifest(title: &str) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-mock-device",
            "version": "0.1.3"
        }],
        "assertions": [{
            "label": "c2pa.actions.v2",
            "data": {
                "actions": [{
                    "action": "c2pa.created",
                    "softwareAgent": "rootlens-mock-device (AVAssetWriter mock)"
                }]
            }
        }]
    })
}

/// D2 manifest JSON を構築する。 D1 を ingredient parentOf 参照し、
/// `c2pa.edited` action で Apple Vision 顔ぼかしを記録する。
/// 先頭の `c2pa.opened` action は Builder の intent=Edit が自動挿入する
/// (= parentOf ingredient を ingredients param に持つ `c2pa.opened`)。 C2PA 2.x の
/// 「最初の action は created/opened」「opened/placed/removed は ingredients param 必須」を
/// 満たすため、 ここでは ingredient 不要な `c2pa.edited` のみ宣言する。
fn build_d2_manifest(title: &str, faces_blurred: u32) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-mock-device",
            "version": "0.1.3"
        }],
        "assertions": [{
            "label": "c2pa.actions.v2",
            "data": {
                "actions": [{
                    "action": "c2pa.edited",
                    "softwareAgent": "Apple Vision VNDetectFaceRectanglesRequest rev 3",
                    "parameters": {
                        "operation": "face_blur",
                        "regions_blurred": faces_blurred
                    }
                }]
            }
        }]
    })
}

/// dev fixture から ed25519 Signer を作る。 production では Secure Enclave callback signer に
/// 差し替える。
fn make_signer() -> Result<Box<dyn c2pa::Signer + Send + Sync>> {
    c2pa::create_signer::from_keys(CERTS_PEM, KEY_PEM, c2pa::SigningAlg::Ed25519, None)
        .map_err(|e| anyhow!("Failed to create ed25519 signer: {e}"))
}

/// デバッグ: created-only manifest で署名 → 同じ c2pa-rs (trust-off) で検証し結果文字列を返す。
/// BMFF(mp4) と image(jpeg) の round-trip 差を切り分けるための最小再現。
pub fn selftest_sign_verify<P: AsRef<Path>>(input: P, format: &str) -> Result<String> {
    let manifest = serde_json::json!({
        "title": "selftest",
        "format": format,
        "assertions": [{"label":"c2pa.actions.v2","data":{"actions":[{"action":"c2pa.created"}]}}]
    })
    .to_string();
    let mut builder = c2pa::Builder::from_context(c2pa::Context::default())
        .with_definition(&manifest)
        .map_err(|e| anyhow!("selftest with_definition: {e}"))?;
    let signer = make_signer()?;
    let out = std::env::temp_dir().join("c2pa_selftest_out.bin");
    let mut src = File::open(input.as_ref())?;
    let mut dest = OpenOptions::new()
        .read(true).write(true).create(true).truncate(true)
        .open(&out)?;
    builder
        .sign(signer.as_ref(), format, &mut src, &mut dest)
        .map_err(|e| anyhow!("selftest sign: {e}"))?;
    drop(dest);
    let settings = c2pa::Settings::new()
        .with_json(r#"{"verify":{"verify_trust":false}}"#)
        .map_err(|e| anyhow!("selftest settings: {e}"))?;
    let ctx = c2pa::Context::new()
        .with_settings(settings)
        .map_err(|e| anyhow!("selftest ctx: {e}"))?;
    let vf = File::open(&out)?;
    let reader = c2pa::Reader::from_context(ctx)
        .with_stream(format, vf)
        .map_err(|e| anyhow!("selftest reader: {e}"))?;
    let codes: Vec<String> = reader
        .validation_status()
        .map(|ss| ss.iter().map(|s| s.code().to_string()).collect())
        .unwrap_or_default();
    Ok(format!("state={:?} codes={:?}", reader.validation_state(), codes))
}

/// 大容量 MP4 を一定メモリで署名するための Context (= c2pa-bridge/pipeline1.rs と揃える)。
/// merkle chunk で mdat をチャンクハッシュ + 埋め込み中間ストリームを 16MB 超でディスク退避。
/// これが無いと c2pa が MP4 全体をメモリに載せ、 モバイルは 4GB 動画で OOM する (2026-07-07 実測)。
fn bounded_context() -> c2pa::Context {
    let mut ctx = c2pa::Context::default();
    ctx.settings_mut().core.merkle_tree_chunk_size_in_kb = Some(1024);
    ctx.settings_mut().core.backing_store_memory_threshold_in_mb = 16;
    ctx
}

/// D1 署名: 生 MP4 → D1 manifest 付き MP4。
pub fn sign_d1<P: AsRef<Path>>(input_mp4: P, output_mp4: P) -> Result<()> {
    let title = output_mp4
        .as_ref()
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d1.mp4");

    let manifest_json = build_d1_manifest(title).to_string();
    let mut builder = c2pa::Builder::from_context(bounded_context())
        .with_definition(&manifest_json)
        .map_err(|e| anyhow!("Builder::with_definition (D1) failed: {e}"))?;
    let signer = make_signer()?;

    let mut src = File::open(input_mp4.as_ref())
        .with_context(|| format!("open input {}", input_mp4.as_ref().display()))?;
    // c2pa::Builder::sign は `W: Write + Read + Seek + Send` を要求するので
    // BufWriter ではなく Read+Write 両対応で File を開く。
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4.as_ref())
        .with_context(|| format!("create output {}", output_mp4.as_ref().display()))?;

    builder
        .sign(signer.as_ref(), MIME_MP4, &mut src, &mut dest)
        .map_err(|e| anyhow!("D1 sign failed: {e}"))?;

    Ok(())
}

/// D2 署名: ぼかし済 MP4 + D1 (= ingredient) → D2 manifest 付き MP4。
///
/// blur の再 encode で MP4 内部の D1 manifest は破壊される (= JUMBF box が再 encode で消える)。
/// D2 manifest は D1 を「parentOf」 として ingredient 参照することで、 経歴チェーン上の前段として
/// 記録する。 D1 manifest 本体は D2 内に埋め込まれず、 ハッシュ参照のみ残る。
pub fn sign_d2_with_parent<P: AsRef<Path>>(
    blurred_mp4: P,
    parent_d1_mp4: P,
    output_mp4: P,
    faces_blurred: u32,
) -> Result<()> {
    let title = output_mp4
        .as_ref()
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d2.mp4");

    let manifest_json = build_d2_manifest(title, faces_blurred).to_string();
    let mut builder = c2pa::Builder::from_context(bounded_context())
        .with_definition(&manifest_json)
        .map_err(|e| anyhow!("Builder::with_definition (D2) failed: {e}"))?;
    // intent=Edit + parentOf ingredient で、 Builder が先頭に `c2pa.opened`
    // (ingredients param 付き) を自動挿入する (= C2PA 2.x の first-action / ingredient ルール充足)。
    builder.set_intent(c2pa::BuilderIntent::Edit);

    // D1 を parentOf ingredient として登録。 ingredient JSON は `relationship: "parentOf"` を含める。
    // c2pa-rs は与えられた stream のハッシュと manifest 情報を取り、 D2 manifest に来歴記録として埋める。
    let ingredient_json = serde_json::json!({
        "title": parent_d1_mp4.as_ref().file_name().and_then(|s| s.to_str()).unwrap_or("d1.mp4"),
        "format": MIME_MP4,
        "relationship": "parentOf"
    })
    .to_string();

    let parent_bytes = std::fs::read(parent_d1_mp4.as_ref())
        .with_context(|| format!("read parent D1 {}", parent_d1_mp4.as_ref().display()))?;
    let mut parent_cursor = Cursor::new(&parent_bytes);
    builder
        .add_ingredient_from_stream(&ingredient_json, MIME_MP4, &mut parent_cursor)
        .map_err(|e| anyhow!("add_ingredient_from_stream (D1 parent) failed: {e}"))?;

    let signer = make_signer()?;

    let mut src = File::open(blurred_mp4.as_ref())
        .with_context(|| format!("open blurred input {}", blurred_mp4.as_ref().display()))?;
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4.as_ref())
        .with_context(|| format!("create output {}", output_mp4.as_ref().display()))?;

    builder
        .sign(signer.as_ref(), MIME_MP4, &mut src, &mut dest)
        .map_err(|e| anyhow!("D2 sign failed: {e}"))?;

    Ok(())
}
