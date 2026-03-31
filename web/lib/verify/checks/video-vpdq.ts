/**
 * 仕様書 §7.4 クライアントサイド検証 — video-vpdq
 *
 * 動画のフレーム別 PDQ ハッシュによる同一性検証。
 * TEE が WASM 内で各フレームの PDQ ハッシュを計算した結果を、
 * ブラウザ側で純粋 TypeScript により再計算し、フレームごとに照合する。
 *
 * 共通チェック (3): collection, tee_signature, content_binding
 * 固有チェック (2): wasm_trusted, vpdq_match
 */

import type { SignedJson, ExtensionPayload, WasmModuleInfo } from "@title-protocol/sdk";
import type { ProcessorVerification, CheckResult } from "./types";
import { findWasmVersionByHash, PDQ_THRESHOLD } from "../config";
import { runCommonChecks } from "./common";
import { computeVpdq, type VpdqFrame } from "../pdq";
import { hammingDistance } from "./image-pdq";

// ---------------------------------------------------------------------------
// Payload 型 (video-vpdq 固有フィールド)
// ---------------------------------------------------------------------------

interface VpdqPayload extends ExtensionPayload {
  frames?: { pdqhash: string; quality: number; timestamp: number }[];
  frame_count?: number;
  algorithm?: string;
  sampling_fps?: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface VideoPdqInput {
  signedJson: SignedJson;
  collectionAddress: string;
  expectedCollection: string;
  queryContentHash: string;
  trustedWasmModules: WasmModuleInfo[];
  /** 表示中の動画URL */
  videoUrl?: string;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verify(input: VideoPdqInput): Promise<ProcessorVerification> {
  const common = await runCommonChecks({
    signedJson: input.signedJson,
    collectionAddress: input.collectionAddress,
    expectedCollection: input.expectedCollection,
    queryContentHash: input.queryContentHash,
  });

  const payload = input.signedJson.payload as VpdqPayload;

  return {
    processorId: "video-vpdq",
    common,
    specific: [
      checkWasmTrusted(payload, input.trustedWasmModules),
      await checkVpdqMatch(payload, input.videoUrl),
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

  const matched = findWasmVersionByHash(trustedModules, "video-vpdq", payload.wasm_hash);
  return {
    id: "wasm_trusted",
    status: matched ? "verified" : "failed",
    detail: matched
      ? `WASM hash ${payload.wasm_hash.slice(0, 12)}... found in GlobalConfig (v${matched.version})`
      : `WASM hash ${payload.wasm_hash.slice(0, 12)}... not found in GlobalConfig`,
  };
}

// ---------------------------------------------------------------------------
// 6. vPDQ Match — フレーム別ハッシュ照合
// ---------------------------------------------------------------------------

async function checkVpdqMatch(
  payload: VpdqPayload,
  videoUrl: string | undefined,
): Promise<CheckResult> {
  if (!payload.frames || payload.frames.length === 0) {
    return { id: "vpdq_match", status: "failed", detail: "No frames in payload" };
  }

  if (!videoUrl) {
    return { id: "vpdq_match", status: "failed", detail: "No video URL provided for vPDQ recomputation" };
  }

  try {
    const timestamps = payload.frames.map(f => f.timestamp);
    const computed = await computeVpdq(videoUrl, timestamps);

    if (computed.length === 0) {
      return { id: "vpdq_match", status: "failed", detail: "No frames extracted from video" };
    }

    let matchedCount = 0;
    let maxDistance = 0;
    const perFrame: string[] = [];

    for (let i = 0; i < payload.frames.length; i++) {
      const onchain = payload.frames[i];
      const recomputed = computed[i];
      if (!recomputed) {
        perFrame.push(`f${i}@${onchain.timestamp}s:skip`);
        continue;
      }

      const dist = hammingDistance(onchain.pdqhash, recomputed.pdqhash);
      if (dist <= PDQ_THRESHOLD) matchedCount++;
      if (dist > maxDistance) maxDistance = dist;
      perFrame.push(`f${i}@${onchain.timestamp}s:${dist}`);
    }

    const totalOnchain = payload.frames.length;
    const ok = matchedCount / totalOnchain >= 0.8;

    return {
      id: "vpdq_match",
      status: ok ? "verified" : "failed",
      detail: `${matchedCount}/${totalOnchain} frames matched [${perFrame.join(", ")}] (threshold: ${PDQ_THRESHOLD})`,
    };
  } catch (e) {
    return {
      id: "vpdq_match",
      status: "failed",
      detail: `vPDQ recomputation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
