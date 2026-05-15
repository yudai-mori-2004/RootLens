// SPDX-License-Identifier: Apache-2.0
//
// Audit 攻撃テスト: issue_license の境界条件 (Bubblegum / Collection / 価格 / sign)。
//
// fixtures.json から:
//   - License Bubblegum tree
//   - Root Bubblegum tree
//   - 5 個のテスト Root NFT leaves (各々 owner / delegate keypair 含む)
//
// テストごとに新規 buyer keypair を生成し、small SOL airdrop + USDC ATA を作って
// adversarial args で issue_license を打って reject されることを確認。

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import {
  buildIssueLicenseIx,
  findBubblegumTreeConfig,
  findLicenseTreeAuthority,
  findMplCoreCpiSigner,
} from "./issue-helpers";
import {
  ensureBalance,
  ensureConfigMatchesNetwork,
  findUserRevenuePda,
  getConnection,
  loadKeypair,
  loadNetwork,
  sendExpectingFailure,
  sendExpectingSuccess,
} from "./helpers";

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

describe("issue_license — adversarial", () => {
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
  const authority = loadKeypair("authority.json");

  // 共通の MPL Core CPI signer + license tree config + authority
  const mplCoreCpiSigner = findMplCoreCpiSigner();
  const licenseTreeConfig = findBubblegumTreeConfig(licenseMerkleTree);
  const licenseTreeAuthority = findLicenseTreeAuthority(programId, licenseMerkleTree);

  beforeAll(async () => {
    await ensureBalance(conn, deployer.publicKey, 0.1);
    // Config を network.json (= 監査テストが前提する fixture collection / usdc_mint /
    // BPS) に揃える。 別 spec / cli / デモが先に書き換えていたら更新する。
    await ensureConfigMatchesNetwork(conn, programId, configPda, authority, {
      rootNftCollection,
      usdcMint,
      stakerBps: network.staker_basis_points,
      delegateBps: network.delegate_basis_points,
    });
  });

  /**
   * 新規 buyer wallet を生成し、SOL airdrop + USDC ATA を作る。
   * USDC は mint しない (adversarial test では残高 0 で OK なケースが多い)。
   */
  async function setupBuyer(): Promise<{
    buyer: Keypair;
    buyerUsdc: PublicKey;
  }> {
    const buyer = Keypair.generate();
    const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);

    const fundIx = SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 30_000_000, // 0.03 SOL — UserRevenue PDA init 用 + tx 手数料
    });
    const ataIx = createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      buyerUsdc,
      buyer.publicKey,
      usdcMint
    );
    await sendExpectingSuccess(conn, [fundIx, ataIx], [deployer]);
    return { buyer, buyerUsdc };
  }

  /** delegate keypair に対して USDC ATA を ensure (なければ作成) */
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
  // [A2] root_collection arg が config.root_nft_collection と一致しない
  //   → handler 早期 require! で InvalidCollection で reject
  // ---------------------------------------------------------------------
  it("rejects when root_collection != config.root_nft_collection (A2)", async () => {
    const leaf = fixtures.leaves[0];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const { buyer, buyerUsdc } = await setupBuyer();
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);

    // delegate keypair も signer として fund する (signer の rent は不要、tx fee は buyer が払う)
    // ただし delegate.publicKey の system account 自体は存在しなくて OK (signer は SOL を持たなくて良い)

    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    // BOGUS root_collection (Root NFT Collection とは別の pubkey)
    const bogusRootCollection = Keypair.generate().publicKey;

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
      },
      {
        root: new Uint8Array(32),
        nonce: 0n,
        index: 0,
        dataHash: new Uint8Array(32),
        creatorHash: new Uint8Array(32),
        assetDataHash: new Uint8Array(32),
        flags: 0,
        rootCollection: bogusRootCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: 1_000_000n, // 1 USDC (price>0 を満たす)
      }
    );

    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp]);
    expect(err.errorName).to.equal("InvalidCollection");
  });

  // ---------------------------------------------------------------------
  // [A7] usdc_mint arg が config.usdc_mint と不一致
  //   → Config の has_one = usdc_mint で UsdcMintMismatch reject
  //   (Anchor account stage、handler 到達せず)
  // ---------------------------------------------------------------------
  it("rejects when usdc_mint != config.usdc_mint (A7)", async () => {
    const leaf = fixtures.leaves[2];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const { buyer } = await setupBuyer();

    // 別 SPL mint を作って渡す代わりに、有効な別 pubkey なら何でも良いが
    // token::mint = usdc_mint 制約で buyer_usdc / delegate_usdc も整合する必要あり
    // → 今 config.usdc_mint ≠ 渡す usdc_mint だと、Config の has_one で先に reject
    //   この時点で buyer_usdc 自体は本物の usdc_mint で OK
    const fakeMint = Keypair.generate().publicKey;

    const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
    const delegateUsdc = getAssociatedTokenAddressSync(usdcMint, delegateKp.publicKey);
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
        usdcMint: fakeMint, // ← これ
        buyerUsdc,
        delegateUsdc,
        poolUsdc,
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
      },
      {
        root: new Uint8Array(32),
        nonce: 0n,
        index: 0,
        dataHash: new Uint8Array(32),
        creatorHash: new Uint8Array(32),
        assetDataHash: new Uint8Array(32),
        flags: 0,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: 1_000_000n,
      }
    );

    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp]);
    // Config の has_one = usdc_mint @ UsdcMintMismatch で reject
    expect(err.errorName).to.match(/UsdcMintMismatch|ConstraintHasOne|AccountNotInitialized/);
  });

  // ---------------------------------------------------------------------
  // [A8] pool_usdc.owner != config PDA
  //   → constraint pool_usdc.owner == config.key() で InvalidPoolOwner reject
  // ---------------------------------------------------------------------
  it("rejects when pool_usdc owner != config PDA (A8)", async () => {
    const leaf = fixtures.leaves[3];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const { buyer } = await setupBuyer();
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);

    const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
    // pool_usdc を deployer 所有の ATA で偽装 (owner != Config PDA)
    const fakePoolUsdc = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);
    // deployer に USDC ATA がまだ無ければ作る
    {
      const info = await conn.getAccountInfo(fakePoolUsdc);
      if (!info) {
        const createIx = createAssociatedTokenAccountInstruction(
          deployer.publicKey,
          fakePoolUsdc,
          deployer.publicKey,
          usdcMint
        );
        await sendExpectingSuccess(conn, [createIx], [deployer]);
      }
    }
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
        poolUsdc: fakePoolUsdc, // ← これ
        rootMerkleTree,
        licenseMerkleTree,
        licenseTreeConfig,
        licenseTreeAuthority,
        licenseCollection,
        mplCoreCpiSigner,
      },
      {
        root: new Uint8Array(32),
        nonce: 0n,
        index: 0,
        dataHash: new Uint8Array(32),
        creatorHash: new Uint8Array(32),
        assetDataHash: new Uint8Array(32),
        flags: 0,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: 1_000_000n,
      }
    );

    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp]);
    expect(err.errorName).to.match(/InvalidPoolOwner|ConstraintTokenOwner|ConstraintRaw/);
  });

  // ---------------------------------------------------------------------
  // [A15] license_tree_authority が別 tree の seeds で派生されている
  //   → seeds 制約 (find_program_address([b"tree_authority", license_merkle_tree])) と
  //     不一致で ConstraintSeeds reject
  // ---------------------------------------------------------------------
  it("rejects mismatched license_tree_authority bump (A15)", async () => {
    const leaf = fixtures.leaves[4];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const { buyer } = await setupBuyer();
    const delegateUsdc = await ensureDelegateAta(delegateKp.publicKey);
    const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
    const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
    const userRevenuePda = findUserRevenuePda(programId, stakerKey);

    // 別 tree の seeds で派生した PDA
    const wrongAuth = findLicenseTreeAuthority(programId, rootMerkleTree); // root_tree で derive

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
        licenseMerkleTree, // 正規 license tree
        licenseTreeConfig,
        licenseTreeAuthority: wrongAuth, // ← 別 tree で派生した PDA
        licenseCollection,
        mplCoreCpiSigner,
      },
      {
        root: new Uint8Array(32),
        nonce: 0n,
        index: 0,
        dataHash: new Uint8Array(32),
        creatorHash: new Uint8Array(32),
        assetDataHash: new Uint8Array(32),
        flags: 0,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: 1_000_000n,
      }
    );

    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp]);
    expect(err.errorName).to.match(/ConstraintSeeds/);
  });

  // ---------------------------------------------------------------------
  // [A9] price = 0 → InvalidPrice で reject
  // ---------------------------------------------------------------------
  it("rejects price = 0 (A9)", async () => {
    const leaf = fixtures.leaves[1];
    const stakerKey = new PublicKey(leaf.owner);
    const delegateKp = Keypair.fromSecretKey(Uint8Array.from(leaf.delegate_secret));
    const { buyer, buyerUsdc } = await setupBuyer();
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
      },
      {
        root: new Uint8Array(32),
        nonce: 0n,
        index: 0,
        dataHash: new Uint8Array(32),
        creatorHash: new Uint8Array(32),
        assetDataHash: new Uint8Array(32),
        flags: 0,
        rootCollection: rootNftCollection,
        licenseMetadataUri: "https://example.com/license.json",
        licenseName: "Test License",
        price: 0n, // ← reject 対象
      }
    );

    const err = await sendExpectingFailure(conn, [ix], [buyer, delegateKp]);
    expect(err.errorName).to.equal("InvalidPrice");
  });
});
