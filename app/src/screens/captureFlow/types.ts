// 撮影フローの抽象。
//
// 「フロー」 = 録画の開始・終了をどう指示するかの戦略。 キャリブレーション (パーで画角合わせ) と
// 録画・保存・サイクル休止の機構は全フロー共通で、 フローが差し替えるのは次の 3 点だけ:
//   1. キャリブレーション確定後にどこへ進むか (= 即カウントダウン / 開始コマンド待ち)
//   2. 録画中の停止トリガー (= サムズアップ保持 / 音声コマンド)
//   3. フロー固有 state の tick・入場 cue・HUD
//
// ⚠ アーキ原則: フローで変わる挙動はすべて CaptureFlow の実装に置く。 CaptureScreen 側に
//    「if (flow === ...)」 の分岐を撒かない。 新フローの追加 = このディレクトリにファイルを
//    1 つ足し、 CaptureState に固有 kind を足し、 registry (index.ts) に登録するだけ。

import type { SfxName } from '../../services/captureSounds';

export type CaptureFlowId = 'gesture' | 'voice';

export type AdjustDirection = 'up' | 'down';

// 全フロー共通の状態機械の状態。 stopping / stopping_confirm は gesture フロー、
// awaiting_start_command は voice フローだけが到達する (= state の所有はフロー単位)。
export type CaptureState =
  | { kind: 'announcing' }
  | { kind: 'next_task_announcing' }
  | { kind: 'mounting' }
  | { kind: 'palm_prompt' }
  | { kind: 'awaiting_palm' }
  | { kind: 'palm_holding'; startTs: number }
  | { kind: 'adjust_needed'; direction: AdjustDirection }
  | { kind: 'calibration_confirmed' }
  | { kind: 'precapture_countdown'; startTs: number }
  | { kind: 'recording'; startTs: number; lastHandSeenTs: number; lastWarnTs: number; armedSince: number }
  | { kind: 'stopping'; startTs: number; lostSince: number }                 // gesture フロー所有
  | { kind: 'stopping_confirm'; startTs: number; lostSince: number }        // gesture フロー所有
  | { kind: 'awaiting_start_command' }                                       // voice フロー所有
  | { kind: 'finalizing' }
  | { kind: 'cycle_pausing'; startTs: number }
  | { kind: 'cycle_resuming' };

export type StableGesture = 'open_palm' | 'thumbs_up' | null;

/** フローが tick 中に使える操作の束。 CaptureScreen が ref 経由で組み立てる。 */
export interface FlowTickCtx {
  now: number;
  gesture: StableGesture;
  /** 直近の音声コマンド (= 鮮度・TTS 再生中ゲート適用済み)。 読んだら consumeVoiceCommand で消費する。 */
  voiceCommand: 'start' | 'stop' | null;
  consumeVoiceCommand(): void;
  /** 現 state が待っている発話が自然に言い終わったか。 */
  speechDone(): boolean;
  setState(next: CaptureState): void;
  /** voiced state へ入る前の sentinel (= awaitedSpeechSeqRef = 0)。 */
  clearAwaitedSpeech(): void;
  /** 理由 TTS 付きで finalizing へ (= 理由は finalizing 冒頭で 1 回読まれる)。 */
  finalizeWithReason(reasonTts: string | null): void;
  audio: {
    speak(text: string): number;
    sfx(name: SfxName): Promise<void>;
    pause(ms: number): void;
    clear(): void;
  };
  /** gesture フローの停止シーケンス (ピロン → TTS → ぴっぴっぴ) の完了フラグと世代破棄。 */
  stopSeq: {
    isDone(): boolean;
    cancel(): void;
  };
}

export interface FlowCue {
  sfx?: SfxName;
  tts?: string;
  keep?: boolean;
}

export interface FlowHud {
  text: string;
  tone: 'normal' | 'accent' | 'dim';
}

export interface CaptureFlow {
  id: CaptureFlowId;
  /** キャリブレーション確定 TTS 完了後に呼ばれる。 次の state へ遷移させる。 */
  afterCalibration(ctx: FlowTickCtx): void;
  /**
   * recording state の tick 内で停止トリガーを判定する。
   * 遷移した場合は { transitioned: true }。 継続なら armedSince (= デバウンス継続値) を返す。
   */
  tickRecordingStop(ctx: FlowTickCtx, armedSince: number): { transitioned: boolean; armedSince: number };
  /** フロー固有 state (stopping / stopping_confirm / awaiting_start_command) の tick。 */
  tickFlowState(ctx: FlowTickCtx, cur: CaptureState): void;
  /** フロー固有 state の入場 cue (共通 state は CaptureScreen 側)。 */
  entryCue(state: CaptureState): FlowCue | null;
  /** フロー固有 state の HUD (共通 state は CaptureScreen 側)。 */
  hud(state: CaptureState): FlowHud | null;
  /** このフローが音声コマンドのリスナーを必要とするか (= マイク・音声認識の起動)。 */
  usesVoiceCommands: boolean;
}
