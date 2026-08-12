import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireAccountId } from "@/lib/auth";
import { clipToDto, clipsToDtos } from "@/lib/mapper";
import type {
  CreateClipRequest,
  CreateClipResponse,
  ListClipsResponse,
} from "@/shared/api-types";

// GET /api/clips
// 撮影アカウント (= Bearer token の sub) の所有クリップ一覧を新しい順に返す。
// optional query: contentHash を渡すと絞り込む (= 端末の冪等チェック用)。
export async function GET(req: Request) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }

  const url = new URL(req.url);
  const contentHash = url.searchParams.get("contentHash");

  const conditions = [eq(clips.accountId, accountId)];
  if (contentHash) conditions.push(eq(clips.contentHash, contentHash));

  const rows = await db
    .select()
    .from(clips)
    .where(and(...conditions))
    .orderBy(desc(clips.createdAt))
    .limit(200);

  const body: ListClipsResponse = { clips: clipsToDtos(rows) };
  return NextResponse.json(body);
}

// POST /api/clips
// 端末で content_hash 計算 + R2 raw アップロードを終えてから呼ぶ「ただの登録」 endpoint。
// content_hash が PK (= ストレージの raw/<content_hash>/ と 1:1)。 同一 hash の再登録は
// 同一アカウントなら idempotent に既存行を返し、 別アカウントなら 409。
const createSchema = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
  contentSize: z.number().int().positive(),
  recordingConfig: z.enum(["ultra_wide", "arkit", "mentra"]),
  durationMs: z.number().int().positive().optional(),
  deviceModel: z.string().min(1).max(64).optional(),
  consentEventId: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<CreateClipRequest>;

export async function POST(req: Request) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
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

  // 重複排除 (= content_hash は世界一意)。
  const existing = await db
    .select()
    .from(clips)
    .where(eq(clips.contentHash, parsed.data.contentHash))
    .limit(1);
  if (existing.length > 0) {
    if (existing[0].accountId !== accountId) {
      return NextResponse.json(
        { error: "content_hash already registered by another account" },
        { status: 409 },
      );
    }
    const body: CreateClipResponse = { clip: clipToDto(existing[0]) };
    return NextResponse.json(body);
  }

  // 新規作成。 端末は R2 アップロード完了後にのみ登録する (= presign は /api/v1/raw-uploads の役目)。
  const [inserted] = await db
    .insert(clips)
    .values({
      contentHash: parsed.data.contentHash,
      accountId,
      consentEventId: parsed.data.consentEventId ?? null,
      recordingConfig: parsed.data.recordingConfig,
      contentSize: parsed.data.contentSize,
      durationMs: parsed.data.durationMs ?? null,
      deviceModel: parsed.data.deviceModel ?? null,
    })
    .returning();

  const body: CreateClipResponse = { clip: clipToDto(inserted) };
  return NextResponse.json(body, { status: 201 });
}
