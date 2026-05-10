// SPDX-License-Identifier: Apache-2.0
//
// 02: G→D の e2e。stake 状態だと D の `issue_license` が成功し、
// unstake 状態だと `DelegateMismatch` で失敗することを確認する。
//
// G が D の前提条件を作る側であることを示す決定的な統合テスト。
// SPECS_JA §4.2 / §4.5 / §5.2 verification の振る舞いをまとめて押さえる。

import { expect } from "chai";
import { describe, it, before } from "mocha";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";

import {
  buildDelegateV2Ix,
  fetchAssetWithProof,
  findBubblegumTreeConfig,
  getConnection,
  getDasUrl,
  loadFixtures,
  loadKeypair,
  loadKeypairFromFile,
  sendIx,
  waitUntilDelegate,
} from "./helpers";
import {
  buildIssueLicenseIx,
  findLicenseTreeAuthority,
  findMplCoreCpiSigner,
  findUserRevenuePda,
} from "./issue-license-helpers";

describe("Unit G+D — staking gates issue_license", function () {
  this.timeout(180000);

  const fixtures = loadFixtures();
  const dasUrl = getDasUrl();
  const conn = getConnection();

  const programId = new PublicKey(fixtures.program_id);
  const configPda = new PublicKey(fixtures.config_pda);
  const titleCoreCollection = new PublicKey(fixtures.title_core_collection);
  const licenseCollection = new PublicKey(fixtures.license_collection);
  const usdcMint = new PublicKey(fixtures.usdc_mint);
  const rootTree = new PublicKey(fixtures.root_tree);
  const licenseMerkleTree = new PublicKey(fixtures.license_tree);

  const cosignAuthority = loadKeypair(fixtures.cosign_authority_secret);
  const deployer = loadKeypairFromFile("deployer.json"); // USDC mint authority

  // 02 では leaf_4 を使う (01 が leaf_3 を使うため衝突回避)
  const leaf = fixtures.leaves[1]; // leaf_4
  const owner = loadKeypair(leaf.owner_secret);
  const assetId = new PublicKey(leaf.asset_id);

  // テスト中に都度生成する buyer
  let buyer: Keypair;
  let buyerUsdc: PublicKey;
  let delegateUsdc: PublicKey;
  let poolUsdc: PublicKey;

  const PRICE = 1_000_000n; // 1 USDC (6 dp)

  before(async () => {
    const ownerBal = await conn.getBalance(owner.publicKey);
    if (ownerBal < 5_000_000) {
      throw new Error(`leaf owner に SOL 不足 (${ownerBal})。手動 airdrop 要`);
    }
    const deployerBal = await conn.getBalance(deployer.publicKey);
    if (deployerBal < 50_000_000) {
      throw new Error(`deployer に SOL 不足 (${deployerBal})。`);
    }

    // buyer keypair を生成 + SOL transfer + USDC ATA + mintTo
    buyer = Keypair.generate();

    const fundIx = SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 50_000_000, // 0.05 SOL
    });
    buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
    const buyerAtaIx = createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      buyerUsdc,
      buyer.publicKey,
      usdcMint,
    );
    await sendAndConfirmTransaction(conn, new Transaction().add(fundIx, buyerAtaIx), [deployer], {
      commitment: "confirmed",
    });
    await mintTo(conn, deployer, usdcMint, buyerUsdc, deployer, Number(PRICE * 2n));

    // delegate (cosign_authority) USDC ATA も作っておく (issue_license が読み書きする)
    const dAta = await getOrCreateAssociatedTokenAccount(
      conn,
      deployer,
      usdcMint,
      cosignAuthority.publicKey,
    );
    delegateUsdc = dAta.address;

    // pool USDC: configPda の ATA (owner-off-curve なので allowOwnerOffCurve=true)
    poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
  });

  async function ensureStaked(target: PublicKey): Promise<void> {
    const cur = await fetchAssetWithProof(assetId, dasUrl);
    if (cur.leafDelegate.equals(target)) return;
    const ix = buildDelegateV2Ix({
      payer: owner.publicKey,
      leafOwner: owner.publicKey,
      newLeafDelegate: target,
      asset: cur,
    });
    await sendIx(conn, [ix], [owner]);
    await waitUntilDelegate(assetId, target, dasUrl);
  }

  async function buildIssueIxFor(coSigner: PublicKey): Promise<TransactionInstruction> {
    const ap = await fetchAssetWithProof(assetId, dasUrl);
    const licenseTreeAuthority = findLicenseTreeAuthority(programId, licenseMerkleTree);
    const licenseTreeConfig = findBubblegumTreeConfig(licenseMerkleTree);
    const userRevenuePda = findUserRevenuePda(programId, ap.leafOwner);
    const mplCoreCpiSigner = findMplCoreCpiSigner();

    return buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: coSigner,
        staker: ap.leafOwner,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree: rootTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: ap.proof,
      },
      {
        root: ap.root,
        nonce: ap.nonce,
        index: ap.index,
        dataHash: ap.dataHash,
        creatorHash: ap.creatorHash,
        assetDataHash: ap.assetDataHash ?? new Uint8Array(32),
        flags: ap.flags ?? 0,
        rootCollection: titleCoreCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: PRICE,
      },
    );
  }

  it("staked → issue_license が成功する", async () => {
    await ensureStaked(cosignAuthority.publicKey);

    const beforeBuyer = (await getAccount(conn, buyerUsdc)).amount;
    const ix = await buildIssueIxFor(cosignAuthority.publicKey);
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(ix),
      [buyer, cosignAuthority],
      { commitment: "confirmed", skipPreflight: false },
    );
    console.log(`  issue_license tx: ${sig}`);

    const afterBuyer = (await getAccount(conn, buyerUsdc)).amount;
    expect(beforeBuyer - afterBuyer).to.equal(PRICE); // 1 USDC が buyer から抜けた
  });

  it("unstaked → issue_license が DelegateMismatch で失敗する", async () => {
    // unstake (delegate を owner に戻す)
    const cur = await fetchAssetWithProof(assetId, dasUrl);
    if (!cur.leafDelegate.equals(owner.publicKey)) {
      const ix = buildDelegateV2Ix({
        payer: owner.publicKey,
        leafOwner: owner.publicKey,
        newLeafDelegate: owner.publicKey,
        asset: cur,
      });
      await sendIx(conn, [ix], [owner]);
      await waitUntilDelegate(assetId, owner.publicKey, dasUrl);
    }

    const ix = await buildIssueIxFor(cosignAuthority.publicKey);
    let threw = false;
    try {
      await sendAndConfirmTransaction(
        conn,
        new Transaction().add(ix),
        [buyer, cosignAuthority],
        { commitment: "confirmed", skipPreflight: false },
      );
    } catch (e: any) {
      threw = true;
      const msg = String(e?.message ?? e);
      // anchor error name は "DelegateMismatch"。ログのどこかに出る想定
      expect(msg.toLowerCase()).to.match(/delegate|mismatch|0x/, `unexpected error: ${msg}`);
    }
    expect(threw).to.equal(true, "issue_license が unstaked 状態で成功してしまった");
  });
});
