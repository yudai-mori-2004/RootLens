// rootlens-mock-device: Pipeline 1 (= iOS 端末側) を macOS で模擬する CLI。
//
// 入力 raw MP4 (+ センサーファイル) を取り、 以下を順に実行:
//   1. C2PA D1 署名 (= c2pa.actions.v2 = [c2pa.created]、 dev ed25519 chain)
//   2. MacOsBlur Swift CLI で Apple Vision 顔ぼかし + H.264 再 encode
//   3. C2PA D2 署名 (= D1 を ingredient parentOf 参照、 c2pa.placed action)
//   4. signature_hash = SHA-256(D2 active manifest signature) を抽出
//   5. R2 raw バケットに 4 ファイル並列 PUT (prod profile)
//      / ローカル out dir にコピー (dev profile)
//
// stdout に 1 行 JSON で結果を返す。 標準エラー出力に進捗を出す (= --quiet で抑制)。
//
// 詳細は document/v0.1.3/tasks/02-pipeline-1-mock-cli/README.md 参照。

mod blur;
mod c2pa_sign;
mod clips_register;
mod cnft_mint;
mod signature_hash;
mod jumbf;
mod r2_upload;
mod tp_register;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, ValueEnum};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(
    name = "mock-device",
    version,
    about = "iOS 端末を模擬する macOS CLI (= Pipeline 1 の代替)"
)]
struct Args {
    /// 入力 raw MP4 ファイル (= H.264 推奨)
    #[arg(long)]
    input: PathBuf,

    /// sensors.jsonl (= 30Hz カメラ外部パラメータ + トラッキング状態 + 手ランドマーク)。
    /// 未指定なら R2 アップロード時に省略する。
    #[arg(long)]
    sensors: Option<PathBuf>,

    /// imu_high_rate.jsonl (= 100Hz 加速度 / ジャイロ / 地磁気)。 未指定なら省略する。
    #[arg(long)]
    imu: Option<PathBuf>,

    /// metadata.json (= fx, fy, cx, cy)。 未指定なら省略する。
    #[arg(long)]
    intrinsics: Option<PathBuf>,

    /// 動作モード。 dev = ローカル出力のみ、 prod = R2 アップロード込み
    #[arg(long, value_enum, default_value_t = Profile::Dev)]
    profile: Profile,

    /// 中間 / 最終ファイルを置くディレクトリ。 dev profile では --output-dir 配下に
    /// `<signature_hash>/rgb.mp4` 等が出る。 prod profile でも R2 PUT 前に一時保存する。
    #[arg(long, default_value = "./mock_device_out")]
    output_dir: PathBuf,

    /// R2 バケット名 (= 環境変数 R2_BUCKET_RAW を override する場合のみ指定)。
    #[arg(long)]
    bucket: Option<String>,

    /// Solana payer keypair JSON path (= prod profile で cNFT 発行に必須、 既定 keys/deployer.json)。
    #[arg(long, default_value = "keys/deployer.json")]
    solana_keypair: PathBuf,

    /// Solana RPC URL (= cNFT broadcast 用、 既定は devnet)。
    #[arg(long, default_value = "https://api.devnet.solana.com")]
    solana_rpc_url: String,

    /// TP Gateway base URL (= /process + /extension/solana を叩く、 既定は固定 IP)。
    /// 環境変数 TP_GATEWAY_URL でも override 可。
    #[arg(long)]
    tp_gateway: Option<String>,

    /// cNFT mint 先 Merkle tree pubkey (= prod profile で必須、 既定なし)。
    #[arg(long)]
    merkle_tree: Option<String>,

    /// Root NFT collection pubkey (= 省略時 collection なしで mint)。
    #[arg(long)]
    collection: Option<String>,

    /// RootLens API base URL (= /api/clips を叩く)。
    #[arg(long, default_value = "https://www.rootlens.io")]
    api_base: String,

    /// タスクカタログ ID (= /api/clips の taskId field)。
    #[arg(long, default_value = "dishes")]
    task_id: String,

