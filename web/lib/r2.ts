import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  signedMp4Key,
  rawSessionFileKey,
  type RawSessionFilename,
} from "./r2-keys";

// Cloudflare R2 (= S3 互換) アクセス。
//
// v0.1.4: 端末は raw バケットに PUT (= presigned)、 撮影者プレビューは raw GET (= presigned)。
// processed バケットは v0.1.4 では使わない (= 後段ワーカー未配線、 v0.1.5 で復活)。
// R2_BUCKET_PROCESSED env はあれば使う、 なくても起動失敗にしない。

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

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここから再エクスポート。
export { signedMp4Key };

// ─── presigned URLs ────────────────────────────────────────────────────

/// クリップ 1 件の撮影構成ファイル分の PUT presigned URL を一括発行 (DATA_SPECS §2.4)。
/// 全構成のファイルを presign し、 端末はその構成で実際に生成したものだけ PUT する
/// (= 超広角: rgb + realtime_handpose + metadata、 ARKit: + imu.jsonl、 LiDAR 機: + depth.tar)。
export async function presignRawSessionUploads(opts: {
  signatureHash: string;
  expiresInSec?: number;
}): Promise<RawSessionUploadResponse> {
  const expiresIn = opts.expiresInSec ?? 3600;
  const filenames: RawSessionFilename[] = [
    "rgb.mp4",
    "realtime_handpose.jsonl",
    "metadata.json",
    "imu.jsonl",
    "depth.tar",
  ];
  const contentTypes: Record<RawSessionFilename, string> = {
    "rgb.mp4": "video/mp4",
    "realtime_handpose.jsonl": "application/x-ndjson",
    "metadata.json": "application/json",
    "imu.jsonl": "application/x-ndjson",
    "depth.tar": "application/x-tar",
  };
  const files: RawSessionUploadResponse["files"] = {} as RawSessionUploadResponse["files"];
  for (const filename of filenames) {
    const key = rawSessionFileKey(opts.signatureHash, filename);
    const cmd = new PutObjectCommand({
      Bucket: BUCKET_RAW,
      Key: key,
      ContentType: contentTypes[filename],
    });
    const url = await getSignedUrl(r2, cmd, { expiresIn });
    files[filename] = { url, key, contentType: contentTypes[filename] };
  }
  return { files, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export interface RawSessionUploadResponse {
  files: Record<
    RawSessionFilename,
    { url: string; key: string; contentType: string }
  >;
  expiresAt: string;
}

/// 任意のキーに対する raw バケット GET 事前署名 URL (= 撮影者プレビュー / デバッグ用)。
export async function presignRawGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export { r2, BUCKET_RAW };
