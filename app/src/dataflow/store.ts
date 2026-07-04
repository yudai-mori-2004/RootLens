// dataflow の状態ストア (Zustand vanilla)。
//
// クリップコレクション・録画ライフサイクル・イベントログを一元管理する Layer 1 の単一の真実。
// vanilla store なので React に依存しない (= React 外の step / orchestrator からも触れる)。
// React 側は UI 層の hooks (src/clips/hooks.ts) が useStore(dataflowStore, selector) で購読する。
//
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない (zustand/vanilla は React 非依存)。

import { createStore } from 'zustand/vanilla';

import { makeEvent, type DataflowEvent, type DataflowEventInput, type EventSink } from './events';
import type { Clip, ServerClipStatus } from './types';
import type { RecordingSession } from './recording-configs';

/** 録画ライフサイクル。 */
export type RecordingPhase =
  | 'idle'            // session 未開始
  | 'session-active'  // プレビュー稼働、 録画前
  | 'recording'       // 録画中
  | 'recorded';       // 録画停止済み、 Pipeline 1 未投入

const MAX_EVENTS = 500;

let localIdSeq = 0;
/** 端末発番のローカル clip id (= sign 完了で signature_hash へ renameClipId する)。 */
export function makeLocalClipId(): string {
  localIdSeq += 1;
  return `local_${Date.now().toString(36)}_${localIdSeq.toString(36)}`;
}

export interface DataflowState {
  // ─── 録画セッションのライフサイクル (= 同時に 1 つ) ──────────────────
  recording: RecordingPhase;
  configId: string | null;
  session: RecordingSession | null;

  // ─── クリップコレクション (= 複数、 単一の真実) ──────────────────────
  clips: Record<string, Clip>;
  /** 録画 → P1 で進行中のクリップ id (= 撮影画面 / sandbox の進行表示対象)。 */
  currentClipId: string | null;

  /** 実行中アクションのラベル (= ボタン二度押し防止 + スピナー表示)。 null なら待機。 */
  busy: string | null;
  events: DataflowEvent[];

  // ─── 録画 actions ───────────────────────────────────────────────────
  setRecording(phase: RecordingPhase): void;
  setSession(session: RecordingSession | null): void;
  setConfigId(id: string | null): void;

  // ─── クリップコレクション actions ────────────────────────────────────
  upsertClip(clip: Clip): void;
  patchClip(id: string, patch: Partial<Clip>): void;
  removeClip(id: string): void;
  /** local id → signature_hash へ key を貼り替える (= sign 完了で identity 誕生)。 */
  renameClipId(localId: string, signatureHash: string): void;
  /** server から受け取った状態を、 指定 id のクリップにマージする。 */
  applyServerStatus(targetId: string, status: ServerClipStatus): void;
  /** 永続化アダプタからの一括 hydrate (= 起動時に保存済みクリップを流し込む)。 */
  replaceClips(clips: Clip[]): void;
  /** 進行表示対象のクリップ id を設定する。 */
  setCurrentClipId(id: string | null): void;

  // ─── events / busy ──────────────────────────────────────────────────
  appendEvent(e: DataflowEventInput): void;
  clearEvents(): void;
  setBusy(label: string | null): void;

  /** 進行中クリップの追跡だけ解除する (= 新しい録画を撮るとき用、 コレクションは残す)。 */
  resetCurrent(): void;
  /** 全リセット (= sandbox の「リセット」)。 */
  reset(): void;
}

const INITIAL: Pick<
  DataflowState,
  'recording' | 'configId' | 'session' | 'clips' | 'currentClipId' | 'busy' | 'events'
> = {
  recording: 'idle',
  configId: null,
  session: null,
  clips: {},
  currentClipId: null,
  busy: null,
  events: [],
};

export const dataflowStore = createStore<DataflowState>((set, get) => ({
  ...INITIAL,

  setRecording(phase) { set({ recording: phase }); },
  setSession(session) { set({ session }); },
  setConfigId(id) { set({ configId: id }); },

  upsertClip(clip) {
    set({ clips: { ...get().clips, [clip.id]: clip } });
  },
  patchClip(id, patch) {
    const cur = get().clips[id];
    if (!cur) return;
    set({ clips: { ...get().clips, [id]: { ...cur, ...patch } } });
  },
  removeClip(id) {
    const { [id]: _removed, ...rest } = get().clips;
    set({
      clips: rest,
      currentClipId: get().currentClipId === id ? null : get().currentClipId,
    });
  },
  renameClipId(localId, signatureHash) {
    if (localId === signatureHash) return;
    const clips = get().clips;
    const cur = clips[localId];
    if (!cur) return;
    const { [localId]: _old, ...rest } = clips;
    set({
      clips: { ...rest, [signatureHash]: { ...cur, id: signatureHash } },
      currentClipId: get().currentClipId === localId ? signatureHash : get().currentClipId,
    });
  },
  applyServerStatus(targetId, status) {
    const cur = get().clips[targetId];
    if (!cur) return;
    const merged: Clip = {
      ...cur,
      state: status.state,
      durationMs: status.durationMs ?? cur.durationMs ?? null,
      deviceModel: status.deviceModel ?? cur.deviceModel ?? null,
      recordingConfigId: cur.recordingConfigId ?? status.recordingConfig ?? undefined,
      contentSize: status.contentSize ?? cur.contentSize,
      errorMessage: status.errorMessage ?? null,
    };
    set({ clips: { ...get().clips, [targetId]: merged } });
  },
  replaceClips(clips) {
    const map: Record<string, Clip> = {};
    for (const c of clips) map[c.id] = c;
    set({ clips: map });
  },
  setCurrentClipId(id) { set({ currentClipId: id }); },

  appendEvent(input) {
    const event = makeEvent(input);
    const events = get().events.concat(event);
    set({ events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events });
  },
  clearEvents() { set({ events: [] }); },
  setBusy(label) { set({ busy: label }); },

  resetCurrent() { set({ currentClipId: null }); },
  reset() { set({ ...INITIAL, clips: {}, events: [] }); },
}));

// ─── selectors (= 純粋。 UI 層 hooks から useMemo 越しに使う) ──────────────

/** クリップ一覧 (= 新しい順)。 呼び出し側は s.clips を dep にした useMemo で包むこと。 */
export function clipList(clips: Record<string, Clip>): Clip[] {
  return Object.values(clips).sort((a, b) => b.createdAt - a.createdAt);
}

/** id でクリップを引く (= 無ければ null)。 */
export function selectClip(state: DataflowState, id: string | null | undefined): Clip | null {
  if (!id) return null;
  return state.clips[id] ?? null;
}

/** 進行中クリップ (= currentClipId が指すもの)。 */
export function selectCurrentClip(state: DataflowState): Clip | null {
  return state.currentClipId ? state.clips[state.currentClipId] ?? null : null;
}

/**
 * store にイベントを流し込む EventSink。 step / orchestrator にこれを渡す。
 * console にもミラーしたい場合は events.ts の teeToConsole で包む。
 */
export const storeEventSink: EventSink = (e) => {
  dataflowStore.getState().appendEvent(e);
};
