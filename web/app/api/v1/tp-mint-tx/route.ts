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
//     partialTx: string,        // base64 VersionedTransaction (未署名 payer slot)
//   }
//
// 端末側はこの partial_tx を payer 鍵で署名 → Solana RPC sendRawTransaction
// → confirmed まで待機 → TreeConfig PDA から num_minted を読んで asset_id を導出する。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Connection } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "@/lib/verify/config";

const TP_GATEWAY = process.env.TP_GATEWAY_URL ?? "http://13.113.217.17:3000";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

  // TP Gateway /extension/solana に転送
  const upstreamBody: Record<string, unknown> = {
    offchain_data_url: offchainDataUrl,
    payer,
    merkle_tree: merkleTree,
    recent_blockhash: recentBlockhash,
  };
  if (collection) upstreamBody.collection = collection;

  let json: { partial_tx?: string };
  try {
    const upstream = await fetch(`${TP_GATEWAY.replace(/\/$/, "")}/extension/solana`, {
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

  return NextResponse.json({ partialTx: json.partial_tx });
}
