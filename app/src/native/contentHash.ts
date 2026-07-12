import { requireOptionalNativeModule } from 'expo-modules-core';

// Thin wrapper around the native content-hash module.
//
// The native side reads the file sequentially and digests it with CryptoKit
// SHA-256, so a multi-GB file takes seconds. Builds without the module
// (Android, older builds) get null and the caller (dataflow/steps/hash.ts)
// falls back to the chunked JS implementation.

interface ContentHashNativeModule {
  sha256File(path: string): Promise<string>;
}

const native = requireOptionalNativeModule<ContentHashNativeModule>('ContentHash');

/** Whether this build has the native SHA-256 module. */
export function isNativeHashAvailable(): boolean {
  return native != null;
}

/**
 * Compute the SHA-256 (64-char hex) of a file natively.
 * null when the module is absent (caller should fall back). Failures throw.
 */
export async function nativeSha256File(uri: string): Promise<string | null> {
  if (!native) return null;
  return native.sha256File(uri);
}
