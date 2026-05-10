/**
 * 仕様書 §6.2 パイプラインB: データ保存 — R2ストレージ
 * Unit F (SPECS §4.3): content_hash を R2 object key にして HEAD ベースで dedup する。
 *
 * Cloudflare R2 (S3互換) クライアント。
 * - 公開バケット: 表示用コンテンツ + OGP画像
 * - 非公開バケット: オリジナル生データ (将来実装)
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// クライアント初期化
// ---------------------------------------------------------------------------

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const PUBLIC_BUCKET = process.env.R2_PUBLIC_BUCKET || "rootlens-public";
const PUBLIC_URL = process.env.R2_PUBLIC_URL!; // e.g. https://cdn.rootlens.io or R2 public URL

// ---------------------------------------------------------------------------
// 内部 export (テスト用 / 他ヘルパーから利用)
// ---------------------------------------------------------------------------

/** S3Client インスタンス。ルート側でテスト時に挙動を上書きしたい時のためだけに export */
export const _r2 = r2;
export const _PUBLIC_BUCKET = PUBLIC_BUCKET;
export const _PUBLIC_URL = PUBLIC_URL;

// ---------------------------------------------------------------------------
// 公開バケット操作
// ---------------------------------------------------------------------------

/**
 * 公開バケットにファイルをアップロードし、公開URLを返す。
 * (server-side put。クライアント側は createPresignedPutUrl 経由で R2 に直接 PUT する)
 */
export async function uploadPublic(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `${PUBLIC_URL}/${key}`;
}

/**
 * 公開バケットへの presigned PUT URL を発行する。
 * クライアントが R2 に直接アップロードするために使用。
 * 期限切れ前ならクライアントが put-once で完了できるよう、デフォルト 600s。
 */
export async function createPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn: number = 600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: PUBLIC_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
}

/** 公開バケットからファイルを削除する。 */
export async function deletePublic(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
    }),
  );
}

/**
 * 公開バケット上で key に対応する object が存在するかを HEAD で確認する。
 *
 * - 200 → true
 * - 404 / NotFound → false
 * - 403 / その他 → throw (上位で 500 として扱うべき。"存在しないこと" の判定に
 *   silent fall through すると、dedup を貫通して二重アップロードを許してしまう)
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: PUBLIC_BUCKET,
        Key: key,
      }),
    );
    return true;
  } catch (e: unknown) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

function isNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  // AWS SDK v3 は HEAD 404 を name="NotFound" / $metadata.httpStatusCode=404 で返す
  const anyE = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (anyE.name === "NotFound" || anyE.name === "NoSuchKey") return true;
  if (anyE.$metadata?.httpStatusCode === 404) return true;
  return false;
}

// ---------------------------------------------------------------------------
// content_hash → R2 key (Unit F)
// ---------------------------------------------------------------------------

export type ContentKind = "media" | "ogp" | "content";

/**
 * クライアントから渡される content_hash を R2 key 用に正規化する。
 *
 * 受け入れる形式:
 *   - 0x prefix 有 / 無 のいずれも可
 *   - 大文字 / 小文字 / 混在 のいずれも可
 *
 * 正規化結果: lowercase 64 文字 hex (0x prefix 無)。
 * 不正な入力 (長さ不一致、非 hex 文字、空) は Error を throw。
 *
 * これにより `0xABcd...` と `abcd...` が同一 key に解決し、TP からの返値の
 * 表現揺れによる dedup miss を防ぐ。
 */
export function normalizeContentHash(input: string): string {
  if (typeof input !== "string") throw new Error("content_hash must be a string");
  const stripped = input.startsWith("0x") || input.startsWith("0X")
    ? input.slice(2)
    : input;
  const lower = stripped.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(lower)) {
    throw new Error(
      `content_hash must be 64 hex chars (got length=${stripped.length})`,
    );
  }
  return lower;
}

/**
 * content_hash + kind + ext から R2 object key を生成する。
 *
 * 形式: `{kind}/{content_hash}.{ext}`
 *
 * 同じ content_hash + kind は常に同じ key になるため、HEAD 1 回で dedup 判定が完結する。
 * ext は normalizeExt() を通して正規化済みであること (例: "video/mp4" → "mp4")。
 */
export function keyForContentHash(
  contentHash: string,
  kind: ContentKind,
  ext: string,
): string {
  const normHash = normalizeContentHash(contentHash);
  const normExt = normalizeExt(ext);
  return `${kind}/${normHash}.${normExt}`;
}

/**
 * MIME / 拡張子文字列を R2 key 用の小文字英数 ext に正規化する。
 *
 * - "video/mp4" → "mp4"
 * - "video/quicktime" → "mov" (iOS の AVAssetWriter mp4/mov 出力対応)
 * - "image/jpeg" → "jpg"
 * - 既に "mp4" 等の素の ext ならそのまま小文字化
 *
 * 結果は `[a-z0-9]{1,8}` を満たす必要があり、満たさない場合は Error。
 */
export function normalizeExt(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("ext / contentType must be a non-empty string");
  }
  let ext = input.toLowerCase();
  if (ext.includes("/")) ext = ext.split("/", 2)[1] ?? "";
  // MIME → ext のうち R2 key にしたとき表記が揺れるものだけ吸収
  if (ext === "jpeg") ext = "jpg";
  if (ext === "quicktime") ext = "mov";
  // パラメータ部 (e.g. "mp4; codecs=avc1") を落とす
  ext = ext.split(";", 1)[0].trim();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) {
    throw new Error(`unsupported ext: "${input}"`);
  }
  return ext;
}

/**
 * content_hash に紐づく R2 公開 URL を返す (object 存在前提)。
 * `keyForContentHash()` の結果を `${PUBLIC_URL}/${key}` に乗せるだけ。
 */
export function publicUrlFor(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

// ---------------------------------------------------------------------------
// 旧式ヘルパー (legacy: fileId 形式 / 内部利用のみ。新規呼び出しは keyForContentHash を使う)
// ---------------------------------------------------------------------------

/** @deprecated Use keyForContentHash(hash, "content", ext). */
export function contentKey(fileId: string, ext: string = "jpg"): string {
  return `content/${fileId}.${ext}`;
}

/** @deprecated Use keyForContentHash(hash, "ogp", "jpg"). */
export function ogpKey(fileId: string): string {
  return `ogp/${fileId}.jpg`;
}

/** @deprecated Use keyForContentHash(hash, "media", ext). */
export function mediaKey(fileId: string, ext: string): string {
  return `media/${fileId}.${ext}`;
}
