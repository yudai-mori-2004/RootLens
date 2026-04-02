/**
 * 仕様書 §7.1 URL構造, §10.4 データベース設計
 *
 * ページメタデータのストレージ (Supabase)。
 * service_role キーを使用し、RLS をバイパスして読み書きする。
 */

import { createClient } from "@supabase/supabase-js";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Supabase クライアント (service_role)
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface PageContentRecord {
  contentHash: string;
  assetId: string;
  thumbnailUrl: string;
  ogpImageUrl: string;
  mediaUrl: string;
  mediaType: string;
}

export interface PageRecord {
  shortId: string;
  contents: PageContentRecord[];
  createdAt: string;
}

export interface ContentInput {
  contentHash: string;
  assetId: string;
  thumbnailUrl: string;
  ogpImageUrl: string;
  mediaUrl?: string;
  mediaType?: string;
}

export interface CreatePageInput {
  contentHash: string;
  assetId: string;
  thumbnailUrl: string;
  ogpImageUrl: string;
  mediaUrl?: string;
  mediaType?: string;
  address?: string;
  additionalContents?: ContentInput[];
}

// ---------------------------------------------------------------------------
// shortId 生成
// ---------------------------------------------------------------------------

/** 7〜11文字のランダム英数字 shortId を生成 */
function generateShortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const length = 7 + Math.floor(Math.random() * 5);
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createPage(input: CreatePageInput): Promise<PageRecord> {
  const shortId = generateShortId();

  // address → user_id 解決
  let userId: string | null = null;
  if (input.address) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("address", input.address)
      .single();
    userId = user?.id ?? null;
  }

  // pages テーブルにレコード作成
  const { data: page, error: pageError } = await supabase
    .from("pages")
    .insert({ short_id: shortId, ...(userId ? { user_id: userId } : {}) })
    .select("id, short_id, created_at")
    .single();

  if (pageError) throw new Error(`pages insert failed: ${pageError.message}`);

  // contents テーブルにコンテンツレコード作成（複数対応）
  const contentRows = [
    {
      page_id: page.id,
      content_hash: input.contentHash,
      title_protocol_asset_id: input.assetId,
      thumbnail_url: input.thumbnailUrl,
      ogp_image_url: input.ogpImageUrl,
      media_url: input.mediaUrl || '',
      content_type: input.mediaType || 'image',
    },
    ...(input.additionalContents ?? []).map((c) => ({
      page_id: page.id,
      content_hash: c.contentHash,
      title_protocol_asset_id: c.assetId,
      thumbnail_url: c.thumbnailUrl,
      ogp_image_url: c.ogpImageUrl,
      media_url: c.mediaUrl || '',
      content_type: c.mediaType || 'image',
    })),
  ];

  const { error: contentError } = await supabase
    .from("contents")
    .insert(contentRows);

  if (contentError)
    throw new Error(`contents insert failed: ${contentError.message}`);

  return {
    shortId: page.short_id,
    contents: contentRows.map((c) => ({
      contentHash: c.content_hash,
      assetId: c.title_protocol_asset_id,
      thumbnailUrl: c.thumbnail_url,
      ogpImageUrl: c.ogp_image_url,
      mediaUrl: c.media_url,
      mediaType: c.content_type,
    })),
    createdAt: page.created_at,
  };
}

