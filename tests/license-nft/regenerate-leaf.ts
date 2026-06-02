// SPDX-License-Identifier: Apache-2.0
//
// fixtures.json の特定リーフをチェーン上で再 mint する operator ツール。 アプリの
// staking フロー等で fixture リーフの delegate がチェーン側で書き換えられて spec
// が `Invalid root recomputed from proof` で fail した時のリカバリ用。
//
// 既存 root_tree (= fixtures.json の root_tree) に新しい owner / delegate Keypair
// で leaf を mint し、 fixtures.json の `leaves[index]` を上書きする。 その他の
// リーフ / tree / collection には触らない。
//
// 使い方:
//   npx tsx regenerate-leaf.ts --index <0..N>
//
// SOL は ~0.001 SOL (mint tx fee + leaf rent 数百 lamport) しか掛からない。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  some,
} from "@metaplex-foundation/umi";
import {
  mintV2,
  mplBubblegum,
  MetadataArgsV2Args,
  TokenStandard,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_PATH = resolve(__dirname, "fixtures.json");
const KEYS_DIR = resolve(__dirname, "../../keys/dev/solana");

interface FixtureLeaf {
  name: string;
  index: number;
  owner: string;
  owner_secret: number[];
  delegate: string;
  delegate_secret: number[];
}

interface Fixtures {
  root_nft_collection: string;
  root_tree: string;
  leaves: FixtureLeaf[];
}

function loadKeypair(filename: string): Keypair {
  const path = resolve(KEYS_DIR, filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function parseArgs(): { index: number } {
  const argv = process.argv.slice(2);
  let index: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--index") { index = Number(argv[i + 1]); i++; }
    else { console.error(`unknown flag: ${argv[i]}`); process.exit(2); }
  }
  if (index === undefined || Number.isNaN(index)) {
    console.error("usage: npx tsx regenerate-leaf.ts --index <0..N>");
    process.exit(2);
  }
  return { index };
}

async function main() {
  const { index } = parseArgs();
  const fixtures: Fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));
  if (index < 0 || index >= fixtures.leaves.length) {
    console.error(`index out of range: ${index} (have ${fixtures.leaves.length} leaves)`);
    process.exit(2);
  }

  const deployer = loadKeypair("deployer.json");
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const umi = createUmi(rpcUrl);
  umi.use(keypairIdentity(fromWeb3JsKeypair(deployer)));
  umi.use(mplBubblegum());

  const merkleTree = new PublicKey(fixtures.root_tree);
  const rootNftCollection = new PublicKey(fixtures.root_nft_collection);
  const owner = Keypair.generate();
  const delegate = Keypair.generate();

  console.log(`regenerating leaves[${index}] on tree ${merkleTree.toBase58()}`);
  console.log(`  new owner   : ${owner.publicKey.toBase58()}`);
  console.log(`  new delegate: ${delegate.publicKey.toBase58()}`);

  const metadata: MetadataArgsV2Args = {
    name: `Test Root #${index} (regenerated)`,
    symbol: "RLROOT",
    uri: `https://example.com/root/${index}.json`,
    sellerFeeBasisPoints: 0,
    primarySaleHappened: false,
    isMutable: false,
    tokenStandard: some(TokenStandard.NonFungible),
    creators: [
      { address: fromWeb3JsPublicKey(deployer.publicKey), verified: false, share: 100 },
    ],
    collection: some(fromWeb3JsPublicKey(rootNftCollection)),
  };

  await mintV2(umi, {
    merkleTree: fromWeb3JsPublicKey(merkleTree),
    leafOwner: fromWeb3JsPublicKey(owner.publicKey),
    leafDelegate: fromWeb3JsPublicKey(delegate.publicKey),
    coreCollection: fromWeb3JsPublicKey(rootNftCollection),
    collectionAuthority: umi.identity,
    metadata,
  }).sendAndConfirm(umi);
  console.log(`  mint 完了`);

  // 既存リーフ index は同じ leaf id (Bubblegum の leaf nonce) を再利用できないため
  // (= 既に消費された nonce 番号は使えない)、 新リーフは tree の現在の leaf 数の
  // 末尾に置かれる。 fixtures.leaves の同じ index には新しい末尾 leaf を上書きする
  // (asset id 計算上、 nonce = 既存 leaf 総数 - 1)。
  const newLeafIndex = fixtures.leaves.length; // 末尾に append したので index = 旧 length
  const updated: FixtureLeaf = {
    name: `leaf_${index}`,
    index: newLeafIndex,
    owner: owner.publicKey.toBase58(),
    owner_secret: Array.from(owner.secretKey),
    delegate: delegate.publicKey.toBase58(),
    delegate_secret: Array.from(delegate.secretKey),
  };
  fixtures.leaves[index] = updated;
  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2) + "\n");

  console.log(`fixtures.leaves[${index}] を更新 (新 leaf nonce=${newLeafIndex})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
