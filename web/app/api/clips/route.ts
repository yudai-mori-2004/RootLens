import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireWalletPubkey } from "@/lib/auth";
import { presignRawSessionUploads } from "@/lib/r2";
import { clipToDto, clipsToDtos } from "@/lib/mapper";
import { makeClipId } from "@/lib/clipId";
import type {
  CreateClipRequest,
  CreateClipResponse,
  ListClipsResponse,
} from "@/shared/api-types";

// GET /api/clips
// 撮影者の所有クリップ一覧を新しい順に返す。
// optional query: signatureHash + network を渡すと、 その条件で絞り込む
// (= 端末の mint 前冪等チェックが「同 wallet × 同 hash × 同 network の既存 clip」を引くのに使う)。
export async function GET(req: Request) {
  let walletPubkey: string;
  try {
    walletPubkey = requireWalletPubkey(req);
  } catch (r) {
    return r as Response;
  }

  const url = new URL(req.url);
  const signatureHash = url.searchParams.get("signatureHash");
  const network = url.searchParams.get("network");

  const conditions = [eq(clips.walletPubkey, walletPubkey)];
  if (signatureHash) conditions.push(eq(clips.signatureHash, signatureHash));
  if (network) conditions.push(eq(clips.network, network));

  const rows = await db
    .select()
    .from(clips)
    .where(and(...conditions))
    .orderBy(desc(clips.createdAt))
    .limit(200);

  const body: ListClipsResponse = { clips: await clipsToDtos(rows) };
  return NextResponse.json(body);
}

// POST /api/clips
// 端末が R2 upload + TP /process + cNFT 発行を終え、 rootAssetId 確定後に呼ぶ。
// rootAssetId + signedJsonUri は v0.1.3 で必須 (= Pipeline 2 起動の前提条件)。
const createSchema = z.object({
  // signature_hash は SHA-256 hex 64 文字 (= "sha256:" prefix なしの hex 部分のみ受ける)
  signatureHash: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 hex 64 chars"),
  contentSize: z.number().int().positive(),
  // Solana cNFT asset id (= base58 32-44 文字、 Pipeline 1 末尾で確定済)
  rootAssetId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Solana cNFT asset id (base58)"),
  // R2 signed-json/<signature_hash>.json への URL (= TP /process 応答保存先)
  signedJsonUri: z.string().url(),
  // cNFT 発行先ネットワーク (= 重複排除キーの一部)。 省略時は devnet 扱い (legacy)。
  network: z.enum(["devnet", "mainnet"]).optional(),
  // 撮影構成。 省略時は ultra_wide 扱い (= 端末が送るまでの移行用 fallback)。
  recordingConfig: z.enum(["ultra_wide", "arkit"]).optional(),
  // 録画尺 (ms)。 端末申告。 省略時はサーバが Pipeline 2 で算出して埋める。
  durationMs: z.number().int().positive().optional(),
  // 撮影端末の機種 (= utsname machine)。
  deviceModel: z.string().min(1).max(64).optional(),
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

  const network = parsed.data.network ?? "devnet";

  // 重複アップロード排除 (= 同 wallet × 同 signature_hash × 同 network は既存行を返す)。
  // network を含めるのは、 devnet 発行済みの動画を mainnet で発行し直す経路を塞がないため。
  const existing = await db
    .select()
    .from(clips)
    .where(
      and(
        eq(clips.walletPubkey, walletPubkey),
        eq(clips.signatureHash, parsed.data.signatureHash),
        eq(clips.network, network),
      ),
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
      state: "uploading",
      signatureHash: parsed.data.signatureHash,
      network,
      // 撮影ファクト (= 端末申告)。 recordingConfig は移行用に ultra_wide fallback。
      recordingConfig: parsed.data.recordingConfig ?? "ultra_wide",
      contentSize: parsed.data.contentSize,
      durationMs: parsed.data.durationMs ?? null,
      deviceModel: parsed.data.deviceModel ?? null,
      rootAssetId: parsed.data.rootAssetId,
      signedJsonUri: parsed.data.signedJsonUri,
    })
    .returning();

  const body: CreateClipResponse = {
    clip: await clipToDto(inserted),
    upload: presigned,
  };
  return NextResponse.json(body, { status: 201 });
}
