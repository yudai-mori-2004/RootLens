import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireAccountPubkey } from "@/lib/auth";
import { clipToDto, clipsToDtos } from "@/lib/mapper";
import { makeClipId } from "@/lib/clipId";
import type {
  CreateClipRequest,
  CreateClipResponse,
  ListClipsResponse,
} from "@/shared/api-types";

// GET /api/clips
// 撮影者の所有クリップ一覧を新しい順に返す。
// optional query: signatureHash を渡すと絞り込む (= 端末の冪等チェック用)。
export async function GET(req: Request) {
  let accountPubkey: string;
  try {
    accountPubkey = requireAccountPubkey(req);
  } catch (r) {
    return r as Response;
  }

  const url = new URL(req.url);
  const signatureHash = url.searchParams.get("signatureHash");

  const conditions = [eq(clips.walletPubkey, accountPubkey)];
  if (signatureHash) conditions.push(eq(clips.signatureHash, signatureHash));

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
// v0.1.4: 端末で C2PA D1 署名 + R2 raw アップロードを終えてから呼ぶ「ただの登録」 endpoint。
// 重複排除キーは (account, signatureHash)。 既存行があれば idempotent に返す。
const createSchema = z.object({
  signatureHash: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
  contentSize: z.number().int().positive(),
  recordingConfig: z.enum(["ultra_wide", "arkit"]),
  durationMs: z.number().int().positive().optional(),
  deviceModel: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<CreateClipRequest>;

export async function POST(req: Request) {
  let accountPubkey: string;
  try {
    accountPubkey = requireAccountPubkey(req);
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

  // 重複排除 (= 同 account × 同 signature_hash は既存行を返す)。
  const existing = await db
    .select()
    .from(clips)
    .where(
      and(
        eq(clips.walletPubkey, accountPubkey),
        eq(clips.signatureHash, parsed.data.signatureHash),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const body: CreateClipResponse = { clip: clipToDto(existing[0]) };
    return NextResponse.json(body);
  }

  // 新規作成。 端末は R2 アップロード完了後にのみ登録する (= presign は /api/v1/raw-uploads の役目)
  // ので、 登録行はその時点で uploaded。
  const id = makeClipId(parsed.data.signatureHash);
  const [inserted] = await db
    .insert(clips)
    .values({
      id,
      walletPubkey: accountPubkey,
      state: "uploaded",
      signatureHash: parsed.data.signatureHash,
      recordingConfig: parsed.data.recordingConfig,
      contentSize: parsed.data.contentSize,
      durationMs: parsed.data.durationMs ?? null,
      deviceModel: parsed.data.deviceModel ?? null,
    })
    .returning();

  const body: CreateClipResponse = { clip: clipToDto(inserted) };
  return NextResponse.json(body, { status: 201 });
}
