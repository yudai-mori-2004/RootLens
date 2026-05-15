// SPDX-License-Identifier: Apache-2.0
//
// Audit テスト: issue_license の happy path (H1) + proof 関連 adversarial。
//
// fixtures.json の leaf を 1 個使い、本物の Bubblegum proof を取得して
// 正規の引数で issue_license を打ち、成功 + USDC 95:5 分配 + UserRevenue 累積を確認。
//
// その後同じ leaf に対して proof / data_hash / delegate を mutate した
// adversarial cases (A1, A3, A4) を実行。

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair, toWeb3JsPublicKey, fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";
import { mplBubblegum, getAssetWithProof, findLeafAssetIdPda, parseLeafFromMintV2Transaction } from "@metaplex-foundation/mpl-bubblegum";
import { keccak_256 } from "@noble/hashes/sha3.js";

import {
  buildIssueLicenseIx,
  findBubblegumTreeConfig,
  findLicenseTreeAuthority,
  findMplCoreCpiSigner,
} from "./issue-helpers";
import {
  ensureBalance,
  findUserRevenuePda,
  getConnection,
  loadAlt,
  loadKeypair,
  loadNetwork,
  sendExpectingFailure,
  sendExpectingSuccess,
} from "./helpers";
import type { AddressLookupTableAccount } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Fixtures {
  program_id: string;
  config_pda: string;
  root_nft_collection: string;
  license_collection: string;
  usdc_mint: string;
  deployer: string;
  license_tree: string;
  license_tree_authority: string;
  root_tree: string;
  alt: string;
  leaves: {
    name: string;
    index: number;
    owner: string;
    owner_secret: number[];
    delegate: string;
    delegate_secret: number[];
  }[];
}

function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures.json"), "utf-8"));
}

