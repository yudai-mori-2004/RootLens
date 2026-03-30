/**
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 *
 * ブラウザ内でトラストレス検証を完結させる。
 * RootLens サーバーには一切問い合わせない。
 *
 * 全NFT共通ステップ:
 *  1. コレクション所属確認
 *  2. TEE署名検証 (Ed25519)
 *
 * NFT固有ステップ (specificChecks):
 *  Core (c2pa): C2PA来歴チェーン確認, content_hash一致, 重複解決
 *  Extension (image-pdq): PDQ同一性検証
 *  Extension (hardware-*): ハードウェア署名検出
 *  Extension (その他): WASMハッシュ検証
 */

import type { SignedJson, CorePayload, ExtensionPayload } from "@title-protocol/sdk";
import type { ResolvedContent } from "./content-resolver";
import type { VerificationResult, VerifyStepStatus, NftVerification, SpecificCheck } from "../types";
import {
  getGlobalConfigData,
  findWasmVersionByHash,
  type GlobalConfigData,
  PDQ_THRESHOLD,
  DAS_RPC_URL,
} from "./config";
import { contentResolver } from "./content-resolver";
import { computePdqWasm } from "./pdq-wasm";

// ---------------------------------------------------------------------------
// メインの検証関数
// ---------------------------------------------------------------------------

/** 翻訳関数の型。check.* キーを解決する。存在しないキーはキー名をそのまま返す */
export type CheckTranslator = (key: string, params?: Record<string, string | number>) => string;

/**
 * ユーザーが手元で知覚しているメディアへの参照。
 * オンチェーンに記録された知覚特徴量（PDQ等）との同一性検証に使用する。
 *
 * これらはRootLensサーバー由来であり、信頼境界の外にある。
 * 検証結果は「この表示データがオンチェーン記録と一致するか」を示すものであり、
 * 表示データ自体の真正性を保証するものではない。
 *
 * 全フィールドはURL形式。ローカルデータは URL.createObjectURL(blob) で変換可能。
 */
export interface PerceptualInputs {
  /** 画像PDQ比較対象。image-pdq Extension の検証に使用 */
  imageUrl?: string;
  /** 動画vPDQ比較対象。video-vpdq Extension の検証に使用（将来） */
  videoUrl?: string;
}

// ---------------------------------------------------------------------------
// コンソールスタイル（%c CSS）
// ---------------------------------------------------------------------------

const S = {
  header: "background:#1E3A5F;color:#fff;padding:6px 12px;font-size:14px;font-weight:bold;border-radius:4px;",
  section: "color:#5b9bd5;font-weight:bold;font-size:12px;",
  label: "color:#9ca3af;",
  value: "color:inherit;",
  pass: "color:#4ade80;font-weight:bold;",
  fail: "color:#f87171;font-weight:bold;",
  skip: "color:#6b7280;",
  muted: "color:#6b7280;font-style:italic;",
  link: "color:#60a5fa;text-decoration:underline;",
  result: "background:#16a34a;color:#fff;padding:4px 10px;font-size:13px;font-weight:bold;border-radius:3px;",
  resultFail: "background:#dc2626;color:#fff;padding:4px 10px;font-size:13px;font-weight:bold;border-radius:3px;",
} as const;

const stepLog = (status: VerifyStepStatus, label: string) => {
  const icon = status === "verified" ? "\u2713" : status === "failed" ? "\u2717" : "-";
  const style = status === "verified" ? S.pass : status === "failed" ? S.fail : S.skip;
  console.log(`%c${icon} ${label}`, style);
};