export async function findByShortId(
  shortId: string
): Promise<PageRecord | null> {
  const { data, error } = await supabase
    .from("pages")
    .select(
      `
      short_id,
      created_at,
      contents (
        content_hash,
        title_protocol_asset_id,
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
    title_protocol_asset_id: string;
    thumbnail_url: string;
    ogp_image_url: string;
    media_url: string;
    content_type: string;
  }>) ?? [];

  if (rawContents.length === 0) return null;

  return {
    shortId: data.short_id,
    contents: rawContents.map((c) => ({
      contentHash: c.content_hash,
      assetId: c.title_protocol_asset_id,
      thumbnailUrl: c.thumbnail_url,
      ogpImageUrl: c.ogp_image_url,
      mediaUrl: c.media_url || '',
      mediaType: c.content_type || 'image',
    })),
    createdAt: data.created_at,
  };
}

export async function updatePageContent(
  shortId: string,
  contentHash: string,
  assetId: string,
): Promise<void> {
  // pages テーブルからpage_idを取得
  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("short_id", shortId)
    .single();

  if (pageError || !page) throw new Error(`Page not found: ${shortId}`);

  // contents テーブルを更新
  const { error } = await supabase
    .from("contents")
    .update({
      content_hash: contentHash,
      title_protocol_asset_id: assetId,
    })
    .eq("page_id", page.id);

  if (error) throw new Error(`contents update failed: ${error.message}`);
}

export async function softDeletePage(shortId: string): Promise<void> {
  const { error } = await supabase
    .from("pages")
    .update({ status: "deleted" })
    .eq("short_id", shortId);

  if (error) throw new Error(`delete failed: ${error.message}`);
}

export async function updatePageCaption(shortId: string, caption: string): Promise<void> {
  const { error } = await supabase
    .from("pages")
    .update({ caption: caption || null })
    .eq("short_id", shortId);

  if (error) throw new Error(`caption update failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// クリエイターページ用クエリ (§7.1)
// ---------------------------------------------------------------------------

export interface CreatorProfile {
  address: string;
  username: string | null;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
}

export interface CreatorPageItem {
  pageId: string;
  shortId: string;
  thumbnailUrl: string;
  contentCount: number;
  createdAt: string;
}

/**
 * ウォレットアドレスまたはusernameからユーザーを解決する。
 * `@` 付きの場合はusernameで検索、それ以外はaddressで検索。
 */
export async function resolveUser(
  addressOrUsername: string,
): Promise<CreatorProfile | null> {
  const isUsername = addressOrUsername.startsWith("@");
  const column = isUsername ? "username" : "address";
  const value = isUsername ? addressOrUsername.slice(1) : addressOrUsername;

  const { data, error } = await supabase
    .from("users")
    .select("address, username, display_name, bio, avatar_url")
    .eq(column, value)
    .single();

  if (error || !data) return null;

  return {
    address: data.address,
    username: data.username,
    displayName: data.display_name || "",
    bio: data.bio || "",
    avatarUrl: data.avatar_url,
  };
}

/**
 * ユーザーの公開済みページ一覧を取得する。
 * address (Solanaウォレット) を受け取り、内部で user_id に解決する。
 */
export async function findPagesByUser(
  address: string,
): Promise<CreatorPageItem[]> {
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("address", address)
    .single();

  if (!user) return [];

  const { data, error } = await supabase
    .from("pages")
    .select(`
      id,
      short_id,
      created_at,
      contents (
        thumbnail_url
      )
    `)
    .eq("user_id", user.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((page) => {
    const contents = (page.contents as unknown as Array<{ thumbnail_url: string }>) ?? [];
    return {
      pageId: page.id,
      shortId: page.short_id,
      thumbnailUrl: contents[0]?.thumbnail_url || "",
      contentCount: contents.length,
      createdAt: page.created_at,
    };
  });
}

/**
 * pageIdからページを取得する（クリエイターページからの個別ページ表示用）。
 */
export async function findByPageId(
  pageId: string,
): Promise<PageRecord | null> {
  const { data, error } = await supabase
    .from("pages")
    .select(`
      short_id,
      created_at,
      contents (
        content_hash,
        title_protocol_asset_id,
        thumbnail_url,
        ogp_image_url,
        media_url,
        content_type
      )
    `)
    .eq("id", pageId)
    .eq("status", "published")
    .single();

  if (error || !data) return null;

  const rawContents = (data.contents as unknown as Array<{
    content_hash: string;
    title_protocol_asset_id: string;
    thumbnail_url: string;
    ogp_image_url: string;
    media_url: string;
    content_type: string;
  }>) ?? [];

  if (rawContents.length === 0) return null;

  return {
    shortId: data.short_id,
    contents: rawContents.map((c) => ({
      contentHash: c.content_hash,
      assetId: c.title_protocol_asset_id,
      thumbnailUrl: c.thumbnail_url,
      ogpImageUrl: c.ogp_image_url,
      mediaUrl: c.media_url || "",
      mediaType: c.content_type || "image",
    })),
    createdAt: data.created_at,
  };
}

export async function findByContentHash(
  contentHash: string
): Promise<PageRecord | null> {
  const { data, error } = await supabase
    .from("contents")
    .select(
      `
      content_hash,
      title_protocol_asset_id,
      thumbnail_url,
      ogp_image_url,
      pages!inner (
        short_id,
        status,
        created_at
      )
    `
    )
    .eq("content_hash", contentHash)
    .single();

  if (error || !data) return null;

  const page = (data.pages as unknown as {
    short_id: string;
    status: string;
    created_at: string;
  });
  if (page.status !== "published") return null;

  // contentHashで検索しているので、そのcontentを含むページの全contentsを返す
  return findByShortId(page.short_id);
}