describe("issue_license — happy path + proof-related adversarial", () => {
  const network = loadNetwork();
  const fixtures = loadFixtures();
  const conn = getConnection();

  const programId = new PublicKey(network.program_id);
  const configPda = new PublicKey(network.config_pda);
  const rootNftCollection = new PublicKey(network.root_nft_collection);
  const licenseCollection = new PublicKey(network.license_collection);
  const usdcMint = new PublicKey(network.usdc_mint);
  const licenseMerkleTree = new PublicKey(fixtures.license_tree);
  const rootMerkleTree = new PublicKey(fixtures.root_tree);

  const deployer = loadKeypair("deployer.json");
  const mplCoreCpiSigner = findMplCoreCpiSigner();
  const licenseTreeConfig = findBubblegumTreeConfig(licenseMerkleTree);
  const licenseTreeAuthority = findLicenseTreeAuthority(programId, licenseMerkleTree);

  // UMI w/ DAS API
  const umi = createUmi("https://api.devnet.solana.com");
  umi.use(keypairIdentity(fromWeb3JsKeypair(deployer)));
  umi.use(mplBubblegum());
  umi.use(dasApi() as any);

  /** UMI で getAssetWithProof + 結果を web3 型に正規化して返す */
  async function fetchProof(leafIndex: number) {
    const [assetId] = findLeafAssetIdPda(umi, {
      merkleTree: fromWeb3JsPublicKey(rootMerkleTree),
      leafIndex: BigInt(leafIndex),
    });
    const ap = await getAssetWithProof(umi, assetId);
    return {
      assetId,
      root: Buffer.from(ap.root),
      dataHash: Buffer.from(ap.dataHash),
      creatorHash: Buffer.from(ap.creatorHash),
      assetDataHash: ap.asset_data_hash ? Buffer.from(ap.asset_data_hash) : Buffer.alloc(32),
      flags: ap.flags ?? 0,
      nonce: BigInt(ap.nonce),
      index: ap.index,
      proof: ap.proof.map((p) => new PublicKey(toWeb3JsPublicKey(p))),
      leafOwner: new PublicKey(toWeb3JsPublicKey(ap.leafOwner)),
      leafDelegate: new PublicKey(toWeb3JsPublicKey(ap.leafDelegate)),
    };
  }

  let alts: AddressLookupTableAccount[] = [];

  beforeAll(async () => {
    await ensureBalance(conn, deployer.publicKey, 0.1);
    alts = [await loadAlt(conn, new PublicKey(fixtures.alt))];
  });

  /** 新規 buyer に SOL + USDC ATA + USDC 残高を ensure */
  async function setupBuyerWithUsdc(amount: bigint): Promise<{
    buyer: Keypair;
    buyerUsdc: PublicKey;
  }> {
    const buyer = Keypair.generate();
    const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
    const fundIx = SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 30_000_000,
    });
    const ataIx = createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      buyerUsdc,
      buyer.publicKey,
      usdcMint
    );
    await sendExpectingSuccess(conn, [fundIx, ataIx], [deployer]);
    // mintTo: deployer が USDC mint authority
    await mintTo(conn, deployer, usdcMint, buyerUsdc, deployer, amount);
    return { buyer, buyerUsdc };
  }

  async function ensureDelegateAta(delegate: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(usdcMint, delegate);
    const info = await conn.getAccountInfo(ata);
    if (!info) {
      const ix = createAssociatedTokenAccountInstruction(deployer.publicKey, ata, delegate, usdcMint);
      await sendExpectingSuccess(conn, [ix], [deployer]);
    }
    return ata;
  }

  // ---------------------------------------------------------------------
  // [H1] 正規 issue_license フロー
  //   leaf_0 を使い、正しい proof + delegate co-sign で発行。
  //   後段で USDC 95:5 分配 + UserRevenue 累積を確認。
  // ---------------------------------------------------------------------
  it("happy path: full issue_license flow (H1)", async () => {
    const leaf = fixtures.leaves[0];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));

    const proof = await fetchProof(leaf.index);
    expect(proof.leafOwner.toBase58()).to.equal(stakerKey.toBase58());
    expect(proof.leafDelegate.toBase58()).to.equal(delegateKp.publicKey.toBase58());

    const PRICE = 1_000_000n; // 1 USDC
    const { buyer, buyerUsdc } = await setupBuyerWithUsdc(PRICE);
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    const beforePool = (await getAccount(conn, poolUsdc)).amount;
    const beforeDelegate = (await getAccount(conn, delegateUsdc)).amount;
    // UserRevenue PDA は staker 共通なのでテスト再実行で累積する。delta で判定する
    const revAcctBefore = await conn.getAccountInfo(userRevenuePda);
    const beforeBalance = revAcctBefore ? revAcctBefore.data.readBigUInt64LE(8 + 32) : 0n;

    const ix = buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: delegateKp.publicKey,
        staker: stakerKey,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: proof.proof,
      },
      {
        root: proof.root,
        nonce: proof.nonce,
        index: proof.index,
        dataHash: proof.dataHash,
        creatorHash: proof.creatorHash,
        assetDataHash: proof.assetDataHash,
        flags: proof.flags,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license/0.json",
        licenseName: "Test License #0",
        price: PRICE,
      }
    );

    const sig = await sendExpectingSuccess(conn, [ix], [buyer, delegateKp], alts);
    console.log(`    issue_license sig: ${sig}`);

    // SPECS §5.5.3 Layer 1 binding 検証: License NFT の URI に
    //   ?root_mint=<root_asset_id_b58> が program によって append されている。
    // 検証方法: program のログ ("license-nft: issue_license root=...") + program code review。
    // 完全な on-chain verification は DAS で License NFT を取得後に uri を読む方式
    // (Bubblegum tree state index 計算が必要なため follow-up で実装)。
    const txDetail = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const allLogs = (txDetail?.meta?.logMessages ?? []).join("\n");
    expect(allLogs).to.match(/license-nft: issue_license root=/);

    // USDC 分配確認: 95% pool, 5% delegate
    const afterPool = (await getAccount(conn, poolUsdc)).amount;
    const afterDelegate = (await getAccount(conn, delegateUsdc)).amount;
    expect(afterPool - beforePool).to.equal(950_000n); // 95% of 1 USDC
    expect(afterDelegate - beforeDelegate).to.equal(50_000n); // 5%

    // UserRevenue.balance += 95% (delta 判定)
    const revAcct = await conn.getAccountInfo(userRevenuePda);
    expect(revAcct, "UserRevenue PDA must exist").to.not.be.null;
    if (!revAcct) throw new Error();
    const balance = revAcct.data.readBigUInt64LE(8 + 32);
    expect(balance - beforeBalance).to.equal(950_000n);
  });

  // ---------------------------------------------------------------------
  // [A1] co-signer ≠ leaf.delegate
  // ---------------------------------------------------------------------
  it("rejects when co-signer is not the leaf delegate (A1)", async () => {
    const leaf = fixtures.leaves[1];
    const stakerKey = new PublicKey(leaf.owner);
    const proof = await fetchProof(leaf.index);

    // 偽 delegate (本物の delegate keypair を持たない attacker)
    const fakeDelegate = Keypair.generate();
    const { buyer, buyerUsdc } = await setupBuyerWithUsdc(1_000_000n);
    const fakeDelegateUsdc = await ensureDelegateAta(fakeDelegate.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    const ix = buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: fakeDelegate.publicKey, // ← attacker
        staker: stakerKey,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc: fakeDelegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: proof.proof,
      },
      {
        root: proof.root,
        nonce: proof.nonce,
        index: proof.index,
        dataHash: proof.dataHash,
        creatorHash: proof.creatorHash,
        assetDataHash: proof.assetDataHash,
        flags: proof.flags,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license/1.json",
        licenseName: "Test License #1",
        price: 1_000_000n,
      }
    );
    const err = await sendExpectingFailure(conn, [ix], [buyer, fakeDelegate], alts);
    // mpl-account-compression は無効 proof で access violation panic する。
    // Anchor error は返らないが、ログに "Invalid root recomputed from proof" が出る
    const allLogs = err.logs.join("\n");
    expect(allLogs).to.match(/Invalid root recomputed from proof|InvalidLeafProof/);
  });

  // ---------------------------------------------------------------------
  // [A3] data_hash 引数を改ざん → 再計算した leaf hash が proof と一致しない
  // ---------------------------------------------------------------------
  it("rejects when data_hash is tampered (A3)", async () => {
    const leaf = fixtures.leaves[2];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const proof = await fetchProof(leaf.index);

    const { buyer, buyerUsdc } = await setupBuyerWithUsdc(1_000_000n);
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    // data_hash の 1 byte 反転
    const tampered = Buffer.from(proof.dataHash);
    tampered[0] ^= 0xff;

    const ix = buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: delegateKp.publicKey,
        staker: stakerKey,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: proof.proof,
      },
      {
        root: proof.root,
        nonce: proof.nonce,
        index: proof.index,
        dataHash: tampered, // ← 改ざん
        creatorHash: proof.creatorHash,
        assetDataHash: proof.assetDataHash,
        flags: proof.flags,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license/2.json",
        licenseName: "Test License #2",
        price: 1_000_000n,
      }
    );
    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp], alts);
    const allLogs = err.logs.join("\n");
    expect(allLogs).to.match(/Invalid root recomputed from proof|InvalidLeafProof/);
  });

  // ---------------------------------------------------------------------
  // [A4] proof 中の sibling hash を別 leaf のものに差し替え
  // ---------------------------------------------------------------------
  it("rejects when merkle proof is bogus (A4)", async () => {
    const leaf = fixtures.leaves[3];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const proof = await fetchProof(leaf.index);

    const { buyer, buyerUsdc } = await setupBuyerWithUsdc(1_000_000n);
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    // proof[0] を全く別の pubkey に差し替え
    const bogusProof = [...proof.proof];
    bogusProof[0] = Keypair.generate().publicKey;

    const ix = buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: delegateKp.publicKey,
        staker: stakerKey,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: bogusProof, // ← 改ざん
      },
      {
        root: proof.root,
        nonce: proof.nonce,
        index: proof.index,
        dataHash: proof.dataHash,
        creatorHash: proof.creatorHash,
        assetDataHash: proof.assetDataHash,
        flags: proof.flags,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license/3.json",
        licenseName: "Test License #3",
        price: 1_000_000n,
      }
    );
    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp], alts);
    const allLogs = err.logs.join("\n");
    expect(allLogs).to.match(/Invalid root recomputed from proof|InvalidLeafProof/);
  });

  // ---------------------------------------------------------------------
  // [A11] buyer の USDC 残高 < price → Token transfer CPI で失敗
  // ---------------------------------------------------------------------
  it("rejects when buyer USDC balance is insufficient (A11)", async () => {
    const leaf = fixtures.leaves[4];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const proof = await fetchProof(leaf.index);

    // buyer に 100 単位だけ mint (price 1_000_000 に対して大幅に不足)
    const { buyer, buyerUsdc } = await setupBuyerWithUsdc(100n);
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    const ix = buildIssueLicenseIx(
      programId,
      {
        buyer: buyer.publicKey,
        delegate: delegateKp.publicKey,
        staker: stakerKey,
        configPda,
        userRevenuePda,
        usdcMint,
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
        proofAccounts: proof.proof,
      },
      {
        root: proof.root,
        nonce: proof.nonce,
        index: proof.index,
        dataHash: proof.dataHash,
        creatorHash: proof.creatorHash,
        assetDataHash: proof.assetDataHash,
        flags: proof.flags,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license/4.json",
        licenseName: "Test License #4",
        price: 1_000_000n,
      }
    );
    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp], alts);
    // SPL Token "insufficient funds" — Anchor error 名は付かない、Token program error
    // logs に "insufficient" や "0x1" (TokenError::InsufficientFunds) が出る
    const allLogs = err.logs.join("\n");
    expect(allLogs).to.match(/insufficient|InsufficientFunds|0x1/i);
  });
});
