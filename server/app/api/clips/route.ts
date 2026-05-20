import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { presignRawSessionUploads, rawMp4Key } from "@/lib/r2";
import { clipToDto, clipsToDtos } from "@/lib/mapper";
import type { CreateClipRequest, CreateClipResponse, ListClipsResponse } from "@/shared/api-types";

// GET /api/clips
// 撮影者の所有クリップ一覧を新しい順に返す。
export async function GET(req: Request) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }

  const rows = await db.select().from(clips)
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
  contentHash: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex"),
  contentSize: z.number().int().positive(),
}) satisfies z.ZodType<CreateClipRequest>;

export async function POST(req: Request) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }

  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.format() }, { status: 400 });
  }

  // 重複アップロード排除 (= 同 wallet × 同 contentHash は既存を返す)
  const existing = await db.select().from(clips)
    .where(and(eq(clips.walletPubkey, walletPubkey), eq(clips.contentHash, parsed.data.contentHash)))
    .limit(1);
  if (existing.length > 0) {
    const presigned = await presignRawSessionUploads({ contentHash: parsed.data.contentHash });
    const body: CreateClipResponse = {
      clip: await clipToDto(existing[0]),
      upload: presigned,
    };
    return NextResponse.json(body);
  }

  // 新規作成
  const id = `clip_${parsed.data.contentHash.slice(0, 12)}_${Date.now().toString(36)}`;
  const presigned = await presignRawSessionUploads({ contentHash: parsed.data.contentHash });

  const [inserted] = await db.insert(clips).values({
    id,
    walletPubkey,
    taskId: parsed.data.taskId,
    state: "uploading",
    achievementConfidence: parsed.data.achievementConfidence,
    contentHash: parsed.data.contentHash,
    rawMp4Key: rawMp4Key(parsed.data.contentHash),
  }).returning();

  const body: CreateClipResponse = {
    clip: await clipToDto(inserted),
    upload: presigned,
  };
  return NextResponse.json(body, { status: 201 });
}
