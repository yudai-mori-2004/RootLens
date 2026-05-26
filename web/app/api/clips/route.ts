import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { presignRawSessionUploads } from "@/lib/r2";
import { signedMp4Key } from "@/lib/r2-keys";
import { clipToDto, clipsToDtos } from "@/lib/mapper";
import { makeClipId } from "@/lib/clipId";
import type {
  CreateClipRequest,
  CreateClipResponse,
  ListClipsResponse,
} from "@/shared/api-types";

// GET /api/clips
// 撮影者の所有クリップ一覧を新しい順に返す。
export async function GET(req: Request) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }

  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.walletPubkey, walletPubkey))
    .orderBy(desc(clips.createdAt))
    .limit(200);

  const body: ListClipsResponse = { clips: await clipsToDtos(rows) };
  return NextResponse.json(body);
}

// POST /api/clips
// 撮影者「送る」 押下。 クリップ行作成 + Pipeline 1 出力 4 ファイル分の事前署名 PUT URL を返す。
const createSchema = z.object({
  taskId: z.string().min(1),
  achievementConfidence: z.number().int().min(0).max(100),
  // content_id は SHA-256 hex 64 文字 (= "sha256:" prefix なしの hex 部分のみ受ける)
  contentId: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
  contentSize: z.number().int().positive(),
}) satisfies z.ZodType<CreateClipRequest>;

export async function POST(req: Request) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    console.warn("[POST /api/clips] body JSON parse failed:", e);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 重複アップロード排除 (= 同 wallet × 同 content_id は既存行を返す)
  const existing = await db
    .select()
    .from(clips)
    .where(
      and(eq(clips.walletPubkey, walletPubkey), eq(clips.contentId, parsed.data.contentId)),
    )
    .limit(1);
  if (existing.length > 0) {
    const presigned = await presignRawSessionUploads({ contentId: parsed.data.contentId });
    const body: CreateClipResponse = {
      clip: await clipToDto(existing[0]),
      upload: presigned,
    };
    return NextResponse.json(body);
  }

  // 新規作成
  const id = makeClipId(parsed.data.contentId);
  const presigned = await presignRawSessionUploads({ contentId: parsed.data.contentId });

  const [inserted] = await db
    .insert(clips)
    .values({
      id,
      walletPubkey,
      taskId: parsed.data.taskId,
      state: "uploading",
      achievementConfidence: parsed.data.achievementConfidence,
      contentId: parsed.data.contentId,
      signedMp4Key: signedMp4Key(parsed.data.contentId),
    })
    .returning();

  const body: CreateClipResponse = {
    clip: await clipToDto(inserted),
    upload: presigned,
  };
  return NextResponse.json(body, { status: 201 });
}
