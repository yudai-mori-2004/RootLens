import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import { processClip } from "@/workflow/process-clip";
import type { RetryResponse } from "@/shared/api-types";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/clips/:id/retry
// state == "error" のクリップを再処理する。 R2 上の raw ファイルが残ってる前提。
export async function POST(req: Request, ctx: Ctx) {
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
  const clip = rows[0];

  if (clip.state !== "error") {
    return NextResponse.json(
      { error: `Cannot retry clip in state ${clip.state}` },
      { status: 409 },
    );
  }
  if (!clip.contentId || !clip.signedMp4Key) {
    return NextResponse.json(
      { error: "Missing contentId / signedMp4Key (= raw 削除済の可能性)" },
      { status: 409 },
    );
  }

  // workflow 再キック
  const run = await start(processClip, [{ clipId: clip.id }]);

  const [updated] = await db
    .update(clips)
    .set({
      state: "processing",
      processingStep: "metadata-scan",
      errorMessage: null,
      workflowRunId: run.runId,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: RetryResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
