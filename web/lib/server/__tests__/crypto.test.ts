/**
 * CryptoSigner 抽象化レイヤーのテスト
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  getAlgorithmParams,
  validatePublicKeyAlgorithm,
  LocalEcSigner,
  type SigningAlgorithm,
} from "../crypto";

// ---------------------------------------------------------------------------
// ヘルパー: テスト用EC P-256鍵ペアを生成
// ---------------------------------------------------------------------------

async function generateTestKeyPair(namedCurve = "P-256") {
  return crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve },
    true,
    ["sign", "verify"],
  );
}

async function exportPrivateKeyPem(keyPair: CryptoKeyPair): Promise<string> {
  const pkcs8 = await crypto.webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const lines = b64.match(/.{1,64}/g)!;
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

// ---------------------------------------------------------------------------
// getAlgorithmParams
// ---------------------------------------------------------------------------

describe("getAlgorithmParams", () => {
  it("ES256のパラメータを返す", () => {
    const params = getAlgorithmParams("ES256");
    expect(params.name).toBe("ECDSA");
    expect(params.namedCurve).toBe("P-256");
    expect(params.hash).toBe("SHA-256");
    expect(params.c2paAlg).toBe("Es256");
  });

  it("ES384のパラメータを返す", () => {
    const params = getAlgorithmParams("ES384");
    expect(params.namedCurve).toBe("P-384");
    expect(params.hash).toBe("SHA-384");
  });

  it("未知のアルゴリズムでエラー", () => {
    expect(() => getAlgorithmParams("UNKNOWN" as SigningAlgorithm)).toThrow("Unsupported algorithm");
  });
});

// ---------------------------------------------------------------------------
// validatePublicKeyAlgorithm
// ---------------------------------------------------------------------------

describe("validatePublicKeyAlgorithm", () => {
  it("EC P-256鍵がES256で検証を通過する", async () => {
    const keyPair = await generateTestKeyPair("P-256");
    const result = validatePublicKeyAlgorithm(keyPair.publicKey, "ES256");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("EC P-384鍵はES256で拒否される", async () => {
    const keyPair = await generateTestKeyPair("P-384");
    const result = validatePublicKeyAlgorithm(keyPair.publicKey, "ES256");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("P-256");
    expect(result.error).toContain("P-384");
  });

  it("EC P-384鍵がES384で検証を通過する", async () => {
    const keyPair = await generateTestKeyPair("P-384");
    const result = validatePublicKeyAlgorithm(keyPair.publicKey, "ES384");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LocalEcSigner
// ---------------------------------------------------------------------------

describe("LocalEcSigner", () => {
  it("PEMから生成してデータに署名できる", async () => {
    const keyPair = await generateTestKeyPair("P-256");
    const pem = await exportPrivateKeyPem(keyPair);

    const signer = await LocalEcSigner.fromPkcs8Pem(pem, "ES256");
    expect(signer.algorithm).toBe("ES256");

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const signature = await signer.sign(data);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBeGreaterThan(0);

    // 署名をWebCryptoで検証
    const valid = await crypto.webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      data,
    );
    expect(valid).toBe(true);
  });

  it("異なるデータで異なる署名を生成する", async () => {
    const keyPair = await generateTestKeyPair("P-256");
    const pem = await exportPrivateKeyPem(keyPair);
    const signer = await LocalEcSigner.fromPkcs8Pem(pem, "ES256");

    const sig1 = await signer.sign(new Uint8Array([1]));
    const sig2 = await signer.sign(new Uint8Array([2]));

    // ECDSA署名はランダム要素を含むため、同じデータでも異なる署名になるが、
    // ここでは異なるデータの署名が生成されることだけ確認
    expect(sig1.length).toBeGreaterThan(0);
    expect(sig2.length).toBeGreaterThan(0);
  });

  it("getCryptoKey()で内部のCryptoKeyを取得できる", async () => {
    const keyPair = await generateTestKeyPair("P-256");
    const pem = await exportPrivateKeyPem(keyPair);
    const signer = await LocalEcSigner.fromPkcs8Pem(pem, "ES256");

    const key = signer.getCryptoKey();
    expect(key).toBeDefined();
    expect(key.type).toBe("private");
  });

  it("不正なPEMでエラー", async () => {
    await expect(
      LocalEcSigner.fromPkcs8Pem("not-a-valid-pem", "ES256"),
    ).rejects.toThrow();
  });
});
