// Title Protocol Gateway (= POST /process) を叩いて signature_hash + attestation を取得する。
//
// サーバ flow からは外れた並列処理。 mock-device が R2 upload 完了後に直接 TP Gateway を呼び、
// 戻ってきた ProcessResponse (= signature_hash + results + attestation) を JSON として保存。
//
// 内部で TEE が R2 から Range Request で fetch するため、 content_url は HTTPS で読める
// presigned URL or public URL を渡す。 TEE fetch 中ずっと有効である必要があるので、 presigned
// URL は最低 5 分の expires_in を持たせる。

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 既定の TP Gateway。 現状は固定 IP、 env (= TP_GATEWAY_URL) で override 可能。
pub const DEFAULT_TP_GATEWAY: &str = "http://13.113.217.17:3000";

#[derive(Serialize)]
struct ProcessRequest<'a> {
    input_type: &'a str, // "single" | "fragmented" | "sidecar" (普通の MP4 は single)
    content_url: &'a str,
    processor_ids: &'a [&'a str],
}

/// POST /process の戻り値。
/// `attestation` は base64 COSE_Sign1 (= TEE 構成証明)。
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct ProcessResponse {
    /// "sha256:<hex>" 形式
    pub signature_hash: String,
    pub results: Value,
    pub attestation: String,
}

pub async fn register_with_tp(
    content_url: &str,
    gateway_url: Option<&str>,
) -> Result<ProcessResponse> {
    let gw = gateway_url.unwrap_or(DEFAULT_TP_GATEWAY);
    let url = format!("{}/process", gw.trim_end_matches('/'));
    let body = ProcessRequest {
        input_type: "single",
        content_url,
        processor_ids: &["c2pa-verify"],
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .context("build reqwest client")?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("TP /process {status}: {text}"));
    }
    let parsed: ProcessResponse = resp
        .json()
        .await
        .context("parse TP /process response JSON")?;
    Ok(parsed)
}
