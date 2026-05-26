import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import type { StakeResponse } from "@/shared/api-types";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/clips/:id/stake
// 撮影者がステーキング画面の最終承認後に呼ぶ。
// 本実装は Bubblegum delegate 命令の tx を build + 部分署名して返し、 端末側で wallet 署名 + 送信する。
// MVP では env の `ROOTLENS_COSIGN_DELEGATE` を delegate として書く mock。
export async function POST(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const delegate = process.env.ROOTLENS_COSIGN_DELEGATE;
  if (!delegate) {
    return NextResponse.json(
      { error: "ROOTLENS_COSIGN_DELEGATE not set (= dev/mock 用、 production では Bubblegum tx build)" },
      { status: 501 },
    );
  }

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, id), eq(clips.walletPubkey, walletPubkey)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const clip = rows[0];

  if (clip.state !== "ready") {
    return NextResponse.json(
      { error: `Cannot stake clip in state ${clip.state}` },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(clips)
    .set({
      state: "staked",
      delegate,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: StakeResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
