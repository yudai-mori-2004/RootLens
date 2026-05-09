import { detectGesture, type GestureLabel } from '../01-hand-pose-gesture/gesture';
import type { HandObservation } from '../../native/handPose';

// Sandbox 04 capture flow の reducer。
//
// 大枠:
//   await_palm (両手パー待ち)
//     ├── frame.bothPalms → palm_holding (sinceTs)
//     └── (top bar に lastFeedback を表示)
//   palm_holding
//     ├── frame.!bothPalms → await_palm (feedback: 「両手をキープしてください」)
//     └── 1秒経過 → vlm_start_checking (副作用で VLM 呼出)
//   vlm_start_checking
//     ├── frame.!bothPalms → await_palm (kepf 喪失)
//     ├── vlmStartResult.match → countdown (startTs)
//     ├── vlmStartResult.!match → await_palm (feedback: 不一致理由)
//     └── vlmStartError → await_palm (feedback: error)
//   countdown
//     ├── frame.!bothPalms → await_palm (feedback: 「カウントダウン中に両手が外れました」)
//     └── 3秒経過 → recording (sinceTs) + 副作用: startRecording
//   recording
//     ├── frame.bothThumbsUp → thumbs_up_holding (sinceTs, handsOk)
//     └── frame: handsOk = anyHandDetected (top-right indicator + 振動)
//   thumbs_up_holding
//     ├── frame.!bothThumbsUp → recording (handsOk 更新)
//     └── 1秒経過 → finalizing (副作用: stopRecording → VLM end check → onComplete)
//   finalizing
//     └── side effect 完了で onComplete 呼出 (CaptureView 側で result mode に遷移)

export type CaptureSub =
  | { kind: 'await_palm'; feedback: string | null }
  | { kind: 'palm_holding'; sinceTs: number }
  | { kind: 'vlm_start_checking' }
  | { kind: 'countdown'; startTs: number }
  | { kind: 'recording'; sinceTs: number; handsOk: boolean }
  | { kind: 'thumbs_up_holding'; sinceTs: number; handsOk: boolean }
  | { kind: 'finalizing' };

export type CaptureEvent =
  | { kind: 'frame'; ts: number; bothPalms: boolean; bothThumbsUp: boolean; anyHandDetected: boolean }
  | { kind: 'vlmStartResult'; match: boolean; reason: string }
  | { kind: 'vlmStartError'; message: string };

export const PALM_HOLD_MS = 1000;
export const COUNTDOWN_MS = 3000;
export const THUMBS_UP_HOLD_MS = 1000;

export const initialCaptureSub: CaptureSub = { kind: 'await_palm', feedback: null };

export function captureReducer(state: CaptureSub, ev: CaptureEvent): CaptureSub {
  switch (state.kind) {
    case 'await_palm': {
      if (ev.kind === 'frame' && ev.bothPalms) {
        return { kind: 'palm_holding', sinceTs: ev.ts };
      }
      return state;
    }
    case 'palm_holding': {
      if (ev.kind !== 'frame') return state;
      if (!ev.bothPalms) {
        return { kind: 'await_palm', feedback: 'Keep both palms in view.' };
      }
      if (ev.ts - state.sinceTs >= PALM_HOLD_MS) {
        return { kind: 'vlm_start_checking' };
      }
      return state;
    }
    case 'vlm_start_checking': {
      // VLM 中は palm 喪失で state を戻さない: snapshot は既に flight 中で、結果は palm 状態と無関係。
      // 戻すと useEffect cleanup で cancelled=true となり VLM 結果が捨てられて feedback 表示されないまま
      // 無限ループになる (frame 単位の flicker で再入する)。
      if (ev.kind === 'vlmStartResult') {
        if (ev.match) {
          return { kind: 'countdown', startTs: Date.now() };
        }
        return { kind: 'await_palm', feedback: `Start condition not met: ${ev.reason}` };
      }
      if (ev.kind === 'vlmStartError') {
        return { kind: 'await_palm', feedback: `VLM error: ${ev.message}` };
      }
      return state;
    }
    case 'countdown': {
      if (ev.kind !== 'frame') return state;
      if (!ev.bothPalms) {
        return { kind: 'await_palm', feedback: 'Hands lost during countdown. Show both palms again.' };
      }
      if (ev.ts - state.startTs >= COUNTDOWN_MS) {
        return { kind: 'recording', sinceTs: ev.ts, handsOk: ev.anyHandDetected };
      }
      return state;
    }
    case 'recording': {
      if (ev.kind !== 'frame') return state;
      if (ev.bothThumbsUp) {
        return { kind: 'thumbs_up_holding', sinceTs: ev.ts, handsOk: ev.anyHandDetected };
      }
      if (state.handsOk !== ev.anyHandDetected) {
        return { ...state, handsOk: ev.anyHandDetected };
      }
      return state;
    }
    case 'thumbs_up_holding': {
      if (ev.kind !== 'frame') return state;
      if (!ev.bothThumbsUp) {
        // recording に戻す。sinceTs は変更しない (元の録画開始時刻保持)
        return { kind: 'recording', sinceTs: 0, handsOk: ev.anyHandDetected };
      }
      if (ev.ts - state.sinceTs >= THUMBS_UP_HOLD_MS) {
        return { kind: 'finalizing' };
      }
      return state;
    }
    case 'finalizing':
      return state;
  }
}

// MARK: - Frame feature extraction

export interface HandFeatures {
  bothPalms: boolean;
  bothThumbsUp: boolean;
  anyHandDetected: boolean;
}

/**
 * 1 frame の hands 配列から「両手パー / 両手サムズアップ / 何か手が見えてる」を判定。
 * detectGesture を 1 hand ずつ呼び、上位 2 個の score の手が同じラベルなら成立。
 */
export function classifyHands(hands: HandObservation[]): HandFeatures {
  const valid = hands.filter((h) => h.score >= 0.5);
  const labels: (GestureLabel | null)[] = valid.map(detectGesture);
  const palmCount = labels.filter((l) => l === 'open_palm').length;
  const thumbCount = labels.filter((l) => l === 'thumbs_up').length;
  return {
    bothPalms: valid.length >= 2 && palmCount >= 2,
    bothThumbsUp: valid.length >= 2 && thumbCount >= 2,
    anyHandDetected: valid.length >= 1,
  };
}

// MARK: - Top bar status text

export function statusText(state: CaptureSub): string {
  switch (state.kind) {
    case 'await_palm':
      return state.feedback ?? 'Show both palms to the camera when ready.';
    case 'palm_holding':
      return 'Holding palms — keep steady.';
    case 'vlm_start_checking':
      return 'Checking start condition…';
    case 'countdown':
      return 'Countdown — keep palms open.';
    case 'recording':
      return state.handsOk
        ? 'Recording — both thumbs up to finish.'
        : 'Hands out of frame — both thumbs up to finish.';
    case 'thumbs_up_holding':
      return 'Holding thumbs up — keep steady.';
    case 'finalizing':
      return 'Checking end condition…';
  }
}
