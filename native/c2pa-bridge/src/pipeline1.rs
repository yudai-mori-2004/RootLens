// Pipeline 1 (= iOS デバイス側 C2PA 処理) の Rust 実装。
//
// FFI 関数:
//   - pipeline1_sign_d1_remote(input_mp4, output_mp4,
//                              sign_service_url,
//                              account_pubkey)            → i32 (0=ok)
//     本番経路 (= リモート署名)。 ハッシュ計算 + manifest 組み立てはローカル、 COSE 署名
//     バイト列 (数 KB) だけを RootLens サーバ (/api/v1/c2pa-sign) に送って署名を得る。
//     秘密鍵はサーバにのみ存在する (= バイナリから鍵を抜けない)。
//   - pipeline1_sign_d1(input_mp4, output_mp4)            → i32 (0=ok)
//     dev fixture 鍵によるローカル署名 (= オフラインテスト / mock 用に残置)。
//   - pipeline1_sign_d2(...)                              → i32 (0=ok) (= v0.1.4 未使用、 残置)
//   - pipeline1_content_id(input_mp4) -> *mut c_char
//                                       ("sha256:<hex>" / NULL on error)

use std::ffi::{CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::Cursor;
use std::os::raw::c_char;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use sha2::{Digest, Sha256};

use crate::pipeline1_jumbf as jumbf;

const CERTS_PEM: &[u8] = include_bytes!("../fixtures/chain.pem");
const KEY_PEM: &[u8] = include_bytes!("../fixtures/ee.key");
const MIME_MP4: &str = "video/mp4";

/// リモート署名の HTTP タイムアウト。 署名対象は数 KB なので通常 1 RTT で返る。
const SIGN_HTTP_TIMEOUT: Duration = Duration::from_secs(60);

/// 直近の失敗理由。 FFI は数値しか返せないので、 呼び出し側 (Swift) が
/// pipeline1_last_error() で人間可読なメッセージを取り出してエラー表示に載せる。
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

fn set_last_error(msg: &str) {
    if let Ok(mut g) = LAST_ERROR.lock() {
        *g = msg.to_string();
    }
}

/// 直近のエラーメッセージを C 文字列で返す (空 = エラーなし)。 c2pa_free_string で解放する。
#[no_mangle]
pub unsafe extern "C" fn pipeline1_last_error() -> *mut c_char {
    let msg = LAST_ERROR.lock().map(|g| g.clone()).unwrap_or_default();
    CString::new(msg).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
}

fn build_d1_manifest(title: &str) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-ios",
            "version": "0.1.3"
        }],
        "assertions": [{
            "label": "c2pa.actions.v2",
            "data": {
                "actions": [{
                    "action": "c2pa.created",
                    "softwareAgent": "rootlens-ios (arkit-capture)"
                }]
            }
        }]
    })
}

// D2 manifest。 先頭の `c2pa.opened` (parentOf ingredient を ingredients param に持つ) は
// Builder の intent=Edit が自動挿入する。 C2PA 2.x の「最初の action は created/opened」
// 「opened/placed/removed は ingredients param 必須」を満たすため、 ここでは ingredient 不要な
// `c2pa.edited` のみ宣言する (= 顔ぼかしは編集アクション)。
// blur_assertion: privacy-blur が検出した per-frame 顔 bbox を載せた custom assertion data
// (= `io.rootlens.privacy.blur.v1`)。 None なら付けない。 署名に含まれるので tamper-evident。
fn build_d2_manifest(
    title: &str,
    faces_blurred: u32,
    blur_assertion: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut manifest = serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-ios",
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
    });
    if let Some(data) = blur_assertion {
        if let Some(arr) = manifest
            .get_mut("assertions")
            .and_then(|a| a.as_array_mut())
        {
            arr.push(serde_json::json!({
                "label": "io.rootlens.privacy.blur.v1",
                "data": data
            }));
        }
    }
    manifest
}

fn make_signer() -> Result<Box<dyn c2pa::Signer + Send + Sync>, String> {
    c2pa::create_signer::from_keys(CERTS_PEM, KEY_PEM, c2pa::SigningAlg::Ed25519, None)
        .map_err(|e| format!("Failed to create ed25519 signer: {e}"))
}

