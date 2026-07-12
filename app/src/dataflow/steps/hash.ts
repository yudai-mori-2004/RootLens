// Upload step: compute the clip's content hash (SHA-256 over the raw MP4 bytes).
//
// The 64-char hex is the clip's identity everywhere: the R2 object key prefix
// and the server DB primary key. The digest runs in the native module
// (sequential reads + CryptoKit), so a multi-GB file takes seconds.
//
// There is deliberately no JS fallback: any build that can record a clip
// includes the native modules, so a missing hash module is a build defect and
// should fail loudly instead of falling into a minutes-per-GB slow path.
//
// ⚠ Dataflow layer: must not import react / react-native.

import * as FileSystem from 'expo-file-system';

import type { EventSink } from '../events';
import type { HashResult } from '../types';
import { nativeSha256File } from '../../native/contentHash';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Compute the SHA-256 of the raw MP4 and return the 64-char hex.
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

  const contentHash = await nativeSha256File(rawMp4Uri);
  if (contentHash == null) {
    throw new Error('SHA-256 ネイティブモジュールがこのビルドに含まれていません (= ビルド不良)');
  }
  if (!HEX64.test(contentHash)) {
    throw new Error(`native hash malformed: ${contentHash.slice(0, 80)}`);
  }
  onProgress?.(1);
  sink({
    step: 'content-hash',
    level: 'success',
    message: `content_hash 確定: ${contentHash}`,
    detail: { contentHash, contentSize: size },
  });
  return { contentHash, contentSize: size };
}
