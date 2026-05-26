import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  signedMp4Key,
  rawSessionFileKey,
  datasetPrefix,
  type RawSessionFilename,
} from "./r2-keys";

// Cloudflare R2 (= S3 互換) アクセス。
//
// R2 の egress は無料なので、 端末と買い手は R2 と直接 PUT / GET する。 サーバは presigned URL の
// 発行と、 サーバ自身が R2 を読み書きする必要がある時 (= Modal 関数経由 / TP submit の R2 download)
// だけ S3Client を使う。
//
// バケット構成 (= v0.1.3 で 2 バケットに簡素化):
//   R2_BUCKET_RAW       端末アップロードの全ファイル (= rgb.mp4 + sensors.jsonl 等)。 非公開、 短期 retention。
//                        rgb.mp4 は既に端末で blur + C2PA D2 署名済。
//   R2_BUCKET_DATASETS  Pipeline 3 出力 (= LeRobot v3 dataset、 buyer 配信用)。

if (!process.env.R2_ACCOUNT_ID) {
  throw new Error("R2_ACCOUNT_ID is not set.");
}
if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error("R2 credentials are not set.");
}
if (!process.env.R2_BUCKET_RAW) {
  throw new Error("R2_BUCKET_RAW is not set.");
}
if (!process.env.R2_BUCKET_DATASETS) {
  throw new Error("R2_BUCKET_DATASETS is not set.");
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
const BUCKET_DATASETS = process.env.R2_BUCKET_DATASETS;

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここから再エクスポート。
export { signedMp4Key, datasetPrefix };

// ─── presigned URLs ────────────────────────────────────────────────────

/// クリップ 1 件の 4 ファイル分の PUT presigned URL を一括発行。
/// 端末はこれを受けて 4 並列 PUT する (= raw/<content_id>/{rgb.mp4 + sensors.jsonl
/// + imu_high_rate.jsonl + camera_intrinsics.json})。
/// depth/ (= Pro 端末の per-frame PNG) は別途トークンベースで扱う想定で、 本関数は固定 4 ファイルのみ。
export async function presignRawSessionUploads(opts: {
  contentId: string;
  expiresInSec?: number;
}): Promise<RawSessionUploadResponse> {
  const expiresIn = opts.expiresInSec ?? 3600;
  const filenames: RawSessionFilename[] = [
    "rgb.mp4",
    "sensors.jsonl",
    "imu_high_rate.jsonl",
    "camera_intrinsics.json",
  ];
  const contentTypes: Record<RawSessionFilename, string> = {
    "rgb.mp4": "video/mp4",
    "sensors.jsonl": "application/x-ndjson",
    "imu_high_rate.jsonl": "application/x-ndjson",
    "camera_intrinsics.json": "application/json",
  };
  const files: RawSessionUploadResponse["files"] = {} as RawSessionUploadResponse["files"];
  for (const filename of filenames) {
    const key = rawSessionFileKey(opts.contentId, filename);
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

/// 署名済 MP4 (= raw/<content_id>/rgb.mp4) の GET 事前署名 URL。
/// 撮影者プレビュー + Pipeline 2 / 3 内での Modal からの読み取り両方に使う。
export async function presignSignedMp4Get(opts: {
  contentId: string;
  expiresInSec?: number;
}): Promise<{ url: string; key: string }> {
  const key = signedMp4Key(opts.contentId);
  const cmd = new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key });
  const url = await getSignedUrl(r2, cmd, { expiresIn: opts.expiresInSec ?? 3600 });
  return { url, key };
}

/// 任意のキーに対する raw バケット GET 事前署名 URL。
export async function presignRawGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

/// LeRobot dataset 配下の任意ファイル GET URL (= buyer が License NFT 保有確認後に取得)。
export async function presignDatasetGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_DATASETS, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export { r2, BUCKET_RAW, BUCKET_DATASETS };
