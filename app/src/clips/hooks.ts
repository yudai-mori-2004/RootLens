// クリップストアの React 購読 hooks (= UI binding)。
//
// dataflowStore は純粋 vanilla store (= react 非依存)。 React からの購読は
// この UI 層 hooks に閉じ込める (= dataflow の純粋性を保ち、 画面は dataflow の詳細を知らない)。
//
// 一覧 (useClips) は s.clips (= Record の安定参照) を購読し、 useMemo で並べ替えるだけ。
// clips の参照は mutation 時しか変わらないので、 ソート済み配列の再生成は最小限で済む
// (= zustand selector が毎回新配列を返して無限再描画する問題を回避)。

import { useMemo } from 'react';
import { useStore } from 'zustand';

import {
  dataflowStore,
  clipList,
  selectCurrentClip,
  type Clip,
  type DataflowEvent,
  type RecordingPhase,
} from '../dataflow';

/** 全クリップ (= 新しい順)。 */
export function useClips(): Clip[] {
  const clips = useStore(dataflowStore, (s) => s.clips);
  return useMemo(() => clipList(clips), [clips]);
}

/** 単一クリップ (= id 指定)。 */
export function useClip(id: string | null | undefined): Clip | null {
  const clips = useStore(dataflowStore, (s) => s.clips);
  return useMemo(() => (id ? clips[id] ?? null : null), [clips, id]);
}

/** 録画 → アップロードで進行中のクリップ。 */
export function useCurrentClip(): Clip | null {
  return useStore(dataflowStore, selectCurrentClip);
}

/** 実行中アクションのラベル (= null なら待機)。 */
export function useDataflowBusy(): string | null {
  return useStore(dataflowStore, (s) => s.busy);
}

/** 録画ライフサイクル。 */
export function useRecordingPhase(): RecordingPhase {
  return useStore(dataflowStore, (s) => s.recording);
}

/** イベントログ。 */
export function useDataflowEvents(): DataflowEvent[] {
  return useStore(dataflowStore, (s) => s.events);
}