    /// 端末側 VLM 達成確度 (= 0..100)。
    #[arg(long, default_value_t = 85)]
    achievement: u32,

    /// 進捗ログを抑制
    #[arg(long)]
    quiet: bool,
}

#[derive(ValueEnum, Clone, Debug, PartialEq)]
enum Profile {
    Dev,
    Prod,
}

#[derive(Serialize)]
struct Output {
    signature_hash: String,
    /// "sha256:" prefix を除いた 64 文字 hex (= DB の signatureHash カラム / R2 prefix に使う)
    signature_hash_hex: String,
    faces_blurred: u32,
    frames_processed: u32,
    blur_duration_ms: f64,
    output_width: u32,
    output_height: u32,
    /// dev profile では `output_paths` (= ローカル絶対パス)、
    /// prod profile では `r2_keys` (= raw/<signature_hash>/<filename>)
    #[serde(skip_serializing_if = "Option::is_none")]
    output_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r2_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r2_bucket: Option<String>,

    // ─── Title Protocol register 結果 (prod profile のみ) ─────────────────
    /// TP Gateway が返した signature_hash (= "sha256:<hex>")。 mock-device 側の signature_hash と
    /// 一致するはず (= 両方 D2 active manifest signature の SHA-256)。
    #[serde(skip_serializing_if = "Option::is_none")]
    tp_signature_hash: Option<String>,
    /// ProcessResponse JSON を保存した R2 key (= signed-json/<signature_hash>.json)。
    #[serde(skip_serializing_if = "Option::is_none")]
    tp_offchain_key: Option<String>,
    /// TP register 自体が成功したか (= 失敗してもアップロード自体は完了)
    #[serde(skip_serializing_if = "Option::is_none")]
    tp_register_error: Option<String>,

    // ─── cNFT 発行 + /api/clips register 結果 (prod profile のみ) ─────────
    /// Solana cNFT asset id (= /api/clips の rootAssetId に渡す、 base58)。
    #[serde(skip_serializing_if = "Option::is_none")]
    root_asset_id: Option<String>,
    /// R2 signed-json/<signature_hash>.json への 7 日有効 presigned GET URL (= /api/clips の signedJsonUri)。
    #[serde(skip_serializing_if = "Option::is_none")]
    signed_json_uri: Option<String>,
    /// /api/clips POST で得たクリップ ID (= サーバ DB 内 primary key)。
    #[serde(skip_serializing_if = "Option::is_none")]
    clip_id: Option<String>,
    /// cNFT 発行 broadcast tx の Solana signature。
    #[serde(skip_serializing_if = "Option::is_none")]
    solana_tx_signature: Option<String>,
    /// cNFT 発行失敗 (= /extension/solana or Solana broadcast 失敗)。 これがあれば clip_id は不在
    #[serde(skip_serializing_if = "Option::is_none")]
    cnft_mint_error: Option<String>,
    /// /api/clips POST 失敗。 cNFT 成功時にのみ呼ぶので、 これが出るのは server 側 validation 失敗
    #[serde(skip_serializing_if = "Option::is_none")]
    clips_register_error: Option<String>,
    /// payer keypair から derive した Solana wallet pubkey (= 後段 finalize / GET の
    /// X-Wallet-Pubkey header に渡す値、 base58)。 prod profile でのみ出る。
    #[serde(skip_serializing_if = "Option::is_none")]
    wallet_pubkey: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    if !args.input.exists() {
        return Err(anyhow!("input not found: {}", args.input.display()));
    }

    let t0 = Instant::now();
    let log = |msg: &str| {
        if !args.quiet {
            eprintln!("[mock-device] {msg}");
        }
    };

    // intermediate 用一時 dir。 dev profile では本番出力としても使う。
    std::fs::create_dir_all(&args.output_dir)
        .with_context(|| format!("mkdir {}", args.output_dir.display()))?;

    let tmp_d1 = args.output_dir.join("_intermediate_d1.mp4");
    let tmp_blur = args.output_dir.join("_intermediate_blur.mp4");
    let tmp_d2 = args.output_dir.join("_intermediate_d2.mp4");

