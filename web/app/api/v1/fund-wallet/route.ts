// POST /api/v1/fund-wallet
//
// 新規ユーザーは SOL を持たないため、 そのままでは cNFT mint の手数料を払えない。
// このエンドポイントは、 指定 wallet の SOL 残高が閾値未満なら、 手数料スポンサー鍵
// (= keys/dev/solana/fee-payer.json、 env FEE_PAYER_PRIVATE_KEY_BASE58) から少額 SOL を送る。
// 端末は mint の直前にこれを呼び、 自分の wallet で手数料を払える状態にしてから mint する。
//
// ⚠ dev/devnet 想定の簡易 faucet。 任意 wallet に送るので本番では要認証 (= 署名や rate limit)。
//
// Request:  { wallet: string }   // base58 pubkey
// Response: { funded: boolean, alreadyFunded?: boolean, balanceSol: number, signature?: string }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { SOLANA_RPC_URL } from "@/lib/verify/config";

export const runtime = "nodejs";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RequestSchema = z.object({ wallet: z.string().regex(BASE58_RE) });

// これ未満なら補給する閾値 / 補給額 (= cNFT mint 手数料は ~0.00001 SOL なので余裕を見て)。
const THRESHOLD_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);
const TOPUP_LAMPORTS = Math.floor(0.02 * LAMPORTS_PER_SOL);

function loadFeePayer(): Keypair {
  const b58 = process.env.FEE_PAYER_PRIVATE_KEY_BASE58;
  if (!b58) throw new Error("FEE_PAYER_PRIVATE_KEY_BASE58 is not set");
  const secret = bs58.decode(b58);
  if (secret.length !== 64) throw new Error(`fee-payer key decoded length ${secret.length}, expected 64`);
  return Keypair.fromSecretKey(secret);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const wallet = new PublicKey(parsed.data.wallet);
  const conn = new Connection(SOLANA_RPC_URL, "confirmed");

  let balance: number;
  try {
    balance = await conn.getBalance(wallet);
  } catch (e) {
    return NextResponse.json({ error: `getBalance failed: ${errMsg(e)}` }, { status: 502 });
  }

  // 既に十分なら何もしない (= 冪等。 端末は毎 mint 前に安全に呼べる)。
  if (balance >= THRESHOLD_LAMPORTS) {
    return NextResponse.json({ funded: false, alreadyFunded: true, balanceSol: balance / LAMPORTS_PER_SOL });
  }

  let feePayer: Keypair;
  try { feePayer = loadFeePayer(); } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }

  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: wallet, lamports: TOPUP_LAMPORTS }),
    );
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer.publicKey;
    tx.sign(feePayer);
    const signature = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    const newBalance = await conn.getBalance(wallet);
    return NextResponse.json({ funded: true, signature, balanceSol: newBalance / LAMPORTS_PER_SOL });
  } catch (e) {
    return NextResponse.json({ error: `fund transfer failed: ${errMsg(e)}` }, { status: 502 });
  }
}
