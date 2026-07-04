// POST /api/v1/raw-uploads
//
// v0.1.4: 端末側 Pipeline 1 用 presigned PUT URL endpoint。
//
// 流れ:
//   1. device が C2PA D1 署名 (生 mp4 への 1 回のみ) を済ませて signature_hash を確定
//   2. このエンドポイントに signatureHash を投げ、 撮影構成ファイル分の presigned PUT を得る
//   3. R2 (raw/<signature_hash>/{rgb.mp4 + realtime_handpose.jsonl + metadata.json + 等}) に並列 PUT
//   4. POST /api/clips でクリップ行を作成 (= rootAssetId は不要)
//
// /api/clips とは別エンドポイントにする理由:
//   端末は「アップロード可能か」 だけ先に確認したい (= 容量制限・帯域制限・空きスロット等の事前 reject)。
//   /api/clips で行を作る前に presign を出せると、 失敗を早く検出できる。
//
// auth: 現状 wallet 縛りなし (= 認証 header 不要)。 R2 への直接 PUT は presigned URL の
// 検証で限定されるので、 endpoint レベルでの追加保護は省略。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { presignRawSessionUploads } from "@/lib/r2";

const CONTENT_ID_RE = /^[0-9a-f]{64}$/;

const RequestSchema = z.object({
  signatureHash: z.string().regex(CONTENT_ID_RE, "signatureHash must be 64-char lowercase hex (SHA-256)"),
});

export async function POST(req: NextRequest) {
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
    const presigned = await presignRawSessionUploads({ signatureHash: parsed.data.signatureHash });
    return NextResponse.json(presigned);
  } catch (e: unknown) {
    console.error("[raw-uploads] presign failed:", e);
    const msg = e instanceof Error ? e.message : "presign failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
