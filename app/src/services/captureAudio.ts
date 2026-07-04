// 撮影フローの音声シーケンサ。
//
// 効果音 (SFX) と音声ガイド (TTS) を「1 本の直列キュー」 で順に再生する。 各 cue は前の cue の完了を
// 待ってから鳴る = 重なりが構造的に起きない。
//
// ⚠ 設計原則 (= アーキ監査): このモジュールは状態遷移を「駆動しない」。 音声完了は callback ではなく
//    「単調増加 seq + 完了時刻」 として記録するだけで、 状態機械側 (= 100ms ticker) が getLastSpeechDone()
//    を読んで遷移を決める。 こうすることで「キャンセルした前試行の onDone が新試行で誤発火する」 類の
//    非同期コールバック競合が原理的に起きない (= 遷移の権限は ticker に一元化される)。
//
//    - enqueueSpeak(text) は即座に「この発話の seq」 を返す。 呼び出し側 (state) はその seq を覚えておき、
//      ticker で getLastSpeechDone().seq === 自分の seq になった時に「言い終わった」 と判定する。
//    - 「自然に最後まで言い終わった」 時だけ seq を確定する (= clearAudioQueue / stop で中断された発話は
//      完了扱いにしない。 よって途中キャンセルされた発話で遷移が起きない)。
//
// ⚠ presentation 層のサービス (= UI 用)。 dataflow (Layer 1) とは無関係。

import * as Speech from 'expo-speech';

import { getLocale } from '../i18n';
import { playSfxAwait, stopAllSfx, type SfxName } from './captureSounds';

type Cue =
  | { kind: 'sfx'; name: SfxName }
  | { kind: 'tts'; text: string; seq: number }
  | { kind: 'pause'; ms: number };

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
interface QueueItem {
  cue: Cue;
  resolve: () => void;
}

let queue: QueueItem[] = [];
let draining = false;
// クリアのたびに増やす世代カウンタ。 in-flight の drain ループが古い世代と気づいて抜けるため。
let generation = 0;

// 発話 seq の発番カウンタと、「自然に最後まで言い終わった」 最新発話の seq + 時刻。
let speechSeqCounter = 0;
let lastDoneSpeechSeq = 0;
let lastDoneSpeechAt = 0;

// TTS の声は現在の locale に追従する (= ja は ja-JP、 en は en-US)。
// rate/pitch は発話時に毎回現 locale で組む (= 言語切替後に開いた撮影で正しい声になる)。
function ttsOptions(): Speech.SpeechOptions {
  return { language: getLocale() === 'en' ? 'en-US' : 'ja-JP', rate: 1.05, pitch: 1.0 };
}

/** 発話し、 自然に完了したか (= true) / 中断されたか (= false) で resolve する。 */
function speakAwait(text: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Speech.stop(); // 念のため (= 通常は直列なので残っていない)
    Speech.speak(text, {
      ...ttsOptions(),
      onDone: () => resolve(true),
      onStopped: () => resolve(false),
      onError: () => resolve(false),
    });
  });
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const myGen = generation;
    const item = queue.shift()!;
    try {
      if (item.cue.kind === 'sfx') {
        await playSfxAwait(item.cue.name);
      } else if (item.cue.kind === 'pause') {
        await delay(item.cue.ms);
      } else {
        const natural = await speakAwait(item.cue.text);
        // 自然完了の時だけ seq を確定する (= 中断発話は「言い終わった」 と見なさない)。
        if (natural && myGen === generation) {
          lastDoneSpeechSeq = item.cue.seq;
          lastDoneSpeechAt = Date.now();
        }
      }
    } catch {
      // 個別 cue の失敗は無視 (= 音声で UX を止めない)
    }
    item.resolve();
    if (myGen !== generation) break; // この間に clearAudioQueue された → 残りは破棄済み
  }
  draining = false;
}

/** 効果音をキューに積む。 返値は「その音が鳴り終わった」 Promise。 */
export function enqueueSfx(name: SfxName): Promise<void> {
  return new Promise<void>((resolve) => {
    queue.push({ cue: { kind: 'sfx', name }, resolve });
    void drain();
  });
}

/** 無音の「間」 をキューに積む (= cue 間に意図的な間を空ける。 例: お疲れさま → 間 → 続けるなら)。 */
export function enqueuePause(ms: number): void {
  queue.push({ cue: { kind: 'pause', ms }, resolve: () => {} });
  void drain();
}

/** 音声ガイドをキューに積む。 返値は「この発話の seq」 (= 状態機械が完了判定に使う)。 fire-and-forget。 */
export function enqueueSpeak(text: string): number {
  const seq = ++speechSeqCounter;
  queue.push({ cue: { kind: 'tts', text, seq }, resolve: () => {} });
  void drain();
  return seq;
}

/** 「自然に最後まで言い終わった」 最新発話の seq + 時刻。 状態機械の ticker が読む。 */
export function getLastSpeechDone(): { seq: number; at: number } {
  return { seq: lastDoneSpeechSeq, at: lastDoneSpeechAt };
}

/** 保留中の cue を全破棄 + 現在の TTS / SFX を停止する (= 状態が切り替わった時・退場時)。
 *  中断された発話は完了扱いにしない (= lastDoneSpeechSeq は進めない)。 */
export function clearAudioQueue(): void {
  generation += 1;
  const pending = queue;
  queue = [];
  Speech.stop();
  stopAllSfx();
  for (const it of pending) it.resolve();
}