    log(&format!("step 1/4: C2PA D1 sign ({})", args.input.display()));
    c2pa_sign::sign_d1(&args.input, &tmp_d1)?;

    log(&format!(
        "step 2/4: Apple Vision face blur ({})",
        tmp_d1.display()
    ));
    let blur_result = blur::blur_faces(&tmp_d1, &tmp_blur)?;
    log(&format!(
        "  blurred {} faces in {} frames ({:.0} ms)",
        blur_result.faces_blurred, blur_result.frames_processed, blur_result.duration_ms
    ));

    log(&format!(
        "step 3/4: C2PA D2 sign (= parentOf {})",
        tmp_d1.display()
    ));
    c2pa_sign::sign_d2_with_parent(&tmp_blur, &tmp_d1, &tmp_d2, blur_result.faces_blurred)?;

    log("step 4/4: extract signature_hash (= SHA-256 of D2 active manifest signature)");
    let signature_hash_full = signature_hash::compute_signature_hash(&tmp_d2, "video/mp4")?;
    let signature_hash_hex = signature_hash::to_hex_only(&signature_hash_full)?.to_string();
    log(&format!("  signature_hash = {signature_hash_full}"));

    // 最終 rgb.mp4 を `<signature_hash>/rgb.mp4` の位置に置く (= dev / prod 共通)
    let clip_dir = args.output_dir.join(&signature_hash_hex);
    std::fs::create_dir_all(&clip_dir)?;
    let final_rgb = clip_dir.join("rgb.mp4");
    std::fs::rename(&tmp_d2, &final_rgb)
        .with_context(|| format!("mv {} -> {}", tmp_d2.display(), final_rgb.display()))?;

    // 中間ファイル削除 (= D1 / blur tmp は最終出力に不要)
    let _ = std::fs::remove_file(&tmp_d1);
    let _ = std::fs::remove_file(&tmp_blur);

    // ローカル realtime_handpose / imu / metadata を clip_dir にコピー
    let mut local_paths: Vec<PathBuf> = vec![final_rgb.clone()];
    if let Some(p) = &args.sensors {
        let dst = clip_dir.join("realtime_handpose.jsonl");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }
    if let Some(p) = &args.imu {
        let dst = clip_dir.join("imu.jsonl");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }
    if let Some(p) = &args.intrinsics {
        let dst = clip_dir.join("metadata.json");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }

    let mut output = Output {
        signature_hash: signature_hash_full,
        signature_hash_hex: signature_hash_hex.clone(),
        faces_blurred: blur_result.faces_blurred,
        frames_processed: blur_result.frames_processed,
        blur_duration_ms: blur_result.duration_ms,
        output_width: blur_result.output_width,
        output_height: blur_result.output_height,
        output_paths: None,
        r2_keys: None,
        r2_bucket: None,
        tp_signature_hash: None,
        tp_offchain_key: None,
        tp_register_error: None,
        root_asset_id: None,
        signed_json_uri: None,
        clip_id: None,
        solana_tx_signature: None,
        cnft_mint_error: None,
        clips_register_error: None,
        wallet_pubkey: None,
    };

