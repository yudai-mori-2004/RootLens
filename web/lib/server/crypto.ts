/**
 * 暗号アルゴリズム抽象化レイヤー
 *
 * 署名・検証を CryptoSigner インターフェースで抽象化し、
 * アルゴリズム切り替え（EC P-256 → KMS → 将来のPQC）を可能にする。
 *
 * 仕様書 §4.2 暗号アルゴリズム
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// アルゴリズム定義 — 将来の追加はここに集約
// ---------------------------------------------------------------------------

/** サポートする署名アルゴリズム */
export type SigningAlgorithm = "ES256" | "ES384";
// 将来: | "ML-DSA-65" | "SLH-DSA-SHA2-128s"

/** アルゴリズムごとのパラメータ */
export interface AlgorithmParams {
  readonly name: string;         // WebCrypto algorithm name
  readonly namedCurve: string;   // e.g. "P-256"
  readonly hash: string;         // e.g. "SHA-256"
  readonly c2paAlg: string;      // C2PA SigningAlg identifier
}

const ALGORITHM_REGISTRY: Record<SigningAlgorithm, AlgorithmParams> = {
  ES256: { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256", c2paAlg: "Es256" },
  ES384: { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384", c2paAlg: "Es384" },
};

export function getAlgorithmParams(alg: SigningAlgorithm): AlgorithmParams {
  const params = ALGORITHM_REGISTRY[alg];
  if (!params) throw new Error(`Unsupported algorithm: ${alg}`);
  return params;
}

// ---------------------------------------------------------------------------
// CryptoSigner — アルゴリズム非依存の署名インターフェース
// ---------------------------------------------------------------------------

/**
 * 署名者インターフェース。
 * LocalEcSigner（dev）、KmsSigner（本番）、将来のPQC実装を同一IFで扱う。
 */
export interface CryptoSigner {
  /** 使用する署名アルゴリズム */
  readonly algorithm: SigningAlgorithm;

  /** データに署名する（DER形式の署名を返す） */
  sign(data: Uint8Array): Promise<Uint8Array>;

  /** 公開鍵をSPKI DER形式で取得 */
  getPublicKeyDer(): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// LocalEcSigner — ローカルCryptoKey（dev環境用）
// ---------------------------------------------------------------------------

/**
 * WebCrypto CryptoKey ベースのEC署名実装。
 * dev環境でファイルベースの鍵を使用する場合に利用。
 */
export class LocalEcSigner implements CryptoSigner {
  readonly algorithm: SigningAlgorithm;
  private readonly key: CryptoKey;

  constructor(key: CryptoKey, algorithm: SigningAlgorithm = "ES256") {
    this.key = key;
    this.algorithm = algorithm;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const params = getAlgorithmParams(this.algorithm);
    const signature = await crypto.webcrypto.subtle.sign(
      { name: params.name, hash: params.hash },
      this.key,
      data,
    );
    return new Uint8Array(signature);
  }

  async getPublicKeyDer(): Promise<Uint8Array> {
    // LocalEcSignerは秘密鍵のみを保持するため、公開鍵は証明書から取得する想定
    throw new Error("LocalEcSigner.getPublicKeyDer() is not supported. Use certificate public key.");
  }

  /**
   * 内部のCryptoKeyを取得する。
   * @peculiar/x509 等、CryptoKeyを直接要求するライブラリとの互換用。
   * KMS移行時はこのメソッドを使わず、手動でtbsCertificate構築+KMS Signに切り替える。
   */
  getCryptoKey(): CryptoKey {
    return this.key;
  }

  /** PKCS#8 PEMからLocalEcSignerを生成 */
  static async fromPkcs8Pem(pem: string, algorithm: SigningAlgorithm = "ES256"): Promise<LocalEcSigner> {
    const { PemConverter } = await import("@peculiar/x509");
    const params = getAlgorithmParams(algorithm);
    const keyDer = PemConverter.decode(pem)[0];
    const key = await crypto.webcrypto.subtle.importKey(
      "pkcs8",
      keyDer,
      { name: params.name, namedCurve: params.namedCurve },
      false,
      ["sign"],
    );
    return new LocalEcSigner(key, algorithm);
  }
}

// ---------------------------------------------------------------------------
// CSR / 公開鍵のアルゴリズム検証ユーティリティ
// ---------------------------------------------------------------------------

/** CSRの公開鍵が期待するアルゴリズムと一致するか検証 */
export function validatePublicKeyAlgorithm(
  publicKey: CryptoKey,
  expectedAlgorithm: SigningAlgorithm = "ES256",
): { valid: boolean; error?: string } {
  const params = getAlgorithmParams(expectedAlgorithm);
  const keyAlg = publicKey.algorithm as EcKeyAlgorithm;

  if (keyAlg.name !== params.name) {
    return {
      valid: false,
      error: `Expected ${params.name} key, got ${keyAlg.name}`,
    };
  }

  if (keyAlg.namedCurve !== params.namedCurve) {
    return {
      valid: false,
      error: `Expected ${params.namedCurve} curve, got ${keyAlg.namedCurve}`,
    };
  }

  return { valid: true };
}
