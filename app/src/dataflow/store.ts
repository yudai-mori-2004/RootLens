// dataflow の状態ストア (Zustand vanilla)。
//
// クリップ状態・録画ライフサイクル・イベントログを一元管理する。
// vanilla store なので React に依存しない (= React 外の step / orchestrator からも触れる)。
// React 側は zustand の useStore(dataflowStore, selector) で購読する (= adapter は UI 層に置く)。
//
// 設計方針:
//   - step / orchestrator は state を直接触らない。 進捗は EventSink (= storeEventSink) 経由で渡す。
//   - 「録画 → Pipeline 1 → Pipeline 2 → Pipeline 3」 の単一クリップ進行を保持する
//     (= sandbox は単体クリップのデータフロー確認が目的。 データセット化は範囲外: DATA_SPECS §1)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない (zustand/vanilla は React 非依存)。

import { createStore } from 'zustand/vanilla';

import { makeEvent, type DataflowEvent, type DataflowEventInput, type EventSink } from './events';
import type { Clip, ServerClipStatus, SignResult } from './types';
import type { RecordingSession } from './recording-configs';

/** 録画ライフサイクル。 */
export type RecordingPhase =
  | 'idle'            // session 未開始
  | 'session-active'  // プレビュー稼働、 録画前
  | 'recording'       // 録画中
  | 'recorded';       // 録画停止済み、 Pipeline 1 未投入

const MAX_EVENTS = 500;

export interface DataflowState {
  recording: RecordingPhase;
  configId: string | null;
  session: RecordingSession | null;

  /** 撮影停止時に signRecording で確定した署名結果 (= signatureHash / signedMp4Uri など)。
   *  署名は録画ごとに 1 回。 runPipeline1 はこれを使い回す (= 再署名しない)。 */
  signedClip: SignResult | null;

  /** Pipeline 1 が確定させたクリップ情報 (= signatureHash / rootAssetId など) */
  clip: Partial<Clip> | null;
  /** Pipeline 2 polling で受け取った最新サーバ状態 */
  serverStatus: ServerClipStatus | null;

  /** 実行中アクションのラベル (= ボタン二度押し防止 + スピナー表示)。 null なら待機。 */
  busy: string | null;
  events: DataflowEvent[];

  // ─── actions ─────────────────────────────────────────────────────
  appendEvent(e: DataflowEventInput): void;
  clearEvents(): void;
  setRecording(phase: RecordingPhase): void;
  setSession(session: RecordingSession | null): void;
  setSignedClip(signed: SignResult | null): void;
  setConfigId(id: string | null): void;
  patchClip(patch: Partial<Clip>): void;
  setServerStatus(status: ServerClipStatus | null): void;
  setBusy(label: string | null): void;
  /** クリップ進行のみリセット (= 録画 session は残す)。 新しいクリップを撮るとき用。 */
  resetClip(): void;
  /** 全リセット。 */
  reset(): void;
}

const INITIAL: Pick<
  DataflowState,
  'recording' | 'configId' | 'session' | 'signedClip' | 'clip' | 'serverStatus' | 'busy' | 'events'
> = {
  recording: 'idle',
  configId: null,
  session: null,
  signedClip: null,
  clip: null,
  serverStatus: null,
  busy: null,
  events: [],
};

export const dataflowStore = createStore<DataflowState>((set, get) => ({
  ...INITIAL,

  appendEvent(input) {
    const event = makeEvent(input);
    const events = get().events.concat(event);
    set({ events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events });
  },
  clearEvents() {
    set({ events: [] });
  },
  setRecording(phase) {
    set({ recording: phase });
  },
  setSession(session) {
    set({ session });
  },
  setSignedClip(signed) {
    set({ signedClip: signed });
  },
  setConfigId(id) {
    set({ configId: id });
  },
  patchClip(patch) {
    set({ clip: { ...(get().clip ?? {}), ...patch } });
  },
  setServerStatus(status) {
    set({ serverStatus: status });
  },
  setBusy(label) {
    set({ busy: label });
  },
  resetClip() {
    set({ clip: null, serverStatus: null });
  },
  reset() {
    set({ ...INITIAL, events: [] });
  },
}));

/**
 * store にイベントを流し込む EventSink。 step / orchestrator にこれを渡す。
 * console にもミラーしたい場合は events.ts の teeToConsole で包む。
 */
export const storeEventSink: EventSink = (e) => {
  dataflowStore.getState().appendEvent(e);
};