    match args.profile {
        Profile::Dev => {
            log(&format!("dev profile: skipping R2 upload, files at {}", clip_dir.display()));
            output.output_paths = Some(
                local_paths
                    .into_iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect(),
            );
        }
        Profile::Prod => {
            let account = require_env("R2_ACCOUNT_ID")?;
            let access_key = require_env("R2_ACCESS_KEY_ID")?;
            let secret = require_env("R2_SECRET_ACCESS_KEY")?;
            let bucket = args
                .bucket
                .or_else(|| std::env::var("R2_BUCKET_RAW").ok())
                .ok_or_else(|| {
                    anyhow!("R2 bucket required: pass --bucket or set R2_BUCKET_RAW env")
                })?;

            log(&format!("prod profile: uploading to s3://{bucket}/raw/{signature_hash_hex}/"));
            let client = r2_upload::make_r2_client(&account, &access_key, &secret).await?;
            let upload_result = r2_upload::upload_clip_files(
                &client,
                &bucket,
                &signature_hash_hex,
                &final_rgb,
                args.sensors.as_deref(),
                args.imu.as_deref(),
                args.intrinsics.as_deref(),
            )
            .await?;
            log(&format!(
                "  uploaded {} files / {} bytes",
                upload_result.keys.len(),
                upload_result.total_bytes
            ));
            output.r2_keys = Some(upload_result.keys);
            output.r2_bucket = Some(bucket.clone());

            // ─── step 5: Title Protocol register (= /process) ───────────────
            log("step 5/7: Title Protocol register (= POST /process via Gateway)");
            let signed_key = format!("raw/{signature_hash_hex}/rgb.mp4");
            let env_gateway = std::env::var("TP_GATEWAY_URL").ok();
            let tp_gateway_url: String = args
                .tp_gateway
                .clone()
                .or(env_gateway)
                .unwrap_or_else(|| tp_register::DEFAULT_TP_GATEWAY.to_string());

            let tp_ok = match register_tp(
                &client,
                &bucket,
                &signed_key,
                &signature_hash_hex,
                Some(&tp_gateway_url),
            )
            .await
            {
                Ok((sig_hash, offchain_key, public_url)) => {
                    log(&format!("  tp signature_hash = {sig_hash}"));
                    log(&format!("  tp offchain JSON  = s3://{bucket}/{offchain_key}"));
                    log(&format!("  tp public URL     = {public_url}"));
                    output.tp_signature_hash = Some(sig_hash);
                    output.tp_offchain_key = Some(offchain_key.clone());
                    Some((offchain_key, public_url))
                }
                Err(e) => {
                    let err_msg = format!("{e:#}");
                    log(&format!("  ERROR: TP register failed: {err_msg}"));
                    output.tp_register_error = Some(err_msg);
                    None
                }
            };

            // ─── step 6: cNFT 発行 (= /extension/solana + Solana broadcast) ─
            // tp register が失敗していた場合は cNFT 発行できない (= offchain_data_url が無い)
            let mut cnft_ok = false;
            if let Some((offchain_key, public_url)) = tp_ok {
                log("step 6/7: cNFT mint (= POST /extension/solana + Solana broadcast)");
                let merkle_tree = match args.merkle_tree.as_deref() {
                    Some(s) => s,
                    None => {
                        let msg = "--merkle-tree required for prod profile cNFT mint";
                        log(&format!("  ERROR: {msg}"));
                        output.cnft_mint_error = Some(msg.to_string());
                        ""
                    }
                };

                if !merkle_tree.is_empty() {
                    // offchain_data_url = rootlens-public バケットの公開 URL
                    // (Bubblegum metadata URI 200 文字制限内、 永続)。
                    let offchain_data_url = &public_url;

                    // signed_json_uri = public バケットの永続 URL。
                    // /api/clips にもこれを渡す (永続、 cNFT metadata と同一 URL)。
                    let signed_json_uri = public_url.clone();
                    output.signed_json_uri = Some(signed_json_uri.clone());

                    let keypair = cnft_mint::load_keypair(&args.solana_keypair);
                    match keypair {
                        Ok(payer) => {
                            let outcome = cnft_mint::mint_cnft(
                                &tp_gateway_url,
                                &offchain_data_url,
                                &payer,
                                merkle_tree,
                                args.collection.as_deref(),
                                &args.solana_rpc_url,
                            )
                            .await;
                            match outcome {
                                Ok(m) => {
                                    log(&format!("  root_asset_id = {}", m.root_asset_id));
                                    log(&format!("  solana tx     = {}", m.tx_signature));
                                    output.root_asset_id = Some(m.root_asset_id);
                                    output.solana_tx_signature = Some(m.tx_signature);
                                    cnft_ok = true;
                                }
                                Err(e) => {
                                    let err_msg = format!("{e:#}");
                                    log(&format!("  ERROR: cNFT mint failed: {err_msg}"));
                                    output.cnft_mint_error = Some(err_msg);
                                }
                            }
                        }
                        Err(e) => {
                            let err_msg = format!("load keypair: {e:#}");
                            log(&format!("  ERROR: {err_msg}"));
                            output.cnft_mint_error = Some(err_msg);
                        }
                    }
                }
            }

            // ─── step 7: POST /api/clips (= サーバ DB 行作成) ──────────────
            if cnft_ok {
                log("step 7/7: POST /api/clips (= server clip registration)");
                let root_asset_id = output.root_asset_id.clone().unwrap();
                let signed_json_uri = output.signed_json_uri.clone().unwrap();
                let content_size = std::fs::metadata(&final_rgb)
                    .with_context(|| format!("stat {}", final_rgb.display()))?
                    .len();

                // wallet pubkey は payer keypair から derive (= mock-device は 1 wallet)
                let payer = cnft_mint::load_keypair(&args.solana_keypair)?;
                let wallet_pubkey = cnft_mint::pubkey(&payer).to_string();
                output.wallet_pubkey = Some(wallet_pubkey.clone());

                match clips_register::register_clip(
                    &args.api_base,
                    &wallet_pubkey,
                    &args.task_id,
                    args.achievement,
                    &signature_hash_hex,
                    content_size,
                    &root_asset_id,
                    &signed_json_uri,
                )
                .await
                {
                    Ok(id) => {
                        log(&format!("  clip_id = {id}"));
                        output.clip_id = Some(id);
                    }
                    Err(e) => {
                        let err_msg = format!("{e:#}");
                        log(&format!("  ERROR: /api/clips failed: {err_msg}"));
                        output.clips_register_error = Some(err_msg);
                    }
                }
            }
        }
    }

