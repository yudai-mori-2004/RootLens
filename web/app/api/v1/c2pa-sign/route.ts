// POST /api/v1/c2pa-sign — C2PA リモート署名 (= Adobe 方式のクラウド署名)。
//
// 端末は動画全体のハッシュ計算 + manifest 組み立てをローカルで行い、 署名対象バイト列
// (= COSE の to-be-signed、 数 KB) だけをここに送る。 サーバは RootLens 組織鍵 (Ed25519、
// env C2PA_SIGN_KEY_B64) で raw 署名を返す。 動画そのものはこの endpoint を通らない。
//
// GET は署名に使う公開証明書チェーン (= x5chain に埋める) を返す。
//
// セキュリティ (MVP):
//   - 秘密鍵はサーバ env のみ (= アプリバイナリに鍵が入らない。 焼き込み方式の弱点を解消)
//   - 認可は X-Account-Pubkey header (= 他 API と同じ MVP 水準)。 単一ユーザー収集フェーズでは十分
//   - 将来: App Attest 検証を「署名する条件」 に足せば per-device PKI なしで genuine-app 保証になる
//     (document/v0.1.4/tasks/09-remote-signing/README.md)

import { NextRequest, NextResponse } from "next/server";
import { createPrivateKey, sign as cryptoSign, type KeyObject } from "crypto";
import { z } from "zod";
import { requireAccountPubkey } from "@/lib/auth";
import { C2PA_SIGN_CERTS_PEM } from "@/lib/c2pa-certs";

// COSE to-be-signed は claim + 証明書チェーン程度 (= 数 KB〜数十 KB)。 動画を送りつけられても
// 署名しない (= サイズ上限で reject)。
const MAX_SIGN_BYTES = 256 * 1024;

const RequestSchema = z.object({
  dataB64: z.string().min(1).max(Math.ceil((MAX_SIGN_BYTES * 4) / 3) + 8),
});

let cachedKey: KeyObject | null = null;
function signingKey(): KeyObject {
  if (cachedKey) return cachedKey;
  const b64 = process.env.C2PA_SIGN_KEY_B64;
  if (!b64) throw new Error("C2PA_SIGN_KEY_B64 is not set.");
  cachedKey = createPrivateKey(Buffer.from(b64, "base64").toString("utf8"));
  if (cachedKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`C2PA signing key must be ed25519, got ${cachedKey.asymmetricKeyType}`);
  }
  return cachedKey;
}

/** 署名用公開証明書チェーンを返す (= 端末が CallbackSigner の certs に使う)。 */
export async function GET() {
  return NextResponse.json({ alg: "ed25519", certsPem: C2PA_SIGN_CERTS_PEM });
}

export async function POST(req: NextRequest) {
  try {
    requireAccountPubkey(req);
  } catch (r) {
    return r as Response;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = Buffer.from(parsed.data.dataB64, "base64");
  if (data.length === 0 || data.length > MAX_SIGN_BYTES) {
    return NextResponse.json({ error: `data must be 1..${MAX_SIGN_BYTES} bytes` }, { status: 400 });
  }

  try {
    // Ed25519 は digest 前置なしの raw 署名 (= 64 bytes)。 c2pa の COSE がそのまま埋める。
    const signature = cryptoSign(null, data, signingKey());
    return NextResponse.json({ signatureB64: signature.toString("base64") });
  } catch (e) {
    console.error("[c2pa-sign] sign failed:", e);
    const msg = e instanceof Error ? e.message : "sign failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
