import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import type { StakeResponse } from "@/shared/api-types";

interface Ctx { params: Promise<{ id: string }> }

// POST /api/clips/:id/stake
//
// MVP 実装: state を 'staked' に遷移、 mock の delegate アドレスを焼く。
// 本実装: Bubblegum の delegate 命令の tx を build + 部分署名して返し、 端末が wallet
// 署名してネットワーク送信する。 サーバ側は co-sign の policy 検証 (= ToS 同意済か、
// クリップ owner と signer が一致するか) を行う。
export async function POST(req: Request, ctx: Ctx) {
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
  const clip = rows[0];

  if (clip.state !== "ready") {
    return NextResponse.json(
      { error: `Cannot stake from state '${clip.state}'` },
      { status: 409 },
    );
  }

  // MVP mock: delegate を固定文字列に設定。 本実装では tx 構築 + co-sign。
  const [updated] = await db.update(clips)
    .set({
      state: "staked",
      delegate: process.env.ROOTLENS_COSIGN_DELEGATE ?? "rootlens-cosign-authority",
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: StakeResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
