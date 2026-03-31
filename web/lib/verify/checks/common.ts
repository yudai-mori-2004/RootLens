/**
 * 仕様書 §7.4 クライアントサイド検証
 *
 * 全 processor_id 共通の4チェック:
 *   1. Collection  — cNFT が期待する Solana コレクションに所属するか
 *   2. TEE Signature — Ed25519 署名が JCS({payload, attributes}) に対して valid か
 *   3. TEE Identity  — tee_pubkey が GlobalConfig.trusted_tee_nodes に存在するか
 *   4. Content Binding — payload.content_hash が検索した content_hash と一致するか
 */

import type { SignedJson } from "@title-protocol/sdk";
import type { CheckResult } from "./types";
import type { TrustedTeeNode } from "../config";

// ---------------------------------------------------------------------------
// 1. Collection
// ---------------------------------------------------------------------------

export function checkCollection(
  actualCollection: string,
  expectedCollection: string,
): CheckResult {
  const ok = actualCollection === expectedCollection;
  return {
    id: "collection",
    status: ok ? "verified" : "failed",
    detail: ok
      ? `Collection ${actualCollection.slice(0, 8)}... matches GlobalConfig`
      : `Expected ${expectedCollection.slice(0, 8)}..., got ${actualCollection.slice(0, 8)}...`,
  };
}

// ---------------------------------------------------------------------------
// 2. TEE Signature (Ed25519 over JCS)
// ---------------------------------------------------------------------------

export async function checkTeeSignature(
  signedJson: SignedJson,
): Promise<CheckResult> {
  try {
    const { tee_pubkey, tee_signature, payload, attributes } = signedJson;
    const canonicalize = (await import("canonicalize")).default;
    const target = canonicalize({ payload, attributes });
    if (!target) {
      return { id: "tee_signature", status: "failed", detail: "JCS canonicalization returned null" };
    }

    const data = new TextEncoder().encode(target);
    const pubkeyBytes = base58Decode(tee_pubkey);
    const sigBytes = base64ToBytes(tee_signature);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      cryptoKey,
      sigBytes.buffer as ArrayBuffer,
      data.buffer as ArrayBuffer,
    );

    return {
      id: "tee_signature",
      status: valid ? "verified" : "failed",
      detail: valid
        ? `Ed25519 signature valid (pubkey: ${tee_pubkey.slice(0, 8)}...)`
        : "Ed25519 signature invalid",
    };
  } catch (e) {
    return {
      id: "tee_signature",
      status: "failed",
      detail: `Ed25519 verification error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. TEE Identity
// ---------------------------------------------------------------------------

export function checkTeeIdentity(
  teePubkey: string,
  trustedNodes: TrustedTeeNode[],
): CheckResult {
  const found = trustedNodes.some((n) => n.signing_pubkey === teePubkey);
  return {
    id: "tee_identity",
    status: found ? "verified" : "failed",
    detail: found
      ? `TEE pubkey ${teePubkey.slice(0, 8)}... is in GlobalConfig.trusted_tee_nodes`
      : `TEE pubkey ${teePubkey.slice(0, 8)}... not found in trusted nodes`,
  };
}

// ---------------------------------------------------------------------------
// 4. Content Binding
// ---------------------------------------------------------------------------

export function checkContentBinding(
  payloadContentHash: string,
  queryContentHash: string,
): CheckResult {
  const ok = payloadContentHash === queryContentHash;
  return {
    id: "content_binding",
    status: ok ? "verified" : "failed",
    detail: ok
      ? "payload.content_hash matches query"
      : `payload.content_hash ${payloadContentHash.slice(0, 10)}... does not match query ${queryContentHash.slice(0, 10)}...`,
  };
}

// ---------------------------------------------------------------------------
// 共通4チェックをまとめて実行
// ---------------------------------------------------------------------------

export interface CommonInput {
  signedJson: SignedJson;
  collectionAddress: string;
  expectedCollection: string;
  queryContentHash: string;
  trustedTeeNodes: TrustedTeeNode[];
}

export async function runCommonChecks(
  input: CommonInput,
): Promise<[CheckResult, CheckResult, CheckResult, CheckResult]> {
  const { signedJson, collectionAddress, expectedCollection, queryContentHash, trustedTeeNodes } = input;
  const payload = signedJson.payload as { content_hash: string };

  return [
    checkCollection(collectionAddress, expectedCollection),
    await checkTeeSignature(signedJson),
    checkTeeIdentity(signedJson.tee_pubkey, trustedTeeNodes),
    checkContentBinding(payload.content_hash, queryContentHash),
  ];
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
