import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  rawMp4Key,
  rawSessionFileKey,
  blurredMp4Key,
  datasetPrefix,
  type RawSessionFilename,
} from "./r2-keys";

// 注意: AWS SDK 依存。 workflow worker bundle に取り込まれないよう、
// 純粋な key 命名関数は lib/r2-keys.ts に分離。
// workflow 内で必要なのは命名のみなので、 そちらだけを import するように調整済。

// Cloudflare R2 (= S3 互換) アクセス。
//
// R2 の egress は無料なので、 クライアントと買い手は R2 と直接 PUT / GET する。
// サーバは事前署名 URL の発行と、 サーバ自身が R2 を読み書きする必要がある時 (= Modal 関数経由
// + TP submit 時の R2 download) だけ S3Client を使う。
//
// バケット構成:
//   R2_BUCKET_RAW       : 端末 upload された 生データ (= rgb.mp4 + sensors.jsonl 等、 非公開、 短期 retention)
//   R2_BUCKET_BLURRED   : Pipeline 2 出力 (= ぼかし済 MP4、 preview 兼 dataset RGB ソース)
//                          - blurred-mp4/<contentHash>.mp4
//   R2_BUCKET_DATASETS  : Pipeline 3 出力 (= LeRobot v3 dataset、 buyer 配信用)。 未設定なら BLURRED を流用
//                          - datasets/<root_asset_id>/{meta,data,videos}/

if (!process.env.R2_ACCOUNT_ID) {
  throw new Error("R2_ACCOUNT_ID is not set.");
}
if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error("R2 credentials are not set.");
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_RAW = process.env.R2_BUCKET_RAW ?? "rootlens-mcap-raw";
const BUCKET_BLURRED = process.env.R2_BUCKET_BLURRED ?? "rootlens-mcap-blurred";
const BUCKET_DATASETS = process.env.R2_BUCKET_DATASETS ?? BUCKET_BLURRED;

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここからも re-export する。
export { rawMp4Key, blurredMp4Key, datasetPrefix };

// ─── presigned URLs ────────────────────────────────────────────────────

/// セッション 1 件の 4 ファイル分の PUT presigned URL を一括発行。
/// 端末はこれを受けて 4 並列 PUT する (= raw/<contentHash>/rgb.mp4 + sensors.jsonl
/// + imu_high_rate.jsonl + camera_intrinsics.json)。 depth/ (= Pro 機の per-frame PNG)
/// は別途 token ベースで扱う想定で、 本関数は深さ 0 のファイルのみ扱う。
export async function presignRawSessionUploads(opts: {
  contentHash: string;
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
    const key = rawSessionFileKey(opts.contentHash, filename);
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

/// 互換用: 既存呼出 (= rgb.mp4 1 ファイルだけの presigned URL) を維持する。
export async function presignRawMp4Upload(opts: {
  contentHash: string;
  expiresInSec?: number;
}): Promise<{ url: string; key: string }> {
  const key = rawMp4Key(opts.contentHash);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET_RAW,
    Key: key,
    ContentType: "video/mp4",
  });
  const url = await getSignedUrl(r2, cmd, { expiresIn: opts.expiresInSec ?? 3600 });
  return { url, key };
}

/// ぼかし済 MP4 (= preview) の GET 事前署名 URL。 撮影者が Stake シートで再生する。
export async function presignBlurredMp4Get(opts: {
  contentHash: string;
  expiresInSec?: number;
}): Promise<{ url: string; key: string }> {
  const key = blurredMp4Key(opts.contentHash);
  const cmd = new GetObjectCommand({ Bucket: BUCKET_BLURRED, Key: key });
  const url = await getSignedUrl(r2, cmd, { expiresIn: opts.expiresInSec ?? 3600 });
  return { url, key };
}

/// 任意のキーに対する blurred バケット GET 事前署名 URL (= preview MP4 等)。
export async function presignBlurredGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_BLURRED, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

/// LeRobot dataset 配下の任意ファイル GET URL (= buyer が License NFT 保有確認後に取得)。
export async function presignDatasetGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_DATASETS, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export { r2, BUCKET_RAW, BUCKET_BLURRED, BUCKET_DATASETS };
