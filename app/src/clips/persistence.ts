// クリップ永続化アダプタ (= Layer 2)。
//
// dataflowStore (Layer 1 純粋 store) を subscribe して、 進行中 / 準備完了のクリップを
// AsyncStorage に保存し、 起動時に hydrate する。 AsyncStorage は react-native 依存なので
// Layer 1 (dataflow) には入れず、 この Layer 2 アダプタに分離する (= dataflow の純粋性維持)。
//
// 仕様:
//   - uploading の永続化は、 アプリ kill でタイマーが切れるため、
//     起動時に error 扱い (= 「アプリ再起動中に中断されました」) にする。
//   - 保存キーは旧 clipPipeline と同じ (= 既存ユーザのローカルクリップをそのまま引き継ぐ)。

import AsyncStorage from '@react-native-async-storage/async-storage';

import { dataflowStore, clipList, type Clip } from '../dataflow';

const STORAGE_KEY = '@rootlens/clips/v1';
const PERSIST_DEBOUNCE_MS = 400;

let initialized = false;

/** 起動時に保存済みクリップを store へ流し込む (= 1 回だけ)。 */
async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as Clip[];
    const sanitized = arr.map((c) => {
      // uploading (= Pipeline 1 が中断) は error にする。 段 (stage) と作業 dir は保持されるので、
      // 「もう一度試す」 で advanceClip が成功済みの段から再開できる。
      if (c.state === 'uploading') {
        return { ...c, state: 'error' as const, errorMessage: 'アプリ再起動中に中断されました' };
      }
      return c;
    });
    dataflowStore.getState().replaceClips(sanitized);
  } catch (e) {
    console.error('[clips/persistence] hydrate failed (persisted clips ignored):', e);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastClips: Record<string, Clip> | null = null;

/** clips の変化を AsyncStorage に書き出す (= 軽くデバウンス)。 */
function schedulePersist(clips: Record<string, Clip>): void {
  if (clips === lastClips) return;
  lastClips = clips;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const arr = clipList(clips);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(arr)).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * クリップ永続化を開始する (= 冪等)。 hydrate → subscribe の順。
 * アプリ起動時に 1 度だけ呼ぶ (= App.tsx の effect)。
 */
export async function initClipPersistence(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await hydrate();
  // clips が変わるたびに永続化 (= zustand vanilla の subscribe は (state, prev) を渡す)。
  dataflowStore.subscribe((state, prev) => {
    if (state.clips !== prev.clips) schedulePersist(state.clips);
  });
}
