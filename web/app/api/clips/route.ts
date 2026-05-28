import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { presignRawSessionUploads } from "@/lib/r2";
import { signedMp4Key, processedPrefix } from "@/lib/r2-keys";
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
// 端末が R2 upload + TP /process + cNFT 発行を終え、 rootAssetId 確定後に呼ぶ。
// rootAssetId + signedJsonUri は v0.1.3 で必須 (= Pipeline 2 起動の前提条件)。
// 2026-05-27 方針転換: taskId / achievementConfidence は新仕様では送られない。
// 旧 client 互換のため zod は optional で受信 (= 受け取っても新 schema では無視 or fallback)。
const createSchema = z.object({
  // signature_hash は SHA-256 hex 64 文字 (= "sha256:" prefix なしの hex 部分のみ受ける)
  signatureHash: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
  contentSize: z.number().int().positive(),
  // Solana cNFT asset id (= base58 32-44 文字、 Pipeline 1 末尾で確定済)
  rootAssetId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Solana cNFT asset id (base58)"),
  // R2 signed-json/<signature_hash>.json への URL (= TP /process 応答保存先)
  signedJsonUri: z.string().url(),
  // legacy 互換 (= 段階削除中、 旧 client からも来うる)
  taskId: z.string().min(1).optional(),
  achievementConfidence: z.number().int().min(0).max(100).optional(),
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

  // 重複アップロード排除 (= 同 wallet × 同 signature_hash は既存行を返す)
  const existing = await db
    .select()
    .from(clips)
    .where(
      and(eq(clips.walletPubkey, walletPubkey), eq(clips.signatureHash, parsed.data.signatureHash)),
    )
    .limit(1);
  if (existing.length > 0) {
    const presigned = await presignRawSessionUploads({ signatureHash: parsed.data.signatureHash });
    const body: CreateClipResponse = {
      clip: await clipToDto(existing[0]),
      upload: presigned,
    };
    return NextResponse.json(body);
  }

  // 新規作成
  const id = makeClipId(parsed.data.signatureHash);
  const presigned = await presignRawSessionUploads({ signatureHash: parsed.data.signatureHash });

  const [inserted] = await db
    .insert(clips)
    .values({
      id,
      walletPubkey,
      // 2026-05-27: taskId は DB schema が notNull なので fallback で埋める (= 別 task で nullable migration 予定)
      taskId: parsed.data.taskId ?? "legacy",
      state: "uploading",
      achievementConfidence: parsed.data.achievementConfidence ?? null,
      signatureHash: parsed.data.signatureHash,
      signedMp4Key: signedMp4Key(parsed.data.signatureHash),
      rootAssetId: parsed.data.rootAssetId,
      signedJsonUri: parsed.data.signedJsonUri,
      processedPrefix: processedPrefix(parsed.data.signatureHash),
    })
    .returning();

  const body: CreateClipResponse = {
    clip: await clipToDto(inserted),
    upload: presigned,
  };
  return NextResponse.json(body, { status: 201 });
}
