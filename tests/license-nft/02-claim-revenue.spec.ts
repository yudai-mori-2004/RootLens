// SPDX-License-Identifier: Apache-2.0
//
// Audit 攻撃テスト: claim_revenue の境界条件。
// Adversarial A10 (別ユーザーの revenue を引き出そうとする) + A11 系。

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import {
  buildClaimRevenueIx,
  ensureBalance,
  findUserRevenuePda,
  getConnection,
  loadKeypair,
  loadNetwork,
  sendExpectingFailure,
  sendExpectingSuccess,
} from "./helpers";

describe("claim_revenue — adversarial", () => {
  const network = loadNetwork();
  const conn = getConnection();
  const programId = new PublicKey(network.program_id);
  const configPda = new PublicKey(network.config_pda);
  const usdcMint = new PublicKey(network.usdc_mint);
  const authority = loadKeypair("authority.json");

  // pool_usdc は Config PDA を owner とする USDC ATA。init-config では作っていないので
  // テスト前に存在しない。adversarial test では存在しない pool_usdc を渡しても
  // 早めに失敗するシナリオが多いので、まず存在を確認する preflight 的な用途
  const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);

  before(async () => {
    await ensureBalance(conn, authority.publicKey, 0.05);
  });

  // ---------------------------------------------------------------------
  // [A10] attacker が別 user の UserRevenue PDA を狙う
  //   → user_revenue PDA seeds = [b"revenue", attacker.key()] 派生のため
  //     attacker.user_revenue ≠ victim.user_revenue。
  //     attacker が victim の user_revenue 渡しても seeds 不一致で reject
  // ---------------------------------------------------------------------
  it("rejects claim against someone else's UserRevenue PDA (A10)", async () => {
    const attacker = Keypair.generate();
    const victim = Keypair.generate();

    // attacker への少額 SOL 送金 (signer fee)
    const fundIx = SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: attacker.publicKey,
      lamports: 5_000_000, // 0.005 SOL
    });
    await sendExpectingSuccess(conn, [fundIx], [authority]);

    const victimRevenuePda = findUserRevenuePda(programId, victim.publicKey);
    const attackerUsdc = getAssociatedTokenAddressSync(usdcMint, attacker.publicKey);

    // attacker が user=attacker で sign しつつ user_revenue=victim's を渡す
    // → Anchor seeds 制約 (seeds=[b"revenue", user.key()]) で seeds 不一致 detect
    const ix = buildClaimRevenueIx(
      programId,
      configPda,
      attacker.publicKey,
      victimRevenuePda, // ← victim の PDA を渡す
      usdcMint,
      poolUsdc,
      attackerUsdc
    );
    const err = await sendExpectingFailure(conn, [ix], [attacker]);
    expect(err.errorName).to.match(/ConstraintSeeds|UserMismatch|AccountNotInitialized/);
  });

  // ---------------------------------------------------------------------
  // user_revenue が存在しない (= まだ revenue を貯めていない user) で claim 試行
  //   → has_one チェック前に AccountNotInitialized で reject される
  // ---------------------------------------------------------------------
  it("rejects claim when UserRevenue PDA doesn't exist (no revenue yet)", async () => {
    const fresh = Keypair.generate();
    const fundIx = SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: fresh.publicKey,
      lamports: 5_000_000,
    });
    await sendExpectingSuccess(conn, [fundIx], [authority]);

    const freshRevenuePda = findUserRevenuePda(programId, fresh.publicKey);
    const freshUsdc = getAssociatedTokenAddressSync(usdcMint, fresh.publicKey);

    const ix = buildClaimRevenueIx(
      programId,
      configPda,
      fresh.publicKey,
      freshRevenuePda,
      usdcMint,
      poolUsdc,
      freshUsdc
    );
    const err = await sendExpectingFailure(conn, [ix], [fresh]);
    // AccountNotInitialized = Anchor 3012 (PDA 未生成)
    expect(err.errorName).to.match(/AccountNotInitialized|ConstraintSeeds/);
  });
});
