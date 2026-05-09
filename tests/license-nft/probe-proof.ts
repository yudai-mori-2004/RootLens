// asset_id を計算して getAssetProof を試す probe スクリプト
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtures = JSON.parse(readFileSync(resolve(__dirname, "fixtures.json"), "utf-8"));
const tree = new PublicKey(fixtures.root_tree);
const BUBBLEGUM = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");

// get_asset_id = find_program_address([b"asset", tree, nonce_le], bubblegum_id)
function getAssetId(tree: PublicKey, nonce: bigint): PublicKey {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), tree.toBuffer(), nonceBuf],
    BUBBLEGUM
  );
  return pda;
}

for (let i = 0; i < 5; i++) {
  const id = getAssetId(tree, BigInt(i));
  console.log(`leaf ${i}: ${id.toBase58()}`);
}

// 1 つで getAsset / getAssetProof を試す
const id0 = getAssetId(tree, 0n);
const url = "https://api.devnet.solana.com";

const ga = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: id0.toBase58() } }),
}).then(r => r.json());
console.log("\n=== getAsset response ===");
console.log(JSON.stringify(ga, null, 2).slice(0, 600));

const gp = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getAssetProof", params: { id: id0.toBase58() } }),
}).then(r => r.json());
console.log("\n=== getAssetProof response ===");
console.log(JSON.stringify(gp, null, 2).slice(0, 600));
