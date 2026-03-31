/**
 * 仕様書 §7.4 クライアントサイド検証 — image-pdq
 *
 * Meta ThreatExchange 互換 256bit PDQ ハッシュによる画像同一性検証。
 * TEE が WASM 内で計算した PDQ ハッシュを、ブラウザ側で純粋 TypeScript により再計算し、
 * ハミング距離が閾値以内であることを確認する。WASM 依存なし。
 *
 * 共通チェック (4):
 *   1. Collection  — ext_collection_mint に所属
 *   2. TEE Signature — Ed25519 署名 valid
 *   3. TEE Identity  — tee_pubkey が trusted_tee_nodes に存在
 *   4. Content Binding — payload.content_hash == query
 *
 * 固有チェック (2):
 *   5. WASM Trusted — payload.wasm_hash が GlobalConfig に登録済み
 *   6. PDQ Match   — 再計算ハッシュとのハミング距離 ≤ 閾値
 */

import type { SignedJson, ExtensionPayload, WasmModuleInfo } from "@title-protocol/sdk";
import type { ProcessorVerification, CheckResult } from "./types";
import type { TrustedTeeNode } from "../config";
import { findWasmVersionByHash, PDQ_THRESHOLD } from "../config";
import { runCommonChecks } from "./common";
import { computePdq } from "../pdq";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ImagePdqInput {
  signedJson: SignedJson;
  collectionAddress: string;
  expectedCollection: string;
  queryContentHash: string;
  trustedTeeNodes: TrustedTeeNode[];
  trustedWasmModules: WasmModuleInfo[];
  /** 表示中の画像URL (PerceptualInputs)。無ければ PDQ Match は failed */
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verify(input: ImagePdqInput): Promise<ProcessorVerification> {
  const common = await runCommonChecks({
    signedJson: input.signedJson,
    collectionAddress: input.collectionAddress,
    expectedCollection: input.expectedCollection,
    queryContentHash: input.queryContentHash,
    trustedTeeNodes: input.trustedTeeNodes,
  });

  const payload = input.signedJson.payload as ExtensionPayload & { pdqhash?: string };

  return {
    processorId: "image-pdq",
    common,
    specific: [
      checkWasmTrusted(payload, input.trustedWasmModules),
      await checkPdqMatch(payload, input.imageUrl),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. WASM Trusted
// ---------------------------------------------------------------------------

function checkWasmTrusted(
  payload: ExtensionPayload,
  trustedModules: WasmModuleInfo[],
): CheckResult {
  if (!payload.wasm_hash) {
    return { id: "wasm_trusted", status: "failed", detail: "No wasm_hash in payload" };
  }

  const matched = findWasmVersionByHash(trustedModules, "image-pdq", payload.wasm_hash);
  return {
    id: "wasm_trusted",
    status: matched ? "verified" : "failed",
    detail: matched
      ? `WASM hash ${payload.wasm_hash.slice(0, 12)}... found in GlobalConfig (v${matched.version})`
      : `WASM hash ${payload.wasm_hash.slice(0, 12)}... not found in GlobalConfig`,
  };
}

// ---------------------------------------------------------------------------
// 6. PDQ Match
// ---------------------------------------------------------------------------

async function checkPdqMatch(
  payload: ExtensionPayload & { pdqhash?: string },
  imageUrl: string | undefined,
): Promise<CheckResult> {
  if (!payload.pdqhash) {
    return { id: "pdq_match", status: "failed", detail: "No pdqhash in payload" };
  }

  if (!imageUrl) {
    return { id: "pdq_match", status: "failed", detail: "No image URL provided for PDQ recomputation" };
  }

  try {
    const computed = await computePdq(imageUrl);
    const distance = hammingDistance(payload.pdqhash, computed);

    return {
      id: "pdq_match",
      status: distance <= PDQ_THRESHOLD ? "verified" : "failed",
      detail: `Hamming distance: ${distance} (threshold: ${PDQ_THRESHOLD}), on-chain: ${payload.pdqhash.slice(0, 12)}..., recomputed: ${computed.slice(0, 12)}...`,
    };
  } catch (e) {
    return {
      id: "pdq_match",
      status: "failed",
      detail: `PDQ recomputation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Hamming distance (256bit hex strings)
// ---------------------------------------------------------------------------

export function hammingDistance(a: string, b: string): number {
  const x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let dist = 0;
  let bits = x;
  while (bits > 0n) {
    dist += Number(bits & 1n);
    bits >>= 1n;
  }
  return dist;
}
