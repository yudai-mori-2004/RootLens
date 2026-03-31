/**
 * 仕様書 §7.4 クライアントサイド検証 — core-c2pa
 *
 * Core processor。C2PA 署名済みコンテンツの来歴を検証する。
 *
 * 共通チェック (4):
 *   1. Collection  — core_collection_mint に所属
 *   2. TEE Signature — Ed25519 署名 valid
 *   3. TEE Identity  — tee_pubkey が trusted_tee_nodes に存在
 *   4. Content Binding — payload.content_hash == query
 *
 * 固有チェック (2):
 *   5. Provenance — C2PA 来歴グラフに nodes が存在する
 *   6. Originality — 同一 content_hash の全 Core cNFT のうち最古である
 */

import type { SignedJson, CorePayload } from "@title-protocol/sdk";
import type { ProcessorVerification, CheckResult } from "./types";
import { runCommonChecks } from "./common";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CoreC2paInput {
  signedJson: SignedJson;
  collectionAddress: string;
  expectedCollection: string;
  queryContentHash: string;
  assetId: string;
  /** 同一 content_hash の全 Core cNFT の assetId 配列 (leaf_id asc)。DAS取得失敗時は null */
  allCoreAssetIds: string[] | null;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verify(input: CoreC2paInput): Promise<ProcessorVerification> {
  const common = await runCommonChecks({
    signedJson: input.signedJson,
    collectionAddress: input.collectionAddress,
    expectedCollection: input.expectedCollection,
    queryContentHash: input.queryContentHash,
  });

  const payload = input.signedJson.payload as CorePayload;

  return {
    processorId: "core-c2pa",
    common,
    specific: [
      checkProvenance(payload),
      checkOriginality(input.assetId, input.allCoreAssetIds),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. Provenance — C2PA 来歴グラフ
// ---------------------------------------------------------------------------

function checkProvenance(payload: CorePayload): CheckResult {
  const nodeCount = payload.nodes?.length ?? 0;
  const linkCount = payload.links?.length ?? 0;

  if (nodeCount === 0) {
    return {
      id: "provenance",
      status: "failed",
      detail: "No provenance nodes in C2PA graph",
    };
  }

  return {
    id: "provenance",
    status: "verified",
    detail: `C2PA graph: ${nodeCount} node(s), ${linkCount} link(s)`,
  };
}

// ---------------------------------------------------------------------------
// 6. Originality — 最古の Core cNFT か
// ---------------------------------------------------------------------------

function checkOriginality(
  assetId: string,
  allCoreAssetIds: string[] | null,
): CheckResult {
  if (allCoreAssetIds === null) {
    return {
      id: "originality",
      status: "failed",
      detail: "Could not query all core cNFTs for originality check",
    };
  }

  if (allCoreAssetIds.length === 0) {
    return {
      id: "originality",
      status: "verified",
      detail: "Only registered core cNFT for this content",
    };
  }

  const isOriginal = allCoreAssetIds[0] === assetId;
  return {
    id: "originality",
    status: isOriginal ? "verified" : "failed",
    detail: isOriginal
      ? "This is the earliest core cNFT (original)"
      : `Earlier core cNFT exists: ${allCoreAssetIds[0].slice(0, 8)}...`,
  };
}
