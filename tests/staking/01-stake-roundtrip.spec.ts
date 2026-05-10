// SPDX-License-Identifier: Apache-2.0
//
// 01: Stake → DAS で leaf.delegate 更新確認 → Unstake → DAS で leaf.delegate ==
// owner に戻ったこと確認。
//
// G の core 機能 (delegateV2 IX builder + DAS read) が devnet 上で正しく動くかを
// 単体で確認する。issue_license との e2e は 02 で見る。

import { expect } from "chai";
import { describe, it, before } from "mocha";
import { PublicKey } from "@solana/web3.js";

import {
  buildDelegateV2Ix,
  fetchAssetWithProof,
  getConnection,
  getDasUrl,
  loadFixtures,
  loadKeypair,
  sendIx,
  waitUntilDelegate,
} from "./helpers";

describe("Unit G — stake / unstake roundtrip", function () {
  this.timeout(120000);

  const fixtures = loadFixtures();
  const dasUrl = getDasUrl();
  const conn = getConnection();
  const cosignAuthority = loadKeypair(fixtures.cosign_authority_secret);

  // 借用 leaf。owner_secret で delegateV2 を sign する
  const leaf = fixtures.leaves[0]; // leaf_3
  const owner = loadKeypair(leaf.owner_secret);
  const assetId = new PublicKey(leaf.asset_id);

  before(async () => {
    // 必要 SOL 残高チェック (詳細 air-drop は手動)
    const bal = await conn.getBalance(owner.publicKey);
    if (bal < 5_000_000) {
      throw new Error(
        `leaf owner ${owner.publicKey.toBase58()} に SOL が足りない (${bal} lamports)。` +
          `airdrop か手動入金してから再実行`,
      );
    }
  });

  it("stake: delegateV2 で leaf.delegate を cosign_authority に切替える", async () => {
    const before = await fetchAssetWithProof(assetId, dasUrl);
    expect(before.leafOwner.toBase58()).to.equal(leaf.owner);
    // 既に staking 済みなら skip しない (idempotent に再 stake してもよい)

    const ix = buildDelegateV2Ix({
      payer: owner.publicKey,
      leafOwner: owner.publicKey,
      newLeafDelegate: cosignAuthority.publicKey,
      asset: before,
    });
    const sig = await sendIx(conn, [ix], [owner]);
    console.log(`  stake tx: ${sig}`);

    const after = await waitUntilDelegate(assetId, cosignAuthority.publicKey, dasUrl);
    expect(after.leafDelegate.toBase58()).to.equal(cosignAuthority.publicKey.toBase58());
    expect(after.leafOwner.toBase58()).to.equal(leaf.owner); // owner は不変
  });

  it("unstake: delegateV2 で leaf.delegate を owner 自身に戻す", async () => {
    const before = await fetchAssetWithProof(assetId, dasUrl);
    expect(before.leafDelegate.toBase58()).to.equal(cosignAuthority.publicKey.toBase58());

    const ix = buildDelegateV2Ix({
      payer: owner.publicKey,
      leafOwner: owner.publicKey,
      newLeafDelegate: owner.publicKey, // ← unstake = owner 自身へ
      asset: before,
    });
    const sig = await sendIx(conn, [ix], [owner]);
    console.log(`  unstake tx: ${sig}`);

    const after = await waitUntilDelegate(assetId, owner.publicKey, dasUrl);
    expect(after.leafDelegate.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(after.leafOwner.toBase58()).to.equal(leaf.owner);
  });
});
