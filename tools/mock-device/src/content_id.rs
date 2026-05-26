// content_id = SHA-256(Active Manifest's COSE signature)
//
// DATA_SPECS §1.1 の content_id 算出。 Title Protocol c2pa_verify.rs::compute_signature_hash
// を adapt (Apache-2.0)。
//
// 流れ:
//   1. c2pa::jumbf_io::load_jumbf_from_stream で JUMBF データだけ抽出 (= ファイル全体は読まない)
//   2. 自前 JUMBF parser で active manifest (= 最後の c2pa.manifest) の label を見つける
//   3. 同 manifest の c2pa.signature box から COSE CBOR bytes を取得
//   4. SHA-256 を計算
//
// 50 GB の MP4 でも JUMBF 周辺だけ読めば済む構造。

use crate::jumbf;
use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// 署名済 MP4 / 画像から content_id を算出する。 戻り値は "sha256:<64 hex>" 形式の
/// 文字列。 DB schema の `contentId` カラムに保存する時は "sha256:" prefix を外して
/// 64 文字 hex のみを使う。
pub fn compute_content_id<P: AsRef<Path>>(path: P, content_type: &str) -> Result<String> {
    let mut file = File::open(path.as_ref())?;
    compute_content_id_from_reader(&mut file, content_type)
}

/// `Read + Seek + Send` から content_id を算出する一般形。 stream 先頭から読む前提。
/// `c2pa::jumbf_io::load_jumbf_from_stream` の trait bound `CAIRead: Read + Seek + Send`
/// に合わせるため Send 制約を付ける。
pub fn compute_content_id_from_reader<R: Read + Seek + Send>(
    reader: &mut R,
    content_type: &str,
) -> Result<String> {
    let signature_bytes = extract_active_manifest_signature(reader, content_type)?;
    Ok(format_content_id(&signature_bytes))
}

/// "sha256:<hex>" 形式の文字列化。 表記揺れを 1 ヶ所に集約。
fn format_content_id(signature_bytes: &[u8]) -> String {
    let hash = Sha256::digest(signature_bytes);
    format!("sha256:{}", hex::encode(hash))
}

/// content_id の hex 部分のみ (= "sha256:" prefix なし) を取り出す。
/// DB / R2 key には hex 64 文字だけ使うのでこれを通す。
pub fn to_hex_only(content_id: &str) -> Result<&str> {
    content_id
        .strip_prefix("sha256:")
        .ok_or_else(|| anyhow!("content_id missing 'sha256:' prefix: {content_id}"))
}

fn extract_active_manifest_signature<R: Read + Seek + Send>(
    reader: &mut R,
    content_type: &str,
) -> Result<Vec<u8>> {
    reader.seek(SeekFrom::Start(0))?;
    let jumbf_data = c2pa::jumbf_io::load_jumbf_from_stream(content_type, reader)
        .map_err(|e| anyhow!("JUMBF extraction failed: {e}"))?;

    let labels = jumbf::find_manifest_labels(&jumbf_data)?;
    let active_label = labels
        .last()
        .ok_or_else(|| anyhow!("No manifest found in JUMBF data"))?;

    jumbf::extract_signature_from_jumbf(&jumbf_data, active_label)
}