export async function verifyContentOnChain(
  resolved: ResolvedContent,
  perceptual: PerceptualInputs,
  queryContentHash: string,
  tc: CheckTranslator,
): Promise<VerificationResult> {
  const result: VerificationResult = {
    nfts: [],
    overall: "pending",
    assetId: resolved.assetId,
    arweaveUri: resolved.arweaveUri,
  };

  const hashShort = queryContentHash.slice(0, 10) + "..." + queryContentHash.slice(-4);

  // --- console.groupCollapsed: 並列実行でもコンテンツ間でログが混ざらない ---
  console.groupCollapsed(`%cContent: ${hashShort}`, S.section);

  // INPUT
  console.log("%cINPUT%c (from RootLens page metadata — not verified)", S.section, S.muted);
  console.log("%cContent Hash: %c%s", S.label, S.value, queryContentHash);
  console.log("%c  SHA-256 of C2PA Active Manifest Signature", S.muted);
  if (perceptual.imageUrl) console.log("%cDisplay image: %c%s", S.label, S.value, perceptual.imageUrl);
  if (perceptual.videoUrl) console.log("%cDisplay video: %c%s", S.label, S.value, perceptual.videoUrl);

  // Title Protocol
  const globalConfig = await getGlobalConfigData();
  console.log("");
  console.log("%cTitle Protocol", S.section);
  console.log("%chttps://github.com/yudai-mori-2004/title-protocol", S.link);
  console.log("%cSolana RPC: %c%s", S.label, S.value, DAS_RPC_URL);
  console.log("%cCore cNFT:  %c%s %c(oldest by leaf_id)", S.label, S.value, resolved.assetId, S.muted);
  for (const e of resolved.extensionNfts) {
    const p = e.signedJson.payload as ExtensionPayload;
    console.log("%cExt  cNFT:  %c%s %c(%s)", S.label, S.value, e.assetId, S.muted, p.extension_id || "unknown");
  }
  console.log("");
  console.log("%cOff-chain storage (TEE-signed data)", S.section);
  console.log("%cCore: %c%s", S.label, S.value, resolved.arweaveUri);
  for (const e of resolved.extensionNfts) {
    console.log("%cExt:  %c%s", S.label, S.value, e.arweaveUri);
  }

  // SIGNATURE VERIFICATION
  console.log("");
  console.log("%cSignature Verification", S.section);
  const corePubkey = resolved.coreSignedJson?.tee_pubkey?.slice(0, 8) || "?";

  // =====================================================================
  // Core NFT 検証
  // =====================================================================
  const coreNft: NftVerification = {
    id: "c2pa",
    collectionVerified: "pending",
    teeSignatureVerified: "pending",
    specificChecks: [],
  };

  // 共通ステップ1: コレクション
  coreNft.collectionVerified = resolved.collectionAddress === globalConfig.core
    ? "verified" : "failed";

  // 共通ステップ2: TEE署名
  if (resolved.coreSignedJson) {
    coreNft.teeSignatureVerified = await verifyTeeSignature(resolved.coreSignedJson);
    const coreStyle = coreNft.teeSignatureVerified === "verified" ? S.pass : S.fail;
    console.log(`%cverify(pubkey: ${corePubkey}..., core_data) = %c${coreNft.teeSignatureVerified === "verified" ? "\u2713" : "\u2717"}`, S.value, coreStyle);
  } else {
    coreNft.teeSignatureVerified = "failed";
    console.log(`%cverify(core_data) = %c\u2717 (no signed_json)`, S.value, S.fail);
  }

  // Core固有: C2PA来歴チェーン
  if (resolved.coreSignedJson) {
    const payload = resolved.coreSignedJson.payload as CorePayload;
    const hasNodes = payload.nodes && payload.nodes.length > 0;
    coreNft.specificChecks.push({
      label: tc("c2pa_chain"),
      status: hasNodes ? "verified" : "failed",
      detail: hasNodes
        ? tc("c2pa_chain_pass", { nodes: payload.nodes.length, links: payload.links?.length ?? 0 })
        : tc("c2pa_chain_fail"),
    });
  } else {
    coreNft.specificChecks.push({
      label: tc("c2pa_chain"),
      status: "failed",
      detail: tc("c2pa_chain_fail"),
    });
  }

  // Core固有: content_hash一致
  if (resolved.coreSignedJson) {
    const payload = resolved.coreSignedJson.payload as CorePayload;
    const matched = payload.content_hash === queryContentHash;
    coreNft.specificChecks.push({
      label: tc("content_hash_match"),
      status: matched ? "verified" : "failed",
      detail: matched ? tc("content_hash_match_pass") : tc("content_hash_match_fail"),
    });
  } else {
    coreNft.specificChecks.push({
      label: tc("content_hash_match"),
      status: "failed",
      detail: tc("content_hash_match_fail"),
    });
  }

  // Core固有: オリジナルチェック（自分が最古の登録か）
  if (contentResolver.resolveAllByContentHash) {
    const allResolved = await contentResolver.resolveAllByContentHash(queryContentHash);
    if (allResolved === null) {
      // DAS APIエラー: 比較不能 → failed（"判定不能"であり"オリジナル"ではない）
      coreNft.specificChecks.push({
        label: tc("original_check"),
        status: "failed",
        detail: tc("original_check_error"),
      });
    } else {
      const isOriginal = allResolved.length === 0 || allResolved[0].assetId === resolved.assetId;
      coreNft.specificChecks.push({
        label: tc("original_check"),
        status: isOriginal ? "verified" : "failed",
        detail: isOriginal ? tc("original_check_pass") : tc("original_check_fail"),
      });
    }
  } else {
    // resolverがメソッドを持たない場合も明示的にfailed
    coreNft.specificChecks.push({
      label: tc("original_check"),
      status: "failed",
      detail: tc("original_check_error"),
    });
  }

  result.nfts.push(coreNft);

  // =====================================================================
  // Extension NFT 検証（全extensionを同じ枠組みで処理）
  // =====================================================================
  for (const extNft of resolved.extensionNfts) {
    const extSj = extNft.signedJson;
    const extPayload = extSj.payload as ExtensionPayload;
    const extId = extPayload.extension_id || "unknown";

    const nftVerif: NftVerification = {
      id: extId,
      collectionVerified: "pending",
      teeSignatureVerified: "pending",
      specificChecks: [],
    };

    // 共通ステップ1: コレクション
    nftVerif.collectionVerified = extNft.collectionAddress === globalConfig.ext
      ? "verified" : "failed";

    // 共通ステップ2: TEE署名
    nftVerif.teeSignatureVerified = await verifyTeeSignature(extSj);
    const extPubkey = extSj.tee_pubkey?.slice(0, 8) || "?";
    const extSigStyle = nftVerif.teeSignatureVerified === "verified" ? S.pass : S.fail;
    console.log(`%cverify(pubkey: ${extPubkey}..., ${extId}_data) = %c${nftVerif.teeSignatureVerified === "verified" ? "\u2713" : "\u2717"}`, S.value, extSigStyle);

    // Extension固有: WASMハッシュ検証（NFTのwasm_hashに一致するバージョンがあるか）
    const wasmHash = (extPayload as Record<string, unknown>).wasm_hash as string | undefined;
    if (wasmHash && globalConfig.trustedWasmModules.length > 0) {
      const matchedVersion = findWasmVersionByHash(globalConfig.trustedWasmModules, extId, wasmHash);
      nftVerif.specificChecks.push({
        label: tc("wasm_hash"),
        status: matchedVersion ? "verified" : "failed",
        detail: matchedVersion ? tc("wasm_hash_pass") : tc("wasm_hash_fail"),
      });
    } else if (wasmHash) {
      // GlobalConfigにモジュール未登録（devnet等）
      nftVerif.specificChecks.push({
        label: tc("wasm_hash"),
        status: "skipped",
        detail: tc("wasm_hash_skip"),
      });
    } else {
      // wasm_hashがペイロードに存在しない → Extension NFTとして不正
      nftVerif.specificChecks.push({
        label: tc("wasm_hash"),
        status: "failed",
        detail: tc("wasm_hash_missing"),
      });
    }

    // Extension固有: image-pdq → PDQ同一性検証
    if (extId === "image-pdq") {
      const pdqPayload = extPayload as ExtensionPayload & { pdqhash?: string };
      if (pdqPayload.pdqhash) {
        const pdqResult = perceptual.imageUrl
          ? await verifyPdqWithImage(pdqPayload.pdqhash, perceptual.imageUrl, wasmHash)
          : { status: "skipped" as const, reason: "No image URL provided for PDQ comparison" };
        if (pdqResult.distance !== undefined) {
          const pdqIcon = pdqResult.status === "verified" ? "\u2713" : "\u2717";
          const pdqStyle = pdqResult.status === "verified" ? S.pass : S.fail;
          console.log("");
          console.log("%cPDQ Identity Check", S.section);
          console.log(`%cOn-chain (TEE computed): %c${pdqPayload.pdqhash}`, S.label, S.value);
          console.log(`%cBrowser (recomputed):    %c${pdqResult.computedHash || "?"}`, S.label, S.value);
          console.log(`%cHamming distance: %c${pdqResult.distance} %c(threshold: ${PDQ_THRESHOLD})`, S.label, pdqStyle, S.muted);
          console.log(`%c${pdqIcon} ${pdqResult.distance} \u2264 ${PDQ_THRESHOLD} → ${pdqResult.status}`, pdqStyle);
          nftVerif.specificChecks.push({
            label: tc("pdq_identity"),
            status: pdqResult.status,
            detail: tc(pdqResult.status === "verified" ? "pdq_identity_pass" : "pdq_identity_fail", { distance: pdqResult.distance, threshold: PDQ_THRESHOLD }),
          });
        } else {
          nftVerif.specificChecks.push({
            label: tc("pdq_identity"),
            status: "skipped",
            detail: tc("pdq_identity_error", { reason: pdqResult.reason || "unknown" }),
          });
        }
      } else {
        nftVerif.specificChecks.push({
          label: tc("pdq_identity"),
          status: "skipped",
          detail: tc("pdq_identity_skip"),
        });
      }
    }

    // Extension固有: hardware-* → ハードウェア署名検出
    if (extId.startsWith("hardware-")) {
      nftVerif.specificChecks.push({
        label: tc("hardware_signing"),
        status: nftVerif.teeSignatureVerified,
        detail: nftVerif.teeSignatureVerified === "verified"
          ? tc("hardware_signing_pass", { id: extId })
          : tc("hardware_signing_fail"),
      });
    }

    result.nfts.push(nftVerif);
  }

  // =====================================================================
  // 全体判定 + リアルタイムログ
  // =====================================================================
  const allChecks: VerifyStepStatus[] = [];
  for (const nft of result.nfts) {
    allChecks.push(nft.collectionVerified);
    allChecks.push(nft.teeSignatureVerified);
    for (const sc of nft.specificChecks) {
      allChecks.push(sc.status);
    }
  }
  const active = allChecks.filter((s) => s !== "skipped");
  const allVerified = active.length > 0 && active.every((s) => s === "verified");
  const anyFailed = active.some((s) => s === "failed");
  result.overall = allVerified ? "verified" : anyFailed ? "failed" : "pending";

  // リアルタイムステップログ（各NFTの全チェックを列挙）
  console.log("");
  console.log("%cVerification Steps", S.section);
  for (const nft of result.nfts) {
    const nftLabel = nft.id === "c2pa" ? "Core" : `Ext (${nft.id})`;
    const expectedColl = nft.id === "c2pa" ? globalConfig.core : globalConfig.ext;
    const actualColl = nft.id === "c2pa" ? resolved.collectionAddress
      : resolved.extensionNfts.find(e => {
          const p = e.signedJson.payload as ExtensionPayload;
          return (p.extension_id || "unknown") === nft.id;
        })?.collectionAddress || "?";
    stepLog(nft.collectionVerified, `${nftLabel} collection: ${actualColl.slice(0, 8)}... == GlobalConfig.${nft.id === "c2pa" ? "core" : "ext"}`);
    stepLog(nft.teeSignatureVerified, `${nftLabel} TEE signature (Ed25519)`);
    for (const sc of nft.specificChecks) {
      stepLog(sc.status, sc.label);
    }
  }

  // Owner
  console.log("%cOwner: %c%s", S.label, S.value, resolved.ownerWallet);

  // サマリー
  console.log("");
  const passed = active.filter((s) => s === "verified").length;
  const overall = result.overall === "verified"
    ? `%c \u2713 VERIFIED (${passed}/${active.length}) `
    : `%c \u2717 FAILED (${passed}/${active.length}) `;
  console.log(overall, result.overall === "verified" ? S.result : S.resultFail);
  console.log("%cRootLens server was NOT consulted for any verification data.", S.muted);
  console.log(`%cVerify independently: %chttps://solana.fm/address/${resolved.assetId}`, S.muted, S.link);
  console.groupEnd();

  return result;
}

