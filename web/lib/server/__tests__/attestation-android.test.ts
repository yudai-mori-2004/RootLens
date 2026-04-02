/**
 * Android Key Attestation 検証のテスト
 *
 * テスト用のKey Attestation チェーンを動的に生成し、
 * パーサーとチェーン検証ロジックを網羅する。
 *
 * Note: 実際のGoogle Root CAで署名されたチェーンは生成できないため、
 * テスト用Root CA → テスト用Intermediate → テスト用Leaf のチェーンを使い、
 * verifyChainRoot のみ別途テストする。
 */

import { describe, it, expect } from "vitest";
import * as x509 from "@peculiar/x509";
import * as asn1js from "asn1js";
import crypto from "crypto";
import {
  parseKeyAttestationExtension,
  verifyKeyAttestationChain,
  SecurityLevel,
  securityLevelToString,
  verifyAndroidAttestation,
} from "../attestation-android";

x509.cryptoProvider.set(crypto.webcrypto as Crypto);

// ---------------------------------------------------------------------------
// Key Attestation Extension ASN.1 ビルダー（テスト用）
// ---------------------------------------------------------------------------

/**
 * テスト用のKey Attestation Extension DER値を構築する。
 *
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion       INTEGER,
 *   attestationSecurityLevel ENUMERATED,
 *   keymasterVersion         INTEGER,
 *   keymasterSecurityLevel   ENUMERATED,
 *   attestationChallenge     OCTET STRING,
 *   uniqueId                 OCTET STRING,
 *   softwareEnforced         SEQUENCE {},
 *   teeEnforced              SEQUENCE {},
 * }
 */
function buildKeyAttestationExtension(opts: {
  attestationSecurityLevel: SecurityLevel;
  keymasterSecurityLevel: SecurityLevel;
  challenge: Uint8Array;
}): ArrayBuffer {
  const seq = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 200 }),                                      // attestationVersion
      new asn1js.Enumerated({ value: opts.attestationSecurityLevel }),          // attestationSecurityLevel
      new asn1js.Integer({ value: 200 }),                                      // keymasterVersion
      new asn1js.Enumerated({ value: opts.keymasterSecurityLevel }),            // keymasterSecurityLevel
      new asn1js.OctetString({ valueHex: opts.challenge }),                    // attestationChallenge
      new asn1js.OctetString({ valueHex: new Uint8Array(0) }),                 // uniqueId
      new asn1js.Sequence({ value: [] }),                                      // softwareEnforced
      new asn1js.Sequence({ value: [] }),                                      // teeEnforced
    ],
  });
  return seq.toBER(false);
}

// ---------------------------------------------------------------------------
// テスト用チェーン生成
// ---------------------------------------------------------------------------

const KEY_ATTESTATION_OID = "1.3.6.1.4.1.11129.2.1.17";

async function generateTestAttestationChain(opts: {
  securityLevel?: SecurityLevel;
  challenge?: Uint8Array;
} = {}): Promise<{
  chain: x509.X509Certificate[];
  chainBase64: string[];
  rootKeyPair: CryptoKeyPair;
}> {
  const securityLevel = opts.securityLevel ?? SecurityLevel.TRUSTED_ENVIRONMENT;
  const challenge = opts.challenge ?? crypto.getRandomValues(new Uint8Array(32));

  // Root CA
  const rootKP = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const rootCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Test Attestation Root",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    keys: rootKP,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.BasicConstraintsExtension(true, 2, true),
    ],
  });

  // Intermediate
  const intKP = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const intCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Test Attestation Intermediate",
    issuer: rootCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: intKP.publicKey,
    signingKey: rootKP.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
    ],
  });

  // Leaf（Key Attestation Extension付き）
  const leafKP = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const attExtValue = buildKeyAttestationExtension({
    attestationSecurityLevel: securityLevel,
    keymasterSecurityLevel: securityLevel,
    challenge,
  });

  const leafCert = await x509.X509CertificateGenerator.create({
    serialNumber: "03",
    subject: "CN=Test Attestation Leaf",
    issuer: intCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: leafKP.publicKey,
    signingKey: intKP.privateKey,
    extensions: [
      new x509.Extension(KEY_ATTESTATION_OID, false, new Uint8Array(attExtValue)),
    ],
  });

  const chain = [leafCert, intCert, rootCert];
  const chainBase64 = chain.map((c) => Buffer.from(c.rawData).toString("base64"));

  return { chain, chainBase64, rootKeyPair: rootKP };
}

