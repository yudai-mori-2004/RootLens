#!/usr/bin/env node
/**
 * KMS ICA証明書生成スクリプト
 *
 * KMSで生成済みのICA鍵の公開鍵を取得し、
 * 既存のファイルベースRoot CAで署名してICA証明書を発行する。
 *
 * Usage:
 *   node scripts/gen-kms-intermediate-ca.mjs <platform> <kms-key-id>
 *
 * 前提:
 *   - AWS CLI が設定済み（aws configure）
 *   - certs/dev/root-ca.pem と certs/dev/root-ca-key.pem が存在
 *   - KMS鍵が作成済み（ECC_NIST_P256, SIGN_VERIFY）
 *
 * 出力:
 *   certs/prod/<platform>-intermediate-ca.pem  — ICA証明書
 *   標準出力に PEM を表示（環境変数にコピー用）
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

const platform = process.argv[2]; // "ios" | "android"
const kmsKeyId = process.argv[3]; // ARN or Key ID

if (!platform || !kmsKeyId) {
  console.error("Usage: node scripts/gen-kms-intermediate-ca.mjs <ios|android> <kms-key-id>");
  console.error("Example: node scripts/gen-kms-intermediate-ca.mjs android arn:aws:kms:ap-northeast-1:123:key/abc");
  process.exit(1);
}

if (platform !== "ios" && platform !== "android") {
  console.error("Platform must be 'ios' or 'android'");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Root CA の読み込み
// ---------------------------------------------------------------------------

const rootCaCertPath = path.join(ROOT_DIR, "certs/dev/root-ca.pem");
const rootCaKeyPath = path.join(ROOT_DIR, "certs/dev/root-ca-key.pem");

if (!fs.existsSync(rootCaCertPath) || !fs.existsSync(rootCaKeyPath)) {
  console.error("Root CA not found at certs/dev/root-ca.pem and certs/dev/root-ca-key.pem");
  process.exit(1);
}

const rootCaCertPem = fs.readFileSync(rootCaCertPath, "utf-8");
const rootCaKeyPem = fs.readFileSync(rootCaKeyPath, "utf-8");

// ---------------------------------------------------------------------------
// KMS から公開鍵を取得
// ---------------------------------------------------------------------------

console.log(`\n=== ${platform} Intermediate CA (KMS) を生成します ===`);
console.log(`KMS Key ID: ${kmsKeyId}`);

// aws kms get-public-key で DER 形式の公開鍵を取得
const pubKeyResult = execSync(
  `aws kms get-public-key --key-id "${kmsKeyId}" --output json`,
  { encoding: "utf-8" }
);
const pubKeyJson = JSON.parse(pubKeyResult);
const pubKeyDer = Buffer.from(pubKeyJson.PublicKey, "base64");

console.log(`公開鍵取得: ${pubKeyDer.length} bytes (${pubKeyJson.KeySpec})`);

if (pubKeyJson.KeySpec !== "ECC_NIST_P256") {
  console.error(`Error: Key spec is ${pubKeyJson.KeySpec}, expected ECC_NIST_P256`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// @peculiar/x509 で ICA証明書を生成
// ---------------------------------------------------------------------------

async function generateIcaCert() {
  const x509 = await import("@peculiar/x509");
  x509.cryptoProvider.set(crypto.webcrypto);

  // Root CA の秘密鍵をインポート
  const rootKeyDer = x509.PemConverter.decode(rootCaKeyPem)[0];
  const rootKey = await crypto.webcrypto.subtle.importKey(
    "pkcs8",
    rootKeyDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  // Root CA 証明書
  const rootCaCert = new x509.X509Certificate(rootCaCertPem);

  // KMS公開鍵をインポート
  const icaPublicKey = await crypto.webcrypto.subtle.importKey(
    "spki",
    pubKeyDer,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );

  // ICA証明書のSubject
  const caName = platform === "ios" ? "RootLens Dev iOS CA" : "RootLens Dev Android CA";

  // ICA証明書を生成（Root CAで署名）
  const now = new Date();
  const notAfter = new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000); // 5年

  const icaCert = await x509.X509CertificateGenerator.create({
    serialNumber: crypto.randomBytes(20).toString("hex"),
    subject: `CN=${caName}, O=RootLens Dev, C=JP`,
    issuer: rootCaCert.subject,
    notBefore: now,
    notAfter: notAfter,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: icaPublicKey,
    signingKey: rootKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true), // CA:TRUE, pathlen:0
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(icaPublicKey),
      await x509.AuthorityKeyIdentifierExtension.create(rootCaCert.publicKey),
    ],
  });

  return icaCert.toString("pem");
}

const icaCertPem = await generateIcaCert();

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

const outDir = path.join(ROOT_DIR, "certs/prod");
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, `${platform}-intermediate-ca.pem`);
fs.writeFileSync(outPath, icaCertPem);

console.log(`\n=== ${platform} ICA証明書生成完了 ===`);
console.log(`出力: ${outPath}`);
console.log(`\n--- チェーン検証 ---`);

// openssl で検証
try {
  const verifyResult = execSync(
    `openssl verify -CAfile "${rootCaCertPath}" "${outPath}"`,
    { encoding: "utf-8" }
  );
  console.log(verifyResult.trim());
} catch (e) {
  console.error("チェーン検証失敗:", e.message);
}

// Subject 表示
const subjectResult = execSync(
  `openssl x509 -in "${outPath}" -subject -issuer -dates -noout`,
  { encoding: "utf-8" }
);
console.log(subjectResult);

console.log("--- 環境変数用 PEM (コピーして Vercel に設定) ---");
console.log(icaCertPem);
console.log("\n--- .gitignore に certs/prod/ が含まれていることを確認してください ---");
