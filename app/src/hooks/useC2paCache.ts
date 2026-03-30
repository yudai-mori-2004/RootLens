import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readManifest, type C2paManifestInfo } from '../native/c2paBridge';
import type * as MediaLibrary from 'expo-media-library';

// ---------------------------------------------------------------------------
// 仕様書 §3.5: C2PA検証結果のキャッシュ
// - メモリキャッシュ: セッション内で即座に参照
// - AsyncStorage: アプリ再起動後も検証結果を保持
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'rootlens:c2pa_cache';

/** 信頼する署名者の signer_org パターン（ガバナンスAPIの certificate 定義と同期） */
const TRUSTED_SIGNER_PATTERNS = [
  'RootLens',
  'Google',
  'Sony',
  'Leica',
];

// メモリキャッシュ
let memCache: Record<string, C2paManifestInfo> = {};
const checking = new Set<string>();
let storageLoaded = false;

/** AsyncStorageからキャッシュを復元する */
async function loadPersistedCache(): Promise<void> {
  if (storageLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, C2paManifestInfo>;
      // メモリキャッシュにマージ（メモリ側が優先）
      memCache = { ...parsed, ...memCache };
    }
  } catch {}
  storageLoaded = true;
}

/** キャッシュをAsyncStorageに永続化する */
async function persistCache(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memCache));
  } catch {}
}

export function useC2paCache(assets: MediaLibrary.Asset[]) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    loadPersistedCache().then(() => {
      setVersion(v => v + 1); // 永続キャッシュ復元後に再描画

      const unchecked = assets.filter(a => !memCache[a.id] && !checking.has(a.id));
      let newEntries = 0;

      for (const asset of unchecked) {
        checking.add(asset.id);
        readManifest(asset.uri).then(info => {
          memCache[asset.id] = info;
          checking.delete(asset.id);
          newEntries++;
          setVersion(v => v + 1);

          // 10件ごとにバッチ永続化（毎回は重い）
          if (newEntries % 10 === 0 || checking.size === 0) {
            persistCache();
          }
        });
      }
    });
  }, [assets]);

  return memCache;
}

// ---------------------------------------------------------------------------
// 信頼判定
// ---------------------------------------------------------------------------

/**
 * C2PA署名の信頼判定。
 *
 * 3段階チェック:
 * 1. マニフェストがあるか
 * 2. 暗号検証に致命的失敗がないか
 * 3. 署名者が信頼リスト（TRUSTED_SIGNER_PATTERNS）に含まれるか
 *
 * @returns true=信頼済み, false=非信頼, null=チェック中
 */
export function isTrustedAsset(
  c2paStatus: Record<string, C2paManifestInfo>,
  assetId: string,
): boolean | null {
  const info = c2paStatus[assetId];
  if (!info) return null; // まだチェック中
  if (!info.has_manifest) return false;
  if (!info.is_valid) return false; // 改ざん検知

  // signer_org が信頼パターンのいずれかに前方一致
  const org = info.signer_org || '';
  return TRUSTED_SIGNER_PATTERNS.some(pattern => org.includes(pattern));
}

/**
 * 署名者の表示ラベルを返す。
 * GalleryViewのバッジ表示に使用。
 */
export function getSignerLabel(
  c2paStatus: Record<string, C2paManifestInfo>,
  assetId: string,
): string | null {
  const info = c2paStatus[assetId];
  if (!info?.has_manifest || !info.is_valid) return null;

  const org = info.signer_org || '';
  if (org.includes('RootLens')) return 'RootLens';
  if (org.includes('Google')) return 'Google Pixel';
  if (org.includes('Sony')) return 'Sony';
  if (org.includes('Leica')) return 'Leica';
  return info.signer_org || null;
}
