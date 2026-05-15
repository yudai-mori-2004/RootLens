// SPDX-License-Identifier: Apache-2.0
//
// Audit 攻撃テスト: update_config の境界条件。
// 仕様書 §5.4.2 + ユニット doc Adversarial A13 / A14 / A15。
//
// すべて devnet 上の deployed program (G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8)
// に対して実打する。

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

import {
  buildUpdateConfigIx,
  decodeConfig,
  ensureBalance,
  ensureConfigMatchesNetwork,
  getConnection,
  loadKeypair,
  loadNetwork,
  sendExpectingFailure,
  sendExpectingSuccess,
} from "./helpers";

describe("update_config — adversarial", () => {
  const network = loadNetwork();
  const conn = getConnection();
  const programId = new PublicKey(network.program_id);
  const configPda = new PublicKey(network.config_pda);
  const authority = loadKeypair("authority.json");

  beforeAll(async () => {
    await ensureBalance(conn, authority.publicKey, 0.05);
    // Config を network.json の値 (= 監査テストが前提する baseline) に揃える。
    // 別 spec / cli / デモが先に書き換えていたら更新する。
    await ensureConfigMatchesNetwork(conn, programId, configPda, authority, {
      rootNftCollection: new PublicKey(network.root_nft_collection),
      usdcMint: new PublicKey(network.usdc_mint),
      stakerBps: network.staker_basis_points,
      delegateBps: network.delegate_basis_points,
    });
    // 念のため authority が一致するか sanity check
    const acc = await conn.getAccountInfo(configPda);
    if (!acc) throw new Error("Config PDA missing");
    const cfg = decodeConfig(Buffer.from(acc.data));
    expect(cfg.authority.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  // ---------------------------------------------------------------------
  // [A14] 別 keypair が update_config を試みる → has_one で reject
  // ---------------------------------------------------------------------
  it("rejects update_config from non-authority signer (A14)", async () => {
    const attacker = Keypair.generate();
    // attacker に rent 不要 (signer fee は authority とは別枠... 実は signer 自体 SOL 必要)
    // tx fee は signer から引かれるので attacker に airdrop 必要。
    // 代わりに authority も signer に並べてしまえば fee は authority 持ち + has_one チェックは attacker
    // → でも attacker = signer の制約は AccountMeta isSigner の話で、actually signing 必要
    // よって attacker への小額 airdrop または authority から直接送金が必要
    //
    // 簡易版: attacker への送金 (authority → attacker 0.01 SOL) してから ix 発行
    const fundAttacker = SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: attacker.publicKey,
      lamports: 5_000_000, // 0.005 SOL
    });
    await sendExpectingSuccess(conn, [fundAttacker], [authority]);

    const ix = buildUpdateConfigIx(programId, configPda, attacker.publicKey, {
      newStakerBps: 9000,
      newDelegateBps: 1000,
    });
    const err = await sendExpectingFailure(conn, [ix], [attacker]);

    // Anchor has_one violation → "ConstraintHasOne" or seeds derive mismatch
    expect(err.errorName).to.match(/ConstraintHasOne|ConstraintSeeds/);
  });

  // ---------------------------------------------------------------------
  // [A13] BPS 合計 != 10000 で update_config → InvalidBasisPoints
  // ---------------------------------------------------------------------
  it("rejects bps sum != 10000 (A13)", async () => {
    const ix = buildUpdateConfigIx(programId, configPda, authority.publicKey, {
      newStakerBps: 9000,
      newDelegateBps: 999, // 9999 != 10000
    });
    const err = await sendExpectingFailure(conn, [ix], [authority]);
    expect(err.errorName).to.equal("InvalidBasisPoints");
  });

  it("rejects bps sum > 10000 (A13)", async () => {
    const ix = buildUpdateConfigIx(programId, configPda, authority.publicKey, {
      newStakerBps: 9500,
      newDelegateBps: 1000, // 10500 > 10000
    });
    const err = await sendExpectingFailure(conn, [ix], [authority]);
    expect(err.errorName).to.equal("InvalidBasisPoints");
  });

  // ---------------------------------------------------------------------
  // partial update: staker のみ → delegate との合計チェックは
  //   既存 delegate_bps とで再検証される (引数省略時は既存値継続)
  // ---------------------------------------------------------------------
  it("rejects partial bps update that breaks invariant (A13 variant)", async () => {
    // 現在 9500/500。staker だけ 9000 にすると 9000+500=9500 != 10000 で reject
    const ix = buildUpdateConfigIx(programId, configPda, authority.publicKey, {
      newStakerBps: 9000,
      // newDelegateBps 省略 → 既存 500 と組み合わせる
    });
    const err = await sendExpectingFailure(conn, [ix], [authority]);
    expect(err.errorName).to.equal("InvalidBasisPoints");
  });

  // ---------------------------------------------------------------------
  // 正常系: bps 比率を変更 → 反映確認 → 元に戻す
  // ---------------------------------------------------------------------
  it("accepts valid bps update and reverts back (happy path)", async () => {
    // before: 9500 / 500
    const ix1 = buildUpdateConfigIx(programId, configPda, authority.publicKey, {
      newStakerBps: 9000,
      newDelegateBps: 1000,
    });
    await sendExpectingSuccess(conn, [ix1], [authority]);

    // verify
    let acc = await conn.getAccountInfo(configPda);
    let cfg = decodeConfig(Buffer.from(acc!.data));
    expect(cfg.stakerBasisPoints).to.equal(9000);
    expect(cfg.delegateBasisPoints).to.equal(1000);

    // restore
    const ix2 = buildUpdateConfigIx(programId, configPda, authority.publicKey, {
      newStakerBps: 9500,
      newDelegateBps: 500,
    });
    await sendExpectingSuccess(conn, [ix2], [authority]);

    acc = await conn.getAccountInfo(configPda);
    cfg = decodeConfig(Buffer.from(acc!.data));
    expect(cfg.stakerBasisPoints).to.equal(9500);
    expect(cfg.delegateBasisPoints).to.equal(500);
  });
});
