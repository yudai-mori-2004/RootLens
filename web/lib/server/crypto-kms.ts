/**
 * AWS KMS ベースの CryptoSigner 実装
 * 仕様書 §4.3: Root CA/ICA鍵はAWS KMSに格納
 *
 * ca.ts の LocalEcSigner を本番環境でこの KmsSigner に差し替えることで、
 * ICA秘密鍵がサーバーメモリに存在しない構成を実現する。
 *
 * 使用方法:
 *   環境変数 KMS_ANDROID_ICA_KEY_ID / KMS_IOS_ICA_KEY_ID が設定されている場合、
 *   ca.ts の loadIntermediateCA() で KmsSigner を使用する。
 *
 * 注意: @peculiar/x509 の X509CertificateGenerator.create() は CryptoKey を直接要求するため、
 *       KMS使用時は tbsCertificate を手動構築して KMS Sign API で署名し、
 *       X.509 DER を自前で組み立てる必要がある。
 *       この実装は issueDeviceCertificateKms() として提供する。
 */

import type { CryptoSigner, SigningAlgorithm } from "./crypto";

/**
 * AWS KMS 署名実装。
 * ICA秘密鍵がKMS内に閉じ込められ、サーバーメモリに平文で存在しない。
 *
 * 必要な環境変数:
 *   AWS_REGION
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY（またはIAMロール）
 */
export class KmsSigner implements CryptoSigner {
  readonly algorithm: SigningAlgorithm;
  private readonly kmsKeyId: string;

  constructor(kmsKeyId: string, algorithm: SigningAlgorithm = "ES256") {
    this.kmsKeyId = kmsKeyId;
    this.algorithm = algorithm;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    // Lazy import to avoid loading AWS SDK when not needed
    const { KMSClient, SignCommand } = await import("@aws-sdk/client-kms");
    const crypto = await import("crypto");

    const kms = new KMSClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

    // KMS Sign API はメッセージダイジェストを受け取る
    const hash = crypto.createHash("sha256").update(data).digest();

    const response = await kms.send(new SignCommand({
      KeyId: this.kmsKeyId,
      Message: hash,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }));

    if (!response.Signature) {
      throw new Error("KMS Sign returned no signature");
    }

    return new Uint8Array(response.Signature);
  }

  async getPublicKeyDer(): Promise<Uint8Array> {
    const { KMSClient, GetPublicKeyCommand } = await import("@aws-sdk/client-kms");

    const kms = new KMSClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
    const response = await kms.send(new GetPublicKeyCommand({
      KeyId: this.kmsKeyId,
    }));

    if (!response.PublicKey) {
      throw new Error("KMS GetPublicKey returned no key");
    }

    return new Uint8Array(response.PublicKey);
  }
}

/**
 * KMS を使用するかどうかを判定する。
 * 環境変数に KMS Key ID が設定されていればtrue。
 */
export function isKmsConfigured(platform: "ios" | "android"): boolean {
  const envVar = platform === "ios" ? "KMS_IOS_ICA_KEY_ID" : "KMS_ANDROID_ICA_KEY_ID";
  return !!process.env[envVar];
}

/**
 * プラットフォーム用の KmsSigner を取得する。
 */
export function getKmsSigner(platform: "ios" | "android"): KmsSigner {
  const envVar = platform === "ios" ? "KMS_IOS_ICA_KEY_ID" : "KMS_ANDROID_ICA_KEY_ID";
  const keyId = process.env[envVar];
  if (!keyId) {
    throw new Error(`${envVar} is not set`);
  }
  return new KmsSigner(keyId);
}
