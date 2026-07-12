import { requireOptionalNativeModule } from 'expo-modules-core';

// Thin wrapper around the native content-hash module.
//
// The native side reads the file sequentially and digests it with CryptoKit
// SHA-256, so a multi-GB file takes seconds.

interface ContentHashNativeModule {
  sha256File(path: string): Promise<string>;
}

const native = requireOptionalNativeModule<ContentHashNativeModule>('ContentHash');

/**
 * Compute the SHA-256 (64-char hex) of a file natively.
 * null when the module is absent (a build defect; the caller fails loudly).
 * Failures throw.
 */
export async function nativeSha256File(uri: string): Promise<string | null> {
  if (!native) return null;
  return native.sha256File(uri);
}
