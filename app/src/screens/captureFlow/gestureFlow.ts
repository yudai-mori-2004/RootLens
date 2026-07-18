// ジェスチャーフロー: キャリブレーション確定 → 即カウントダウン → 録画、
// 停止は両手サムズアップの保持 (ARM → 保持 → 確認シーケンス完走で確定)。
//
// 停止フロー (= 人間目線): 頭部装着・両手で作業中・画面は見ない前提。 thumbs-up が ARM_MS 継続して
// 「検出」 → 即時音。 検出から HOLD_MS 立て続けると音声「撮影を終了します」を流し、
// シーケンスを最後まで聞かせ終えた時にまだ立て続けていたら停止確定。
// ⚠ 停止まで「立て続け」 を要求: 作業中は手が常に動くので、 偶発検出は手が動いた瞬間にキャンセル。
// ⚠ 離脱判定は RELEASE_GRACE_MS のヒステリシス: 単フレームの検出フリッカーで即キャンセルしない。

import { t } from '../../i18n';
import type { CaptureFlow, CaptureState, FlowTickCtx } from './types';

const THUMBS_UP_ARM_MS = 300;
const THUMBS_UP_HOLD_MS = 700;   // ARM と合わせて計 1.0 秒キープでチャイム + 確認 TTS
// 離脱猶予 (= 立て続け中の検出フリッカーを吸収。 意図的な離脱はこれより長く手を動かす)。
const RELEASE_GRACE_MS = 800;

export const gestureFlow: CaptureFlow = {
  id: 'gesture',
  usesVoiceCommands: false,

  initialPrompt(ctx) {
    ctx.clearAwaitedSpeech();
    ctx.setState({ kind: 'palm_prompt' });
  },

  calibrationIdleState() {
    return { kind: 'awaiting_palm' };
  },

  calibrationConfirmedTts() {
    return t('capture.tts.confirmed');
  },

  donePromptTts() {
    return t('capture.tts.done');
  },

  stopHintTts() {
    return t('capture.tts.stopHint');
  },

  afterDonePrompt(ctx) {
    ctx.setState({ kind: 'awaiting_palm' });
  },

  afterCycleResume(ctx) {
    ctx.clearAwaitedSpeech();
    ctx.setState({ kind: 'palm_prompt' });
  },

  tickCalibrationIdle() {
    return false;
  },

  afterCalibration(ctx) {
    ctx.setState({ kind: 'precapture_countdown', startTs: ctx.now });
  },

  tickRecordingStop(ctx, armedSince) {
    if (ctx.gesture !== 'thumbs_up') return { transitioned: false, armedSince: 0 };
    const since = armedSince === 0 ? ctx.now : armedSince;
    if (ctx.now - since >= THUMBS_UP_ARM_MS) {
      // stopping の入場効果音 (detect_thumbs_up) は stopping_confirm の専用シーケンスが鳴らす。
      ctx.setState({ kind: 'stopping', startTs: ctx.now, lostSince: 0 });
      return { transitioned: true, armedSince: 0 };
    }
    return { transitioned: false, armedSince: since };
  },

  tickFlowState(ctx, cur) {
    if (cur.kind === 'stopping') {
      const thumbsUp = ctx.gesture === 'thumbs_up';
      if (!thumbsUp) {
        // 離脱ヒステリシス (= 単フレームのフリッカーでは切らない)。 lostSince を state に内包。
        const lostSince = cur.lostSince === 0 ? ctx.now : cur.lostSince;
        if (ctx.now - lostSince >= RELEASE_GRACE_MS) {
          ctx.setState({ kind: 'recording', startTs: cur.startTs, lastHandSeenTs: ctx.now, lastWarnTs: 0, armedSince: 0 });
        } else if (lostSince !== cur.lostSince) {
          ctx.setState({ ...cur, lostSince });
        }
        return;
      }
      // HOLD_MS 立て続け → stopping_confirm (確認シーケンスは CaptureScreen の state 駆動 effect が積む)。
      if (ctx.now - cur.startTs >= THUMBS_UP_HOLD_MS) {
        ctx.clearAwaitedSpeech();
        ctx.setState({ kind: 'stopping_confirm', startTs: ctx.now, lostSince: 0 });
        return;
      }
      if (cur.lostSince !== 0) ctx.setState({ ...cur, lostSince: 0 }); // フリッカー復帰
      return;
    }

    if (cur.kind === 'stopping_confirm') {
      const thumbsUp = ctx.gesture === 'thumbs_up';
      if (!thumbsUp) {
        const lostSince = cur.lostSince === 0 ? ctx.now : cur.lostSince;
        if (ctx.now - lostSince >= RELEASE_GRACE_MS) {
          // 本当に離した → キャンセルして録画継続。 世代を進めて、 まだ鳴り終わっていない tick の
          // Promise 解決で done=true が立つのを無効化する。
          ctx.stopSeq.cancel();
          ctx.audio.clear();
          void ctx.audio.sfx('detect_cancel');
          ctx.audio.pause(1000);
          ctx.audio.speak(t('capture.tts.stopHint'));
          ctx.setState({ kind: 'recording', startTs: ctx.now, lastHandSeenTs: ctx.now, lastWarnTs: 0, armedSince: 0 });
        } else if (lostSince !== cur.lostSince) {
          ctx.setState({ ...cur, lostSince });
        }
        return;
      }
      // シーケンス (ピロン → TTS → ぴっぴっぴ) が最後まで鳴り切り、 今も立て続けている → 停止確定。
      if (ctx.stopSeq.isDone()) {
        ctx.finalizeWithReason(null);
        return;
      }
      if (cur.lostSince !== 0) ctx.setState({ ...cur, lostSince: 0 }); // フリッカー復帰
    }
  },

  entryCue(state) {
    switch (state.kind) {
      case 'stopping':
        // 保持の前半 (= ARM 後) は無音。 作業中の偶然の検出で音を出さない。
        return null;
      case 'stopping_confirm':
        // ピロン → 「撮影を終了します」 → ぴっぴっぴ は CaptureScreen の専用 effect が積む。
        return null;
      default:
        return null;
    }
  },

  hud(state: CaptureState) {
    if (state.kind === 'stopping' || state.kind === 'stopping_confirm') {
      return { text: t('capture.tts.stoppingConfirm'), tone: 'accent' as const };
    }
    return null;
  },
};