// ─── リモート署名 (= RootLens サーバの組織鍵で COSE 署名) ──────────────────

fn sign_http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(SIGN_HTTP_TIMEOUT))
        // 4xx/5xx を即エラーにせず自前で status を見る。 サーバのエラー本文
        // ("Invalid account pubkey format" 等) を診断メッセージに残すため。
        .http_status_as_error(false)
        .build()
        .into()
}

/// 非 2xx レスポンスを 「status + 本文冒頭」 のエラー文字列にする。
fn http_error_text(status: u16, body: &str) -> String {
    let snippet: String = body.chars().take(300).collect();
    format!("http status {status}: {snippet}")
}

/// GET {service_url} → { alg, certsPem } を取り、 署名 callback が POST {service_url} に
/// { dataB64 } を投げて { signatureB64 } (= Ed25519 raw 64 byte) を得る CallbackSigner を作る。
fn make_remote_signer(
    service_url: &str,
    account_pubkey: &str,
) -> Result<c2pa::CallbackSigner, String> {
    let agent = sign_http_agent();

    // 公開証明書チェーン (= x5chain に埋める) をサーバから取得。
    let mut resp = agent
        .get(service_url)
        .call()
        .map_err(|e| format!("GET {service_url}: {e}"))?;
    if resp.status().as_u16() >= 300 {
        let status = resp.status().as_u16();
        let body = resp.body_mut().read_to_string().unwrap_or_default();
        return Err(format!("GET {service_url}: {}", http_error_text(status, &body)));
    }
    let info: serde_json::Value = resp
        .body_mut()
        .read_json()
        .map_err(|e| format!("sign service cert response parse: {e}"))?;
    let certs_pem = info
        .get("certsPem")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "sign service response missing certsPem".to_string())?
        .to_owned();
    let alg = info.get("alg").and_then(|v| v.as_str()).unwrap_or("ed25519");
    if alg != "ed25519" {
        return Err(format!("unsupported sign service alg: {alg}"));
    }

    let url = service_url.to_owned();
    let pubkey = account_pubkey.to_owned();
    let callback = move |_ctx: *const (), data: &[u8]| -> std::result::Result<Vec<u8>, c2pa::Error> {
        let data_b64 = base64::engine::general_purpose::STANDARD.encode(data);
        let mut resp = sign_http_agent()
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Account-Pubkey", &pubkey)
            .send_json(serde_json::json!({ "dataB64": data_b64 }))
            .map_err(|e| c2pa::Error::OtherError(format!("remote sign POST: {e}").into()))?;
        if resp.status().as_u16() >= 300 {
            let status = resp.status().as_u16();
            let body = resp.body_mut().read_to_string().unwrap_or_default();
            return Err(c2pa::Error::OtherError(
                format!("remote sign POST: {}", http_error_text(status, &body)).into(),
            ));
        }
        let body: serde_json::Value = resp
            .body_mut()
            .read_json()
            .map_err(|e| c2pa::Error::OtherError(format!("remote sign response parse: {e}").into()))?;
        let sig_b64 = body
            .get("signatureB64")
            .and_then(|v| v.as_str())
            .ok_or_else(|| c2pa::Error::OtherError("remote sign response missing signatureB64".into()))?;
        base64::engine::general_purpose::STANDARD
            .decode(sig_b64)
            .map_err(|e| c2pa::Error::OtherError(format!("signature base64 decode: {e}").into()))
    };

    Ok(c2pa::CallbackSigner::new(
        callback,
        c2pa::SigningAlg::Ed25519,
        certs_pem,
    ))
}

