// Node.js polyfills for @solana/web3.js and @title-protocol/sdk
// Must be imported before any other module
import 'react-native-get-random-values';
import { gcm } from '@noble/ciphers/aes.js';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;

// Polyfill crypto.subtle (AES-GCM only) for @title-protocol/sdk
// The SDK uses importKey + encrypt/decrypt with AES-GCM
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore
  globalThis.crypto = {};
}
if (!globalThis.crypto.subtle) {
  // @ts-ignore
  globalThis.crypto.subtle = {
    async importKey(
      _format: string,
      keyData: ArrayBuffer | Uint8Array,
      _algo: unknown,
      _extractable: boolean,
      usages: string[],
    ) {
      return { rawKey: new Uint8Array(keyData), usages };
    },
    async encrypt(
      algo: { name: string; iv: Uint8Array },
      key: { rawKey: Uint8Array },
      plaintext: ArrayBuffer | Uint8Array,
    ) {
      const aes = gcm(key.rawKey, algo.iv);
      return aes.encrypt(new Uint8Array(plaintext)).buffer;
    },
    async decrypt(
      algo: { name: string; iv: Uint8Array },
      key: { rawKey: Uint8Array },
      ciphertext: ArrayBuffer | Uint8Array,
    ) {
      const aes = gcm(key.rawKey, algo.iv);
      return aes.decrypt(new Uint8Array(ciphertext)).buffer;
    },
  };
}

// Ensure Uint8Array.subarray returns Buffer (needed by @title-protocol/sdk
// which calls disc.equals() — a Buffer method not present on plain Uint8Array)
const origSubarray = Uint8Array.prototype.subarray;
// @ts-ignore – intentional override for React Native compatibility
Uint8Array.prototype.subarray = function (...args: [number?, number?]) {
  const result = origSubarray.apply(this, args);
  return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
};
