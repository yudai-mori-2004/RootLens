/**
 * 仕様書 §7.4 クライアントサイド検証 — video-vpdq
 *
 * 動画のフレーム別 PDQ ハッシュによる同一性検証。
 * TEE が WASM 内で各フレームの PDQ ハッシュを計算した結果を、
 * ブラウザ側で純粋 TypeScript により再計算し、フレームごとに照合する。
 *
 * 共通チェック (4):
 *   1. Collection  — ext_collection_mint に所属
 *   2. TEE Signature — Ed25519 署名 valid
 *   3. TEE Identity  — tee_pubkey が trusted_tee_nodes に存在
 *   4. Content Binding — payload.content_hash == query
 *
 * 固有チェック (2):
 *   5. WASM Trusted  — payload.wasm_hash が GlobalConfig に登録済み
 *   6. vPDQ Match    — フレーム別ハッシュ照合 (ハミング距離 ≤ 閾値)
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
    const computed = await computeVpdq(videoUrl);

    if (computed.length === 0) {
      return { id: "vpdq_match", status: "failed", detail: "No frames extracted from video" };
    }

    // フレーム照合: オンチェーンの各フレームに対して、
    // 再計算フレームから最もtimestampが近いものを探してハミング距離を比較
    let matchedCount = 0;
    let maxDistance = 0;

    for (const onchain of payload.frames) {
      const closest = findClosestFrame(computed, onchain.timestamp);
      if (!closest) continue;

      const dist = hammingDistance(onchain.pdqhash, closest.pdqhash);
      if (dist <= PDQ_THRESHOLD) {
        matchedCount++;
      }
      if (dist > maxDistance) maxDistance = dist;
    }

    const totalOnchain = payload.frames.length;
    const ratio = matchedCount / totalOnchain;

    // 80% 以上のフレームがマッチすれば verified
    // (デコーダ差異でフレーム抽出タイミングがずれる可能性を許容)
    const ok = ratio >= 0.8;

    return {
      id: "vpdq_match",
      status: ok ? "verified" : "failed",
      detail: `${matchedCount}/${totalOnchain} frames matched (max distance: ${maxDistance}, threshold: ${PDQ_THRESHOLD})`,
    };
  } catch (e) {
    return {
      id: "vpdq_match",
      status: "failed",
      detail: `vPDQ recomputation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** timestamp が最も近いフレームを返す (±0.5秒以内) */
function findClosestFrame(frames: VpdqFrame[], timestamp: number): VpdqFrame | null {
  let best: VpdqFrame | null = null;
  let bestDelta = Infinity;

  for (const f of frames) {
    const delta = Math.abs(f.timestamp - timestamp);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = f;
    }
  }

  // 0.5秒以上ずれていたらマッチなし
  return bestDelta <= 0.5 ? best : null;
}
