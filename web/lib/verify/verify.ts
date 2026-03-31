/**
 * 仕様書 §7.4 クライアントサイド検証 — オーケストレータ
 *
 * ResolvedContent を受け取り、各 processor_id の検証モジュールに dispatch し、
 * 結果を VerificationResult として返す。
 *
 * コンソールログはここだけに集約する。checks/* は副作用を持たない。
 */

import type { ExtensionPayload } from "@title-protocol/sdk";
import type { ResolvedContent } from "./content-resolver";
import type { ProcessorVerification, VerificationResult, CheckResult } from "./checks/types";
import { getGlobalConfigData, type GlobalConfigData } from "./config";
import { contentResolver } from "./content-resolver";
import { verify as verifyCoreC2pa } from "./checks/core-c2pa";
import { verify as verifyImagePdq } from "./checks/image-pdq";
import { verify as verifyCert } from "./checks/cert";
import { verify as verifyVideoPdq } from "./checks/video-vpdq";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VerifyInput {
  /** DAS 解決済みコンテンツ */
  resolved: ResolvedContent;
  /** 検索に使った content_hash */
  queryContentHash: string;
  /** ブラウザに表示中のメディア URL */
  perceptual: {
    imageUrl?: string;
    videoUrl?: string;
  };
}

export async function verifyAll(input: VerifyInput): Promise<VerificationResult> {
  const { resolved, queryContentHash, perceptual } = input;
  const globalConfig = await getGlobalConfigData();

  // Core cNFT のオリジナル判定用: 同一 content_hash の全 Core assetId を取得
  let allCoreAssetIds: string[] | null = null;
  if (contentResolver.resolveAllByContentHash) {
    try {
      const allCore = await contentResolver.resolveAllByContentHash(queryContentHash);
      allCoreAssetIds = allCore?.map((c) => c.assetId) ?? null;
    } catch {
      allCoreAssetIds = null;
    }
  }

  const processors: ProcessorVerification[] = [];

  // --- Core ---
  if (resolved.coreSignedJson) {
    const core = await verifyCoreC2pa({
      signedJson: resolved.coreSignedJson,
      collectionAddress: resolved.collectionAddress,
      expectedCollection: globalConfig.core,
      queryContentHash,
      assetId: resolved.assetId,
      allCoreAssetIds,
    });
    processors.push(core);
  }

  // --- Extensions ---
  for (const ext of resolved.extensionNfts) {
    const payload = ext.signedJson.payload as ExtensionPayload;
    const extId = payload.extension_id || "unknown";
    const commonArgs = {
      signedJson: ext.signedJson,
      collectionAddress: ext.collectionAddress,
      expectedCollection: globalConfig.ext,
      queryContentHash,
      trustedWasmModules: globalConfig.trustedWasmModules,
    };

    if (extId === "image-pdq") {
      processors.push(await verifyImagePdq({ ...commonArgs, imageUrl: perceptual.imageUrl }));
    } else if (extId === "video-vpdq") {
      processors.push(await verifyVideoPdq({ ...commonArgs, videoUrl: perceptual.videoUrl }));
    } else if (extId.startsWith("cert-")) {
      processors.push(await verifyCert(commonArgs));
    } else {
      // 未知の extension: 共通チェックのみ実行
      processors.push(await verifyUnknownExtension(extId, commonArgs));
    }
  }

  // --- 全体判定 ---
  const allChecks = processors.flatMap((p) => [...p.common, ...p.specific]);
  const anyFailed = allChecks.some((c) => c.status === "failed");
  const overall = processors.length === 0 ? "failed"
    : anyFailed ? "failed"
    : "verified";

  const result: VerificationResult = { processors, overall };

  // --- Console ---
  logVerification(result, resolved, queryContentHash, globalConfig);

  return result;
}

// ---------------------------------------------------------------------------
// 未知の extension (共通4チェックのみ)
// ---------------------------------------------------------------------------

async function verifyUnknownExtension(
  extId: string,
  args: {
    signedJson: import("@title-protocol/sdk").SignedJson;
    collectionAddress: string;
    expectedCollection: string;
    queryContentHash: string;
  },
): Promise<ProcessorVerification> {
  const { runCommonChecks } = await import("./checks/common");
  const common = await runCommonChecks(args);
  return { processorId: extId, common, specific: [] };
}

// ---------------------------------------------------------------------------
// Console logging (副作用はここだけ)
// ---------------------------------------------------------------------------

const S = {
  header: "background:#1E3A5F;color:#fff;padding:6px 12px;font-size:14px;font-weight:bold;border-radius:4px;",
  section: "color:#5b9bd5;font-weight:bold;font-size:12px;",
  label: "color:#9ca3af;",
  value: "color:inherit;",
  pass: "color:#4ade80;font-weight:bold;",
  fail: "color:#f87171;font-weight:bold;",
  muted: "color:#6b7280;font-style:italic;",
  link: "color:#60a5fa;text-decoration:underline;",
  result: "background:#16a34a;color:#fff;padding:4px 10px;font-size:13px;font-weight:bold;border-radius:3px;",
  resultFail: "background:#dc2626;color:#fff;padding:4px 10px;font-size:13px;font-weight:bold;border-radius:3px;",
} as const;

function logVerification(
  result: VerificationResult,
  resolved: ResolvedContent,
  queryContentHash: string,
  globalConfig: GlobalConfigData,
) {
  const hashShort = queryContentHash.slice(0, 10) + "..." + queryContentHash.slice(-4);
  console.groupCollapsed(`%cContent: ${hashShort}`, S.section);

  // Data sources
  console.log("%cData Sources", S.section);
  console.log("%cContent Hash: %c%s", S.label, S.value, queryContentHash);
  console.log("%cCore cNFT:    %c%s", S.label, S.value, resolved.assetId);
  for (const ext of resolved.extensionNfts) {
    const p = ext.signedJson.payload as ExtensionPayload;
    console.log("%cExt cNFT:     %c%s %c(%s)", S.label, S.value, ext.assetId, S.muted, p.extension_id || "?");
  }

  // Per-processor checks
  console.log("");
  console.log("%cVerification Checks", S.section);
  for (const proc of result.processors) {
    console.log(`%c[${proc.processorId}]`, S.section);
    for (const check of [...proc.common, ...proc.specific]) {
      logCheck(check);
    }
  }

  // Summary
  console.log("");
  const all = result.processors.flatMap((p) => [...p.common, ...p.specific]);
  const passed = all.filter((c) => c.status === "verified").length;
  const total = all.length;
  const summaryStyle = result.overall === "verified" ? S.result : S.resultFail;
  const summaryIcon = result.overall === "verified" ? "\u2713" : "\u2717";
  console.log(`%c ${summaryIcon} ${result.overall.toUpperCase()} (${passed}/${total}) `, summaryStyle);
  console.log("%cRootLens server was NOT consulted.", S.muted);
  console.log(`%chttps://solana.fm/address/${resolved.assetId}`, S.link);
  console.groupEnd();
}

function logCheck(check: CheckResult) {
  const icon = check.status === "verified" ? "\u2713" : "\u2717";
  const style = check.status === "verified" ? S.pass : S.fail;
  const detail = check.detail ? ` — ${check.detail}` : "";
  console.log(`%c${icon} ${check.id}${detail}`, style);
}
