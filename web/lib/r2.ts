import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  signedMp4Key,
  rawSessionFileKey,
  processedPrefix,
  type RawSessionFilename,
} from "./r2-keys";

// Cloudflare R2 (= S3 互換) アクセス。
//
// R2 の egress は無料なので、 端末と買い手は R2 と直接 PUT / GET する。 サーバは presigned URL の
// 発行と、 サーバ自身が R2 を読み書きする必要がある時 (= Modal 関数経由 / TP submit の R2 download)
// だけ S3Client を使う。
//
// バケット構成 (DATA_SPECS §5):
//   R2_BUCKET_RAW        端末アップロード (= raw/<signature_hash>/ の rgb.mp4 + realtime_handpose.jsonl +
//                        metadata.json 等)。 rgb.mp4 は既に端末で blur + C2PA D2 署名済。 非公開、 短期 retention。
//   R2_BUCKET_PROCESSED  Pipeline 2 / 3 の計算結果 (= processed/<signature_hash>/ の quality_scores.json +
//                        semantic.jsonl + wilor.jsonl)。 raw を元にした追加情報。

if (!process.env.R2_ACCOUNT_ID) {
  throw new Error("R2_ACCOUNT_ID is not set.");
}
if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error("R2 credentials are not set.");
}
if (!process.env.R2_BUCKET_RAW) {
  throw new Error("R2_BUCKET_RAW is not set.");
}
if (!process.env.R2_BUCKET_PROCESSED) {
  throw new Error("R2_BUCKET_PROCESSED is not set.");
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
const BUCKET_PROCESSED = process.env.R2_BUCKET_PROCESSED;

// key / prefix 命名関数は lib/r2-keys.ts に分離。 互換性のためここから再エクスポート。
export { signedMp4Key, processedPrefix };

// ─── presigned URLs ────────────────────────────────────────────────────

/// クリップ 1 件の撮影構成ファイル分の PUT presigned URL を一括発行 (DATA_SPECS §2.2)。
/// 全構成のファイルを presign し、 端末はその構成で実際に生成したものだけ PUT する
/// (= 超広角: rgb + realtime_handpose + metadata、 ARKit: + imu.jsonl)。
/// depth/ (ARKit + Pro) は可変枚数なので別扱い (現状アップロード対象外)。
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

/// 署名済 MP4 (= raw/<signature_hash>/rgb.mp4) の GET 事前署名 URL。
/// 撮影者プレビュー + Pipeline 2 / 3 内での Modal からの読み取り両方に使う。
export async function presignSignedMp4Get(opts: {
  signatureHash: string;
  expiresInSec?: number;
}): Promise<{ url: string; key: string }> {
  const key = signedMp4Key(opts.signatureHash);
  const cmd = new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key });
  const url = await getSignedUrl(r2, cmd, { expiresIn: opts.expiresInSec ?? 3600 });
  return { url, key };
}

/// 任意のキーに対する raw バケット GET 事前署名 URL。
export async function presignRawGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

/// processed/ 配下の任意ファイル GET URL (= Pipeline 2 / 3 の計算結果取得)。
export async function presignProcessedGet(key: string, expiresInSec = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_PROCESSED, Key: key });
  return await getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export { r2, BUCKET_RAW, BUCKET_PROCESSED };
