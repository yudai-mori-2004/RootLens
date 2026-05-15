// SPDX-License-Identifier: Apache-2.0
//
// staking テスト用 fixtures.json 生成。
//
// 設計:
//   - 新しい Bubblegum tree や leaf を mint しない。tests/license-nft/fixtures.json
//     からそのまま借りて来て、staking テスト用の cosign authority だけ生成する。
//   - leaf は license-nft の adversarial test で使われていない leaf_3 / leaf_4 を借用。
//     これら 2 個は license-nft 側では setup でだけ参照され、本番テスト中は触らない。
//   - asset_id は (merkleTree, leaf_index) から決定的に派生 (Bubblegum 仕様)。
//
// 1 度きり実行。冪等で、既に fixtures.json があれば skip。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, PublicKey } from "@solana/web3.js";

import { findLeafAssetId } from "./helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_PATH = resolve(__dirname, "fixtures.json");
const LICENSE_FIXTURES = resolve(__dirname, "../license-nft/fixtures.json");

interface LicenseLeaf {
  name: string;
  index: number;
  owner: string;
  owner_secret: number[];
  delegate: string;
  delegate_secret: number[];
}

interface LicenseFixtures {
  program_id: string;
  config_pda: string;
  root_nft_collection: string;
  license_collection: string;
  usdc_mint: string;
  license_tree: string;
  license_tree_authority: string;
  root_tree: string;
  leaves: LicenseLeaf[];
}

function main() {
  if (existsSync(FIXTURES_PATH)) {
    console.log("fixtures.json 既に存在。skip。再生成は手動で削除を。");
    return;
  }
  if (!existsSync(LICENSE_FIXTURES)) {
    throw new Error(
      `tests/license-nft/fixtures.json が見つからない。先に license-nft の setup を回すこと:\n` +
        `  cd tests/license-nft && npm run setup`,
    );
  }

  const lf: LicenseFixtures = JSON.parse(readFileSync(LICENSE_FIXTURES, "utf-8"));

  // staking で借りる leaf (license-nft 本番テストが触らない leaf_3 / leaf_4)
  const borrowedNames = ["leaf_3", "leaf_4"];
  const rootTree = new PublicKey(lf.root_tree);

  const borrowedLeaves = lf.leaves
    .filter((l) => borrowedNames.includes(l.name))
    .map((l) => {
      const assetId = findLeafAssetId(rootTree, l.index);
      return {
        name: l.name,
        index: l.index,
        asset_id: assetId.toBase58(),
        owner: l.owner,
        owner_secret: l.owner_secret,
        initial_delegate: l.delegate,
      };
    });

  if (borrowedLeaves.length !== borrowedNames.length) {
    throw new Error(
      `期待した leaves (${borrowedNames.join(", ")}) が license-nft fixtures に揃っていない。` +
        `license-nft の setup を最新で回し直すこと`,
    );
  }

  // RootLens cosign authority (D の issue_license で delegate signer になる hot wallet)
  const cosignAuthority = Keypair.generate();

  const out = {
    program_id: lf.program_id,
    config_pda: lf.config_pda,
    root_nft_collection: lf.root_nft_collection,
    license_collection: lf.license_collection,
    usdc_mint: lf.usdc_mint,
    license_tree: lf.license_tree,
    license_tree_authority: lf.license_tree_authority,
    root_tree: lf.root_tree,
    cosign_authority: cosignAuthority.publicKey.toBase58(),
    cosign_authority_secret: Array.from(cosignAuthority.secretKey),
    leaves: borrowedLeaves,
  };

  writeFileSync(FIXTURES_PATH, JSON.stringify(out, null, 2));
  console.log(`fixtures.json 生成完了: ${FIXTURES_PATH}`);
  console.log(`  cosign_authority: ${cosignAuthority.publicKey.toBase58()}`);
  console.log(`  borrowed leaves: ${borrowedLeaves.map((l) => `${l.name} (${l.asset_id.slice(0, 8)}…)`).join(", ")}`);
  console.log("");
  console.log("次のステップ:");
  console.log("  - 各 leaf の owner に devnet SOL を入金 (delegateV2 tx の fee 用)");
  console.log("  - cosign_authority に devnet SOL + USDC を入金 (issue_license 用)");
  console.log("  - SOLANA_RPC_URL に DAS 対応 endpoint (helius 等) を設定");
  console.log("  - npm test");
}

main();
