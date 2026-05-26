// rootlens-mock-device: Pipeline 1 (= iOS 端末側) を macOS で模擬する CLI。
//
// 入力 raw MP4 (+ センサーファイル) を取り、 以下を順に実行:
//   1. C2PA D1 署名 (= c2pa.actions.v2 = [c2pa.created]、 dev ed25519 chain)
//   2. MacOsBlur Swift CLI で Apple Vision 顔ぼかし + H.264 再 encode
//   3. C2PA D2 署名 (= D1 を ingredient parentOf 参照、 c2pa.placed action)
//   4. content_id = SHA-256(D2 active manifest signature) を抽出
//   5. R2 raw バケットに 4 ファイル並列 PUT (prod profile)
//      / ローカル out dir にコピー (dev profile)
//
// stdout に 1 行 JSON で結果を返す。 標準エラー出力に進捗を出す (= --quiet で抑制)。
//
// 詳細は document/v0.1.3/tasks/02-pipeline-1-mock-cli/README.md 参照。

mod blur;
mod c2pa_sign;
mod content_id;
mod jumbf;
mod r2_upload;

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

    /// camera_intrinsics.json (= fx, fy, cx, cy)。 未指定なら省略する。
    #[arg(long)]
    intrinsics: Option<PathBuf>,

    /// 動作モード。 dev = ローカル出力のみ、 prod = R2 アップロード込み
    #[arg(long, value_enum, default_value_t = Profile::Dev)]
    profile: Profile,

    /// 中間 / 最終ファイルを置くディレクトリ。 dev profile では --output-dir 配下に
    /// `<content_id>/rgb.mp4` 等が出る。 prod profile でも R2 PUT 前に一時保存する。
    #[arg(long, default_value = "./mock_device_out")]
    output_dir: PathBuf,

    /// R2 バケット名 (= 環境変数 R2_BUCKET_RAW を override する場合のみ指定)。
    #[arg(long)]
    bucket: Option<String>,

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
    content_id: String,
    /// "sha256:" prefix を除いた 64 文字 hex (= DB の contentId カラム / R2 prefix に使う)
    content_id_hex: String,
    faces_blurred: u32,
    frames_processed: u32,
    blur_duration_ms: f64,
    output_width: u32,
    output_height: u32,
    /// dev profile では `output_paths` (= ローカル絶対パス)、
    /// prod profile では `r2_keys` (= raw/<content_id>/<filename>)
    #[serde(skip_serializing_if = "Option::is_none")]
    output_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r2_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r2_bucket: Option<String>,
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

    log("step 4/4: extract content_id (= SHA-256 of D2 active manifest signature)");
    let content_id_full = content_id::compute_content_id(&tmp_d2, "video/mp4")?;
    let content_id_hex = content_id::to_hex_only(&content_id_full)?.to_string();
    log(&format!("  content_id = {content_id_full}"));

    // 最終 rgb.mp4 を `<content_id>/rgb.mp4` の位置に置く (= dev / prod 共通)
    let clip_dir = args.output_dir.join(&content_id_hex);
    std::fs::create_dir_all(&clip_dir)?;
    let final_rgb = clip_dir.join("rgb.mp4");
    std::fs::rename(&tmp_d2, &final_rgb)
        .with_context(|| format!("mv {} -> {}", tmp_d2.display(), final_rgb.display()))?;

    // 中間ファイル削除 (= D1 / blur tmp は最終出力に不要)
    let _ = std::fs::remove_file(&tmp_d1);
    let _ = std::fs::remove_file(&tmp_blur);

    // ローカル sensors / imu / intrinsics を clip_dir にコピー
    let mut local_paths: Vec<PathBuf> = vec![final_rgb.clone()];
    if let Some(p) = &args.sensors {
        let dst = clip_dir.join("sensors.jsonl");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }
    if let Some(p) = &args.imu {
        let dst = clip_dir.join("imu_high_rate.jsonl");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }
    if let Some(p) = &args.intrinsics {
        let dst = clip_dir.join("camera_intrinsics.json");
        std::fs::copy(p, &dst).with_context(|| format!("cp {} -> {}", p.display(), dst.display()))?;
        local_paths.push(dst);
    }

    let mut output = Output {
        content_id: content_id_full,
        content_id_hex: content_id_hex.clone(),
        faces_blurred: blur_result.faces_blurred,
        frames_processed: blur_result.frames_processed,
        blur_duration_ms: blur_result.duration_ms,
        output_width: blur_result.output_width,
        output_height: blur_result.output_height,
        output_paths: None,
        r2_keys: None,
        r2_bucket: None,
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

            log(&format!("prod profile: uploading to s3://{bucket}/raw/{content_id_hex}/"));
            let client = r2_upload::make_r2_client(&account, &access_key, &secret).await?;
            let upload_result = r2_upload::upload_clip_files(
                &client,
                &bucket,
                &content_id_hex,
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
            output.r2_bucket = Some(bucket);
        }
    }

    log(&format!("total elapsed: {:.0} ms", t0.elapsed().as_millis()));
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn require_env(name: &str) -> Result<String> {
    std::env::var(name).map_err(|_| anyhow!("{name} env var is required for prod profile"))
}

#[allow(dead_code)]
fn ensure_exists(path: &Path, what: &str) -> Result<()> {
    if !path.exists() {
        Err(anyhow!("{what} not found: {}", path.display()))
    } else {
        Ok(())
    }
}
