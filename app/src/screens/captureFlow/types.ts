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
import type { TranslationKey } from '../../i18n';

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
  | { kind: 'voice_prompt' }                                                 // voice フロー所有 (開始コマンド案内 TTS 中)
  | { kind: 'awaiting_start_command' }                                       // voice フロー所有
  | { kind: 'finalizing' }
  | { kind: 'cycle_pausing'; startTs: number }
  | { kind: 'cycle_resuming' };

export type StableGesture = 'open_palm' | 'thumbs_up' | null;

/** 音声キューを操作する束。 tick と入場効果の両方で使う。 */
export interface FlowAudio {
  speak(text: string): number;
  sfx(name: SfxName): Promise<void>;
  pause(ms: number): void;
  clear(): void;
}

/** フロー固有の停止シーケンス (gesture の ピロン → TTS → ぴっぴっぴ) の世代管理。
 *  同 state に再突入 (キャンセル→復帰→再度発火) した時に、 古い試行の Promise 解決で
 *  誤って完了フラグが立たないように、 発火時に世代を進めてトラッキングする。 */
export interface StopSeqController {
  isDone(): boolean;
  /** 新しい世代を開始する (= 古い試行を無効化)。 返り値をトラッキング id に使う。
   *  ticker から呼ぶ場合は返り値を捨てれば実質「今の試行を中止」 として使える。 */
  newGeneration(): number;
  /** 世代が一致していれば完了フラグを立てる (= 遅延解決の stale 破棄)。 */
  markDone(gen: number): void;
}

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
  audio: FlowAudio;
  stopSeq: StopSeqController;
}

/** state 入場時のフロー固有副作用に渡す ctx (= 音声シーケンス組み立て用の最小セット)。 */
export interface FlowEnterCtx {
  audio: FlowAudio;
  stopSeq: StopSeqController;
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
  /** 装着案内のあとの最初の案内へ (= フローの分岐点はここから始まる)。 */
  initialPrompt(ctx: FlowTickCtx): void;
  /** キャリブレーション途中離脱・エラー時に戻る待機 state。 */
  calibrationIdleState(): CaptureState;
  /** キャリブレーション確定時の TTS (= gesture は「開始します」、 voice は位置確認のみ)。 */
  calibrationConfirmedTts(): string;
  /** クリップ完了時の案内 TTS。 */
  donePromptTts(): string;
  /** 録画が乗ってきた頃に 1 回だけ読む、 終了方法の案内 TTS。 */
  stopHintTts(): string;
  /** クリップ完了案内のあとの待機へ。 */
  afterDonePrompt(ctx: FlowTickCtx): void;
  /** サイクル休止明けの再開案内のあとへ。 */
  afterCycleResume(ctx: FlowTickCtx): void;
  /** 待機系 state (awaiting_palm / adjust_needed) での追加トリガー (= voice の開始コマンド)。 遷移したら true。 */
  tickCalibrationIdle(ctx: FlowTickCtx, cur: CaptureState): boolean;
  /** キャリブレーション確定 TTS 完了後に呼ばれる。 次の state へ遷移させる。 */
  afterCalibration(ctx: FlowTickCtx): void;
  /**
   * recording state の tick 内で停止トリガーを判定する。
   * 遷移した場合は { transitioned: true }。 継続なら armedSince (= デバウンス継続値) を返す。
   */
  tickRecordingStop(ctx: FlowTickCtx, armedSince: number): { transitioned: boolean; armedSince: number };
  /** フロー固有 state の tick (= gesture の palm_prompt / awaiting_palm / stopping* 、 voice の
   *  voice_prompt / awaiting_start_command)。 CaptureScreen の dispatcher が該当 state kind を
   *  この関数へ流す。 */
  tickFlowState(ctx: FlowTickCtx, cur: CaptureState): void;
  /** state 入場時のフロー固有副作用 (= gesture の停止確認シーケンス「ピロン→TTS→ぴっぴっぴ」)。
   *  単発 cue (音+TTS 1 回) は entryCue で足りるが、 多段音声シーケンスや完了トラッキングが要る
   *  ケースをここに置く。 未定義なら何もしない。 */
  onEnterState?(state: CaptureState, ctx: FlowEnterCtx): void;
  /** フロー固有 state の入場 cue (共通 state は CaptureScreen 側)。 */
  entryCue(state: CaptureState): FlowCue | null;
  /** state 表示用 HUD。 フロー固有 state に加え、 共通 state のうちフローごとに文言が異なるもの
   *  (recording / calibration_confirmed / next_task_announcing) もここで返す。 null なら
   *  CaptureScreen 側のフロー中立フォールバックを使う。 */
  hud(state: CaptureState): FlowHud | null;
  /** このフローが音声コマンドのリスナーを必要とするか (= マイク・音声認識の起動)。 */
  usesVoiceCommands: boolean;
  /** 設定画面のセグメントに出す表示名の i18n キー。 新フロー追加時に SettingsScreen を編集せず
   *  registry のみで反映されるように、 各フローが自分のラベルを供給する。 */
  displayLabelKey: TranslationKey;
  /** 共通の 'recording' 以外にも「録画進行中」 として扱う state kind か
   *  (= gesture の停止確認シーケンス中 = stopping / stopping_confirm)。
   *  録画中の副作用 (画面消灯・空き容量ポーリング・経過タイマー・バックグラウンド停止判定) が
   *  これを参照する (= フロー固有 state 名を CaptureScreen に直書きしない)。 */
  isStillRecording(state: CaptureState): boolean;
}
