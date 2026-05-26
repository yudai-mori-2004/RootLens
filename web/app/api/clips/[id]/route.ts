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

  return NextResponse.json({ clip: await clipToDto(rows[0]) });
}

// DELETE /api/clips/:id ─ ready 以下のクリップを破棄。 staked は 409。
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

  if (rows[0].state === "staked") {
    return NextResponse.json(
      { error: "Cannot delete staked clip (License NFT permanence)" },
      { status: 409 },
    );
  }

  await db.delete(clips).where(eq(clips.id, id));
  // R2 上のオブジェクト削除は別 worker (= まとめて GC) で行う。 ここでは DB 行のみ削除。

  const body: DeleteClipResponse = { ok: true };
  return NextResponse.json(body);
}
