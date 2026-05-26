// POST https://<api_base>/api/clips を叩いて clips 行を作成する。 v0.1.3 では
// content_id + rootAssetId + signedJsonUri が必須 (= Pipeline 2 起動の前提条件)。
//
// zod schema (= web/app/api/clips/route.ts) 参照:
//   taskId               : string, min 1
//   achievementConfidence: int 0-100
//   contentId            : sha256 hex 64 chars (= "sha256:" prefix なし)
//   contentSize          : positive int (= rgb.mp4 のバイト数)
//   rootAssetId          : base58 32-44 chars (= cNFT asset id)
//   signedJsonUri        : URL (= R2 signed-json/<content_id>.json の公開 URL)
//
// wallet pubkey は `X-Wallet-Pubkey` header で渡す (= web/lib/auth.ts requireWalletPubkey)。

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct CreateClipBody<'a> {
    #[serde(rename = "taskId")]
    task_id: &'a str,
    #[serde(rename = "achievementConfidence")]
    achievement_confidence: u32,
    #[serde(rename = "contentId")]
    content_id: &'a str,
    #[serde(rename = "contentSize")]
    content_size: u64,
    #[serde(rename = "rootAssetId")]
    root_asset_id: &'a str,
    #[serde(rename = "signedJsonUri")]
    signed_json_uri: &'a str,
}

#[derive(Deserialize)]
struct ClipResponse {
    clip: ClipDto,
}

#[derive(Deserialize)]
struct ClipDto {
    id: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn register_clip(
    api_base: &str,
    wallet_pubkey: &str,
    task_id: &str,
    achievement_confidence: u32,
    content_id_hex: &str,
    content_size: u64,
    root_asset_id: &str,
    signed_json_uri: &str,
) -> Result<String> {
    let url = format!("{}/api/clips", api_base.trim_end_matches('/'));
    let body = CreateClipBody {
        task_id,
        achievement_confidence,
        content_id: content_id_hex,
        content_size,
        root_asset_id,
        signed_json_uri,
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .context("build reqwest client")?;

    let resp = client
        .post(&url)
        .header("X-Wallet-Pubkey", wallet_pubkey)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;

    let status = resp.status();
    // 既存行があると 200 (重複)、 新規は 201。 どちらも成功扱い。
    if !(status == reqwest::StatusCode::CREATED || status == reqwest::StatusCode::OK) {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("/api/clips {status}: {text}"));
    }
    let parsed: ClipResponse = resp.json().await.context("parse /api/clips response JSON")?;
    Ok(parsed.clip.id)
}
