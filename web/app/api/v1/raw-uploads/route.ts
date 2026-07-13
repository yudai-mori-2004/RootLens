// POST /api/v1/raw-uploads
//
// 端末のアップロード用 presigned PUT URL endpoint。
//
// 流れ:
//   1. device が生 mp4 の SHA-256 を計算して content_hash を確定
//   2. このエンドポイントに contentHash を投げ、 撮影構成ファイル分の presigned PUT を得る
//   3. R2 (raw/<content_hash>/{rgb.mp4 + frames.jsonl + metadata.json + 等}) に並列 PUT
//
// /api/clips とは別エンドポイントにする理由:
//   端末は「アップロード可能か」 だけ先に確認したい (= 容量制限・帯域制限・空きスロット等の事前 reject)。
//   /api/clips で行を作る前に presign を出せると、 失敗を早く検出できる。
//
// auth: Bearer token 必須。 presign の発行自体をログイン済みアカウントに限定する。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { presignRawSessionUploads } from "@/lib/r2";
import { requireAccountId } from "@/lib/auth";

const CONTENT_ID_RE = /^[0-9a-f]{64}$/;

const RequestSchema = z.object({
  contentHash: z.string().regex(CONTENT_ID_RE, "contentHash must be 64-char lowercase hex (SHA-256)"),
  // 撮影構成 → アップロード先バケット + ファイルマニフェストが決まる (DATA_SPECS §3)。
  // 旧クライアント互換のため省略時は ultra_wide。
  recordingConfig: z.enum(["ultra_wide", "arkit"]).default("ultra_wide"),
});

export async function POST(req: NextRequest) {
  try {
    await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const presigned = await presignRawSessionUploads({
      contentHash: parsed.data.contentHash,
      recordingConfig: parsed.data.recordingConfig,
    });
    return NextResponse.json(presigned);
  } catch (e: unknown) {
    console.error("[raw-uploads] presign failed:", e);
    const msg = e instanceof Error ? e.message : "presign failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