fn sign_d1_with(
    input_mp4: &Path,
    output_mp4: &Path,
    signer: &dyn c2pa::Signer,
) -> Result<(), String> {
    let title = output_mp4
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d1.mp4");

    let manifest_json = build_d1_manifest(title).to_string();
    let mut builder = c2pa::Builder::from_context(c2pa::Context::default())
        .with_definition(&manifest_json)
        .map_err(|e| format!("Builder::with_definition (D1) failed: {e}"))?;

    let mut src = File::open(input_mp4)
        .map_err(|e| format!("open input {}: {e}", input_mp4.display()))?;
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4)
        .map_err(|e| format!("create output {}: {e}", output_mp4.display()))?;

    builder
        .sign(signer, MIME_MP4, &mut src, &mut dest)
        .map_err(|e| format!("D1 sign failed: {e}"))?;

    Ok(())
}

fn sign_d1_impl(input_mp4: &Path, output_mp4: &Path) -> Result<(), String> {
    let signer = make_signer()?;
    sign_d1_with(input_mp4, output_mp4, signer.as_ref())
}

fn sign_d1_remote_impl(
    input_mp4: &Path,
    output_mp4: &Path,
    service_url: &str,
    account_pubkey: &str,
) -> Result<(), String> {
    let signer = make_remote_signer(service_url, account_pubkey)?;
    sign_d1_with(input_mp4, output_mp4, &signer)
}

fn sign_d2_impl(
    blurred_mp4: &Path,
    parent_d1_mp4: &Path,
    output_mp4: &Path,
    faces_blurred: u32,
    blur_assertion: Option<serde_json::Value>,
) -> Result<(), String> {
    let title = output_mp4
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d2.mp4");

    let manifest_json = build_d2_manifest(title, faces_blurred, blur_assertion).to_string();
    let mut builder = c2pa::Builder::from_context(c2pa::Context::default())
        .with_definition(&manifest_json)
        .map_err(|e| format!("Builder::with_definition (D2) failed: {e}"))?;
    // intent=Edit + parentOf ingredient で、 Builder が先頭に `c2pa.opened`
    // (ingredients param 付き) を自動挿入する (= C2PA 2.x の first-action / ingredient ルール充足)。
    builder.set_intent(c2pa::BuilderIntent::Edit);

    let ingredient_json = serde_json::json!({
        "title": parent_d1_mp4.file_name().and_then(|s| s.to_str()).unwrap_or("d1.mp4"),
        "format": MIME_MP4,
        "relationship": "parentOf"
    })
    .to_string();

    let parent_bytes = std::fs::read(parent_d1_mp4)
        .map_err(|e| format!("read parent D1 {}: {e}", parent_d1_mp4.display()))?;
    let mut parent_cursor = Cursor::new(&parent_bytes);
    builder
        .add_ingredient_from_stream(&ingredient_json, MIME_MP4, &mut parent_cursor)
        .map_err(|e| format!("add_ingredient_from_stream (D1 parent): {e}"))?;

    let signer = make_signer()?;

    let mut src = File::open(blurred_mp4)
        .map_err(|e| format!("open blurred input {}: {e}", blurred_mp4.display()))?;
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4)
        .map_err(|e| format!("create output {}: {e}", output_mp4.display()))?;

    builder
        .sign(signer.as_ref(), MIME_MP4, &mut src, &mut dest)
        .map_err(|e| format!("D2 sign failed: {e}"))?;

    Ok(())
}

fn content_id_impl(input_path: &Path) -> Result<String, String> {
    let mut file = File::open(input_path)
        .map_err(|e| format!("open {}: {e}", input_path.display()))?;
    let jumbf_data = c2pa::jumbf_io::load_jumbf_from_stream(MIME_MP4, &mut file)
        .map_err(|e| format!("JUMBF extraction failed: {e}"))?;

    let labels = jumbf::find_manifest_labels(&jumbf_data)
        .map_err(|e| format!("find_manifest_labels: {e}"))?;
    let active_label = labels
        .last()
        .ok_or_else(|| "No manifest found in JUMBF data".to_string())?;

    let signature_bytes = jumbf::extract_signature_from_jumbf(&jumbf_data, active_label)
        .map_err(|e| format!("extract_signature_from_jumbf: {e}"))?;

    let hash = Sha256::digest(&signature_bytes);
    Ok(format!("sha256:{}", hex::encode(hash)))
}

// ─── C FFI exports ─────────────────────────────────────────────────────

