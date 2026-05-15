#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// SPECS_JA §5.5.3 のライセンス条文 JSON を license-templates/*.txt から生成する。
// 出力先は web/public/licenses/<type>/<sha256>.json。 sha256 は出力 JSON 自身の
// hash で、 URL path に焼き込まれることで条文 tamper を検知可能にする。
//
// 使い方:
//   node web/scripts/build-license-json.mjs
//
// 終了後、 stdout に「catalog.ts に貼り付ける URL」 が出る。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES = resolve(ROOT, "document/v0.1.2/license-templates");
const OUT_BASE = resolve(ROOT, "web/public/licenses");

const PROGRAM_ID = "G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8";
const LICENSE_COLLECTION = "BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b";
const TYPES = [
  { id: "commercial-v1", file: "commercial-v1.txt", permitted: ["ai_training", "commercial_use", "derivative_works"] },
  { id: "non-commercial-v1", file: "non-commercial-v1.txt", permitted: ["research", "evaluation", "personal_non_commercial_use"] },
  { id: "training-only-v1", file: "training-only-v1.txt", permitted: ["ai_training"] },
  { id: "redistribution-v1", file: "redistribution-v1.txt", permitted: ["ai_training", "commercial_use", "derivative_works", "redistribution_with_conditions"] },
];

function build(type) {
  const fullText = readFileSync(resolve(TEMPLATES, type.file), "utf-8");
  // SPECS_JA §5.5.3 のスキーマに準拠。 key 順序は決定論的にしておくと将来再生成
  // しても hash が変わりにくい (ただし URL に hash を焼く設計上、 内容変更 = URL
  // 変更で OK なので順序にこだわる必要はない、 念のため)。
  const json = {
    version: "1.0",
    license_type: type.id,
    issuer: {
      rootlens_program_id: PROGRAM_ID,
      license_collection: LICENSE_COLLECTION,
    },
    binding: {
      root_mint_format: "solana_pubkey_b58",
      verification_note: "Verify sha256(b58_decode(this License NFT's bound root_mint)) == leaf.asset_data_hash",
    },
    terms: {
      is_unilateral_grant: true,
      is_contract: false,
      is_exclusive: false,
      ledger_authoritative: false,
      legal_authoritative: true,
      licensee_identification:
        "Lawful holder of the License NFT on Solana. The licensee identity is determined by NFT ownership; the mint address need not be enumerated in the terms.",
      data_identification_method:
        "The Content licensed under this NFT is the video bound to the Root NFT whose b58-encoded asset id is appended to this License NFT URI as ?root_mint=<...> (see SPECS_JA §5.5.3 Layer 1).",
      permitted_uses: type.permitted,
      duration: "perpetual",
      transfer_rule:
        "Transfer of the NFT transfers the license, except where theft or fraud is established; in such cases legal remedies prevail (Legal-Authoritative, SPECS_JA §5.5.2).",
      governing_law: "Singapore",
      dispute_resolution: "Singapore International Arbitration Centre (SIAC), Singapore seat",
      ny_convention_enforceability: "Awards are enforceable in the 172 NY Convention member states.",
      sanctions_condition:
        "License is void ab initio if licensee is on OFAC SDN List, EU Consolidated Financial Sanctions List, UK OFSI Consolidated List, or Singapore MAS Targeted Financial Sanctions List, or is located in a comprehensively sanctioned jurisdiction.",
      licensor_representations:
        "The original creator has consented to RootLens ToS as the verified copyright holder under KYC. RootLens has applied its VLM-based pre-screening as a reasonable effort against third-party IP inclusion.",
      buyer_due_diligence:
        "For ordinary commercial use including aggregate AI training, the buyer is not required to perform per-asset due diligence on each video.",
      buyer_notification_duty:
        "If the buyer has actual knowledge that the Licensed Content contains third-party IP, publicity, or privacy rights, the buyer must promptly notify RootLens in writing.",
      indemnification: {
        scope:
          "Suits by third parties against the buyer for IP, privacy, or publicity rights, within RootLens's representations and warranties.",
        covered_amounts: [
          "refund of license fee for the affected License NFT",
          "buyer's reasonable defence costs incurred before RootLens assumes the defence",
        ],
        per_claim_cap_usd: "set in Terms of Sale at License NFT purchase",
        annual_aggregate_cap_per_buyer_per_root_nft_usd: "set in Terms of Sale at License NFT purchase",
        defence_control: "RootLens retains the option to assume defence (counsel selection, settlement, strategy).",
        exclusions: [
          "Use outside the licensed scope",
          "Cases where the buyer had actual knowledge of the issue but failed to promptly notify RootLens (constructive knowledge is not applied so as not to impose de facto per-asset due diligence on buyers)",
          "Suits arising from buyer's modification of the Licensed Content",
        ],
        consequential_damages_exclusion:
          "Indirect damages (lost future profits, reputational harm, AI model retraining costs) are excluded by default. Coverage for AI model retraining costs can be agreed separately in an enterprise contract.",
        enterprise_contract_note:
          "Buyers requiring coverage above the default caps negotiate an enterprise contract with RootLens, optionally backed by an IP infringement insurance policy. Specific terms are determined at contract time.",
      },
      two_layer_contract_structure:
        "Buyer-side obligations (notification, sanctions condition, modification limits, scope-of-use limits) are placed in the Terms of Sale, which the buyer accepts explicitly at License NFT purchase. The copyright grant itself remains a stand-alone unilateral licence so that licence inheritance on NFT transfer is preserved.",
    },
    full_text: fullText,
  };

  // 2 スペース indent + LF 終端で固定。 URL hash は厳密にこの bytes に対する sha256。
  const bytes = Buffer.from(JSON.stringify(json, null, 2) + "\n", "utf-8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const outDir = resolve(OUT_BASE, type.id);
  mkdirSync(outDir, { recursive: true });
  // 古い hash ファイルがあったら掃除する (型ごとに 1 file が現行と決めうち)
  if (existsSync(outDir)) {
    for (const f of readdirIfExists(outDir)) {
      if (f.endsWith(".json") && f !== `${hash}.json`) {
        rmSync(resolve(outDir, f));
      }
    }
  }
  const outPath = resolve(outDir, `${hash}.json`);
  writeFileSync(outPath, bytes);
  return { type: type.id, hash, url: `https://rootlens.io/licenses/${type.id}/${hash}.json`, path: outPath };
}

function readdirIfExists(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

const results = TYPES.map(build);
console.log("\nGenerated:");
for (const r of results) {
  console.log(`  ${r.url}`);
  console.log(`    -> ${r.path}`);
}
console.log("\nPaste into web/lib/license-nft/catalog.ts:");
for (const r of results) {
  console.log(`  ${r.type}: "${r.url}"`);
}
