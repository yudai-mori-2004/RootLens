import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import { processClip } from "@/workflow/process-clip";
import type { RetryResponse } from "@/shared/api-types";

interface Ctx { params: Promise<{ id: string }> }

// POST /api/clips/:id/retry
// 'error' に陥ったクリップを再処理する。 R2 raw データはそのまま残ってる前提なので
// state を 'processing' に戻して workflow を再起動するだけで再実行される。
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

  if (clip.state !== "error") {
    return NextResponse.json(
      { error: `Cannot retry from state '${clip.state}'` },
      { status: 409 },
    );
  }
  if (!clip.contentHash || !clip.rawMp4Key) {
    return NextResponse.json(
      { error: "Clip missing contentHash or rawMp4Key" },
      { status: 409 },
    );
  }

  const run = await start(processClip, [{ clipId: clip.id }]);

  const [updated] = await db.update(clips)
    .set({
      state: "processing",
      processingStep: "anonymize",
      workflowRunId: run.runId,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: RetryResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