unsafe fn cstr_to_str<'a>(ptr: *const c_char) -> Result<&'a str, String> {
    if ptr.is_null() {
        return Err("null string pointer".to_string());
    }
    CStr::from_ptr(ptr)
        .to_str()
        .map_err(|e| format!("non-UTF8 string: {e}"))
}

unsafe fn cstr_to_path<'a>(ptr: *const c_char) -> Result<&'a Path, String> {
    cstr_to_str(ptr).map(Path::new)
}

/// D1 リモート署名 FFI (= 本番経路)。 0 = success, non-zero = failure.
/// sign_service_url: RootLens の署名 endpoint (= GET で証明書、 POST で署名)。
/// account_pubkey: X-Account-Pubkey header に載せる認可用のアカウント公開鍵 (base58)。
#[no_mangle]
pub unsafe extern "C" fn pipeline1_sign_d1_remote(
    input_mp4: *const c_char,
    output_mp4: *const c_char,
    sign_service_url: *const c_char,
    account_pubkey: *const c_char,
) -> i32 {
    let input = match cstr_to_path(input_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1_remote] {e}");
            return -1;
        }
    };
    let output = match cstr_to_path(output_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1_remote] {e}");
            return -1;
        }
    };
    let url = match cstr_to_str(sign_service_url) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1_remote] {e}");
            return -1;
        }
    };
    let pubkey = match cstr_to_str(account_pubkey) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1_remote] {e}");
            return -1;
        }
    };
    match sign_d1_remote_impl(input, output, url, pubkey) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1_remote] {e}");
            set_last_error(&e);
            -2
        }
    }
}

/// D1 sign FFI (= dev fixture 鍵によるローカル署名。 オフラインテスト / mock 用)。
/// 0 = success, non-zero = failure.
#[no_mangle]
pub unsafe extern "C" fn pipeline1_sign_d1(
    input_mp4: *const c_char,
    output_mp4: *const c_char,
) -> i32 {
    let input = match cstr_to_path(input_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            return -1;
        }
    };
    let output = match cstr_to_path(output_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            return -1;
        }
    };
    match sign_d1_impl(input, output) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            set_last_error(&e);
            -2
        }
    }
}

/// D2 sign FFI. 0 = success, non-zero = failure.
#[no_mangle]
pub unsafe extern "C" fn pipeline1_sign_d2(
    blurred_mp4: *const c_char,
    parent_d1_mp4: *const c_char,
    output_mp4: *const c_char,
    faces_blurred: u32,
    blur_assertion_json: *const c_char,
) -> i32 {
    let blurred = match cstr_to_path(blurred_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    let parent = match cstr_to_path(parent_d1_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    let output = match cstr_to_path(output_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    // blur assertion data (= io.rootlens.privacy.blur.v1)。 NULL / 空 / parse 失敗時は付けない
    // (= blur メタは best-effort、 ここで署名全体を失敗させない)。
    let blur_assertion: Option<serde_json::Value> = if blur_assertion_json.is_null() {
        None
    } else {
        match CStr::from_ptr(blur_assertion_json).to_str() {
            Ok(s) if !s.is_empty() => match serde_json::from_str::<serde_json::Value>(s) {
                Ok(v) => Some(v),
                Err(e) => {
                    eprintln!("[pipeline1_sign_d2] blur_assertion parse failed: {e}");
                    None
                }
            },
            _ => None,
        }
    };
    match sign_d2_impl(blurred, parent, output, faces_blurred, blur_assertion) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            -2
        }
    }
}

/// content_id 抽出 FFI. 戻り値は "sha256:<hex>" の C string、 NULL on error。
/// 呼び出し側は `c2pa_free_string` で解放する。
#[no_mangle]
pub unsafe extern "C" fn pipeline1_content_id(input_mp4: *const c_char) -> *mut c_char {
    let input = match cstr_to_path(input_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_content_id] {e}");
            return std::ptr::null_mut();
        }
    };
    match content_id_impl(input) {
        Ok(id) => match CString::new(id) {
            Ok(c) => c.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(e) => {
            eprintln!("[pipeline1_content_id] {e}");
            std::ptr::null_mut()
        }
    }
}
