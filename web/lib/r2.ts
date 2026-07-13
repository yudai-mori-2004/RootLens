import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  rawMp4Key,
  rawSessionFileKey,
  RAW_SESSION_MANIFEST,
  type RecordingConfigId,
  type RawSessionFilename,
} from "./r2-keys";

// Cloudflare R2 (= S3 互換) アクセス。
//
// バケットは撮影構成ごとに分離する:
//   ultra_wide → R2_BUCKET_RAW        (= rootlens-raw)
//   arkit      → R2_BUCKET_RAW_ARKIT  (= 既定 rootlens-raw-arkit、 env で上書き)

if (!process.env.R2_ACCOUNT_ID) {
  throw new Error("R2_ACCOUNT_ID is not set.");
}
if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error("R2 credentials are not set.");
}
if (!process.env.R2_BUCKET_RAW) {
  throw new Error("R2_BUCKET_RAW is not set.");
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_RAW = process.env.R2_BUCKET_RAW;
const BUCKET_RAW_ARKIT = process.env.R2_BUCKET_RAW_ARKIT ?? "rootlens-raw-arkit";

/// 撮影構成 → アップロード先バケット。
export function rawBucketFor(config: RecordingConfigId): string {
  return config === "arkit" ? BUCKET_RAW_ARKIT : BUCKET_RAW;
}

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここから再エクスポート。
export { rawMp4Key };

// ─── presigned URLs ────────────────────────────────────────────────────

/// クリップ 1 件の撮影構成ファイル分の PUT presigned URL を一括発行 (DATA_SPECS §2.4)。
/// 構成マニフェスト (RAW_SESSION_MANIFEST) のファイルだけを、 構成対応バケットに presign する。
/// optional なファイル (= depth.tar 等) も presign には含め、 端末は実際に生成したものだけ PUT する。
export async function presignRawSessionUploads(opts: {
  contentHash: string;
  recordingConfig: RecordingConfigId;
  expiresInSec?: number;
}): Promise<RawSessionUploadResponse> {
  const expiresIn = opts.expiresInSec ?? 3600;
  const bucket = rawBucketFor(opts.recordingConfig);
  const manifest = RAW_SESSION_MANIFEST[opts.recordingConfig];
  const files: RawSessionUploadResponse["files"] = {};
  for (const { filename, contentType } of manifest) {
    const key = rawSessionFileKey(opts.contentHash, filename);
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(r2, cmd, { expiresIn });
    files[filename] = { url, key, contentType };
  }
  return {
    files,
    bucket,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export interface RawSessionUploadResponse {
  files: Partial<
    Record<RawSessionFilename, { url: string; key: string; contentType: string }>
  >;
  /// presign したバケット名 (= デバッグ表示用)。
  bucket: string;
  expiresAt: string;
}

/// 任意のキーに対する raw GET 事前署名 URL (= 撮影者の履歴再生 / デバッグ用)。
/// バケットは構成依存 (= rawBucketFor) なので呼び出し側が渡す。 省略時は ultra_wide 側。
export async function presignRawGet(
  key: string,
  bucket: string = BUCKET_RAW,
  expiresInSec = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export { r2, BUCKET_RAW, BUCKET_RAW_ARKIT };
