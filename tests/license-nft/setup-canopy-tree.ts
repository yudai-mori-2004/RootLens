// SPDX-License-Identifier: Apache-2.0
//
// 本番想定の Root NFT tree を 1 本掘り、 そこに leafDelegate=prod cosign delegate
// で固定した Root NFT leaf を NUM_LEAVES 本 mint する。
//
// 既存 setup.ts (depth=5, buffer=8, canopy なし) は監査テスト用の最小ツリーで、
// proof 5 sibling と短く v0 tx に余裕で収まる。 一方、 production 想定では
// 数万 leaf を入れる深さが要るため depth=14, buffer=64 が現実的だが、 そのまま
// だと proof 14 sibling × 32B = 448B で v0 tx 1232B 制限に当たる。 解決策は
// canopyDepth を高めに設定し、 proof 上層 N 段をオンチェーンに保管しておくこと。
// ここでは canopy=10 を入れて、 client 側 proof は実質 4 sibling のみ詰めれば済む
// 構成にする (web/lib/license-nft/build-tx.ts の inferCanopyDepth が自動で対応)。
//
// 出力は fixtures-canopy.json に保存。 既存 fixtures.json には触らない (= 既存
// 監査テストへの影響なし)。
//
// **冪等性**: 各ステップ完了直後に fixtures-canopy.json を更新する。 中断 / 失敗
// 時の再実行は、 fixture に記録済みかつ chain にも存在するアカウントを skip して
// 続きから再開する。 collection 作成 1.13 SOL を二重支払いしない。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
  some,
} from "@metaplex-foundation/umi";
import {
  createTreeV2,
  mintV2,
  mplBubblegum,
  MetadataArgsV2Args,
  TokenStandard,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createCollection,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK_PATH = resolve(__dirname, "../../network.json");
const FIXTURES_PATH = resolve(__dirname, "fixtures-canopy.json");
const KEYS_DIR = resolve(__dirname, "../../keys");

// production cosign delegate の pubkey は keys/cosign-delegate.json (= サーバが
// COSIGN_DELEGATE_PRIVATE_KEY_BASE58 env で読む secret key と同じもの) から派生する。
// ハードコードしていた頃は env / .env / ここの 3 箇所が暗黙の同期前提で、 鍵
// ローテーションのたびに齟齬が出ていた。 唯一の出処は keys/cosign-delegate.json。
function loadProdCosignDelegateB58(): string {
  const path = resolve(KEYS_DIR, "cosign-delegate.json");
  const arr = JSON.parse(readFileSync(path, "utf-8")) as number[];
  if (arr.length !== 64) throw new Error(`cosign-delegate.json: expected 64-byte JSON array, got ${arr.length}`);
  const pubkey = Buffer.from(arr).subarray(32); // ed25519 secret key 64B = seed(32B) + pubkey(32B)
  return bs58.encode(pubkey);
}

const TREE_DEPTH = 14;
const TREE_BUFFER = 64;
// canopy=10 で account 容量 65KB 程度 (rent ~0.45 SOL)、 client が tx に詰める
// proof は depth-canopy=4 sibling のみ (= 128 byte)。 depth=14 のフル proof
// 448 byte に対して 320 byte 削減できて v0 1232B 制限内に余裕。
const TREE_CANOPY = 10;

const NUM_LEAVES = 3;

interface Leaf {
  name: string;
  index: number;
  owner: string;
  owner_secret: number[];
  leaf_delegate: string;
}

interface Fixture {
  cluster: string;
  program_id: string;
  config_pda: string;
  deployer: string;
  cosign_delegate_pubkey: string;
  tree_params: { max_depth: number; max_buffer_size: number; canopy_depth: number };
  root_nft_collection?: string;
  root_tree?: string;
  leaves: Leaf[];
}

function loadKeypair(filename: string): Keypair {
  const path = resolve(KEYS_DIR, filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function loadOrInitFixture(
  network: { cluster: string; program_id: string; config_pda: string },
  deployerPub: string,
  cosignDelegateB58: string,
): Fixture {
  if (existsSync(FIXTURES_PATH)) {
    return JSON.parse(readFileSync(FIXTURES_PATH, "utf-8")) as Fixture;
  }
  return {
    cluster: network.cluster,
    program_id: network.program_id,
    config_pda: network.config_pda,
    deployer: deployerPub,
    cosign_delegate_pubkey: cosignDelegateB58,
    tree_params: { max_depth: TREE_DEPTH, max_buffer_size: TREE_BUFFER, canopy_depth: TREE_CANOPY },
    leaves: [],
  };
}

function saveFixture(f: Fixture) {
  writeFileSync(FIXTURES_PATH, JSON.stringify(f, null, 2) + "\n");
}

async function accountExists(conn: Connection, pubkey: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(pubkey, "confirmed");
  return info !== null;
}

async function main() {
  const network = JSON.parse(readFileSync(NETWORK_PATH, "utf-8"));
  const deployer = loadKeypair("deployer.json");
  const prodCosignDelegateB58 = loadProdCosignDelegateB58();
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const umi = createUmi("https://api.devnet.solana.com");
  umi.use(keypairIdentity(fromWeb3JsKeypair(deployer)));
  umi.use(mplBubblegum());
  umi.use(mplCore());

  const fixture = loadOrInitFixture(network, deployer.publicKey.toBase58(), prodCosignDelegateB58);
  console.log(`deployer balance: ${(await conn.getBalance(deployer.publicKey)) / 1e9} SOL`);
  console.log(`cosign delegate: ${prodCosignDelegateB58}`);
  console.log(`fixture path: ${FIXTURES_PATH}`);

  // -----------------------------------------------------------------
  // 1. MPL Core Collection (= mock TP root collection)
  // -----------------------------------------------------------------
  if (fixture.root_nft_collection && (await accountExists(conn, new PublicKey(fixture.root_nft_collection)))) {
    console.log(`\n=== MPL Core Collection: skip (existing ${fixture.root_nft_collection}) ===`);
  } else {
    console.log("\n=== MPL Core Collection (new) ===");
    const collectionSigner = generateSigner(umi);
    console.log(`  collection: ${collectionSigner.publicKey}`);
    await createCollection(umi, {
      collection: collectionSigner,
      name: "RootLens Mock TP Root v2",
      uri: "https://example.com/mock-tp-root-collection.json",
      updateAuthority: fromWeb3JsPublicKey(deployer.publicKey),
      plugins: [{ type: "BubblegumV2" }],
    }).sendAndConfirm(umi);
    fixture.root_nft_collection = collectionSigner.publicKey.toString();
    saveFixture(fixture);
    console.log("  作成完了 + fixture 保存");
  }
  const rootNftCollection = umiPublicKey(fixture.root_nft_collection!);

  // -----------------------------------------------------------------
  // 2. Bubblegum tree (canopy 付き)
  // -----------------------------------------------------------------
  if (fixture.root_tree && (await accountExists(conn, new PublicKey(fixture.root_tree)))) {
    console.log(`\n=== Bubblegum root tree: skip (existing ${fixture.root_tree}) ===`);
  } else {
    console.log(`\n=== Bubblegum root tree (depth=${TREE_DEPTH} buffer=${TREE_BUFFER} canopy=${TREE_CANOPY}, new) ===`);
    const merkleTree = generateSigner(umi);
    console.log(`  tree: ${merkleTree.publicKey}`);
    await (await createTreeV2(umi, {
      merkleTree,
      treeCreator: umi.identity,
      public: false,
      maxDepth: TREE_DEPTH,
      maxBufferSize: TREE_BUFFER,
      canopyDepth: TREE_CANOPY,
    })).sendAndConfirm(umi);
    fixture.root_tree = merkleTree.publicKey.toString();
    saveFixture(fixture);
    console.log("  作成完了 + fixture 保存");
  }
  const rootTree = umiPublicKey(fixture.root_tree!);

  // -----------------------------------------------------------------
  // 3. Root NFT leaves。 既に必要数あれば skip、 足りなければ追加 mint
  // -----------------------------------------------------------------
  if (fixture.leaves.length >= NUM_LEAVES) {
    console.log(`\n=== Root NFT leaves: skip (existing ${fixture.leaves.length} leaves) ===`);
  } else {
    console.log(`\n=== Root NFT leaves: existing ${fixture.leaves.length}, minting ${NUM_LEAVES - fixture.leaves.length} more ===`);
    for (let i = fixture.leaves.length; i < NUM_LEAVES; i++) {
      const owner = Keypair.generate();
      console.log(`\n  leaf_${i}: owner=${owner.publicKey.toBase58().slice(0, 8)}...`);

      const metadata: MetadataArgsV2Args = {
        name: `RootLens Mock Root v2 #${i}`,
        symbol: "RLROOT2",
        uri: `https://example.com/mock-root-v2/${i}.json`,
        sellerFeeBasisPoints: 0,
        primarySaleHappened: false,
        isMutable: false,
        tokenStandard: some(TokenStandard.NonFungible),
        creators: [
          { address: fromWeb3JsPublicKey(deployer.publicKey), verified: false, share: 100 },
        ],
        collection: some(rootNftCollection),
      };

      await mintV2(umi, {
        merkleTree: rootTree,
        leafOwner: fromWeb3JsPublicKey(owner.publicKey),
        leafDelegate: umiPublicKey(prodCosignDelegateB58),
        coreCollection: rootNftCollection,
        collectionAuthority: umi.identity,
        metadata,
      }).sendAndConfirm(umi);

      fixture.leaves.push({
        name: `leaf_${i}`,
        index: i,
        owner: owner.publicKey.toBase58(),
        owner_secret: Array.from(owner.secretKey),
        leaf_delegate: prodCosignDelegateB58,
      });
      saveFixture(fixture);
      console.log(`    mint 完了 + fixture 保存`);
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  collection: ${fixture.root_nft_collection}`);
  console.log(`  tree:       ${fixture.root_tree}`);
  console.log(`  leaves:     ${fixture.leaves.map((l) => l.owner.slice(0, 8)).join(", ")}`);
  console.log(`\n次の手順:`);
  console.log(`  1. npx tsx update-config.ts --root-collection ${fixture.root_nft_collection}`);
  console.log(`  2. npx tsx issue-license.ts --root <leaf_0 asset id (DAS で導出)>`);
  console.log(`  3. npx tsx verify-license-chain.ts <license asset id>`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
