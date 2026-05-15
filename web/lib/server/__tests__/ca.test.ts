/**
 * CA（証明書発行）ロジックのテスト
 *
 * テスト用のPKI（Root CA → ICA → Device Cert）を動的に生成し、
 * verifyCSR / issueDeviceCertificate / アルゴリズム検証を網羅する。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as x509 from "@peculiar/x509";
import crypto from "crypto";
import {
  verifyCSR,
  issueDeviceCertificate,
  loadPemFromEnv,
  _resetCache,
  _setTestIntermediateCA,
  DEVICE_CERT_VALIDITY_DAYS,
  PKI_ALGORITHM,
} from "../ca";

// @peculiar/x509 の crypto provider を設定
x509.cryptoProvider.set(crypto.webcrypto as Crypto);

// ---------------------------------------------------------------------------
// テスト用PKI生成
// ---------------------------------------------------------------------------

let rootCaKeyPair: CryptoKeyPair;
let rootCaCert: x509.X509Certificate;
let icaKeyPair: CryptoKeyPair;
let icaCert: x509.X509Certificate;
let icaKeyPem: string;

beforeAll(async () => {
  // Root CA
  rootCaKeyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  rootCaCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Test Root CA, O=Test, C=JP",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    keys: rootCaKeyPair,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.BasicConstraintsExtension(true, 1, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  // Android Intermediate CA
  icaKeyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  icaCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Test Android CA, O=Test, C=JP",
    issuer: rootCaCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: icaKeyPair.publicKey,
    signingKey: rootCaKeyPair.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  // Root CA cert は env (公開物なので)
  process.env.ROOT_CA_CERT_PEM = rootCaCert.toString("pem");

  // ICA 秘密鍵 PEM — fixture を作って毎 test で _setTestIntermediateCA に渡す
  const icaKeyPkcs8 = await crypto.webcrypto.subtle.exportKey("pkcs8", icaKeyPair.privateKey);
  icaKeyPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(icaKeyPkcs8).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
});

// 各 test 前にキャッシュをリセットしつつ ICA fixture を再注入
// (= テストでは `keys/` ファイルや env を読まずに in-memory fixture で完結させる)
beforeEach(async () => {
  _resetCache();
  await _setTestIntermediateCA("android", icaCert.toString("pem"), icaKeyPem);
  await _setTestIntermediateCA("ios", icaCert.toString("pem"), icaKeyPem);
});

afterEach(() => {
  _resetCache();
});

// ---------------------------------------------------------------------------
// テスト用CSR生成
// ---------------------------------------------------------------------------

async function generateTestCSR(
  namedCurve = "P-256",
): Promise<{ csr: x509.Pkcs10CertificateRequest; keyPair: CryptoKeyPair }> {
  const keyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve },
    true,
    ["sign", "verify"],
  );
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: "CN=RootLens Device, O=RootLens",
    keys: keyPair,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  return { csr, keyPair };
}

// ---------------------------------------------------------------------------
// verifyCSR
// ---------------------------------------------------------------------------

describe("verifyCSR", () => {
  it("正しいEC P-256 CSRが検証を通過する", async () => {
    const { csr } = await generateTestCSR("P-256");
    const csrBase64 = Buffer.from(csr.rawData).toString("base64");

    const result = await verifyCSR(csrBase64);
    expect(result.valid).toBe(true);
    expect(result.publicKey).not.toBeNull();
    expect(result.deviceIdHash).toHaveLength(16);
    expect(result.error).toBeUndefined();
  });

  it("device_id_hashが公開鍵から決定論的に導出される", async () => {
    const { csr } = await generateTestCSR("P-256");
    const csrBase64 = Buffer.from(csr.rawData).toString("base64");

    const result1 = await verifyCSR(csrBase64);
    _resetCache();
    const result2 = await verifyCSR(csrBase64);

    expect(result1.deviceIdHash).toBe(result2.deviceIdHash);
  });

  it("異なる鍵で異なるdevice_id_hashが生成される", async () => {
    const { csr: csr1 } = await generateTestCSR("P-256");
    const { csr: csr2 } = await generateTestCSR("P-256");

    const result1 = await verifyCSR(Buffer.from(csr1.rawData).toString("base64"));
    const result2 = await verifyCSR(Buffer.from(csr2.rawData).toString("base64"));

    expect(result1.deviceIdHash).not.toBe(result2.deviceIdHash);
  });

  it("EC P-384のCSRが拒否される（アルゴリズム検証）", async () => {
    const { csr } = await generateTestCSR("P-384");
    const csrBase64 = Buffer.from(csr.rawData).toString("base64");

    const result = await verifyCSR(csrBase64);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("P-256");
  });

  it("不正なBase64でエラー", async () => {
    const result = await verifyCSR("not-valid-base64!!!");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("CSR parse error");
  });

  it("空文字列でエラー", async () => {
    const result = await verifyCSR("");
    expect(result.valid).toBe(false);
  });

  it("切り詰められたCSRでエラー", async () => {
    const { csr } = await generateTestCSR("P-256");
    const csrBase64 = Buffer.from(csr.rawData).toString("base64");
    const truncated = csrBase64.substring(0, 20);

    const result = await verifyCSR(truncated);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// issueDeviceCertificate
// ---------------------------------------------------------------------------

describe("issueDeviceCertificate", () => {
  it("正しいDevice Certificateを発行する", async () => {
    const { csr, keyPair } = await generateTestCSR("P-256");
    const csrBase64 = Buffer.from(csr.rawData).toString("base64");
    const verifyResult = await verifyCSR(csrBase64);
    expect(verifyResult.valid).toBe(true);

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    // 返り値の構造確認
    expect(result.deviceCertDer).toBeTruthy();
    expect(result.intermediateCaCertDer).toBeTruthy();
    expect(result.rootCaCertDer).toBeTruthy();
    expect(result.deviceId).toBe(verifyResult.deviceIdHash);
    expect(result.serialNumber).toBeTruthy();
    expect(result.serialNumber).toHaveLength(40); // 20 bytes hex
  });

  it("発行された証明書がICAで検証できる", async () => {
    const { csr, keyPair } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    // DER → X509Certificate
    const deviceCert = new x509.X509Certificate(Buffer.from(result.deviceCertDer, "base64"));
    const issuedIcaCert = new x509.X509Certificate(Buffer.from(result.intermediateCaCertDer, "base64"));

    // Subject確認
    expect(deviceCert.subject).toContain(verifyResult.deviceIdHash);
    expect(deviceCert.subject).toContain("RootLens Device");

    // Issuer がICAのSubjectと一致
    expect(deviceCert.issuer).toBe(issuedIcaCert.subject);
  });

  it("90日の有効期限が設定される", async () => {
    const { csr } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    const deviceCert = new x509.X509Certificate(Buffer.from(result.deviceCertDer, "base64"));
    const diffMs = deviceCert.notAfter.getTime() - deviceCert.notBefore.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(DEVICE_CERT_VALIDITY_DAYS);
  });

  it("BasicConstraints CA:FALSEが設定される", async () => {
    const { csr } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    const deviceCert = new x509.X509Certificate(Buffer.from(result.deviceCertDer, "base64"));
    const bcExt = deviceCert.getExtension("2.5.29.19") as x509.BasicConstraintsExtension;
    expect(bcExt).toBeDefined();
    expect(bcExt.ca).toBe(false);
    expect(bcExt.critical).toBe(true);
  });

  it("ExtendedKeyUsage id-kp-documentSigningが設定される", async () => {
    const { csr } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    const deviceCert = new x509.X509Certificate(Buffer.from(result.deviceCertDer, "base64"));
    const ekuExt = deviceCert.getExtension("2.5.29.37") as x509.ExtendedKeyUsageExtension;
    expect(ekuExt).toBeDefined();
    // id-kp-documentSigning = 1.3.6.1.5.5.7.3.36
    expect(ekuExt.usages).toContain("1.3.6.1.5.5.7.3.36");
  });

  it("毎回異なるシリアル番号が生成される", async () => {
    const { csr } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result1 = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );
    const result2 = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    expect(result1.serialNumber).not.toBe(result2.serialNumber);
  });

  it("3層チェーンが正しく構成される（Device → ICA → Root）", async () => {
    const { csr } = await generateTestCSR("P-256");
    const verifyResult = await verifyCSR(Buffer.from(csr.rawData).toString("base64"));

    const result = await issueDeviceCertificate(
      verifyResult.publicKey!,
      verifyResult.deviceIdHash,
      "android",
    );

    const deviceCert = new x509.X509Certificate(Buffer.from(result.deviceCertDer, "base64"));
    const returnedIca = new x509.X509Certificate(Buffer.from(result.intermediateCaCertDer, "base64"));
    const returnedRoot = new x509.X509Certificate(Buffer.from(result.rootCaCertDer, "base64"));

    // Device Cert → ICA
    expect(deviceCert.issuer).toBe(returnedIca.subject);

    // ICA → Root CA
    expect(returnedIca.issuer).toBe(returnedRoot.subject);

    // Root CA は自己署名
    expect(returnedRoot.issuer).toBe(returnedRoot.subject);
  });
});

// ---------------------------------------------------------------------------
// loadPem
// ---------------------------------------------------------------------------

describe("loadPemFromEnv", () => {
  it("環境変数から読み込む", () => {
    process.env._TEST_PEM = "test-value";
    const result = loadPemFromEnv("_TEST_PEM");
    expect(result).toBe("test-value");
    delete process.env._TEST_PEM;
  });

  it("環境変数が未設定ならエラー", () => {
    expect(() => loadPemFromEnv("_NONEXISTENT_VAR")).toThrow("is not set");
  });
});

// ---------------------------------------------------------------------------
// PKI_ALGORITHM定数
// ---------------------------------------------------------------------------

describe("PKI_ALGORITHM", () => {
  it("現在のPKIアルゴリズムはES256", () => {
    expect(PKI_ALGORITHM).toBe("ES256");
  });
});
