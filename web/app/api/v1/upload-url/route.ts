/**
 * 仕様書 §4.3 重複排除 + §6.2 R2 アップロード — Unit F
 *
 * POST /api/v1/upload-url
 *
 * クライアントから (content_hash, kind, contentType) を受け取り、
 * R2 上で同じ content_hash の object 有無を HEAD で確認:
 *
 *   - 既存 → status="exists", publicUrl のみ返す (presigned PUT は発行しない)
 *   - 新規 → status="new", presigned PUT URL + key + publicUrl を返す
 *
 * content_hash は §3 の TP register 結果 (signed_json.payload.content_hash) を
 * クライアントがそのまま渡す想定。SHA-256 等の再計算は本ユニットで行わない。
 *
 * 信頼境界:
 *   - クライアントが嘘の content_hash を渡しても R2 には書けるだけ。
 *   - 「動画と content_hash が一致しているか」の検証は staking 層 (Unit G) の責務。
 *   - 本ユニットは dedup と key 形式の正規化だけを保証する。
 */

import { NextRequest, NextResponse } from "next/server";
import {
  keyForContentHash,
  normalizeContentHash,
  normalizeExt,
  objectExists,
  createPresignedPutUrl,
  publicUrlFor,
  type ContentKind,
} from "@/lib/server/r2";

const ALLOWED_KINDS: ReadonlyArray<ContentKind> = ["media", "ogp", "content"];

interface UploadUrlBody {
  content_hash?: string;
  kind?: string;
  contentType?: string;
}

export async function POST(req: NextRequest) {
  let body: UploadUrlBody;
  try {
    body = (await req.json()) as UploadUrlBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { content_hash, kind, contentType } = body;

  if (!content_hash) {
    return NextResponse.json({ error: "content_hash is required" }, { status: 400 });
  }
  if (!contentType) {
    return NextResponse.json({ error: "contentType is required" }, { status: 400 });
  }
  if (!kind || !ALLOWED_KINDS.includes(kind as ContentKind)) {
    return NextResponse.json(
      {
        error: `kind must be one of ${ALLOWED_KINDS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // 入力正規化 — 不正なら 400
  let key: string;
  try {
    // normalizeContentHash / normalizeExt は keyForContentHash 内で再度走るが、
    // 例外を 400 として明示するため先に呼ぶ
    normalizeContentHash(content_hash);
    const ext = normalizeExt(contentType);
    key = keyForContentHash(content_hash, kind as ContentKind, ext);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "invalid content_hash or contentType";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // dedup 判定
  let exists: boolean;
  try {
    exists = await objectExists(key);
  } catch (e: unknown) {
    console.error("[upload-url] HEAD failed:", e);
    const msg = e instanceof Error ? e.message : "R2 head failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (exists) {
    return NextResponse.json({
      status: "exists",
      key,
      publicUrl: publicUrlFor(key),
    });
  }

  // 新規 — presigned PUT を発行
  let uploadUrl: string;
  try {
    uploadUrl = await createPresignedPutUrl(key, contentType);
  } catch (e: unknown) {
    console.error("[upload-url] presign failed:", e);
    const msg = e instanceof Error ? e.message : "presign failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({
    status: "new",
    key,
    uploadUrl,
    publicUrl: publicUrlFor(key),
  });
}
