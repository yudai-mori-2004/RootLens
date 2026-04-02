/**
 * 仕様書 §7.1 URL構造
 *
 * GET /api/v1/pages/:shortId — shortId からページメタデータを解決
 */

import { NextRequest, NextResponse } from "next/server";
import { findByShortId, updatePageContent, updatePageCaption, softDeletePage } from "@/lib/server/page-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shortId: string }> }
) {
  const { shortId } = await params;
  const record = await findByShortId(shortId);

  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    contents: record.contents,
  });
}

/**
 * PATCH /api/v1/pages/:shortId
 *
 * Title Protocol登録完了後、アプリからcontentHash/assetIdを更新
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ shortId: string }> }
) {
  try {
    const { shortId } = await params;
    const body = await req.json();

    if ("caption" in body) {
      await updatePageCaption(shortId, body.caption ?? "");
      return NextResponse.json({ ok: true });
    }

    const { contentHash, assetId } = body;
    if (!contentHash) {
      return NextResponse.json({ error: "contentHash is required" }, { status: 400 });
    }

    await updatePageContent(shortId, contentHash, assetId || "");

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/pages/:shortId
 *
 * ページを非公開化（status → 'deleted'）
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ shortId: string }> }
) {
  try {
    const { shortId } = await params;
    await softDeletePage(shortId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
