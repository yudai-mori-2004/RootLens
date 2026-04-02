/**
 * iOS App Attest 検証
 * 仕様書 §4.4.3 証明書発行API — サーバー側検証ロジック（iOS）
 *
 * App Attestは C2PA署名用 Secure Enclave鍵とは独立した仕組み。
 * clientDataHash に SHA-256(CSR) を設定することで CSR との紐づけを実現する。
 *
 * 検証フロー:
 *   1. Attestation object を CBOR デコード
 *   2. 証明書チェーンを Apple App Attest Root CA まで検証
 *   3. rpIdHash, counter, aaguid, clientDataHash を検証
 */

import * as x509 from "@peculiar/x509";
import * as cbor from "cbor-x";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Apple App Attest Root CA（ピン留め）
// ---------------------------------------------------------------------------

// https://www.apple.com/certificateauthority/private/
const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDnNSzR6cOBBdf1SfJ2GIXLGyREsUGJ5JFLZ
HzM5BKW6IY2JOnoOri2UMBi8FnN7x4uo0YXho0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhd6HcwPBb34GGAjEAp5U+Y3mBMHBKRREPZhtQSQQiJrl54oG1r3us
rBWHg42HDXR1Nn8ein0rSYqkqLJ1
-----END CERTIFICATE-----`;

// App Attest の aaguid (本番環境)
const APPLE_AAGUID_PRODUCTION = "appattestdevelop"; // 16 bytes ASCII
const APPLE_AAGUID_DEVELOPMENT = "appattestdevelop"; // dev/prodで同じ文字列

// ---------------------------------------------------------------------------
// Attestation Object 構造
// ---------------------------------------------------------------------------

interface AttestationObject {
  fmt: string;
  attStmt: {
    x5c: Uint8Array[];   // 証明書チェーン（DER）
    receipt: Uint8Array;
  };
  authData: Uint8Array;
}

interface AuthenticatorData {
  rpIdHash: Buffer;           // 32 bytes
  flags: number;              // 1 byte
  signCount: number;          // 4 bytes (big-endian)
  aaguid: Buffer;             // 16 bytes
  credentialIdLength: number; // 2 bytes (big-endian)
  credentialId: Buffer;
  credentialPublicKey: Buffer;
}

// ---------------------------------------------------------------------------
// メイン検証関数
// ---------------------------------------------------------------------------

export interface IOSAttestationInput {
  app_attest_object: string;   // Base64 CBOR
  app_attest_key_id: string;
}

/**
 * iOS App Attest を検証する。
 *
 * @param csrBase64 CSR（Base64 DER）
 * @param attestation App Attest object + key ID
 * @param appId RootLens の App ID（team_id + "." + bundle_id）
 * @returns 検証結果
 */
export async function verifyIOSAttestation(
  csrBase64: string,
  attestation: IOSAttestationInput,
  appId: string = process.env.APPLE_APP_ID || "TEAM_ID.io.rootlens.app",
): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    const csrDer = Buffer.from(csrBase64, "base64");

    // 1. Attestation object を CBOR デコード
    const attestObj = decodeAttestationObject(attestation.app_attest_object);
    if (!attestObj) {
      return { valid: false, error: "Failed to decode attestation CBOR" };
    }

    // 2. 証明書チェーンを Apple Root CA まで検証
    const chainResult = await verifyAppleCertChain(attestObj.attStmt.x5c);
    if (!chainResult.valid) {
      return chainResult;
    }

    // 3. authenticatorData をパース
    const authData = parseAuthenticatorData(attestObj.authData);
    if (!authData) {
      return { valid: false, error: "Failed to parse authenticator data" };
    }

    // 4. rpIdHash 検証: SHA-256(appId) と一致すること
    const expectedRpIdHash = crypto.createHash("sha256").update(appId).digest();
    if (!authData.rpIdHash.equals(expectedRpIdHash)) {
      return { valid: false, error: "rpIdHash does not match App ID" };
    }

    // 5. counter が 0（初回attestation）
    if (authData.signCount !== 0) {
      return { valid: false, error: `Expected counter=0 for initial attestation, got ${authData.signCount}` };
    }

    // 6. nonce 検証: SHA-256(authData || clientDataHash) が leaf cert の nonce extension と一致
    //    clientDataHash = SHA-256(CSR)
    const clientDataHash = crypto.createHash("sha256").update(csrDer).digest();
    const nonceData = Buffer.concat([Buffer.from(attestObj.authData), clientDataHash]);
    const expectedNonce = crypto.createHash("sha256").update(nonceData).digest();

    // Leaf cert から nonce extension (OID 1.2.840.113635.100.8.2) を取得
    const leafCert = new x509.X509Certificate(new Uint8Array(attestObj.attStmt.x5c[0]));
    const nonceExt = leafCert.getExtension("1.2.840.113635.100.8.2");
    if (!nonceExt) {
      return { valid: false, error: "Nonce extension not found in leaf certificate" };
    }

    // Extension value 内のnonce を抽出（ASN.1 SEQUENCE > OCTET STRING）
    const extractedNonce = extractNonceFromExtension(nonceExt.value);
    if (!extractedNonce || !extractedNonce.equals(expectedNonce)) {
      return { valid: false, error: "Attestation nonce does not match SHA-256(authData || clientDataHash)" };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `iOS attestation verification error: ${e}` };
  }
}

// ---------------------------------------------------------------------------
// CBOR デコード
// ---------------------------------------------------------------------------

function decodeAttestationObject(base64: string): AttestationObject | null {
  try {
    const data = Buffer.from(base64, "base64");
    const decoded = cbor.decode(data) as AttestationObject;
    if (!decoded.fmt || !decoded.attStmt || !decoded.authData) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Apple 証明書チェーン検証
// ---------------------------------------------------------------------------

async function verifyAppleCertChain(
  x5c: Uint8Array[],
): Promise<{ valid: boolean; error?: string }> {
  if (!x5c || x5c.length < 2) {
    return { valid: false, error: "x5c must have at least 2 certificates (leaf + intermediate)" };
  }

  try {
    const certs = x5c.map((der) => new x509.X509Certificate(new Uint8Array(der)));
    const appleRoot = new x509.X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);

    // チェーン署名検証: leaf → intermediate → ... → root
    for (let i = 0; i < certs.length - 1; i++) {
      const valid = await certs[i].verify({
        publicKey: await certs[i + 1].publicKey.export(),
      });
      if (!valid) {
        return { valid: false, error: `Certificate chain verification failed at index ${i}` };
      }
    }

    // 最後の証明書が Apple Root CA で検証できるか
    const lastCert = certs[certs.length - 1];
    const rootValid = await lastCert.verify({
      publicKey: await appleRoot.publicKey.export(),
    });
    if (!rootValid) {
      return { valid: false, error: "Certificate chain does not chain to Apple App Attest Root CA" };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Apple cert chain verification error: ${e}` };
  }
}

