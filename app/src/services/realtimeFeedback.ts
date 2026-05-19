import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';

// 撮影中のリアルタイムフィードバック。 状態 + 制御ループ方式。
//
// 旧版はイベントごとに fadeTo を呼ぶイベント駆動だったが、 イベントのドロップや順序ずれで
// 「手が映ってるのに音楽が鳴らない」 状態が出ることがあった。 そこで:
//
//   1. desiredState を最新のイベントで更新するだけ (fade は走らせない)
//   2. 30ms 間隔の制御ループが、 currentVolume を desiredVolume に向かって一定速度で動かす
//
// この方式だと、 イベントが何回連続しても、 何回落ちても、 ループが現状と目標の差を見て
// 詰めるだけなので、 状態と音量が乖離する事故が起きない。
//
// 状態:
//   safe   両手が画面の外周から 8% 以上の余裕を持って収まっている
//   edge   両手映ってるが画面端ギリギリ
//   absent 片手のみ / 0 手
//
// 音量目標:
//   safe   → 0.7
//   edge   → 0.25
//   absent → 0
//
// 加えて、 absent が 10 秒続けば「手がフレームから出ています」 を 1 度喋り、
// edge が 3 秒続けばはみ出している方向を 1 度喋る (= CaptureScreen 側で呼出し制御)。

const BGM_VOLUME_SAFE = 0.7;
const BGM_VOLUME_EDGE = 0.25;
const BGM_VOLUME_ABSENT = 0;
const BGM_FADE_MS = 300;
const TICK_MS = 30;
const VOLUME_PER_TICK = TICK_MS / BGM_FADE_MS;  // = 0.1 (= 30ms / 300ms = 10% of full scale per tick)
const VOICE_ABSENT_AFTER_MS = 10_000;

const BGM_SOURCE = require('../../assets/audio/clavier-music-chopin-nocturne-op-9-no-2-relaxing-piano-music-345085.mp3');

const DRIFT_PHRASES: Record<'left' | 'right' | 'top' | 'bottom', string> = {
  left: '左に寄ってる',
  right: '右に寄ってる',
  top: '上に寄ってる',
  bottom: '下に寄ってる',
};

export type FramingState = 'safe' | 'edge' | 'absent';

function stateToVolume(s: FramingState): number {
  switch (s) {
    case 'safe':   return BGM_VOLUME_SAFE;
    case 'edge':   return BGM_VOLUME_EDGE;
    case 'absent': return BGM_VOLUME_ABSENT;
  }
}

class RealtimeFeedbackImpl {
  private bgm: Audio.Sound | null = null;

  // 状態
  private isRecording = false;
  private desiredState: FramingState = 'absent';
  private currentVolume = 0;
  private lastAppliedVolume = -1;   // setVolumeAsync を冗長に呼ばないため

  // 制御ループ
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // 音声案内
  private absentSince: number | null = null;
  private voicePromptTimer: ReturnType<typeof setTimeout> | null = null;
  private voicePromptDone = false;

  async onRecordingStart(): Promise<void> {
    this.isRecording = true;
    this.desiredState = 'absent';
    this.currentVolume = 0;
    this.lastAppliedVolume = -1;
    this.absentSince = null;
    this.voicePromptDone = false;
    await this.ensureLoaded();
    await this.bgm?.setIsLoopingAsync(true);
    await this.bgm?.setVolumeAsync(0);
    await this.bgm?.playAsync();
    this.startTickLoop();
  }

  async onRecordingStop(): Promise<void> {
    this.isRecording = false;
    this.stopTickLoop();
    this.clearVoicePromptTimer();
    if (this.bgm) {
      await this.bgm.stopAsync().catch(() => {});
      await this.bgm.unloadAsync().catch(() => {});
      this.bgm = null;
    }
    Speech.stop();
  }

  /// 最新の framing 状態を保存するだけ。 音量は制御ループが追従する。
  onFramingState(state: FramingState): void {
    if (!this.isRecording) return;
    this.desiredState = state;

    // 不在タイマー管理 (= 10 秒以上 absent なら音声案内)
    if (state === 'absent') {
      if (this.absentSince === null) {
        this.absentSince = Date.now();
        this.voicePromptTimer = setTimeout(() => {
          if (!this.isRecording) return;
          if (this.absentSince === null) return;
          if (this.voicePromptDone) return;
          this.voicePromptDone = true;
          Speech.speak('手がフレームから出ています', { language: 'ja-JP', volume: 0.7, rate: 0.95 });
        }, VOICE_ABSENT_AFTER_MS);
      }
    } else {
      if (this.absentSince !== null) {
        this.absentSince = null;
        this.clearVoicePromptTimer();
        this.voicePromptDone = false;
      }
    }
  }

  /// 方向音声ガイド: 安全ゾーンから外れている方向を 1 度喋る (同じ方向の連発抑制は呼び出し側で)
  speakDriftDirection(direction: 'left' | 'right' | 'top' | 'bottom'): void {
    if (!this.isRecording) return;
    const phrase = DRIFT_PHRASES[direction];
    if (!phrase) return;
    Speech.speak(phrase, { language: 'ja-JP', volume: 0.7, rate: 1.0 });
  }

  // MARK: - 制御ループ

  private startTickLoop(): void {
    this.stopTickLoop();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTickLoop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    if (!this.isRecording || !this.bgm) return;
    const target = stateToVolume(this.desiredState);
    const delta = target - this.currentVolume;
    const absDelta = Math.abs(delta);
    if (absDelta < 0.005) {
      // 既にターゲットに居る。 setVolume を冗長に呼ばない
      if (this.currentVolume !== target) this.currentVolume = target;
      return;
    }
    const step = absDelta > VOLUME_PER_TICK ? Math.sign(delta) * VOLUME_PER_TICK : delta;
    this.currentVolume += step;
    // 適用音量が前回と十分違うときだけ setVolumeAsync を呼ぶ (= async storm 抑制)
    if (Math.abs(this.currentVolume - this.lastAppliedVolume) > 0.01 || absDelta < 0.05) {
      this.lastAppliedVolume = this.currentVolume;
      this.bgm.setVolumeAsync(this.currentVolume).catch(() => {});
    }
  }

  // MARK: - internals

  private async ensureLoaded(): Promise<void> {
    if (this.bgm) return;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync(BGM_SOURCE, { isLooping: true, volume: 0 });
    this.bgm = sound;
  }

  private clearVoicePromptTimer(): void {
    if (this.voicePromptTimer !== null) {
      clearTimeout(this.voicePromptTimer);
      this.voicePromptTimer = null;
    }
  }
}

export const RealtimeFeedback = new RealtimeFeedbackImpl();
