import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import type { DeleteClipResponse } from "@/shared/api-types";

interface Ctx { params: Promise<{ id: string }> }

// GET /api/clips/:id
export async function GET(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const rows = await db.select().from(clips)
    .where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ clip: await clipToDto(rows[0]) });
}

// DELETE /api/clips/:id
// staked クリップは削除不可 (= ライセンス発行先が存在しうるため、 §4.4.4 §3 で永続性保証)。
export async function DELETE(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const rows = await db.select().from(clips)
    .where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (rows[0].state === "staked") {
    return NextResponse.json({ error: "Cannot delete staked clip" }, { status: 409 });
  }

  await db.delete(clips).where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)));

  // TODO: R2 オブジェクトも削除する (= raw / blurred それぞれ DeleteObjectCommand)。
  // ready / error 状態のクリップを user が消す時の R2 cleanup は別 background job でも良い。

  const body: DeleteClipResponse = { ok: true };
  return NextResponse.json(body);
}