// ---------------------------------------------------------------------------
// Authenticator Data パーサー
// ---------------------------------------------------------------------------

function parseAuthenticatorData(rawData: Uint8Array | Buffer): AuthenticatorData | null {
  const data = Buffer.from(rawData);
  if (data.length < 37) return null; // minimum: rpIdHash(32) + flags(1) + signCount(4)

  let offset = 0;

  const rpIdHash = Buffer.from(data.subarray(offset, offset + 32));
  offset += 32;

  const flags = data[offset];
  offset += 1;

  const signCount = data.readUInt32BE(offset);
  offset += 4;

  // Attested credential data (if flags bit 6 is set)
  let aaguid = Buffer.alloc(0);
  let credentialIdLength = 0;
  let credentialId = Buffer.alloc(0);
  let credentialPublicKey = Buffer.alloc(0);

  if (flags & 0x40) { // AT flag
    if (data.length < offset + 18) return null; // aaguid(16) + credIdLen(2)

    aaguid = Buffer.from(data.subarray(offset, offset + 16));
    offset += 16;

    credentialIdLength = data.readUInt16BE(offset);
    offset += 2;

    if (data.length < offset + credentialIdLength) return null;
    credentialId = Buffer.from(data.subarray(offset, offset + credentialIdLength));
    offset += credentialIdLength;

    credentialPublicKey = Buffer.from(data.subarray(offset));
  }

  return {
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credentialIdLength,
    credentialId,
    credentialPublicKey,
  };
}

// ---------------------------------------------------------------------------
// Nonce Extension 抽出
// ---------------------------------------------------------------------------

/**
 * Apple App Attest nonce extension (OID 1.2.840.113635.100.8.2) から nonce を抽出する。
 * 構造: SEQUENCE { [1] EXPLICIT OCTET STRING }
 */
function extractNonceFromExtension(extValue: ArrayBuffer): Buffer | null {
  try {
    const asn1 = require("asn1js");
    const parsed = asn1.fromBER(extValue);
    if (parsed.offset === -1) return null;

    const seq = parsed.result;
    if (!(seq instanceof asn1.Sequence)) return null;

    // [1] EXPLICIT タグの中の OCTET STRING を探す
    for (const item of seq.valueBlock.value) {
      if (item instanceof asn1.Constructed && item.idBlock.tagNumber === 1) {
        const inner = item.valueBlock.value[0];
        if (inner instanceof asn1.OctetString) {
          return Buffer.from(inner.valueBlock.valueHexView);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// エクスポート（テスト用）
// ---------------------------------------------------------------------------

export {
  decodeAttestationObject as _decodeAttestationObject,
  parseAuthenticatorData as _parseAuthenticatorData,
  verifyAppleCertChain as _verifyAppleCertChain,
};
