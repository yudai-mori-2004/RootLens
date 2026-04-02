/**
 * Android Platform Attestation 検証
 * 仕様書 §4.4.3 証明書発行API — サーバー側検証ロジック
 *
 * 2段階の検証:
 *   1. Key Attestation: ハードウェアが署名した証明書チェーンを検証
 *   2. Play Integrity: Google API経由でデバイス整合性を検証
 *
 * 暗号アルゴリズム抽象化: crypto.ts の方針に従い、
 * 署名検証アルゴリズムはハードコードせず定数で管理。
 */

import * as x509 from "@peculiar/x509";
import * as asn1js from "asn1js";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Google Hardware Attestation Root CAs（ピン留め）
// ---------------------------------------------------------------------------

// https://developer.android.com/privacy-and-security/security-key-attestation#root_certificate
// 3種類のRoot CAを信頼: Legacy RSA (〜2026/5), Current RSA (〜2042), New ECC/RKP (〜2035)
// 全Root CAは https://android.googleapis.com/attestation/root からも取得可能

// Current RSA Root CA (2022-2042)
const GOOGLE_ROOT_CA_RSA_PEM = `-----BEGIN CERTIFICATE-----
MIIFHDCCAwSgAwIBAgIJAPHBcqaZ6vUdMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMjIwMzIwMTgwNzQ4WhcNNDIwMzE1MTgw
NzQ4WjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B
AQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xUFmOr75gvMsd/dTEDDJdS
Sxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5jlRfdnJLmN0pTy/4lj4/7
tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y//0rb+T+W8a9nsNL/ggj
nar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73XpXyTqRxB/M0n1n/W9nGq
C4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYImQQcHtGl/m00QLVWutHQ
oVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB+TxywElgS70vE0XmLD+O
JtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7quvmag8jfPioyKvxnK/Eg
sTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgpZrt3i5MIlCaY504LzSRi
igHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7gLiMm0jhO2B6tUXHI/+M
RPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82ixPvZtXQpUpuL12ab+9E
aDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+NpUFgNPN9PvQi8WEg5Um
AGMCAwEAAaNjMGEwHQYDVR0OBBYEFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMB8GA1Ud
IwQYMBaAFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMA8GA1UdEwEB/wQFMAMBAf8wDgYD
VR0PAQH/BAQDAgIEMA0GCSqGSIb3DQEBCwUAA4ICAQB8cMqTllHc8U+qCrOlg3H7
174lmaCsbo/bJ0C17JEgMLb4kvrqsXZs01U3mB/qABg/1t5Pd5AORHARs1hhqGIC
W/nKMav574f9rZN4PC2ZlufGXb7sIdJpGiO9ctRhiLuYuly10JccUZGEHpHSYM2G
tkgYbZba6lsCPYAAP83cyDV+1aOkTf1RCp/lM0PKvmxYN10RYsK631jrleGdcdkx
oSK//mSQbgcWnmAEZrzHoF1/0gso1HZgIn0YLzVhLSA/iXCX4QT2h3J5z3znluKG
1nv8NQdxei2DIIhASWfu804CA96cQKTTlaae2fweqXjdN1/v2nqOhngNyz1361mF
mr4XmaKH/ItTwOe72NI9ZcwS1lVaCvsIkTDCEXdm9rCNPAY10iTunIHFXRh+7KPz
lHGewCq/8TOohBRn0/NNfh7uRslOSZ/xKbN9tMBtw37Z8d2vvnXq/YWdsm1+JLVw
n6yYD/yacNJBlwpddla8eaVMjsF6nBnIgQOf9zKSe06nSTqvgwUHosgOECZJZ1Eu
zbH4yswbt02tKtKEFhx+v+OTge/06V+jGsqTWLsfrOCNLuA8H++z+pUENmpqnnHo
vaI47gC+TNpkgYGkkBT6B/m/U01BuOBBTzhIlMEZq9qkDWuM2cA5kW5V3FJUcfHn
w1IdYIg2Wxg7yHcQZemFQg==
-----END CERTIFICATE-----`;

