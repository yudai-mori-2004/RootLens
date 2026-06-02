// Bubblegum V2 public tree を devnet に作る (smoke test 用)。
// 出力: { merkle_tree, collection } を stdout JSON で返す。
//
// 使い方: npx tsx tools/create-smoke-tree.ts

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
} from "@metaplex-foundation/umi";
import {
  createTreeV2,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createCollection,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = resolve(__dirname, "../../keys/dev/solana");

const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(resolve(KEYS_DIR, "deployer.json"), "utf-8")))
);

const RPC = "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const umi = createUmi(RPC);
umi.use(keypairIdentity(fromWeb3JsKeypair(deployer)));
umi.use(mplBubblegum());
umi.use(mplCore());

async function main() {
  const balance = await conn.getBalance(deployer.publicKey);
  console.error(`deployer: ${deployer.publicKey.toBase58()} (${balance / 1e9} SOL)`);

  // 1. MPL Core Collection (BubblegumV2 plugin 付き)
  console.error("creating MPL Core collection...");
  const collectionSigner = generateSigner(umi);
  await createCollection(umi, {
    collection: collectionSigner,
    name: "RootLens Smoke cNFT",
    uri: "https://example.com/smoke-collection.json",
    updateAuthority: fromWeb3JsPublicKey(deployer.publicKey),
    plugins: [{ type: "BubblegumV2" }],
  }).sendAndConfirm(umi);
  console.error(`  collection: ${collectionSigner.publicKey}`);

  // 2. Bubblegum V2 tree (depth=5, buffer=8, public)
  console.error("creating Bubblegum V2 tree (depth=5, buffer=8, public)...");
  const merkleTree = generateSigner(umi);
  await (await createTreeV2(umi, {
    merkleTree,
    treeCreator: umi.identity,
    public: true,
    maxDepth: 5,
    maxBufferSize: 8,
  })).sendAndConfirm(umi);
  console.error(`  tree: ${merkleTree.publicKey}`);

  console.log(JSON.stringify({
    merkle_tree: merkleTree.publicKey.toString(),
    collection: collectionSigner.publicKey.toString(),
    deployer: deployer.publicKey.toBase58(),
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
