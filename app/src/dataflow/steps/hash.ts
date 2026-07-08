// Pipeline 1 step: 生 MP4 の content_hash 計算 (= SHA-256 of raw bytes)。
//
// v0.1.4 で C2PA D1 署名を廃止し、 クリップの識別子は「生 mp4 のバイト内容の SHA-256」 に置換。
// 端末で計算し、 その 64 文字 hex を R2 キー / DB PK として使う。
//
// 4GB 級の mp4 でも OOM しないよう、 8MB ずつ base64 chunk read → noble/hashes で incremental update
// してから最後に digest する。 iOS の phys_footprint はこれで平坦。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import type { EventSink } from '../events';
import type { HashInput, HashResult } from '../types';

const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB。 iOS / Android どちらも余裕。

/**
 * 生 MP4 の SHA-256 を chunked に計算して 64 文字 hex を返す。
 */
export async function computeContentHash(
  rawMp4Uri: string,
  sink: EventSink,
): Promise<HashResult> {
  const info = await FileSystem.getInfoAsync(rawMp4Uri, { size: true });
  if (!info.exists) throw new Error(`raw mp4 missing: ${rawMp4Uri}`);
  const size = (info as { size?: number }).size ?? 0;
  if (size <= 0) throw new Error(`raw mp4 is empty: ${rawMp4Uri}`);

  sink({ step: 'content-hash', level: 'info', message: `SHA-256 計算開始 (${(size / 1e6).toFixed(1)} MB)` });

  const hasher = sha256.create();
  let read = 0;
  while (read < size) {
    const length = Math.min(CHUNK_BYTES, size - read);
    const b64 = await FileSystem.readAsStringAsync(rawMp4Uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: read,
      length,
    });
    // Hermes は atob をグローバル提供する (RN 0.74+)。 追加依存を避けるためこれを使う。
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    hasher.update(bytes);
    read += length;
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

/** 単発実行用ラッパ。 純粋関数なので tmpDir 等は不要。 */
export async function hashClip(
  input: HashInput,
  sink: EventSink,
): Promise<HashResult> {
  return computeContentHash(input.rawMp4Uri, sink);
}
