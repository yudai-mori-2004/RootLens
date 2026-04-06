/**
 * ネイティブ AES-256-GCM CryptoProvider（ファイルパス方式 + AAD対応）
 *
 * 大容量データがJS↔ネイティブBridgeを通過しない。
 * Bridgeを流れるのは鍵(32byte)、nonce(12byte)、AAD、ファイルパス文字列のみ。
 */

import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { CryptoProvider } from '@title-protocol/sdk';

const { AesGcmBridge } = NativeModules;
const cacheDir = FileSystem.cacheDirectory!;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function base64ToUint8Array(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stripFileScheme(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

export const nativeCryptoProvider: CryptoProvider = {
  async encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array) {
    const ts = Date.now();
    const t0 = Date.now();
    const lap = (l: string) => console.log(`[AES] ${l}: ${Date.now() - t0}ms`);
    const inputUri = `${cacheDir}aes_in_${ts}.bin`;
    const outputUri = `${cacheDir}aes_out_${ts}.bin`;

    try {
      lap('toBase64 start');
      const b64 = uint8ArrayToBase64(plaintext);
      lap('toBase64 done');
      await FileSystem.writeAsStringAsync(inputUri, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      lap('writeFile done');

      const result = await AesGcmBridge.encryptFile(
        stripFileScheme(inputUri),
        stripFileScheme(outputUri),
        uint8ArrayToBase64(key),
        uint8ArrayToBase64(aad),
      );

      lap('encryptFile done');

      const ciphertextBase64 = await FileSystem.readAsStringAsync(outputUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      lap('readFile done');

      const ciphertext = base64ToUint8Array(ciphertextBase64);
      lap('fromBase64 done');

      return {
        nonce: base64ToUint8Array(result.nonce),
        ciphertext,
      };
    } finally {
      FileSystem.deleteAsync(inputUri, { idempotent: true });
      FileSystem.deleteAsync(outputUri, { idempotent: true });
    }
  },

  async decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array) {
    const ts = Date.now();
    const inputUri = `${cacheDir}aes_dec_in_${ts}.bin`;
    const outputUri = `${cacheDir}aes_dec_out_${ts}.bin`;

    try {
      await FileSystem.writeAsStringAsync(inputUri, uint8ArrayToBase64(ciphertext), {
        encoding: FileSystem.EncodingType.Base64,
      });

      await AesGcmBridge.decryptFile(
        stripFileScheme(inputUri),
        stripFileScheme(outputUri),
        uint8ArrayToBase64(key),
        uint8ArrayToBase64(nonce),
        uint8ArrayToBase64(aad),
      );

      const plaintextBase64 = await FileSystem.readAsStringAsync(outputUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return base64ToUint8Array(plaintextBase64);
    } finally {
      FileSystem.deleteAsync(inputUri, { idempotent: true });
      FileSystem.deleteAsync(outputUri, { idempotent: true });
    }
  },

  toBase64(bytes: Uint8Array): string {
    return uint8ArrayToBase64(bytes);
  },

  fromBase64(str: string): Uint8Array {
    return base64ToUint8Array(str);
  },
};