// ---------------------------------------------------------------------------
// parseKeyAttestationExtension テスト
// ---------------------------------------------------------------------------

describe("parseKeyAttestationExtension", () => {
  it("TEEレベルのattestation extensionをパースできる", async () => {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const { chain } = await generateTestAttestationChain({
      securityLevel: SecurityLevel.TRUSTED_ENVIRONMENT,
      challenge,
    });

    const result = parseKeyAttestationExtension(chain[0]);
    expect(result).not.toBeNull();
    expect(result!.attestationSecurityLevel).toBe(SecurityLevel.TRUSTED_ENVIRONMENT);
    expect(result!.keymasterSecurityLevel).toBe(SecurityLevel.TRUSTED_ENVIRONMENT);
    expect(Buffer.from(result!.attestationChallenge).toString("hex"))
      .toBe(Buffer.from(challenge).toString("hex"));
  });

  it("StrongBoxレベルをパースできる", async () => {
    const { chain } = await generateTestAttestationChain({
      securityLevel: SecurityLevel.STRONGBOX,
    });

    const result = parseKeyAttestationExtension(chain[0]);
    expect(result).not.toBeNull();
    expect(result!.attestationSecurityLevel).toBe(SecurityLevel.STRONGBOX);
  });

  it("SOFTWAREレベルをパースできる", async () => {
    const { chain } = await generateTestAttestationChain({
      securityLevel: SecurityLevel.SOFTWARE,
    });

    const result = parseKeyAttestationExtension(chain[0]);
    expect(result).not.toBeNull();
    expect(result!.attestationSecurityLevel).toBe(SecurityLevel.SOFTWARE);
  });

  it("attestation extensionがない証明書ではnullを返す", async () => {
    // Extension なしの普通の証明書
    const kp = await crypto.webcrypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "99",
      name: "CN=No Attestation",
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      keys: kp,
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    });

    const result = parseKeyAttestationExtension(cert);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyKeyAttestationChain テスト（Google Root CAマッチを除く）
// ---------------------------------------------------------------------------

describe("verifyKeyAttestationChain", () => {
  it("チェーンが短すぎる場合エラー", async () => {
    const result = await verifyKeyAttestationChain([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least 2");
  });

  it("1証明書のチェーンはエラー", async () => {
    const { chainBase64 } = await generateTestAttestationChain();
    const result = await verifyKeyAttestationChain([chainBase64[0]]);
    expect(result.valid).toBe(false);
  });

  it("Google Root CAにマッチしないチェーンは拒否される", async () => {
    const { chainBase64 } = await generateTestAttestationChain();

    // テスト用Root CAはGoogle Root CAではないため拒否される
    const result = await verifyKeyAttestationChain(chainBase64);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// verifyAndroidAttestation 統合テスト
// ---------------------------------------------------------------------------

describe("verifyAndroidAttestation", () => {
  it("key_attestation_chainが空の場合エラー", async () => {
    const result = await verifyAndroidAttestation("dGVzdA==", {
      key_attestation_chain: [],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("key_attestation_chain");
  });

  it("テスト用チェーン（非Google Root CA）は拒否される", async () => {
    const { chainBase64 } = await generateTestAttestationChain();
    const result = await verifyAndroidAttestation("dGVzdA==", {
      key_attestation_chain: chainBase64,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// securityLevelToString テスト
// ---------------------------------------------------------------------------

describe("securityLevelToString", () => {
  it("各レベルを正しく変換する", () => {
    expect(securityLevelToString(SecurityLevel.SOFTWARE)).toBe("software");
    expect(securityLevelToString(SecurityLevel.TRUSTED_ENVIRONMENT)).toBe("tee");
    expect(securityLevelToString(SecurityLevel.STRONGBOX)).toBe("strongbox");
  });
});