// New ECC Root CA for RKP devices (2025-2035)
const GOOGLE_ROOT_CA_ECC_PEM = `-----BEGIN CERTIFICATE-----
MIICIjCCAaigAwIBAgIRAISp0Cl7DrWK5/8OgN52BgUwCgYIKoZIzj0EAwMwUjEc
MBoGA1UEAwwTS2V5IEF0dGVzdGF0aW9uIENBMTEQMA4GA1UECwwHQW5kcm9pZDET
MBEGA1UECgwKR29vZ2xlIExMQzELMAkGA1UEBhMCVVMwHhcNMjUwNzE3MjIzMjE4
WhcNMzUwNzE1MjIzMjE4WjBSMRwwGgYDVQQDDBNLZXkgQXR0ZXN0YXRpb24gQ0Ex
MRAwDgYDVQQLDAdBbmRyb2lkMRMwEQYDVQQKDApHb29nbGUgTExDMQswCQYDVQQG
EwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABCPaI3FO3z5bBQo8cuiEas4HjqCt
G/mLFfRT0MsIssPBEEU5Cfbt6sH5yOAxqEi5QagpU1yX4HwnGb7OtBYpDTB57uH5
Eczm34A5FNijV3s0/f0UPl7zbJcTx6xwqMIRq6NCMEAwDwYDVR0TAQH/BAUwAwEB
/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFFIyuyz7RkOb3NaBqQ5lZuA0QepA
MAoGCCqGSM49BAMDA2gAMGUCMETfjPO/HwqReR2CS7p0ZWoD/LHs6hDi422opifH
EUaYLxwGlT9SLdjkVpz0UUOR5wIxAIoGyxGKRHVTpqpGRFiJtQEOOTp/+s1GcxeY
uR2zh/80lQyu9vAFCj6E4AXc+osmRg==
-----END CERTIFICATE-----`;

// OID for Key Attestation Extension
const KEY_ATTESTATION_OID = "1.3.6.1.4.1.11129.2.1.17";

// ---------------------------------------------------------------------------
// SecurityLevel 定義
// ---------------------------------------------------------------------------

export enum SecurityLevel {
  SOFTWARE = 0,
  TRUSTED_ENVIRONMENT = 1,
  STRONGBOX = 2,
}

export function securityLevelToString(level: SecurityLevel): string {
  switch (level) {
    case SecurityLevel.SOFTWARE: return "software";
    case SecurityLevel.TRUSTED_ENVIRONMENT: return "tee";
    case SecurityLevel.STRONGBOX: return "strongbox";
    default: return `unknown(${level})`;
  }
}

// ---------------------------------------------------------------------------
// Key Attestation Extension パース結果
// ---------------------------------------------------------------------------

export interface KeyAttestationResult {
  attestationVersion: number;
  attestationSecurityLevel: SecurityLevel;
  keymasterSecurityLevel: SecurityLevel;
  attestationChallenge: Uint8Array;
  // softwareEnforced / teeEnforced は必要なフィールドのみ抽出
}

// ---------------------------------------------------------------------------
// 証明書チェーン検証
// ---------------------------------------------------------------------------

/**
 * Android Key Attestation チェーンを検証する。
 *
 * CSRとの紐づけはattestation cert[0]の公開鍵とCSRの公開鍵の一致で保証される。
 * attestationChallengeはAndroid APIの制約上、鍵生成時にしか設定できないため
 * SHA-256(CSR) にはできない（循環依存）。公開鍵一致で同等の安全性を実現。
 *
 * @param chainDerBase64 DER形式の証明書配列（leaf → intermediate → root の順）
 * @param csrPublicKeySpki CSRの公開鍵SPKI DER（attestation certとの紐づけ検証用）
 * @returns 検証結果
 */
export async function verifyKeyAttestationChain(
  chainDerBase64: string[],
  csrPublicKeySpki?: Uint8Array,
): Promise<{
  valid: boolean;
  securityLevel?: string;
  error?: string;
}> {
  if (!chainDerBase64.length || chainDerBase64.length < 2) {
    return { valid: false, error: "Attestation chain must have at least 2 certificates" };
  }

  try {
    // DER → X509Certificate
    const chain = chainDerBase64.map((b64) => new x509.X509Certificate(Buffer.from(b64, "base64")));

    // 1. チェーンの最後がGoogle Root CAにマッチするか確認
    const rootVerified = await verifyChainRoot(chain);
    if (!rootVerified.valid) {
      return rootVerified;
    }

    // 2. チェーン内の各証明書の署名を検証（leaf → ... → root）
    const chainVerified = await verifyChainSignatures(chain);
    if (!chainVerified.valid) {
      return chainVerified;
    }

    // 3. Leaf証明書のKey Attestation Extensionをパース
    const leafCert = chain[0];
    const attestation = parseKeyAttestationExtension(leafCert);
    if (!attestation) {
      return { valid: false, error: "Key Attestation extension not found in leaf certificate" };
    }

    // 4. attestationSecurityLevel が SOFTWARE でないことを確認
    if (attestation.attestationSecurityLevel === SecurityLevel.SOFTWARE) {
      return {
        valid: false,
        error: "Attestation security level is SOFTWARE — hardware-backed key required",
      };
    }

    // 5. attestation cert[0] の公開鍵とCSRの公開鍵の一致を検証（暗号的紐づけ）
    //    challengeベースの紐づけはAndroid APIの循環依存により不可能。
    //    公開鍵一致はGoogle Root CAが署名したattestation certを偽造できない限り安全。
    if (csrPublicKeySpki) {
      const attestPubKey = await leafCert.publicKey.export();
      const attestPubKeySpki = new Uint8Array(
        await crypto.webcrypto.subtle.exportKey("spki", attestPubKey),
      );
      if (!bufferEqual(attestPubKeySpki, csrPublicKeySpki)) {
        return {
          valid: false,
          error: "Attestation certificate public key does not match CSR public key",
        };
      }
    }

    return {
      valid: true,
      securityLevel: securityLevelToString(attestation.attestationSecurityLevel),
    };
  } catch (e) {
    return { valid: false, error: `Attestation verification error: ${e}` };
  }
}

