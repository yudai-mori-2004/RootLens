// 音声コマンドフロー: キャリブレーション確定 → 開始コマンド待ち (勝手に録画を始めない)。
// 「さつえいスタート」 でカウントダウン → 録画、 録画中は 「さつえいストップ」 で終了。
//
// 現場動機: サムズアップの検知率に個体差があり、 全く通らない装着者がいた (2026-07-18 実店舗)。
// 音声認識は個体差の吸収が済んだ成熟技術なので、 開始・終了だけ声に任せる。 キャリブレーション
// (パーで画角合わせ) は面積が大きく検知が安定しているため全フロー共通で残す。
//
// マイクは端末内の音声認識 (= コマンドの聞き取り) だけに使い、 音声が保存されることはない
// (録画クリップに音声トラックは無い)。 コマンドの照合とゲート (TTS 再生中は無視) は
// CaptureScreen 側のリスナーが済ませ、 ここへは 'start' | 'stop' だけが届く。

import { t } from '../../i18n';
import type { CaptureFlow, CaptureState } from './types';

export const voiceFlow: CaptureFlow = {
  id: 'voice',
  usesVoiceCommands: true,

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
    if (cur.kind !== 'awaiting_start_command') return;
    if (ctx.voiceCommand === 'start') {
      ctx.consumeVoiceCommand();
      ctx.setState({ kind: 'precapture_countdown', startTs: ctx.now });
    }
  },

  entryCue(state) {
    if (state.kind === 'awaiting_start_command') {
      return { tts: t('capture.tts.voiceArmed') };
    }
    return null;
  },

  hud(state: CaptureState) {
    if (state.kind === 'awaiting_start_command') {
      return { text: t('capture.tts.voiceArmed'), tone: 'normal' as const };
    }
    return null;
  },
};
