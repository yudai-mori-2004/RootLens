/**
 * 仕様書 §7.4 クライアントサイド検証 — cert-*
 *
 * 証明書チェーン検証 Extension。TEE 内で WASM が C2PA 証明書チェーンを
 * ハードコードされた Root CA の SPKI に対して検証した結果を確認する。
 * cert-google, cert-sony, cert-leica, cert-rootlens 等、全 cert 拡張で共通。
 *
 * 共通チェック (4):
 *   1. Collection  — ext_collection_mint に所属
 *   2. TEE Signature — Ed25519 署名 valid
 *   3. TEE Identity  — tee_pubkey が trusted_tee_nodes に存在
 *   4. Content Binding — payload.content_hash == query
 *
 * 固有チェック (2):
 *   5. WASM Trusted     — payload.wasm_hash が GlobalConfig に登録済み
 *   6. Cert Verified    — TEE 内の WASM が証明書チェーンを verified と判定したか
 */

import type { SignedJson, ExtensionPayload, WasmModuleInfo } from "@title-protocol/sdk";
import type { ProcessorVerification, CheckResult } from "./types";
import { findWasmVersionByHash } from "../config";
import { runCommonChecks } from "./common";

// ---------------------------------------------------------------------------
// Payload 型 (cert-* 固有フィールド)
// ---------------------------------------------------------------------------

interface CertPayload extends ExtensionPayload {
  verified?: boolean;
  root_ca?: string;
  root_spki?: string;
  chain?: unknown[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CertInput {
  signedJson: SignedJson;
  collectionAddress: string;
  expectedCollection: string;
  queryContentHash: string;
  trustedWasmModules: WasmModuleInfo[];
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verify(input: CertInput): Promise<ProcessorVerification> {
  const common = await runCommonChecks({
    signedJson: input.signedJson,
    collectionAddress: input.collectionAddress,
    expectedCollection: input.expectedCollection,
    queryContentHash: input.queryContentHash,
  });

  const payload = input.signedJson.payload as CertPayload;

  return {
    processorId: payload.extension_id,
    common,
    specific: [
      checkWasmTrusted(payload, input.trustedWasmModules),
      checkCertVerified(payload),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. WASM Trusted
// ---------------------------------------------------------------------------

function checkWasmTrusted(
  payload: CertPayload,
  trustedModules: WasmModuleInfo[],
): CheckResult {
  if (!payload.wasm_hash) {
    return { id: "wasm_trusted", status: "failed", detail: "No wasm_hash in payload" };
  }

  const matched = findWasmVersionByHash(trustedModules, payload.extension_id, payload.wasm_hash);
  return {
    id: "wasm_trusted",
    status: matched ? "verified" : "failed",
    detail: matched
      ? `WASM hash ${payload.wasm_hash.slice(0, 12)}... found in GlobalConfig (v${matched.version})`
      : `WASM hash ${payload.wasm_hash.slice(0, 12)}... not found in GlobalConfig`,
  };
}

// ---------------------------------------------------------------------------
// 6. Cert Verified — TEE の WASM が証明書チェーンを検証した結果
// ---------------------------------------------------------------------------

function checkCertVerified(payload: CertPayload): CheckResult {
  if (payload.error) {
    return {
      id: "cert_verified",
      status: "failed",
      detail: `Certificate verification error: ${payload.error}`,
    };
  }

  if (payload.verified !== true) {
    return {
      id: "cert_verified",
      status: "failed",
      detail: payload.root_ca
        ? `Certificate chain not verified against ${payload.root_ca}`
        : "Certificate chain not verified (verified !== true)",
    };
  }

  return {
    id: "cert_verified",
    status: "verified",
    detail: payload.root_ca
      ? `Certificate chain verified against ${payload.root_ca}`
      : "Certificate chain verified",
  };
}