// ---------------------------------------------------------------------------
// チェーンルート検証
// ---------------------------------------------------------------------------

async function verifyChainRoot(
  chain: x509.X509Certificate[],
): Promise<{ valid: boolean; error?: string }> {
  const rootCert = chain[chain.length - 1];

  // Google Root CA (RSA and ECC) を信頼アンカーとして使用
  const trustedRoots = [
    new x509.X509Certificate(GOOGLE_ROOT_CA_RSA_PEM),
    new x509.X509Certificate(GOOGLE_ROOT_CA_ECC_PEM),
  ];

  for (const trustedRoot of trustedRoots) {
    if (bufferEqual(
      new Uint8Array(rootCert.rawData),
      new Uint8Array(trustedRoot.rawData),
    )) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    error: "Attestation chain root does not match any Google Hardware Attestation Root CA",
  };
}

// ---------------------------------------------------------------------------
// チェーン署名検証
// ---------------------------------------------------------------------------

async function verifyChainSignatures(
  chain: x509.X509Certificate[],
): Promise<{ valid: boolean; error?: string }> {
  for (let i = 0; i < chain.length - 1; i++) {
    const cert = chain[i];
    const issuerCert = chain[i + 1];

    try {
      const valid = await cert.verify({ publicKey: await issuerCert.publicKey.export() });
      if (!valid) {
        return {
          valid: false,
          error: `Certificate chain verification failed at index ${i}: signature invalid`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        error: `Certificate chain verification failed at index ${i}: ${e}`,
      };
    }
  }

  // Root CA は自己署名を検証
  const root = chain[chain.length - 1];
  try {
    const rootValid = await root.verify({ publicKey: await root.publicKey.export() });
    if (!rootValid) {
      return { valid: false, error: "Root CA self-signature verification failed" };
    }
  } catch (e) {
    return { valid: false, error: `Root CA self-signature verification failed: ${e}` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Key Attestation Extension パーサー
// ---------------------------------------------------------------------------

/**
 * Key Attestation Extension (OID 1.3.6.1.4.1.11129.2.1.17) をパースする。
 *
 * ASN.1 構造:
 *   KeyDescription ::= SEQUENCE {
 *     attestationVersion       INTEGER,
 *     attestationSecurityLevel SecurityLevel,  -- ENUMERATED
 *     keymasterVersion         INTEGER,
 *     keymasterSecurityLevel   SecurityLevel,
 *     attestationChallenge     OCTET STRING,
 *     uniqueId                 OCTET STRING,
 *     softwareEnforced         AuthorizationList,
 *     teeEnforced              AuthorizationList,
 *   }
 */
export function parseKeyAttestationExtension(
  cert: x509.X509Certificate,
): KeyAttestationResult | null {
  const ext = cert.getExtension(KEY_ATTESTATION_OID);
  if (!ext) return null;

  // Extension value は OCTET STRING でラップされている
  const extValue = ext.value;
  const asn1 = asn1js.fromBER(extValue);
  if (asn1.offset === -1) return null;

  const seq = asn1.result;
  if (!(seq instanceof asn1js.Sequence) || seq.valueBlock.value.length < 6) {
    return null;
  }

  const items = seq.valueBlock.value;

  const attestationVersion = (items[0] as asn1js.Integer).valueBlock.valueDec;
  const attestationSecurityLevel = (items[1] as asn1js.Enumerated).valueBlock.valueDec as SecurityLevel;
  const keymasterVersion = (items[2] as asn1js.Integer).valueBlock.valueDec;
  const keymasterSecurityLevel = (items[3] as asn1js.Enumerated).valueBlock.valueDec as SecurityLevel;
  const attestationChallenge = new Uint8Array((items[4] as asn1js.OctetString).valueBlock.valueHexView);

  return {
    attestationVersion,
    attestationSecurityLevel,
    keymasterSecurityLevel,
    attestationChallenge,
  };
}

// ---------------------------------------------------------------------------
// Play Integrity Token 検証
// ---------------------------------------------------------------------------

/**
 * Google Play Integrity Token を検証する。
 *
 * サーバー間API: Google Play Integrity API で トークンをデコード。
 * 要件:
 *   - requestPackageName = RootLens パッケージ名
 *   - nonce = Base64(SHA-256(CSR))
 *   - deviceRecognitionVerdict に MEETS_DEVICE_INTEGRITY を含む
 */
export async function verifyPlayIntegrityToken(
  token: string,
  expectedNonce: string,
  packageName: string = "io.rootlens.app",
): Promise<{ valid: boolean; error?: string }> {
  const googleProjectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
  if (!googleProjectNumber) {
    return { valid: false, error: "GOOGLE_CLOUD_PROJECT_NUMBER not configured" };
  }

  try {
    // Google Play Integrity API でトークンをデコード
    // https://developer.android.com/google/play/integrity/verdict#decrypt-verify
    const response = await fetch(
      `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${await getGoogleAccessToken()}`,
        },
        body: JSON.stringify({ integrity_token: token }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      return { valid: false, error: `Play Integrity API error: ${response.status} ${body}` };
    }

    const result = await response.json();
    const payload = result.tokenPayloadExternal;

    if (!payload) {
      return { valid: false, error: "No token payload in Play Integrity response" };
    }

    // nonce 検証
    if (payload.requestDetails?.nonce !== expectedNonce) {
      return { valid: false, error: "Play Integrity nonce mismatch" };
    }

    // パッケージ名検証
    if (payload.appIntegrity?.packageName !== packageName) {
      return { valid: false, error: "Play Integrity package name mismatch" };
    }

    // デバイス整合性検証
    const deviceVerdict = payload.deviceIntegrity?.deviceRecognitionVerdict || [];
    if (!deviceVerdict.includes("MEETS_DEVICE_INTEGRITY")) {
      return {
        valid: false,
        error: `Device integrity check failed: ${deviceVerdict.join(", ") || "empty"}`,
      };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Play Integrity verification error: ${e}` };
  }
}

// ---------------------------------------------------------------------------
// 統合: Android Attestation 全体検証
// ---------------------------------------------------------------------------

export interface AndroidAttestationInput {
  key_attestation_chain: string[];   // DER Base64 配列
  play_integrity_token?: string;     // Play Integrity Token（将来必須化）
}

/**
 * Android Platform Attestation を検証する（Key Attestation + Play Integrity）。
 *
 * @param csrBase64 CSR（Base64 DER）
 * @param attestation Key Attestation chain + Play Integrity token
 * @returns 検証結果（securityLevel を含む）
 */
/**
 * Android Platform Attestation を検証する（Key Attestation + Play Integrity）。
 *
 * @param csrBase64 CSR（Base64 DER）
 * @param attestation Key Attestation chain + Play Integrity token
 * @param csrPublicKeySpki CSR公開鍵のSPKI DER（attestation certとの紐づけ検証用、省略時はスキップ）
 * @returns 検証結果（securityLevel を含む）
 */
export async function verifyAndroidAttestation(
  csrBase64: string,
  attestation: AndroidAttestationInput,
  csrPublicKeySpki?: Uint8Array,
): Promise<{
  valid: boolean;
  securityLevel?: string;
  error?: string;
}> {
  const csrDer = Buffer.from(csrBase64, "base64");

  // 1. Key Attestation チェーン検証（公開鍵一致で紐づけ）
  if (!attestation.key_attestation_chain || attestation.key_attestation_chain.length < 2) {
    return { valid: false, error: "key_attestation_chain is required and must have at least 2 certificates" };
  }

  const keyAttResult = await verifyKeyAttestationChain(
    attestation.key_attestation_chain,
    csrPublicKeySpki,
  );
  if (!keyAttResult.valid) {
    return keyAttResult;
  }

  // 2. Play Integrity Token 検証（nonce = SHA-256(CSR) — PIはCSR作成後に呼べるため可能）
  if (attestation.play_integrity_token && process.env.GOOGLE_CLOUD_PROJECT_NUMBER) {
    const csrHash = crypto.createHash("sha256").update(csrDer).digest();
    const nonce = Buffer.from(csrHash).toString("base64");
    const piResult = await verifyPlayIntegrityToken(
      attestation.play_integrity_token,
      nonce,
    );
    if (!piResult.valid) {
      return piResult;
    }
  }

  return {
    valid: true,
    securityLevel: keyAttResult.securityLevel,
  };
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function bufferEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Google Cloud Access Token 取得（Application Default Credentials） */
async function getGoogleAccessToken(): Promise<string> {
  // 本番では ADC (Application Default Credentials) を使用
  // Vercel等ではサービスアカウントキーを環境変数で設定
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (token) return token;

  // TODO: Google Auth Library を使った自動トークン取得
  throw new Error("GOOGLE_ACCESS_TOKEN not configured. Set up ADC or provide token.");
}
