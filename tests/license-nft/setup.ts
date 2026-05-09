// SPDX-License-Identifier: Apache-2.0
//
// 監査テスト前のセットアップ。
//   1. License Bubblegum tree 作成 (tree_creator = license_tree_authority PDA)
//   2. Root Bubblegum tree 作成 (tree_creator = deployer。TP TitleCore のテスト代替)
//   3. テスト用 Root NFT leaf を 5 個 mint (異なる owner / delegate 組み合わせ)
//   4. 結果を tests/license-nft/fixtures.json に保存
//
// 1 度きり実行。冪等性は持たないので、既に fixtures.json があれば skip。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, generateSigner, publicKey, none, some } from "@metaplex-foundation/umi";
import {
  createTreeV2,
  mplBubblegum,
  mintV2,
  fetchMerkleTree,
  MetadataArgsV2Args,
  TokenStandard,
} from "@metaplex-foundation/mpl-bubblegum";
import { fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK_PATH = resolve(__dirname, "../../network.json");
const FIXTURES_PATH = resolve(__dirname, "fixtures.json");
const KEYS_DIR = resolve(__dirname, "../../keys");

interface NetworkConfig {
  cluster: string;
  program_id: string;
  config_pda: string;
  authority: string;
  title_core_collection: string;
  license_collection: string;
  usdc_mint: string;
  staker_basis_points: number;
  delegate_basis_points: number;
}

function loadKeypair(filename: string): Keypair {
  const path = resolve(KEYS_DIR, filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main() {
  if (existsSync(FIXTURES_PATH)) {
    console.log("fixtures.json 既に存在。skip。再作成は手動で削除を。");
    return;
  }

  const network: NetworkConfig = JSON.parse(readFileSync(NETWORK_PATH, "utf-8"));
  const programId = new PublicKey(network.program_id);
  const titleCore = new PublicKey(network.title_core_collection); // = test root collection (deployer 所有)
  const deployer = loadKeypair("deployer.json");

  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const umi = createUmi("https://api.devnet.solana.com");
  umi.use(keypairIdentity(fromWeb3JsKeypair(deployer)));
  umi.use(mplBubblegum());

  const fixtures: any = {
    program_id: network.program_id,
    config_pda: network.config_pda,
    title_core_collection: network.title_core_collection,
    license_collection: network.license_collection,
    usdc_mint: network.usdc_mint,
    deployer: deployer.publicKey.toBase58(),
  };

  // -----------------------------------------------------------------
  // 1. License Bubblegum tree 作成
  // -----------------------------------------------------------------
  console.log("\n=== License Bubblegum tree ===");
  const licenseMerkleTree = generateSigner(umi);

  // license_tree_authority PDA を派生
  const [licenseTreeAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree_authority"), toWeb3JsPublicKey(licenseMerkleTree.publicKey).toBuffer()],
    programId
  );
  console.log(`  tree:           ${licenseMerkleTree.publicKey}`);
  console.log(`  tree authority: ${licenseTreeAuthority.toBase58()}`);

  await (await createTreeV2(umi, {
    merkleTree: licenseMerkleTree,
    treeCreator: umi.identity, // 作成時の payer。tree_creator_or_delegate は handler 内で別途設定可
    public: false,
    maxDepth: 5,
    maxBufferSize: 8,
  })).sendAndConfirm(umi);
  console.log("  作成完了");

  fixtures.license_tree = licenseMerkleTree.publicKey.toString();
  fixtures.license_tree_authority = licenseTreeAuthority.toBase58();

  // -----------------------------------------------------------------
  // 2. Root Bubblegum tree 作成 (tree_creator = deployer = collection authority も持つ)
  // -----------------------------------------------------------------
  console.log("\n=== Root Bubblegum tree ===");
  const rootMerkleTree = generateSigner(umi);
  console.log(`  tree:           ${rootMerkleTree.publicKey}`);

  await (await createTreeV2(umi, {
    merkleTree: rootMerkleTree,
    treeCreator: umi.identity,
    public: false,
    maxDepth: 5,
    maxBufferSize: 8,
  })).sendAndConfirm(umi);
  console.log("  作成完了");

  fixtures.root_tree = rootMerkleTree.publicKey.toString();

  // -----------------------------------------------------------------
  // 3. テスト用 Root NFT leaf を 5 個 mint
  //    各 leaf は (owner, delegate) を変えて adversarial test 用に分ける
  // -----------------------------------------------------------------
  console.log("\n=== Root NFT leaves (5 個) ===");

  // 5 種類の (owner, delegate) パターン
  const stakers: { name: string; staker: Keypair; delegate: Keypair }[] = [];
  for (let i = 0; i < 5; i++) {
    stakers.push({
      name: `leaf_${i}`,
      staker: Keypair.generate(),
      delegate: Keypair.generate(),
    });
  }

  fixtures.leaves = [] as any[];

  for (let i = 0; i < stakers.length; i++) {
    const { name, staker, delegate } = stakers[i];
    console.log(`\n  ${name}: owner=${staker.publicKey.toBase58().slice(0, 8)}... delegate=${delegate.publicKey.toBase58().slice(0, 8)}...`);

    const metadata: MetadataArgsV2Args = {
      name: `Test Root #${i}`,
      symbol: "RLROOT",
      uri: `https://example.com/root/${i}.json`,
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      tokenStandard: some(TokenStandard.NonFungible),
      creators: [
        {
          address: fromWeb3JsPublicKey(deployer.publicKey),
          verified: false,
          share: 100,
        },
      ],
      collection: some(fromWeb3JsPublicKey(titleCore)),
    };

    await mintV2(umi, {
      merkleTree: rootMerkleTree.publicKey,
      leafOwner: fromWeb3JsPublicKey(staker.publicKey),
      leafDelegate: fromWeb3JsPublicKey(delegate.publicKey),
      coreCollection: fromWeb3JsPublicKey(titleCore),
      collectionAuthority: umi.identity, // deployer = test collection の update_authority
      metadata,
    }).sendAndConfirm(umi);

    // umi-web3js-adapters で公開鍵保存
    fixtures.leaves.push({
      name,
      index: i,
      owner: staker.publicKey.toBase58(),
      owner_secret: Array.from(staker.secretKey),
      delegate: delegate.publicKey.toBase58(),
      delegate_secret: Array.from(delegate.secretKey),
    });
    console.log(`    mint 完了`);
  }

  // -----------------------------------------------------------------
  // 4. fixtures.json 書き出し
  // -----------------------------------------------------------------
  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2) + "\n");
  console.log(`\n=== setup 完了 ===`);
  console.log(`  fixtures: ${FIXTURES_PATH}`);
  console.log(`  License tree:    ${fixtures.license_tree}`);
  console.log(`  Root tree:       ${fixtures.root_tree}`);
  console.log(`  test leaves:     ${fixtures.leaves.length} 個`);
}

main().catch((e) => {
  console.error("setup failed:", e);
  process.exit(1);
});
