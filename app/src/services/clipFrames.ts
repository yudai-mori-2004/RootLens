// クリップの代表フレーム (サムネイル) 取得。
//
// 方針: 動画そのものは端末に保存しない。 ローカルの録画ファイルも、 アップロード済みの
// R2 上の mp4 も、 同じ API (expo-video-thumbnails = AVAssetImageGenerator) に URI を渡して
// 1 フレームだけ起こす。 リモート URL の場合、 AVFoundation は HTTP range リクエストで
// moov atom と必要なサンプルだけを読むので、 動画全体はダウンロードされない。
//
// キャッシュは 2 段:
//   1. メモリ (frames Map): セッション中の即時ヒット。
//   2. ディスク (cacheDirectory 配下): 一度起こしたサムネは jpg として残し、 次回起動時に
//      再取得 (= range リクエスト) しない。 key から決まる決定的パスに置くので manifest 不要。
// cacheDirectory なので OS の空き容量逼迫や設定の「キャッシュをクリア」 で消えうるが、
// 消えても miss 時に起こし直すだけ (= 動画本体は端末に無いという方針は不変)。

import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { fetchClipMediaUrl } from '../dataflow';
import { getCurrentSession } from './auth/instance';

const frames = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

// ディスクキャッシュの置き場 (= cacheDirectory 配下)。 存在確認は一度だけ。
const FRAME_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}frame-cache/`;
let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(FRAME_CACHE_DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
}

/** key → 決定的なキャッシュファイル path。 key はファイル名に使える文字だけに落とす。 */
function cachePathFor(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return `${FRAME_CACHE_DIR}${safe}.jpg`;
}

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
      // ディスクキャッシュヒット (= 前回起動で起こした jpg が残っている) なら range 取得しない。
      const diskPath = cachePathFor(key);
      const info = await FileSystem.getInfoAsync(diskPath).catch(() => null);
      if (info?.exists) {
        frames.set(key, diskPath);
        return diskPath;
      }

      const uri = await videoUri();
      const { uri: jpg } = await VideoThumbnails.getThumbnailAsync(uri, { time: 800, quality: 0.6 });
      // 決定的パスへ移して次回起動でも引けるようにする (= 失敗しても生成物 jpg は返す)。
      await ensureDir();
      let finalUri = jpg;
      try {
        await FileSystem.deleteAsync(diskPath, { idempotent: true });
        await FileSystem.moveAsync({ from: jpg, to: diskPath });
        finalUri = diskPath;
      } catch {
        // 移動に失敗しても、 生成された一時 jpg をそのまま使う (= セッション中は表示できる)。
      }
      frames.set(key, finalUri);
      return finalUri;
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
