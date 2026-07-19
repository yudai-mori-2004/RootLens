// 音声コマンドフロー: 装着案内のあとは開始コマンド待機。 「さつえいスタート」 で録画開始、
// 「さつえいストップ」 で終了。 キャリブレーション (パーで画角合わせ) はフローから切り離されて
// いて、 待機中にパーを出せば動くが、 するもしないも自由 (= 確定後も待機に戻るだけ)。
//
// 現場動機: サムズアップの検知率に個体差があり、 全く通らない装着者がいた (2026-07-18 実店舗)。
// 音声認識は個体差の吸収が済んだ成熟技術なので、 開始・終了を声に任せる。
//
// マイクは端末内の音声認識 (= コマンドの聞き取り) だけに使い、 音声が保存されることはない
// (録画クリップに音声トラックは無い)。 コマンドの照合とゲート (TTS 再生中は無視) は
// CaptureScreen 側のリスナーが済ませ、 ここへは 'start' | 'stop' だけが届く。

import { t } from '../../i18n';
import type { CaptureFlow, CaptureState } from './types';

export const voiceFlow: CaptureFlow = {
  id: 'voice',
  usesVoiceCommands: true,
  displayLabelKey: 'settings.capture.flowVoice',

  isStillRecording() {
    // 声の停止は state 'recording' → 'finalizing' に直行 (gesture の stopping* を経由しない)。
    return false;
  },

  initialPrompt(ctx) {
    ctx.clearAwaitedSpeech();
    ctx.setState({ kind: 'voice_prompt' });
  },

  calibrationIdleState() {
    return { kind: 'awaiting_start_command' };
  },

  calibrationConfirmedTts() {
    // 位置確認だけ告げる (= 「これより開始します」 とは言わない。 開始は声で指示される)。
    return t('capture.tts.confirmedAim');
  },

  donePromptTts() {
    return t('capture.tts.doneVoice');
  },

  stopHintTts() {
    return t('capture.tts.stopHintVoice');
  },

  afterDonePrompt(ctx) {
    // 完了案内に次の始めようが含まれるので、 再プロンプトせず黙って待機へ。
    ctx.setState({ kind: 'awaiting_start_command' });
  },

  afterCycleResume(ctx) {
    // 自動サイクルの区切りからの復帰は「撮影を再開します」と告げた直後なので、
    // 開始コマンドを待たずそのままカウントダウンへ (= 案内どおり実際に再開する)。
    ctx.clearAwaitedSpeech();
    ctx.setState({ kind: 'precapture_countdown', startTs: ctx.now });
  },

  tickCalibrationIdle(ctx, cur) {
    // キャリブレーション途中 (adjust_needed) でも開始コマンドは効く (= キャリブは任意)。
    // 案内 TTS の読み上げ中は割り込まない。
    if (ctx.voiceCommand === 'start' && (cur.kind !== 'adjust_needed' || ctx.speechDone())) {
      ctx.consumeVoiceCommand();
      ctx.setState({ kind: 'precapture_countdown', startTs: ctx.now });
      return true;
    }
    return false;
  },

  afterCalibration(ctx) {
    ctx.clearAwaitedSpeech();
    ctx.setState({ kind: 'awaiting_start_command' });
  },

  tickRecordingStop(ctx, _armedSince) {
    if (ctx.voiceCommand === 'stop') {
      ctx.consumeVoiceCommand();
      // 終了宣言は finalizing 冒頭の理由読み上げに乗せる (= 保存と並行して再生される)。
      ctx.finalizeWithReason(t('capture.tts.stoppingConfirm'));
      return { transitioned: true, armedSince: 0 };
    }
    return { transitioned: false, armedSince: 0 };
  },

  tickFlowState(ctx, cur) {
    if (cur.kind === 'voice_prompt') {
      // 案内を言い終わったら待機へ。
      if (ctx.speechDone()) ctx.setState({ kind: 'awaiting_start_command' });
      return;
    }
    if (cur.kind !== 'awaiting_start_command') return;
    if (ctx.voiceCommand === 'start') {
      ctx.consumeVoiceCommand();
      ctx.setState({ kind: 'precapture_countdown', startTs: ctx.now });
      return;
    }
    // パーを出したらキャリブレーションへ合流 (= 任意。 確定後はここへ戻る)。
    if (ctx.gesture === 'open_palm') {
      ctx.setState({ kind: 'palm_holding', startTs: ctx.now });
    }
  },

  entryCue(state) {
    if (state.kind === 'voice_prompt') {
      return { tts: t('capture.tts.voiceArmed') };
    }
    return null;
  },

  hud(state: CaptureState) {
    switch (state.kind) {
      case 'voice_prompt':
      case 'awaiting_start_command':
        return { text: t('capture.tts.voiceArmed'), tone: 'normal' as const };
      case 'calibration_confirmed':
        return { text: t('capture.tts.confirmedAim'), tone: 'accent' as const };
      case 'recording':
        return { text: t('capture.hud.recordingHintVoice'), tone: 'dim' as const };
      case 'next_task_announcing':
        return { text: t('capture.tts.doneVoice'), tone: 'normal' as const };
      default:
        return null;
    }
  },
};
