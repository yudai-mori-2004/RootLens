import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import type { DeleteClipResponse } from "@/shared/api-types";

interface Ctx {
  params: Promise<{ id: string }>;
}

// GET /api/clips/:id ─ 単件取得
export async function GET(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ clip: clipToDto(rows[0]) });
}

// DELETE /api/clips/:id ─ 撮影者がクリップを破棄する。 R2 オブジェクトは別 worker で GC する。
export async function DELETE(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(clips).where(eq(clips.id, id));

  const body: DeleteClipResponse = { ok: true };
  return NextResponse.json(body);
}
