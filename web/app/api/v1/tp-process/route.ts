// POST /api/v1/tp-process
//
// v0.1.3 Pipeline 1 step 5 をサーバ側でやるための統合エンドポイント。
//
//   1. signature_hash から rootlens-raw/raw/<id>/rgb.mp4 への presigned GET URL を発行
//   2. TP Gateway /process に POST (= TEE が R2 から MP4 fetch + C2PA 検証 +
//      signature_hash 計算 + signed_json 作成)
//   3. TP の ProcessResponse JSON を rootlens-raw + rootlens-public に保存
//   4. クライアント (= iOS) に signedJsonUri (公開 URL) と signature_hash を返す
//
// クライアント側に R2 credential を持たせず、 ATS で塞がる plain HTTP TP gateway も
// HTTPS proxy で迂回するため、 デバイスから 1 リクエストで全部済むようにまとめる。
//
// 本エンドポイントは認証 header 不要 (= signature_hash 自体が SHA-256 hex なので簡単に
// 推測されない、 かつ signed_json 自体の保存先は public bucket で読み取り無認証)。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { presignSignedMp4Get, r2, BUCKET_RAW } from "@/lib/r2";
import { uploadPublic } from "@/lib/server/r2";
import { tpGatewayUrl } from "@/lib/tp-gateway";

const CONTENT_ID_RE = /^[0-9a-f]{64}$/;

const RequestSchema = z.object({
  signatureHash: z.string().regex(CONTENT_ID_RE, "signatureHash must be 64-char lowercase hex"),
});

export const runtime = "nodejs";

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
  const { signatureHash } = parsed.data;
  const offchainKey = `signed-json/${signatureHash}.json`;

  // 1. presigned GET URL for the raw mp4 (TP gateway は TEE 内で fetch する)
  let contentUrl: string;
  try {
    const presigned = await presignSignedMp4Get({ signatureHash, expiresInSec: 600 });
    contentUrl = presigned.url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `presign signed mp4 failed: ${msg}` }, { status: 500 });
  }

  // 2. POST TP Gateway /process
  let processJson: unknown;
  try {
    const upstream = await fetch(`${tpGatewayUrl()}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_type: "single",
        content_url: contentUrl,
        processor_ids: ["c2pa-verify"],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `TP /process ${upstream.status}: ${errBody.slice(0, 500)}` },
        { status: 502 },
      );
    }
    processJson = await upstream.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `TP /process fetch failed: ${msg}` }, { status: 502 });
  }

  // TP gateway が返す signature_hash を取り出す (= 必ず返すフィールド、 mock-device の検証参照)
  const tpSignatureHash = (processJson as { signature_hash?: unknown }).signature_hash;
  if (typeof tpSignatureHash !== "string") {
    return NextResponse.json(
      { error: "TP /process response missing signature_hash" },
      { status: 502 },
    );
  }

  // TP 返却値と client が計算した signature_hash の整合性チェック (= TP は sha256:<hex> 形式で返す)
  const expected = `sha256:${signatureHash}`;
  if (tpSignatureHash !== expected) {
    return NextResponse.json(
      {
        error: "signature_hash mismatch",
        signatureHash,
        expected,
        actual: tpSignatureHash,
      },
      { status: 422 },
    );
  }

  // 3a. 内部参照用に rootlens-raw に保存
  const body_bytes = Buffer.from(JSON.stringify(processJson, null, 2));
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_RAW,
        Key: offchainKey,
        Body: body_bytes,
        ContentType: "application/json",
      }),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `raw bucket save failed: ${msg}` }, { status: 500 });
  }

  // 3b. cNFT metadata URI 用に rootlens-public にも保存して公開 URL を取得
  let signedJsonUri: string;
  try {
    signedJsonUri = await uploadPublic(offchainKey, body_bytes, "application/json");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `public bucket save failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({
    signedJsonUri,
    signatureHash,
  });
}
