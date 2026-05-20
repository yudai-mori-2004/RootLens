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
// Bubblegum delegate を サーバ side で焼き込む簡易版。 ROOTLENS_COSIGN_DELEGATE
// (= base58 pubkey) が必須。 未設定なら 501 で fail-loud (= silent mock を作らない)。
// 本実装では Bubblegum の delegate instruction の tx を build + 部分署名して
// 端末へ返し、 端末 wallet 署名 + network 送信に切り替える。 その時 server は
// co-sign の policy 検証 (= ToS 同意済か、 owner と signer が一致するか) を行う。
export async function POST(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  const cosignDelegate = process.env.ROOTLENS_COSIGN_DELEGATE;
  if (!cosignDelegate) {
    return NextResponse.json(
      {
        error:
          "ROOTLENS_COSIGN_DELEGATE is not set. Configure the Bubblegum cosign delegate pubkey to enable staking.",
      },
      { status: 501 },
    );
  }

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

  const [updated] = await db.update(clips)
    .set({
      state: "staked",
      delegate: cosignDelegate,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: StakeResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
