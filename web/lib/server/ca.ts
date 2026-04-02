/**
 * Root CA + Intermediate CA 鍵管理 + Device Certificate 発行
 * 仕様書 §4.3, §4.4
 *
 * 3層PKI構造:
 *   Root CA → iOS/Android Intermediate CA → Device Certificate
 *
 * 暗号アルゴリズムは CryptoSigner インターフェースで抽象化（crypto.ts参照）。
 * dev環境: LocalEcSigner（ファイルベース鍵）
 * 本番: KmsSigner（AWS KMS）に差し替え
 *
 * 環境変数:
 *   ROOT_CA_CERT_PEM — Root CA 証明書
 *   IOS_INTERMEDIATE_CA_CERT_PEM / IOS_INTERMEDIATE_CA_KEY_PEM — iOS ICA
 *   ANDROID_INTERMEDIATE_CA_CERT_PEM / ANDROID_INTERMEDIATE_CA_KEY_PEM — Android ICA
 *
 * ローカル開発時はファイルからフォールバック。
 */

import * as x509 from "@peculiar/x509";
import crypto from "crypto";

import {
  type CryptoSigner,
  type SigningAlgorithm,
  LocalEcSigner,
  getAlgorithmParams,
  validatePublicKeyAlgorithm,
} from "./crypto";
import { isKmsConfigured, getKmsSigner } from "./crypto-kms";

// @peculiar/x509 が使う Crypto プロバイダを設定（Node.js環境）
x509.cryptoProvider.set(crypto.webcrypto as Crypto);

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** Device Certificate の有効期間（日） */
export const DEVICE_CERT_VALIDITY_DAYS = 90;

/** 現在のPKI署名アルゴリズム */
export const PKI_ALGORITHM: SigningAlgorithm = "ES256";

// ---------------------------------------------------------------------------
// PEM 読み込みユーティリティ
// ---------------------------------------------------------------------------

export function loadPem(envVar: string, fallbackPath?: string): string {
  const envValue = process.env[envVar];
  if (envValue) return envValue;
  if (fallbackPath) {
    const fs = require("fs");
    const path = require("path");
    const resolved = path.resolve(process.cwd(), fallbackPath);
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, "utf-8");
    }
  }
  throw new Error(`${envVar} is not set and fallback not found`);
}

// ---------------------------------------------------------------------------
// Root CA
// ---------------------------------------------------------------------------

let rootCaCert: x509.X509Certificate | null = null;

async function loadRootCaCert(): Promise<x509.X509Certificate> {
  if (rootCaCert) return rootCaCert;
  const certPem = loadPem("ROOT_CA_CERT_PEM", "../certs/dev/root-ca.pem");
  rootCaCert = new x509.X509Certificate(certPem);
  return rootCaCert;
}

// ---------------------------------------------------------------------------
// Intermediate CAs (per-platform)
// ---------------------------------------------------------------------------

interface IntermediateCA {
  cert: x509.X509Certificate;
  signer: CryptoSigner;
}

const intermediateCache: Record<string, IntermediateCA> = {};

async function loadIntermediateCA(platform: "ios" | "android"): Promise<IntermediateCA> {
  if (intermediateCache[platform]) return intermediateCache[platform];

  const prefix = platform === "ios" ? "IOS" : "ANDROID";
  const certPem = loadPem(
    `${prefix}_INTERMEDIATE_CA_CERT_PEM`,
    `../certs/dev/${platform}-intermediate-ca.pem`,
  );
  const cert = new x509.X509Certificate(certPem);

  // KMS Key ID が設定されていれば KmsSigner を使用（本番）
  // 設定されていなければ PEM ファイルから LocalEcSigner（dev）
  let signer: CryptoSigner;
  if (isKmsConfigured(platform)) {
    signer = getKmsSigner(platform);
  } else {
    const keyPem = loadPem(
      `${prefix}_INTERMEDIATE_CA_KEY_PEM`,
      `../certs/dev/${platform}-intermediate-ca-key.pem`,
    );
    signer = await LocalEcSigner.fromPkcs8Pem(keyPem, PKI_ALGORITHM);
  }

  intermediateCache[platform] = { cert, signer };
  return intermediateCache[platform];
}

/** テスト用: キャッシュをクリア */
export function _resetCache(): void {
  rootCaCert = null;
  for (const key of Object.keys(intermediateCache)) {
    delete intermediateCache[key];
  }
}

