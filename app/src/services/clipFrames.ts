// クリップの代表フレーム (サムネイル) 取得。
//
// 方針: 動画そのものは端末に保存しない。 ローカルの録画ファイルも、 アップロード済みの
// R2 上の mp4 も、 同じ API (expo-video-thumbnails = AVAssetImageGenerator) に URI を渡して
// 1 フレームだけ起こす。 リモート URL の場合、 AVFoundation は HTTP range リクエストで
// moov atom と必要なサンプルだけを読むので、 動画全体はダウンロードされない。
//
// 生成された jpg は OS 管理のキャッシュ領域に置かれる。 ここで持つのはメモリ上の
// key → jpg URI の対応だけで、 Documents への永続化は行わない。

import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { fetchClipMediaUrl } from '../dataflow';
import { getCurrentSession } from './auth/instance';

const frames = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** 旧実装が Documents に永続化していたサムネの掃除 (1 回だけ、 失敗しても無害)。 */
let legacyCleaned = false;
function cleanupLegacyThumbs(): void {
  if (legacyCleaned) return;
  legacyCleaned = true;
  FileSystem.deleteAsync(`${FileSystem.documentDirectory}thumbs/`, { idempotent: true }).catch(() => {});
}

async function resolveFrame(key: string, videoUri: () => Promise<string>): Promise<string | null> {
  const cached = frames.get(key);
  if (cached) return cached;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async () => {
    try {
      const uri = await videoUri();
      const { uri: jpg } = await VideoThumbnails.getThumbnailAsync(uri, { time: 800, quality: 0.6 });
      frames.set(key, jpg);
      return jpg;
    } catch {
      return null; // フレームが起こせなくてもプレースホルダで表示できる
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** ローカル録画ファイルの代表フレーム。 */
export function useLocalClipFrame(key: string, videoUri: string | null): string | null {
  const [uri, setUri] = useState<string | null>(frames.get(key) ?? null);
  useEffect(() => {
    cleanupLegacyThumbs();
    if (!videoUri || frames.has(key)) return;
    let cancelled = false;
    void resolveFrame(key, async () => videoUri).then((u) => {
      if (!cancelled && u) setUri(u);
    });
    return () => { cancelled = true; };
  }, [key, videoUri]);
  return uri;
}

/** アップロード済みクリップの代表フレーム (= /media の presigned URL から range 読み)。 */
export function useUploadedClipFrame(key: string | null, clipId: string | null): string | null {
  const [uri, setUri] = useState<string | null>(key ? frames.get(key) ?? null : null);
  useEffect(() => {
    cleanupLegacyThumbs();
    if (!key || !clipId || frames.has(key)) return;
    let cancelled = false;
    void resolveFrame(key, async () => {
      const session = getCurrentSession();
      if (!session) throw new Error('not authenticated');
      return fetchClipMediaUrl(clipId, session.pubkey);
    }).then((u) => {
      if (!cancelled && u) setUri(u);
    });
    return () => { cancelled = true; };
  }, [key, clipId]);
  return uri;
}