// ---------------------------------------------------------------------------
// TEE署名検証 (Ed25519)
// ---------------------------------------------------------------------------

async function verifyTeeSignature(
  signedJson: SignedJson
): Promise<VerifyStepStatus> {
  try {
    const { tee_pubkey, tee_signature, payload, attributes } = signedJson;
    // RFC 8785 JCS — TP の serde_json_canonicalizer と同一の正規化
    const canonicalize = (await import("canonicalize")).default;
    const signatureTarget = canonicalize({ payload, attributes });
    if (!signatureTarget) return "failed";
    const data = new TextEncoder().encode(signatureTarget);
    const pubkeyBytes = base58Decode(tee_pubkey);
    const sigBytes = base64ToBytes(tee_signature);

    const cryptoKey = await crypto.subtle.importKey(
      "raw", pubkeyBytes.buffer as ArrayBuffer,
      { name: "Ed25519" }, false, ["verify"]
    );
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" }, cryptoKey,
      sigBytes.buffer as ArrayBuffer, data.buffer as ArrayBuffer
    );
    return valid ? "verified" : "failed";
  } catch (e) {
    console.warn("  → Ed25519 verification error:", e);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// PDQ 照合
// ---------------------------------------------------------------------------

interface PdqResult {
  status: VerifyStepStatus;
  distance?: number;
  computedHash?: string;
  reason?: string;
}

async function verifyPdqWithImage(
  onchainHash: string,
  imageUrl: string,
  wasmHash?: string,
): Promise<PdqResult> {
  try {
    const computed = await computePdqWasm(imageUrl, wasmHash);
    const distance = hammingDistance(onchainHash, computed);
    return {
      status: distance <= PDQ_THRESHOLD ? "verified" : "failed",
      distance,
      computedHash: computed,
    };
  } catch (e) {
    console.warn("  → PDQ computation error:", e);
    return { status: "failed", reason: `Computation failed: ${e}` };
  }
}

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

// ---------------------------------------------------------------------------
// エンコーディングユーティリティ
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid Base58 character: ${c}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of str) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