// ---------------------------------------------------------------------------
// CSR 検証
// ---------------------------------------------------------------------------

export async function verifyCSR(
  csrBase64: string,
): Promise<{
  valid: boolean;
  publicKey: CryptoKey | null;
  deviceIdHash: string;
  error?: string;
}> {
  try {
    const csrDer = Buffer.from(csrBase64, "base64");
    const csr = new x509.Pkcs10CertificateRequest(csrDer);

    // CSR自己署名検証（Proof of Possession）
    const valid = await csr.verify();
    if (!valid) {
      return { valid: false, publicKey: null, deviceIdHash: "", error: "CSR signature verification failed" };
    }

    // 公開鍵を取得
    const publicKey = await csr.publicKey.export();

    // 公開鍵アルゴリズム検証 — EC P-256以外を拒否
    const algCheck = validatePublicKeyAlgorithm(publicKey, PKI_ALGORITHM);
    if (!algCheck.valid) {
      return { valid: false, publicKey: null, deviceIdHash: "", error: algCheck.error };
    }

    // device_id_hash = SHA-256(公開鍵DER)の先頭16文字hex
    const publicKeyDer = await crypto.webcrypto.subtle.exportKey("spki", publicKey);
    const hash = crypto.createHash("sha256").update(Buffer.from(publicKeyDer)).digest("hex");
    const deviceIdHash = hash.substring(0, 16);

    return { valid: true, publicKey, deviceIdHash };
  } catch (e) {
    return {
      valid: false,
      publicKey: null,
      deviceIdHash: "",
      error: `CSR parse error: ${e}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Device Certificate 発行（Intermediate CA で署名）
// ---------------------------------------------------------------------------

export interface IssuedCertificate {
  deviceCertDer: string;           // Base64 DER
  intermediateCaCertDer: string;   // Base64 DER
  rootCaCertDer: string;           // Base64 DER
  deviceId: string;
  serialNumber: string;            // 発行ログ・CRL用
}

export async function issueDeviceCertificate(
  publicKey: CryptoKey,
  deviceIdHash: string,
  platform: "ios" | "android" = "android",
): Promise<IssuedCertificate> {
  const intermediateCa = await loadIntermediateCA(platform);
  const rootCa = await loadRootCaCert();
  const algParams = getAlgorithmParams(PKI_ALGORITHM);

  // §4.3.2 Device Certificate プロファイル
  // 有効期限: 90日（短寿命証明書モデル）
  const now = new Date();
  const notAfter = new Date(now.getTime() + DEVICE_CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const serialNumber = crypto.randomBytes(20).toString("hex");

  const deviceCert = await x509.X509CertificateGenerator.create({
    serialNumber,
    subject: `CN=RootLens Device ${deviceIdHash}, O=RootLens`,
    issuer: intermediateCa.cert.subject,
    notBefore: now,
    notAfter: notAfter,
    signingAlgorithm: { name: algParams.name, hash: algParams.hash },
    publicKey: publicKey,
    // LocalEcSigner → CryptoKey を直接使用
    // KmsSigner の場合は tbsCertificate 手動構築 + KMS Sign が必要（crypto-kms.ts 参照）
    signingKey: intermediateCa.signer instanceof LocalEcSigner
      ? intermediateCa.signer.getCryptoKey()
      : (() => { throw new Error("KMS signing requires manual tbsCertificate construction. See crypto-kms.ts"); })(),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true), // CA:FALSE, critical
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature,
        true, // critical
      ),
      new x509.ExtendedKeyUsageExtension(
        ["1.3.6.1.5.5.7.3.36"], // id-kp-documentSigning
        false,
      ),
      await x509.SubjectKeyIdentifierExtension.create(publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(intermediateCa.cert.publicKey),
    ],
  });

  return {
    deviceCertDer: Buffer.from(deviceCert.rawData).toString("base64"),
    intermediateCaCertDer: Buffer.from(intermediateCa.cert.rawData).toString("base64"),
    rootCaCertDer: Buffer.from(rootCa.rawData).toString("base64"),
    deviceId: deviceIdHash,
    serialNumber,
  };
}

// ---------------------------------------------------------------------------
// 公開情報
// ---------------------------------------------------------------------------

export async function getRootCaCertDer(): Promise<string> {
  const cert = await loadRootCaCert();
  return Buffer.from(cert.rawData).toString("base64");
}
