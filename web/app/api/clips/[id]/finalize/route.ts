import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { start } from "workflow/api";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import { processClip } from "@/workflow/process-clip";
import type { FinalizeUploadRequest, FinalizeUploadResponse } from "@/shared/api-types";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/clips/:id/finalize
// 端末が R2 への PUT を完了したら呼ぶ。 サーバは contentId 照合 + state 遷移 + workflow 起動。
const schema = z.object({
  contentId: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
}) satisfies z.ZodType<FinalizeUploadRequest>;

export async function POST(req: Request, ctx: Ctx) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }
  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    console.warn(`[POST /api/clips/${id}/finalize] body JSON parse failed:`, e);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.format() },
      { status: 400 },
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

  if (clip.contentId !== parsed.data.contentId) {
    return NextResponse.json(
      { error: `Content id mismatch (expected ${clip.contentId})` },
      { status: 409 },
    );
  }
  // v0.1.3: rootAssetId が DB に存在しないクリップで finalize すると 400 (= Pipeline 2 の前提
  // 条件未満たし)。 schema 上 notNull だが、 古い行 / 異常系の防御として実行時にも check する。
  if (!clip.rootAssetId) {
    return NextResponse.json(
      { error: "rootAssetId is required before finalize (Pipeline 1 cNFT mint incomplete)" },
      { status: 400 },
    );
  }
  if (clip.state !== "uploading") {
    // 既に processing 以降に進んでいる場合は冪等に成功を返す
    const body: FinalizeUploadResponse = { clip: await clipToDto(clip) };
    return NextResponse.json(body);
  }

  // 状態を processing に遷移 + WDK workflow を起動
  const run = await start(processClip, [{ clipId: clip.id }]);

  const [updated] = await db
    .update(clips)
    .set({
      state: "processing",
      processingStep: "metadata-scan",
      workflowRunId: run.runId,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, clip.id))
    .returning();

  const body: FinalizeUploadResponse = { clip: await clipToDto(updated) };
  return NextResponse.json(body);
}
