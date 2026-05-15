/**
 * ローカル動画ファイルを TP に verify だけ投げて結果を表示するスクリプト。
 * アプリと同じフローを Node.js で実行する。
 *
 * 使い方: npx tsx scripts/verify-video.ts /path/to/video.mp4
 */

import * as fs from "node:fs";
import {
  fetchGlobalConfig,
  TitleClient,
  buildPlaintext,
  encryptPayload,
  decryptResponse,
} from "@title-protocol/sdk";
import type { VerifyResponse } from "@title-protocol/sdk";
import { Connection } from "@solana/web3.js";

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const OWNER_WALLET = "EvmnNCtsjGJTuMCe78GbGHSq2mcQpWQgDG8eDB9BBJEY";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/verify-video.ts <video-file>");
    process.exit(1);
  }

  const content = fs.readFileSync(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const isVideo = ["mp4", "mov", "m4v", "webm"].includes(ext);

  const processorIds = ["core-c2pa", "cert-rootlens"];
  if (isVideo) processorIds.push("video-vpdq");
  else processorIds.push("image-pdq");

  console.log(`File: ${filePath} (${(content.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Processors: ${processorIds.join(", ")}`);

  // GlobalConfig
  const connection = new Connection(SOLANA_RPC_URL);
  const globalConfig = await fetchGlobalConfig(connection, "devnet");
  console.log("GlobalConfig loaded");

  const client = new TitleClient(globalConfig);
  const node = await client.selectNode();
  console.log(`Node: ${node.gatewayUrl}`);

  // Encrypt
  const plaintext = buildPlaintext(
    { owner_wallet: OWNER_WALLET },
    new Uint8Array(content),
  );

  const teeEncPubkey = Buffer.from(node.encryptionPubkey, "base64");
  const aad = new TextEncoder().encode("/verify");
  const { responseKey, payload } = await encryptPayload(
    new Uint8Array(teeEncPubkey),
    plaintext,
    aad,
  );
  console.log(`Encrypted payload: ${(payload.length / 1024 / 1024).toFixed(1)} MB`);

  // Upload
  const { uploadUrl, downloadUrl } = await client.getUploadUrl(
    node.gatewayUrl,
    payload.length,
    "application/octet-stream",
  );

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: payload as unknown as BodyInit,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  console.log("Uploaded");

  // Verify
  console.log("Calling verify...");
  const t0 = Date.now();
  const encResponse = await client.verifyRaw(node.gatewayUrl, {
    download_url: downloadUrl,
    processor_ids: processorIds,
  });
  console.log(`Verify done in ${Date.now() - t0}ms`);

  // Decrypt
  const responsePlaintext = await decryptResponse(
    responseKey,
    encResponse.nonce,
    encResponse.ciphertext,
    aad,
  );
  const response: VerifyResponse = JSON.parse(
    new TextDecoder().decode(responsePlaintext),
  );

  // Print results
  console.log(`\nResults: ${response.results.length} processors`);
  for (const r of response.results) {
    const p = r.signed_json.payload as Record<string, unknown>;
    console.log(`\n--- ${r.processor_id} ---`);
    console.log(`  content_hash: ${p.content_hash}`);

    if (r.processor_id === "core-c2pa") {
      console.log(`  nodes: ${(p.nodes as any[])?.length}`);
    } else {
      console.log(`  extension_id: ${p.extension_id}`);
      console.log(`  wasm_hash: ${p.wasm_hash}`);
      if (p.pdqhash) console.log(`  pdqhash: ${p.pdqhash}`);
      if (p.verified !== undefined) console.log(`  verified: ${p.verified}`);
      if (p.frames) {
        const frames = p.frames as any[];
        console.log(`  frames: ${frames.length}`);
        for (const f of frames) {
          console.log(`    t=${f.timestamp}s hash=${f.pdqhash} q=${f.quality}`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
