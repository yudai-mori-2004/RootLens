import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  rawMp4Key,
  rawSessionFileKey,
  rawSessionPrefix,
  RAW_SESSION_MANIFEST,
  type RecordingConfigId,
  type RawSessionFilename,
} from "./r2-keys";

// Cloudflare R2 (= S3 互換) アクセス。
//
// バケットは撮影構成ごとに分離する:
//   ultra_wide → R2_BUCKET_RAW        (= rootlens-raw)
//   arkit      → R2_BUCKET_RAW_ARKIT  (= 既定 rootlens-raw-arkit、 env で上書き)
//   mentra     → R2_BUCKET_RAW_MENTRA (= 既定 rootlens-raw-mentra、 env で上書き)
//   iphone     → R2_BUCKET_RAW        (= rootlens-raw。ultra_wideと同じ既存iPhone raw bucket)

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
const BUCKET_RAW_MENTRA = process.env.R2_BUCKET_RAW_MENTRA ?? "rootlens-raw-mentra";
// iPhone RGB+IMU is part of the existing iPhone raw dataset. This alias is
// intentionally not configurable independently so app/server/ops cannot drift
// onto a fourth bucket by environment accident.
const BUCKET_RAW_IPHONE = BUCKET_RAW;

/// 撮影構成 → アップロード先バケット。
export function rawBucketFor(config: RecordingConfigId): string {
  if (config === "ultra_wide") return BUCKET_RAW;
  if (config === "arkit") return BUCKET_RAW_ARKIT;
  if (config === "iphone") return BUCKET_RAW_IPHONE;
  return BUCKET_RAW_MENTRA;
}

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここから再エクスポート。
export { rawMp4Key };

// ─── presigned URLs ────────────────────────────────────────────────────

/// クリップ 1 件の撮影構成ファイル分の PUT presigned URL を一括発行。
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

/// presign だけでは存在しない key にも URL を作れるため、再生前の fail-fast に使う。
export async function rawObjectExists(key: string, bucket: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}

/// content hash 配下の raw 一式を削除する。DB 行より先に R2 を消すことで、
/// API が成功を返したのに実データだけ残る状態を作らない。prefix は content hash からのみ組み立てる。
export async function deleteRawSession(contentHash: string, bucket: string): Promise<number> {
  if (!/^[0-9a-f]{64}$/i.test(contentHash)) {
    throw new Error("Invalid content hash for R2 deletion");
  }

  const prefix = rawSessionPrefix(contentHash);
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key?.startsWith(prefix)) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let offset = 0; offset < keys.length; offset += 1000) {
    const batch = keys.slice(offset, offset + 1000);
    const result = await r2.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: false,
      },
    }));
    if ((result.Errors ?? []).length > 0) {
      const first = result.Errors![0];
      throw new Error(`R2 deletion failed for ${first.Key}: ${first.Code} ${first.Message}`);
    }
  }

  return keys.length;
}

export { r2, BUCKET_RAW, BUCKET_RAW_ARKIT, BUCKET_RAW_MENTRA, BUCKET_RAW_IPHONE };
