/**
 * iOS App Attest 検証のテスト
 *
 * 実際の Apple Root CA で署名されたチェーンは生成できないため、
 * パーサーのユニットテストと、不正入力のエラーハンドリングを中心にテストする。
 */

import { describe, it, expect } from "vitest";
import * as cbor from "cbor-x";
import crypto from "crypto";
import {
  verifyIOSAttestation,
  _decodeAttestationObject,
  _parseAuthenticatorData,
} from "../attestation-ios";

// ---------------------------------------------------------------------------
// テスト用 Attestation Object ビルダー
// ---------------------------------------------------------------------------

function buildTestAuthenticatorData(opts: {
  appId?: string;
  counter?: number;
  withCredential?: boolean;
} = {}): Buffer {
  const appId = opts.appId ?? "TEAM_ID.io.rootlens.app";
  const counter = opts.counter ?? 0;
  const withCredential = opts.withCredential ?? false;

  const rpIdHash = crypto.createHash("sha256").update(appId).digest();
  const flags = Buffer.alloc(1);
  flags[0] = withCredential ? 0x41 : 0x01; // UP flag + optional AT flag
  const signCount = Buffer.alloc(4);
  signCount.writeUInt32BE(counter);

  const parts = [rpIdHash, flags, signCount];

  if (withCredential) {
    // aaguid (16 bytes) + credentialIdLength (2 bytes) + credentialId + pubkey
    const aaguid = Buffer.from("appattestdevelop"); // 16 bytes
    const credId = crypto.randomBytes(32);
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(credId.length);
    const fakePubKey = crypto.randomBytes(64);
    parts.push(aaguid, credIdLen, credId, fakePubKey);
  }

  return Buffer.concat(parts);
}

function buildTestAttestationObject(opts: {
  authData?: Buffer;
  x5c?: Buffer[];
} = {}): string {
  const authData = opts.authData ?? buildTestAuthenticatorData({ withCredential: true });
  const x5c = opts.x5c ?? [crypto.randomBytes(100), crypto.randomBytes(100)];

  const obj = {
    fmt: "apple-appattest",
    attStmt: {
      x5c,
      receipt: Buffer.alloc(0),
    },
    authData,
  };

  return Buffer.from(cbor.encode(obj)).toString("base64");
}

// ---------------------------------------------------------------------------
// _decodeAttestationObject
// ---------------------------------------------------------------------------

describe("decodeAttestationObject", () => {
  it("正しいCBORをデコードできる", () => {
    const base64 = buildTestAttestationObject();
    const result = _decodeAttestationObject(base64);
    expect(result).not.toBeNull();
    expect(result!.fmt).toBe("apple-appattest");
    expect(result!.attStmt.x5c).toHaveLength(2);
    expect(result!.authData).toBeInstanceOf(Buffer);
  });

  it("不正なBase64でnull", () => {
    const result = _decodeAttestationObject("not-valid-base64!!!");
    expect(result).toBeNull();
  });

  it("空のCBORでnull", () => {
    const result = _decodeAttestationObject(Buffer.from(cbor.encode({})).toString("base64"));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// _parseAuthenticatorData
// ---------------------------------------------------------------------------

describe("parseAuthenticatorData", () => {
  it("rpIdHashとcounterをパースできる", () => {
    const authData = buildTestAuthenticatorData({ counter: 0 });
    const result = _parseAuthenticatorData(authData);
    expect(result).not.toBeNull();
    expect(result!.signCount).toBe(0);
    expect(result!.rpIdHash).toHaveLength(32);
  });

  it("counter=0 の初回attestation", () => {
    const authData = buildTestAuthenticatorData({ counter: 0 });
    const result = _parseAuthenticatorData(authData);
    expect(result!.signCount).toBe(0);
  });

  it("counter>0 のsubsequent attestation", () => {
    const authData = buildTestAuthenticatorData({ counter: 42 });
    const result = _parseAuthenticatorData(authData);
    expect(result!.signCount).toBe(42);
  });

  it("短すぎるデータでnull", () => {
    const result = _parseAuthenticatorData(Buffer.alloc(10));
    expect(result).toBeNull();
  });

  it("AT flagがセットされている場合にcredentialデータをパースする", () => {
    const authData = buildTestAuthenticatorData({ withCredential: true });
    const result = _parseAuthenticatorData(authData);
    expect(result).not.toBeNull();
    expect(result!.aaguid).toHaveLength(16);
    expect(result!.credentialIdLength).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// verifyIOSAttestation 統合テスト
// ---------------------------------------------------------------------------

describe("verifyIOSAttestation", () => {
  it("不正なattestation objectでエラー", async () => {
    const result = await verifyIOSAttestation("dGVzdA==", {
      app_attest_object: "invalid-cbor",
      app_attest_key_id: "test-key-id",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("decode");
  });

  it("Apple Root CAにチェーンしない証明書は拒否される", async () => {
    const base64 = buildTestAttestationObject();
    const result = await verifyIOSAttestation("dGVzdA==", {
      app_attest_object: base64,
      app_attest_key_id: "test-key-id",
    });
    expect(result.valid).toBe(false);
    // ランダムな証明書はx509パースで失敗する
    expect(result.error).toBeDefined();
  });

  it("空のx5cチェーンでエラー", async () => {
    const base64 = buildTestAttestationObject({ x5c: [] });
    const result = await verifyIOSAttestation("dGVzdA==", {
      app_attest_object: base64,
      app_attest_key_id: "test-key-id",
    });
    expect(result.valid).toBe(false);
  });
});
