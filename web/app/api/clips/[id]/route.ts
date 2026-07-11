import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireAccountId } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import type { DeleteClipResponse } from "@/shared/api-types";

// path param `id` = content_hash (task 13 で合成 id を撤去し、 識別子は content_hash のみ)。
interface Ctx {
  params: Promise<{ id: string }>;
}

// GET /api/clips/:contentHash ─ 単件取得 (所有アカウントのみ)
export async function GET(req: Request, ctx: Ctx) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ clip: clipToDto(rows[0]) });
}

// DELETE /api/clips/:contentHash ─ 撮影者がクリップを破棄する。 R2 オブジェクトは別 worker で GC する。
export async function DELETE(req: Request, ctx: Ctx) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(clips).where(eq(clips.contentHash, contentHash));

  const body: DeleteClipResponse = { ok: true };
  return NextResponse.json(body);
}
