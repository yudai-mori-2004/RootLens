// 物理ボタンフロー: iOSのAVCaptureEventInteractionが受けるcapture eventだけで
// 録画開始・終了をトグルする。ジェスチャー/音声コマンドと同じCaptureFlow実装であり、
// 他フローへの補助トリガーではない。TTS・キャリブレーション・カウントダウンは使わず、
// 開始時と終了操作時に短い効果音だけを鳴らす。

import { t } from '../../i18n';
import type { CaptureFlow, CaptureState } from './types';

const START_KINDS: CaptureState['kind'][] = [
  'announcing',
  'mounting',
  'awaiting_hardware_button',
];

export const hardwareButtonFlow: CaptureFlow = {
  id: 'hardware_button',
  usesVoiceCommands: false,
  usesHardwareCaptureEvents: true,
  usesSpokenGuidance: false,
  sessionEntrySfx: null,
  postFinalizeSfx: null,
  displayLabelKey: 'settings.capture.flowHardwareButton',

  introTts() {
    return null;
  },

  afterIntro(ctx) {
    ctx.setState({ kind: 'awaiting_hardware_button' });
  },

  isStillRecording() {
    return false;
  },

  initialPrompt(ctx) {
    ctx.setState({ kind: 'awaiting_hardware_button' });
  },

  calibrationIdleState() {
    return { kind: 'awaiting_hardware_button' };
  },

  calibrationConfirmedTts() {
    return null;
  },

  donePromptTts() {
    return null;
  },

  stopHintTts() {
    return null;
  },

  cycleResumeTts() {
    return null;
  },

  afterDonePrompt(ctx) {
    ctx.setState({ kind: 'awaiting_hardware_button' });
  },

  afterCycleResume(ctx) {
    ctx.audio.clear();
    void ctx.audio.sfx('countdown_end');
    ctx.setState({ kind: 'recording', startTs: ctx.now, armedSince: 0 });
  },

  tickCalibrationIdle() {
    return false;
  },

  afterCalibration(ctx) {
    ctx.setState({ kind: 'awaiting_hardware_button' });
  },

  tickRecordingStop(_ctx, armedSince) {
    return { transitioned: false, armedSince };
  },

  tickCaptureControl(ctx, cur) {
    if (!ctx.hardwareCaptureEvent) return false;
    ctx.consumeHardwareCaptureEvent();

    if (START_KINDS.includes(cur.kind)) {
      ctx.audio.clear();
      void ctx.audio.sfx('countdown_end');
      ctx.setState({ kind: 'recording', startTs: ctx.now, armedSince: 0 });
      return true;
    }

    if (cur.kind === 'recording') {
      ctx.finalize({ immediateSfx: 'rec_stop' });
      return true;
    }

    // finalizing/cycle statesでは押下を消費して何もしない。古い押下を次の待機へ持ち越さない。
    return false;
  },

  tickFlowState() {},

  entryCue() {
    return null;
  },

  hud(state: CaptureState) {
    switch (state.kind) {
      case 'announcing':
      case 'mounting':
      case 'awaiting_hardware_button':
        return { text: t('capture.hud.hardwareReady'), tone: 'normal' as const };
      case 'recording':
        return { text: t('capture.hud.hardwareRecording'), tone: 'dim' as const };
      default:
        return null;
    }
  },
};
