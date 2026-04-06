/**
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 *
 * データフロー:
 *  1. サーバー: shortId → { contentHash, thumbnailUrl, ogpImageUrl }
 *  2. DAS API: content_hash trait → cNFT メタデータ
 *  3. オフチェーンストレージ: json_uri → signed_json
 *  4. ブラウザ内検証: Ed25519 + PDQ (サーバー関与なし)
 */

import type { PageMeta, ContentRecord } from "./types";
import type { ResolvedContent } from "./verify/content-resolver";
import type { VerificationResult } from "./verify/checks/types";
import type { CorePayload } from "@title-protocol/sdk";
import { contentResolver } from "./verify/content-resolver";
import { verifyAll } from "./verify/verify";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Supabase: shortId → PageMeta
// ---------------------------------------------------------------------------

export async function resolvePageMeta(
  shortId: string
): Promise<PageMeta | null> {
  const { data, error } = await supabase
    .from("pages")
    .select(
      `
      short_id,
      caption,
      published_at,
      users (
        address,
        username,
        display_name,
        bio,
        avatar_url
      ),
      contents (
        content_hash,
        thumbnail_url,
        ogp_image_url,
        media_url,
        content_type
      )
    `
    )
    .eq("short_id", shortId)
    .eq("status", "published")
    .single();

  if (error || !data) return null;

  const rawContents = (data.contents as unknown as Array<{
    content_hash: string;
    thumbnail_url: string;
    ogp_image_url: string;
    media_url: string;
    content_type: string;
  }>) ?? [];

  if (rawContents.length === 0) return null;

  const rawUser = data.users as unknown as {
    address: string;
    username: string | null;
    display_name: string;
    bio: string;
    avatar_url: string | null;
  } | null;

  const rawData = data as unknown as { caption?: string | null; published_at?: string };

  return {
    shortId,
    caption: rawData.caption ?? null,
    publishedAt: rawData.published_at || new Date().toISOString(),
    contents: rawContents.map((c) => ({
      contentHash: c.content_hash,
      thumbnailUrl: c.thumbnail_url || "",
      ogpImageUrl: c.ogp_image_url || "",
      mediaUrl: c.media_url || "",
      mediaType: c.content_type || "image",
    })),
    user: rawUser ? {
      address: rawUser.address,
      username: rawUser.username ?? null,
      displayName: rawUser.display_name,
      bio: rawUser.bio,
      avatarUrl: rawUser.avatar_url,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// ResolvedContent → ContentRecord 変換
// ---------------------------------------------------------------------------

function toContentRecord(resolved: ResolvedContent): ContentRecord {
  const sj = resolved.coreSignedJson;
  const payload = sj?.payload;

  const getAttr = (key: string) =>
    resolved.attributes.find((a) => a.trait_type === key)?.value;

  const contentType = getAttr("content_type") || "image/jpeg";
  const isVideo =
    contentType.startsWith("video/") || contentType === "video";

  return {
    deviceName: getAttr("device_name") || "",
    appName: getAttr("app_name") || "RootLens",
    appVersion: getAttr("app_version") || "",
    capturedAt:
      getAttr("captured_at") ||
      (payload && "tsa_timestamp" in payload && (payload as CorePayload).tsa_timestamp
        ? new Date((payload as CorePayload).tsa_timestamp! * 1000).toISOString()
        : null),
    mediaType: isVideo ? "video" : "image",
    sourceDimensions: parseDimensions(getAttr("source_dimensions")),
    assuranceLevel: parseAssuranceLevel(getAttr("assurance_level")),
    teeType: sj?.tee_type || getAttr("tee_type") || "Unknown",
    signingAlgorithm: getAttr("signing_algorithm") || "ECDSA P-256 (ES256)",
    tsaProvider: getAttr("tsa_provider") || null,
    tsaTimestamp: getAttr("tsa_timestamp") || null,
    editOperations: [],
  };
}

function parseDimensions(
  raw: string | undefined
): { width: number; height: number } {
  if (!raw) return { width: 0, height: 0 };
  const parts = raw.split(/[x,×]/);
  if (parts.length === 2) {
    return {
      width: parseInt(parts[0], 10) || 0,
      height: parseInt(parts[1], 10) || 0,
    };
  }
  return { width: 0, height: 0 };
}

function parseAssuranceLevel(raw: string | undefined): 1 | 2 {
  const n = parseInt(raw || "1", 10);
  return n === 2 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// content_hash → DAS → ContentRecord
// ---------------------------------------------------------------------------

/**
 * content_hash からオンチェーンのコンテンツ記録を取得する。
 * DAS API で cNFT を trait 検索 → オフチェーンストレージから signed_json 取得。
 */
export async function fetchContentRecord(
  contentHash: string,
): Promise<{ record: ContentRecord | null; resolved: ResolvedContent | null }> {
  const resolved = await contentResolver.resolveByContentHash(contentHash);

  if (!resolved) {
    return { record: null, resolved: null };
  }

  return { record: toContentRecord(resolved), resolved };
}

// ---------------------------------------------------------------------------
// クライアントサイド検証
// ---------------------------------------------------------------------------

/**
 * オンチェーンデータに基づくクライアントサイド検証を実行する。
 * cNFT が見つからない場合は全ステップ failed を返す。
 */
export async function verifyContent(
  contentHash: string,
  perceptual: { imageUrl?: string; videoUrl?: string },
  resolved: ResolvedContent | null,
): Promise<VerificationResult> {
  if (!resolved) {
    return { processors: [], overall: "failed" };
  }

  return verifyAll({
    resolved,
    queryContentHash: contentHash,
    perceptual,
  });
}
