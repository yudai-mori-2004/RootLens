// POST /api/v1/raw-uploads
//
// v0.1.3 device-side Pipeline 1 用 presigned PUT URL endpoint。
//
// 流れ:
//   1. device が C2PA D1+D2 を済ませて signature_hash を確定
//   2. このエンドポイントに signatureHash を投げ、 超広角構成ファイル分の presigned PUT を得る
//   3. R2 (raw/<signature_hash>/{rgb.mp4 + realtime_handpose.jsonl + metadata.json}) に並列 PUT
//   4. その後 device は TP /process + cNFT mint を経て rootAssetId を確定
//   5. POST /api/clips で clip 行を作成 (= rootAssetId 必須)
//
// /api/clips とは別エンドポイントにする理由:
//   /api/clips は rootAssetId が無いと clip 行が作れないが、 rootAssetId 確定には
//   TP /process が必要で、 TP /process は R2 にアップ済の MP4 を fetch する。
//   つまりアップロードが rootAssetId より先に来る必要があり、 別 endpoint が要る。
//
// auth: 現状 wallet 縛りなし (= 認証 header 不要)。 R2 への直接 PUT は presigned URL の
// 検証で限定されるので、 endpoint レベルでの追加保護は省略。 将来 spam 対策する時は
// X-Wallet-Pubkey + rate limit を足す。

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
