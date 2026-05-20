// ARKit 撮影フローの状態遷移 (= 旧 captureStateMachine の ARKit ベース置換)。
//
// 状態 (英語名はコード上の type、 日本語は意味の説明):
//   await_palm         両手パーを待っている
//   palm_holding       両手パー検出済、 1 秒保持を待っている
//   vlm_start_checking VLM の事前チェックを呼んでいる (= 結果を待っている)
//   countdown          3 秒カウントダウン
//   recording          録画中
//   thumbs_up_holding  両親指立てを検出、 1 秒保持を待っている
//   finalizing         録画停止 + VLM の事後チェックを呼んでいる
//   reviewing          達成確度を表示し、 撮影者の「送る / 撮り直す」 判断を待つ (SPECS §2.4 step 6)
//
// 遷移はすべてイベント駆動: hand-track event (= 15 Hz)、 vlm-result event、 UI の送る/撮り直す event。

export const PALM_HOLD_MS = 1000;
export const COUNTDOWN_MS = 3000;
export const THUMBS_UP_HOLD_MS = 1000;

export type CaptureState =
  | { kind: 'await_palm'; feedback: string | null }
  | { kind: 'palm_holding'; sinceTs: number }
  | { kind: 'vlm_start_checking' }
  | { kind: 'countdown'; startTs: number }
  | { kind: 'recording'; sinceTs: number }
  | { kind: 'thumbs_up_holding'; sinceTs: number }
  | { kind: 'finalizing' }
  | { kind: 'reviewing'; sessionDirUri: string; achievementConfidence: number; snapshotUri: string | null };

export type CaptureEvent =
  | { kind: 'frame'; ts: number; gesture: 'open_palm' | 'thumbs_up' | null; wearerHandCount: number }
  | { kind: 'vlmStartResult'; match: boolean; reason: string }
  | { kind: 'vlmStartError'; message: string }
  | { kind: 'reviewReady'; sessionDirUri: string; achievementConfidence: number; snapshotUri: string | null }
  | { kind: 'retake' };

export const initialCaptureState: CaptureState = { kind: 'await_palm', feedback: null };

export function captureReducer(state: CaptureState, ev: CaptureEvent): CaptureState {
  switch (state.kind) {
    case 'await_palm': {
      if (ev.kind === 'frame' && ev.gesture === 'open_palm' && ev.wearerHandCount >= 2) {
        return { kind: 'palm_holding', sinceTs: ev.ts };
      }
      return state;
    }
    case 'palm_holding': {
      if (ev.kind !== 'frame') return state;
      if (ev.gesture !== 'open_palm' || ev.wearerHandCount < 2) {
        return { kind: 'await_palm', feedback: '両手パーをキープしてください' };
      }
      if (ev.ts - state.sinceTs >= PALM_HOLD_MS) {
        return { kind: 'vlm_start_checking' };
      }
      return state;
    }
    case 'vlm_start_checking': {
      // VLM 中は frame でフラフラさせない。 結果が来てから次へ。
      if (ev.kind === 'vlmStartResult') {
        if (ev.match) return { kind: 'countdown', startTs: Date.now() };
        return { kind: 'await_palm', feedback: `タスクと一致していません: ${ev.reason}` };
      }
      if (ev.kind === 'vlmStartError') {
        return { kind: 'await_palm', feedback: `チェックに失敗: ${ev.message}` };
      }
      return state;
    }
    case 'countdown': {
      if (ev.kind !== 'frame') return state;
      // カウントダウン中に両手が外れたら最初から
      if (ev.wearerHandCount < 2) {
        return { kind: 'await_palm', feedback: 'カウントダウン中に両手が外れました' };
      }
      if (ev.ts - state.startTs >= COUNTDOWN_MS) {
        return { kind: 'recording', sinceTs: ev.ts };
      }
      return state;
    }
    case 'recording': {
      if (ev.kind !== 'frame') return state;
      if (ev.gesture === 'thumbs_up' && ev.wearerHandCount >= 2) {
        return { kind: 'thumbs_up_holding', sinceTs: ev.ts };
      }
      return state;
    }
    case 'thumbs_up_holding': {
      if (ev.kind !== 'frame') return state;
      if (ev.gesture !== 'thumbs_up' || ev.wearerHandCount < 2) {
        return { kind: 'recording', sinceTs: ev.ts };
      }
      if (ev.ts - state.sinceTs >= THUMBS_UP_HOLD_MS) {
        return { kind: 'finalizing' };
      }
      return state;
    }
    case 'finalizing': {
      if (ev.kind === 'reviewReady') {
        return {
          kind: 'reviewing',
          sessionDirUri: ev.sessionDirUri,
          achievementConfidence: ev.achievementConfidence,
          snapshotUri: ev.snapshotUri,
        };
      }
      return state;
    }
    case 'reviewing': {
      if (ev.kind === 'retake') {
        return { kind: 'await_palm', feedback: null };
      }
      return state;
    }
  }
}

/// 現在の状態を一言で表す (= UI の文言用)。
export function describeState(state: CaptureState): string {
  switch (state.kind) {
    case 'await_palm':       return state.feedback ?? '両手をパーにして構えてください';
    case 'palm_holding':     return '両手検出。 そのままキープ…';
    case 'vlm_start_checking': return 'シーンを確認しています…';
    case 'countdown':        return 'もうすぐ始まります';
    case 'recording':        return '録画中。 終わるときは両親指を立ててください';
    case 'thumbs_up_holding': return '終了確認中…';
    case 'finalizing':       return '保存中…';
    case 'reviewing':        return '達成確度を確認してください';
  }
}
