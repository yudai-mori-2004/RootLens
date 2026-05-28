// Cloudflare R2 (= S3 互換) アップロード。
//
// aws-sdk-s3 で endpoint URL を R2 の "https://<account_id>.r2.cloudflarestorage.com" に差し替え。
// region は "auto"、 認証は AWS_ACCESS_KEY_ID 形式 + secret。
// signature_hash を prefix にして raw/<signature_hash>/<filename> 配下に PUT。

use anyhow::{anyhow, Context, Result};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// R2 PUT 1 ファイルあたりの最大同時実行 (= aws-sdk-s3 内部 connection pool で十分)。
const MAX_CONCURRENT_UPLOADS: usize = 4;

/// signature_hash 配下にアップロードする 4 ファイル + depth/ の組。
pub struct UploadFile {
    /// ローカル絶対パス
    pub local_path: PathBuf,
    /// R2 内の object key (= raw/<signature_hash>/<filename> 形式)
    pub key: String,
    /// HTTP Content-Type ヘッダ
    pub content_type: &'static str,
}

/// R2 アップロード結果。
pub struct UploadResult {
    pub keys: Vec<String>,
    pub total_bytes: u64,
}

/// R2 (= S3 互換) クライアントを構築する。
pub async fn make_r2_client(account_id: &str, access_key: &str, secret: &str) -> Result<Client> {
    let endpoint = format!("https://{account_id}.r2.cloudflarestorage.com");
    let creds = Credentials::new(access_key, secret, None, None, "rootlens-mock-device");

    let config = aws_config::defaults(BehaviorVersion::latest())
        .endpoint_url(endpoint)
        .region(Region::new("auto"))
        .credentials_provider(creds)
        .load()
        .await;

    Ok(Client::new(&config))
}

/// 4 ファイル + depth/ を並列で PUT する。
pub async fn upload_files(
    client: &Client,
    bucket: &str,
    files: Vec<UploadFile>,
) -> Result<UploadResult> {
    use tokio::task::JoinSet;

    let mut total_bytes: u64 = 0;
    for f in &files {
        total_bytes += std::fs::metadata(&f.local_path)?.len();
    }

    let mut set = JoinSet::new();
    let mut active = 0usize;
    let mut files_iter = files.into_iter();
    let mut keys: Vec<String> = Vec::new();

    loop {
        while active < MAX_CONCURRENT_UPLOADS {
            let Some(file) = files_iter.next() else {
                break;
            };
            active += 1;
            let client = client.clone();
            let bucket = bucket.to_string();
            set.spawn(async move {
                let body = ByteStream::from_path(&file.local_path).await.map_err(|e| {
                    anyhow!("read {} as ByteStream: {e}", file.local_path.display())
                })?;
                client
                    .put_object()
                    .bucket(&bucket)
                    .key(&file.key)
                    .body(body)
                    .content_type(file.content_type)
                    .send()
                    .await
                    .with_context(|| format!("PUT {}/{}", bucket, file.key))?;
                Ok::<String, anyhow::Error>(file.key)
            });
        }

        let Some(result) = set.join_next().await else {
            break;
        };
        active -= 1;
        match result {
            Ok(Ok(key)) => keys.push(key),
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(anyhow!("join_next: {e}")),
        }
    }

    Ok(UploadResult { keys, total_bytes })
}

/// raw/<signature_hash>/ 配下にクリップのファイルをまとめてアップロードする (DATA_SPECS §2.2 / §5)。
/// 超広角構成: rgb.mp4 + realtime_handpose.jsonl + metadata.json。 imu.jsonl は ARKit 構成のみ。
pub async fn upload_clip_files(
    client: &Client,
    bucket: &str,
    signature_hash_hex: &str,
    rgb_mp4: &Path,
    realtime_handpose_jsonl: Option<&Path>,
    imu_jsonl: Option<&Path>,
    metadata_json: Option<&Path>,
) -> Result<UploadResult> {
    let prefix = format!("raw/{signature_hash_hex}");
    let mut files = vec![UploadFile {
        local_path: rgb_mp4.to_path_buf(),
        key: format!("{prefix}/rgb.mp4"),
        content_type: "video/mp4",
    }];

    if let Some(p) = realtime_handpose_jsonl {
        files.push(UploadFile {
            local_path: p.to_path_buf(),
            key: format!("{prefix}/realtime_handpose.jsonl"),
            content_type: "application/x-ndjson",
        });
    }
    if let Some(p) = imu_jsonl {
        files.push(UploadFile {
            local_path: p.to_path_buf(),
            key: format!("{prefix}/imu.jsonl"),
            content_type: "application/x-ndjson",
        });
    }
    if let Some(p) = metadata_json {
        files.push(UploadFile {
            local_path: p.to_path_buf(),
            key: format!("{prefix}/metadata.json"),
            content_type: "application/json",
        });
    }

    upload_files(client, bucket, files).await
}

/// 指定 key に対する presigned GET URL を発行する。 TP Gateway が R2 から Range Request で
/// fetch するのに使う。 expires_secs は 5 分以上が安全 (= TEE fetch + 検証で時間取る)。
pub async fn presign_get_url(
    client: &Client,
    bucket: &str,
    key: &str,
    expires_secs: u64,
) -> Result<String> {
    let cfg = PresigningConfig::expires_in(Duration::from_secs(expires_secs))
        .context("PresigningConfig::expires_in")?;
    let req = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(cfg)
        .await
        .with_context(|| format!("presign GET {bucket}/{key}"))?;
    Ok(req.uri().to_string())
}

/// 任意 bytes を R2 に PUT する。 ProcessResponse を JSON 化して signed-json/<signature_hash>.json に
/// 保存する用。
pub async fn put_bytes(
    client: &Client,
    bucket: &str,
    key: &str,
    bytes: Vec<u8>,
    content_type: &'static str,
) -> Result<()> {
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(bytes))
        .content_type(content_type)
        .send()
        .await
        .with_context(|| format!("PUT {bucket}/{key}"))?;
    Ok(())
}
