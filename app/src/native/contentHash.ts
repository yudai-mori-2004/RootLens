import { requireOptionalNativeModule } from 'expo-modules-core';

// content_hash 計算 (ContentHashModule) の薄ラッパー。
//
// ネイティブ側はファイルを順次読みながら CryptoKit SHA256 で計算する (= 数 GB でも数秒)。
// モジュール未搭載のビルド (旧ビルド / Android) では null を返し、 呼び出し側
// (dataflow/steps/hash.ts) が JS chunked 実装へフォールバックする。

interface ContentHashNativeModule {
  sha256File(path: string): Promise<string>;
}

const native = requireOptionalNativeModule<ContentHashNativeModule>('ContentHash');

/** ネイティブ SHA-256 が使えるビルドか。 */
export function isNativeHashAvailable(): boolean {
  return native != null;
}

/**
 * 生ファイルの SHA-256 (64 文字 hex) をネイティブで計算する。
 * モジュール未搭載なら null (= フォールバックせよ)。 計算失敗は throw。
 */
export async function nativeSha256File(uri: string): Promise<string | null> {
  if (!native) return null;
  return native.sha256File(uri);
}
