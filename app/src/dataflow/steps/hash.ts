// Upload step: compute the clip's content hash (SHA-256 over the raw MP4 bytes).
//
// The 64-char hex is the clip's identity everywhere: the R2 object key prefix
// and the server DB primary key. It is computed on the device.
//
// Two paths:
//   1. Native (ContentHashModule, CryptoKit). Sequential reads; a multi-GB file
//      takes seconds. This is the main path.
//   2. JS fallback (for builds without the module): read 8 MB base64 chunks and
//      feed an incremental noble/hashes digest. Never OOMs, but Hermes takes
//      minutes per GB.
//
// ⚠ Dataflow layer: must not import react / react-native.

import * as FileSystem from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import type { EventSink } from '../events';
import type { HashInput, HashResult } from '../types';
import { nativeSha256File } from '../../native/contentHash';

const HEX64 = /^[0-9a-f]{64}$/;

const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB; comfortable on iOS and Android alike.

/**
 * Compute the SHA-256 of the raw MP4 in chunks and return the 64-char hex.
 */
export async function computeContentHash(
  rawMp4Uri: string,
  sink: EventSink,
  onProgress?: (fraction: number) => void,
): Promise<HashResult> {
  const info = await FileSystem.getInfoAsync(rawMp4Uri, { size: true });
  if (!info.exists) throw new Error(`raw mp4 missing: ${rawMp4Uri}`);
  const size = (info as { size?: number }).size ?? 0;
  if (size <= 0) throw new Error(`raw mp4 is empty: ${rawMp4Uri}`);

  sink({ step: 'content-hash', level: 'info', message: `SHA-256 計算開始 (${(size / 1e6).toFixed(1)} MB)` });

  // ── Main path: native (sequential reads + CryptoKit) ────────────────
  try {
    const nativeHex = await nativeSha256File(rawMp4Uri);
    if (nativeHex != null) {
      if (!HEX64.test(nativeHex)) throw new Error(`native hash malformed: ${nativeHex.slice(0, 80)}`);
      onProgress?.(1);
      sink({
        step: 'content-hash',
        level: 'success',
        message: `content_hash 確定 (native): ${nativeHex}`,
        detail: { contentHash: nativeHex, contentSize: size },
      });
      return { contentHash: nativeHex, contentSize: size };
    }
    // null means the build has no native module; fall through to JS.
  } catch (e) {
    // Report the native failure rather than swallowing it, then continue with
    // the JS implementation (the result must be identical).
    const msg = e instanceof Error ? e.message : String(e);
    sink({ step: 'content-hash', level: 'info', message: `ネイティブ計算に失敗、 JS 実装へフォールバック: ${msg}` });
  }

  // ── Fallback: chunked JS hashing ────────────────────────────────────
  const hasher = sha256.create();
  let read = 0;
  while (read < size) {
    const length = Math.min(CHUNK_BYTES, size - read);
    const b64 = await FileSystem.readAsStringAsync(rawMp4Uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: read,
      length,
    });
    // Hermes provides atob globally (RN 0.74+); using it avoids an extra dependency.
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    hasher.update(bytes);
    read += length;
    onProgress?.(read / size);
  }

  const contentHash = bytesToHex(hasher.digest());
  sink({
    step: 'content-hash',
    level: 'success',
    message: `content_hash 確定: ${contentHash}`,
    detail: { contentHash, contentSize: size },
  });
  return { contentHash, contentSize: size };
}

/** One-shot wrapper. Pure, so it needs no working directory or other context. */
export async function hashClip(
  input: HashInput,
  sink: EventSink,
): Promise<HashResult> {
  return computeContentHash(input.rawMp4Uri, sink);
}
