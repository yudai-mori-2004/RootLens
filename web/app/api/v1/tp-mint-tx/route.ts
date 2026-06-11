// POST /api/v1/tp-mint-tx
//
// v0.1.3 Pipeline 1 step 6a (= cNFT 発行 partial_tx 取得) のサーバ proxy。
//
// クライアント (= iOS) が直接 TP Gateway /extension/solana を叩けない
// (ATS で plain HTTP block) ため、 HTTPS proxy として中継する。
//
// Request:
//   {
//     offchainDataUrl: string,  // rootlens-public 上の signed_json URL
//     payer:           string,  // base58 wallet pubkey (= 撮影者)
//     merkleTree:      string,  // base58 cNFT 発行先 Bubblegum tree
//     collection?:     string,  // base58 MPL Core collection (省略可)
//   }
//
// Response:
//   {
//     partialTx: string,        // base64 VersionedTransaction (= fee payer まで署名済み)
//   }
//
// 手数料スポンサー (D 案): payer (= leaf owner = 撮影者) と fee payer (= スポンサー) を分離する。
// TP /extension/solana に fee_payer=スポンサー pubkey を渡すと、 TEE は fee payer をスポンサーにした
// mint tx を作って tree_creator_or_delegate だけ署名して返す。 ここで fee payer slot を
// スポンサー鍵 (FEE_PAYER_PRIVATE_KEY_BASE58) で署名し、 完全署名済み tx を端末へ返す。
// → 端末は broadcast するだけ。 leaf owner (撮影者) は signer ではないので SOL も署名も不要。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bs58 from "bs58";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "@/lib/verify/config";
import { tpGatewayUrl } from "@/lib/tp-gateway";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/// 手数料スポンサー鍵 (= keys/dev/solana/fee-payer.json、 env 経由)。 fee payer slot を署名する。
function loadFeePayer(): Keypair {
  const b58 = process.env.FEE_PAYER_PRIVATE_KEY_BASE58;
  if (!b58) throw new Error("FEE_PAYER_PRIVATE_KEY_BASE58 is not set");
  const secret = bs58.decode(b58);
  if (secret.length !== 64) throw new Error(`fee-payer key decoded length ${secret.length}, expected 64`);
  return Keypair.fromSecretKey(secret);
}

const RequestSchema = z.object({
  offchainDataUrl: z.string().url(),
  payer: z.string().regex(BASE58_RE),
  merkleTree: z.string().regex(BASE58_RE),
  collection: z.string().regex(BASE58_RE).optional(),
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
  const { offchainDataUrl, payer, merkleTree, collection } = parsed.data;

  // 手数料スポンサー鍵を読む (= fee payer。 これで手数料を肩代わりする)。
  let feePayer: Keypair;
  try {
    feePayer = loadFeePayer();
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // 最新 blockhash を取得 (= partial_tx は recent_blockhash 付きで返ってくる必要)
  let recentBlockhash: string;
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    recentBlockhash = blockhash;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `getLatestBlockhash failed: ${msg}` }, { status: 502 });
  }

  // TP Gateway /extension/solana に転送。 payer=leaf owner (撮影者)、 fee_payer=スポンサーで分離。
  const upstreamBody: Record<string, unknown> = {
    offchain_data_url: offchainDataUrl,
    payer,
    merkle_tree: merkleTree,
    recent_blockhash: recentBlockhash,
    fee_payer: feePayer.publicKey.toBase58(),
  };
  if (collection) upstreamBody.collection = collection;

  let json: { partial_tx?: string };
  try {
    const upstream = await fetch(`${tpGatewayUrl()}/extension/solana`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `TP /extension/solana ${upstream.status}: ${errBody.slice(0, 500)}` },
        { status: 502 },
      );
    }
    json = await upstream.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `TP /extension/solana fetch failed: ${msg}` },
      { status: 502 },
    );
  }

  if (typeof json.partial_tx !== "string") {
    return NextResponse.json(
      { error: "TP response missing partial_tx" },
      { status: 502 },
    );
  }

  // TEE が返す tx は tree_creator_or_delegate だけ署名済み。 fee payer slot をスポンサー鍵で署名し、
  // 完全署名済み tx にして返す (= 端末は broadcast するだけ。 leaf owner の署名は不要)。
  let signedB64: string;
  try {
    const tx = VersionedTransaction.deserialize(
      new Uint8Array(Buffer.from(json.partial_tx, "base64")),
    );
    tx.sign([feePayer]); // pubkey が一致する fee payer slot だけ埋まる
    signedB64 = Buffer.from(tx.serialize()).toString("base64");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `fee-payer sign failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ partialTx: signedB64 });
}
