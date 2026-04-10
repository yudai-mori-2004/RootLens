/**
 * POST /api/v1/delete-account — アカウント完全削除
 *
 * 削除順序（FK 依存を考慮）:
 * 1. contents の R2 ファイル削除
 * 2. contents レコード削除
 * 3. pages レコード削除
 * 4. users レコード削除
 *
 * 保持するデータ:
 * - device_certificates: デバイス紐付け（個人情報なし）
 * - cnft_assets: ブロックチェーン記録（削除不可）
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deletePublic } from "../../../../lib/server/r2";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** R2 URL からバケットキーを抽出する */
function extractR2Key(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // パスの先頭 / を除去
    return parsed.pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { address } = body;

  if (!address || typeof address !== "string" || address.length < 32) {
    return NextResponse.json(
      { error: "Valid wallet address is required" },
      { status: 400 },
    );
  }

  // 1. ユーザー検索
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, address")
    .eq("address", address.trim())
    .single();

  if (userErr || !user) {
    return NextResponse.json(
      { error: "No account found for this wallet address" },
      { status: 404 },
    );
  }

  // 2. ユーザーのページ一覧を取得
  const { data: pages } = await supabase
    .from("pages")
    .select("id")
    .eq("user_id", user.id);

  const pageIds = (pages ?? []).map((p) => p.id);

  if (pageIds.length > 0) {
    // 3. 各ページのコンテンツを取得し、R2 ファイルを削除
    const { data: contents } = await supabase
      .from("contents")
      .select("id, thumbnail_url, ogp_image_url")
      .in("page_id", pageIds);

    if (contents && contents.length > 0) {
      // R2 ファイル削除（エラーは無視して続行）
      const deletePromises: Promise<void>[] = [];
      for (const content of contents) {
        const thumbKey = extractR2Key(content.thumbnail_url);
        if (thumbKey) deletePromises.push(deletePublic(thumbKey).catch(() => {}));

        const ogpKey = extractR2Key(content.ogp_image_url);
        if (ogpKey) deletePromises.push(deletePublic(ogpKey).catch(() => {}));
      }
      await Promise.all(deletePromises);

      // 4. contents レコード削除
      await supabase
        .from("contents")
        .delete()
        .in("page_id", pageIds);
    }

    // 5. pages レコード削除
    await supabase
      .from("pages")
      .delete()
      .eq("user_id", user.id);
  }

  // 6. users レコード削除
  await supabase
    .from("users")
    .delete()
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}