    log(&format!("total elapsed: {:.0} ms", t0.elapsed().as_millis()));
    println!("{}", serde_json::to_string(&output)?);
    // prod profile で cNFT or clips register が失敗していたら exit 1
    if args.profile == Profile::Prod
        && (output.cnft_mint_error.is_some() || output.clips_register_error.is_some())
    {
        std::process::exit(1);
    }
    Ok(())
}

fn require_env(name: &str) -> Result<String> {
    std::env::var(name).map_err(|_| anyhow!("{name} env var is required for prod profile"))
}

/// presigned GET URL を発行して TP /process を呼び、 ProcessResponse を R2 に保存。
/// raw バケット + public バケットの両方に PUT する。
/// 戻り値は (signature_hash, offchain_key, public_url)。
async fn register_tp(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    signed_key: &str,
    signature_hash_hex: &str,
    gateway: Option<&str>,
) -> Result<(String, String, String)> {
    let content_url = r2_upload::presign_get_url(client, bucket, signed_key, 600).await?;
    let resp = tp_register::register_with_tp(&content_url, gateway).await?;

    let offchain_key = format!("signed-json/{signature_hash_hex}.json");
    let body = serde_json::to_vec_pretty(&resp).context("serialize ProcessResponse")?;

    // raw バケットに保存 (サーバ内部参照用)
    r2_upload::put_bytes(client, bucket, &offchain_key, body.clone(), "application/json").await?;

    // public バケットにも保存 (cNFT metadata URI 用、 公開アクセス可)
    let public_bucket = std::env::var("R2_PUBLIC_BUCKET")
        .unwrap_or_else(|_| "rootlens-public".to_string());
    let public_url_base = std::env::var("R2_PUBLIC_URL")
        .unwrap_or_else(|_| "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev".to_string());
    r2_upload::put_bytes(client, &public_bucket, &offchain_key, body, "application/json").await?;

    let public_url = format!("{}/{offchain_key}", public_url_base.trim_end_matches('/'));
    Ok((resp.signature_hash, offchain_key, public_url))
}

#[allow(dead_code)]
fn ensure_exists(path: &Path, what: &str) -> Result<()> {
    if !path.exists() {
        Err(anyhow!("{what} not found: {}", path.display()))
    } else {
        Ok(())
    }
}
