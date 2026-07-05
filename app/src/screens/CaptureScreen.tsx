// 撮影画面 (= v0.1.4)。 IMU 照準合わせ → 開始ジェスチャー → 撮影 → ローカル保存。
//
// 照準合わせ (= services/aimCalibration の設計):
//   直立して目の高さの遠くを注視した姿勢で、 カメラ軸の俯角 (= 重力基準、 加速度計で読む) が
//   目標角に入るまで「スマホを少しずつ下に」 と TTS で誘導する。 手検出には頼らない
//   (= 姿勢の個人差が乗らない、 画面が見えなくても重力は万人共通の基準)。
//   目標角は事前分布 + 前クリップの手の在圏統計から学習した補正。
//
// 4 layer:
//   0. 装着 (mounting)
//        - TTS: 「スマホをヘッドセットに取り付けて、 頭に装着してください」
//        - 静止 + 装着らしい俯角を検知したら姿勢案内 (= 証明写真のポーズ) へ
//   1. 照準 (aim_adjust)
//        - 俯角が目標 ±3° に 1.2 秒収まったら音 + 振動で確定 → 開始ジェスチャーの案内
//   2. 開始ジェスチャー
//        - 両手チョキを 1 秒キープ → 完了と同時に録画開始 (= 機械カウントダウン無し)
//   3. 撮影
//        - 両手チョキを 1.5 秒キープで録画停止 → 次タスク提案 → 照準確認に戻る
//        - 両手が 5 秒以上画面から外れたら警告音 + TTS
//        - 手が下端に外れ続ける (= 照準が上すぎるシグネチャ) なら 1 回だけ「かけ直し」 を提案
//        - 60 分は native 側で hard cap
//        - 録画中の手の在圏統計を貯め、 終了時に次回の目標俯角へ反映 (= aimCalibration)
//
// ⚠ v0.1.4: 録画停止後の自動アップロードは行わない。 クリップは state 'recorded' でローカル一覧
//    (マイビデオ) に積まれ、 ユーザーがプレビュー確認 → 「アップロード」 した時に advanceClip が
//    署名 → R2 → 登録 を進める (= DATA_SPECS §2)。
//
// 効果音は assets/sounds/*.mp3 から expo-av で再生 (= captureSounds service)。

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { Camera } from 'expo-camera';
import * as Device from 'expo-device';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../app/types';
import { WideCapturePreviewView } from '../native/wideCapture';
import { ArkitCapturePreviewView } from '../native/arkitCapture';
import {
  DEFAULT_RECORDING_CONFIG,
  RECORDING_CONFIGS,
  getRecordingConfig,
  enqueueRecording,
  storeEventSink,
  teeToConsole,
  type RecordingConfig,
  type HandTrackEvent,
} from '../dataflow';
import { playSfx, preloadCaptureSounds, unloadCaptureSounds, type SfxName } from '../services/captureSounds';
import { enqueueSfx, enqueueSpeak, enqueuePause, clearAudioQueue, getLastSpeechDone } from '../services/captureAudio';
import {
  AIM_STABLE_MS,
  AIM_TOLERANCE_DEG,
  RedoMonitor,
  SessionAimStats,
  aimTargetPitchDownDeg,
  loadLearnedAim,
  updateLearnedAim,
  useCameraPitch,
} from '../services/aimCalibration';
import { applyCaptureSettingsToNative } from '../services/captureSettings';
import { PeaceHoldDetector } from '../domain/gestureDetect';
import { t, useT } from '../i18n';
import { colors, fonts, typography } from '../theme';

// dataflow の進捗を Metro ログにもミラーする sink (= 撮影画面の保存進捗)。
const sink = teeToConsole(storeEventSink, 'capture');

// 構成切替時にカメラが解放されるのを待つ猶予 (= AVCaptureSession を stop してから
// 次の session を start するまで。 カメラは排他リソースなので即貼り直すとクラッシュする)。
const CAMERA_RELEASE_DELAY_MS = 450;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureMode'>;

// ─── 状態定義 ─────────────────────────────────────────────────────────

type CaptureState =
  | { kind: 'announcing' }                                 // 取り付け案内 TTS 中 (= 「ヘッドセットに取り付けて」)
  | { kind: 'next_task_announcing' }                       // 撮影完了後の次タスク提案 TTS 中
  // 装着待ち。 端末が動かされている間は黙って待ち、 「取り付けの動きを観測 → 静止 + 装着らしい
  // 角度」 で姿勢案内へ (追跡は mountTrackRef、 判定は ticker)。
  | { kind: 'mounting' }
  | { kind: 'posture_announcing' }                         // 姿勢案内 TTS 中 (= 証明写真のポーズ)
  // IMU 誘導中 (= パーキングセンサー式)。 方向は音声で言わず、 目標角をまたいだ瞬間の
  // 音 + 振動だけで探させる。 stableSince: 許容内に入り続けている開始時刻 (0=範囲外)。
  | { kind: 'aim_adjust'; stableSince: number }
  | { kind: 'aim_confirmed' }                              // 照準確定。 aimOk TTS (= 開始ジェスチャー案内込み)
  // 開始ジェスチャー (両手チョキをキープ) 待ち。 検出は subscription が startSeqRef に流す。
  | { kind: 'awaiting_start' }
  // 録画中。 終了ジェスチャー (両手チョキを長めにキープ) は stopSeqRef が検出し、 完了で finalizing へ。
  | { kind: 'recording'; startTs: number; lastHandSeenTs: number; lastWarnTs: number }
  | { kind: 'finalizing' };

// 開始・終了トリガー = 両手チョキを少しキープ (domain/gestureDetect の PeaceHoldDetector)。
// チョキ検出の瞬間にブリップ + 小さな振動、 キープしきったら即座に録画を開始 / 終了する。
// 終了は家事中の偶然のチョキ形を弾くため、 開始より長めのキープを要求する。
const START_HOLD_MS = 1000;
const STOP_HOLD_MS = 1500;
const HAND_LOST_WARN_MS = 5000;
const WARN_REPEAT_MS = 7000;            // 手が映ってない警告の繰り返し間隔 (= 間延びさせない)

// 交差ティック (= 目標角をまたいだ瞬間の音 + 振動) の連射抑制。 目標付近で行き来すると
// 頻繁にまたぐが、 それ自体が「ここが目標」 のフィードバックなので軽い間引きだけにする。
const AIM_CROSS_MIN_INTERVAL_MS = 180;
// 装着待ちの判定。 静止は「tick 間の角速度」 で見る (= 装着した頭の自然な揺れ・呼吸は通し、
// 手で扱っている大きな動きだけ弾く。 絶対角のアンカー比較だと頭の微動で永遠に通らない)。
// さらに「取り付けの動きを一度は観測した後」 でないと進まない (= 手に持ったまま静止しても
// 即通過しない)。 既に装着済みで開いた場合のために MOUNT_TIMEOUT_MS で解除する。
const MOUNT_STILL_DELTA_DEG = 2;      // 1 tick (100ms) あたりの角度変化がこれ超 = 扱い中
const MOUNT_STILL_MS = 2000;
const MOUNT_MOTION_MIN_MS = 1000;     // 取り付けの動きと見なす累計時間
const MOUNT_TIMEOUT_MS = 8000;
const MOUNT_WORN_PITCH_RANGE = { min: -30, max: 70 } as const; // 机に平置き (≈90°) を除外
// 照準誘導中に激しい動き (= 読めない加速度) が続いたら装着し直しと見なして装着待ちへ戻す。
const AIM_REMOUNT_NULL_MS = 1200;

// ─── 音声ガイド ───────────────────────────────────────────────────────
//
// ⚠ アーキ原則: 音声 (SFX/TTS) は state の副作用として state→audio effect が enqueue するだけ。
//    状態遷移は音声 callback で駆動しない (= captureAudio の getLastSpeechDone を ticker が読んで判定)。
//    この方針で「キャンセルした前試行の onDone が新試行で誤発火」 類の競合が原理的に起きない。

// 音声ガイドの文言はトーン = 機内アナウンス調 (= 丁寧・穏やか・誰にでも明確、 砕けすぎない)。
// i18n 辞書 (capture.tts.*) に locale 別で持つ。 ja は読み間違い回避済 (= 「方」「開いて」 不使用)。
const NEXT_TASK_PAUSE_MS = 1000;

// 各 state の「入場時に鳴らす cue」。 sfx → tts の順でキューに積まれる。 announcing だけは enter_capture
// 効果音 (handoff が積む) の後に続けたいので clearAudioQueue しない (= keep)。
// aim_adjust のヒント発話は方向・間隔の条件付きなので ticker 側で個別に積む (= entryCue ではない)。
function entryCue(s: CaptureState): { sfx?: SfxName; tts?: string; keep?: boolean } | null {
  switch (s.kind) {
    case 'announcing':
      return { tts: t('capture.tts.intro'), keep: true };
    case 'posture_announcing':
      return { tts: t('capture.tts.posture') };
    case 'aim_adjust':
      // 誘導の説明は入場時に 1 回だけ。 以降は交差ティック (音 + 振動) だけで探させる。
      return { tts: t('capture.tts.aimExplore') };
    // next_task_announcing は二部構成 (お疲れさま → 間 → 続けるなら) なので state→audio effect で個別に積む。
    case 'aim_confirmed':
      // 照準確定。 到達ビープは ticker が即時再生する。 開始ジェスチャーの案内込み。
      return { tts: t('capture.tts.aimOk') };
    default:
      return null;
  }
}

// ─── 画面本体 ─────────────────────────────────────────────────────────

export const CaptureScreen: React.FC<Props> = (props) => (
  <SafeAreaProvider>
    <CaptureBody {...props} />
  </SafeAreaProvider>
);

const CaptureBody: React.FC<Props> = ({ navigation }) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const STATUS_BAR_H = 20;
  const safeTop = Math.max(insets.top, STATUS_BAR_H);
  const safeLeft = insets.left;
  const safeRight = insets.right;
  const safeBottom = insets.bottom;

  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  // available = 現在アクティブな撮影構成が当端末で使えるか。
  const [available, setAvailable] = useState<boolean | null>(null);

  // 撮影構成は録画待機中のみ切替可能 (= ultra_wide ⇄ arkit、 DevSandbox と同じ要領)。
  // selectedConfigId = ユーザーが選んだ構成 (= 切替目標)。 activeConfigId = 実際に session が
  // 稼働中の構成 (= preview / hand-track はこちらを使う)。
  const [selectedConfigId, setSelectedConfigId] = useState<string>(DEFAULT_RECORDING_CONFIG.id);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [availByConfig, setAvailByConfig] = useState<Record<string, boolean>>({});
  // 退場中フラグ: 戻る瞬間にプレビューを隠して、 portrait へ回転する間に landscape 映像が残らないようにする。
  const [leaving, setLeaving] = useState(false);
  const config = getRecordingConfig(selectedConfigId) ?? DEFAULT_RECORDING_CONFIG;
  // session 操作 (start/stop) はカメラ排他のため直列化する (= 重ねるとクラッシュ)。
  const sessionOpRef = useRef<Promise<void>>(Promise.resolve());
  const runningConfigRef = useRef<RecordingConfig | null>(null);

  // 起動直後は announcing から始める (= TTS 「手のひらを上向きに 3 秒キープ」 を最後まで言わせる)
  const [state, setState] = useState<CaptureState>({ kind: 'announcing' });
  const [error, setError] = useState<string | null>(null);
  // 録画経過秒 (= 右上の読み出し)。 基準は native 録画開始の wall-clock (recordingStartedAtRef)。
  const [elapsedSec, setElapsedSec] = useState(0);
  // HUD スクリムの実寸 (= SVG は % サイズが効かないので onLayout で測って px 指定する)
  const [hudSize, setHudSize] = useState<{ w: number; h: number } | null>(null);
  const latestHandRef = useRef<HandTrackEvent | null>(null);
  // 開始 / 終了の両手チョキキープ検出器 (= フェーズ入場時に作り直す)。
  const startSeqRef = useRef<PeaceHoldDetector | null>(null);
  const stopSeqRef = useRef<PeaceHoldDetector | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const recordingStartedRef = useRef(false);
  // 録画尺 (= POST /api/clips の durationMs) 算出用に、 native 録画開始の wall-clock を控える。
  const recordingStartedAtRef = useRef(0);
  const sessionDirRef = useRef<string | null>(null);

  // 照準較正: 学習済み補正のロード + 誘導フェーズ中だけ加速度計を回す。
  useEffect(() => { void loadLearnedAim(); }, []);
  const aimPhaseActive =
    state.kind === 'announcing' || state.kind === 'mounting' ||
    state.kind === 'posture_announcing' || state.kind === 'aim_adjust';
  const { readingRef: pitchRef, hudPitchDeg } = useCameraPitch(aimPhaseActive);
  // 録画中の手の在圏統計 (= クリップ終了時に目標俯角を更新) と「かけ直し」 監視。
  const aimStatsRef = useRef<SessionAimStats | null>(null);
  const redoMonitorRef = useRef<RedoMonitor | null>(null);
  // 交差ティック用: 直前の誤差 (符号反転 = 目標角をまたいだ) と直近ティック時刻。
  const aimPrevErrRef = useRef<number | null>(null);
  const aimLastCrossTsRef = useRef(0);
  // 照準誘導中の「装着し直し」 検知 (= 読めない加速度が続いた開始時刻)。
  const aimNullSinceRef = useRef(0);
  // 装着待ちの追跡 (= ref で持ち、 遷移の瞬間だけ setState する。 10Hz の再描画を避ける)。
  const mountTrackRef = useRef({ enteredTs: 0, lastPitch: null as number | null, motionMs: 0, stillSince: 0 });
  useEffect(() => {
    if (state.kind === 'aim_adjust') {
      aimPrevErrRef.current = null;
      aimLastCrossTsRef.current = 0;
      aimNullSinceRef.current = 0;
    }
    if (state.kind === 'mounting') {
      mountTrackRef.current = { enteredTs: Date.now(), lastPitch: null, motionMs: 0, stillSince: 0 };
    }
    if (state.kind === 'awaiting_start') startSeqRef.current = new PeaceHoldDetector(START_HOLD_MS);
    if (state.kind === 'recording') stopSeqRef.current = new PeaceHoldDetector(STOP_HOLD_MS);
  }, [state.kind]);
  // 「今の voiced state が待っている発話の seq」 (0 = まだ発行前 / 音声ゲート無し)。
  // voiced state へ遷移する瞬間に 0 にし (= 前 state の完了済 seq との誤一致を防ぐ)、
  // state→audio effect が発話を enqueue した seq をここに入れる。 ticker は
  // getLastSpeechDone().seq === awaitedSpeechSeqRef.current で「言い終わった」 と判定する。
  const awaitedSpeechSeqRef = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // 画面の向き (= 全画面 landscape) は RootNavigator の native-stack `orientation` オプションが
  // ネイティブ (react-native-screens) で管理する。

  // 効果音 preload (= 起動時に Sound インスタンスを全部展開)
  useEffect(() => {
    preloadCaptureSounds().catch(() => {});
    return () => {
      unloadCaptureSounds().catch(() => {});
    };
  }, []);

  // 権限確認 + 全撮影構成の利用可否判定 (= スイッチャ表示用)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await Camera.getCameraPermissionsAsync();
        if (cancelled) return;
        if (!existing.granted) {
          const requested = await Camera.requestCameraPermissionsAsync();
          if (cancelled) return;
          setPermission(requested.granted ? 'granted' : 'denied');
        } else {
          setPermission('granted');
        }
        const entries = await Promise.all(
          RECORDING_CONFIGS.map(async (c) => [c.id, await c.isAvailable().catch(() => false)] as const),
        );
        if (!cancelled) setAvailByConfig(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 撮影構成の session ハンドオフ (= DevSandbox と同じ直列化)。 config が変わるたびに
  // 「旧 session 完全停止 (await) → カメラ解放待ち → 新 session 開始」 を直列実行する。
  // permission 許可後のみ動く。
  useEffect(() => {
    if (permission !== 'granted') return;
    let cancelled = false;
    const target = config;
    sessionOpRef.current = sessionOpRef.current
      .then(async () => {
        if (cancelled) return;
        const running = runningConfigRef.current;
        if (running && running.id === target.id) return; // 既に稼働中

        const ok = await target.isAvailable().catch(() => false);
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) {
          sink({ step: 'capture', level: 'warn', message: `撮影構成 ${target.id} は当端末で利用不可` });
          return;
        }

        setSwitching(true);
        if (running) {
          await running.stopSession(sink).catch((e) =>
            sink({ step: 'capture', level: 'warn', message: `旧 session 停止: ${errMsg(e)}` }),
          );
          runningConfigRef.current = null;
          setActiveConfigId(null);
          await delay(CAMERA_RELEASE_DELAY_MS);
          if (cancelled) return;
        }
        // 保存済みの撮影設定 (解像度 / レート / ストリーム) を session 起動前に native へ反映
        await applyCaptureSettingsToNative().catch((e) =>
          sink({ step: 'capture', level: 'warn', message: `撮影設定の適用失敗: ${errMsg(e)}` }),
        );
        await target.startSession(sink);
        runningConfigRef.current = target;
        if (cancelled) return;
        // session が安定した後に進入効果音を積む (= camera 再構成での切れを避ける)。 setActiveConfigId
        // (= 案内 TTS のトリガ) より「先に」 積むので、 enter 音 → 案内 TTS の順が確定する。
        enqueueSfx('enter_capture');
        setActiveConfigId(target.id);
      })
      .catch((e) => sink({ step: 'capture', level: 'error', message: `session 切替失敗: ${errMsg(e)}` }))
      .finally(() => { if (!cancelled) setSwitching(false); });
    return () => { cancelled = true; };
  }, [config, permission]);

  // アンマウント時に稼働中 session を停止する。
  useEffect(() => {
    return () => {
      const running = runningConfigRef.current;
      runningConfigRef.current = null;
      if (running) running.stopSession(sink).catch(() => {});
    };
  }, []);

  // 画面が landscapeRight に固定されるので、 native にも landscapeRight を固定で渡す (= 変化リスナー無し)。
  // ⚠ 上の lock を LANDSCAPE_LEFT に変えるなら、 ここも 'landscapeLeft' に揃えること。
  useEffect(() => {
    config.setDisplayOrientation('landscapeRight').catch(() => {});
  }, [config]);

  // hand track subscription (= アクティブ構成のストリームを購読、 切替で貼り替え)。
  // ⚠ ここで tickState() を呼ばない: native イベントは ~15-30Hz で来るので、 毎イベント
  //    setState すると再描画ストーム → "Maximum update depth" でクラッシュする。 状態機械は
  //    下の 100ms ticker が単独で進める。 ここは ref 更新 + 系列イベントの瞬間だけ setState。
  useEffect(() => {
    const subc = config.subscribeHandTrack((e) => {
      latestHandRef.current = e;
      const now = Date.now();
      const k = stateRef.current.kind;
      // 録画中は手の在圏統計 + かけ直し監視に流す (= per-frame、 setState はしない)。
      if (k === 'recording') {
        aimStatsRef.current?.add(e);
        redoMonitorRef.current?.add(e, now);
      }
      // 開始・終了ジェスチャー (= 両手チョキをキープ)。 チョキ検出でブリップ + 小さな振動、
      // キープ完了で開始 / 終了。 per-frame で流すが、 setState するのは完了イベントの瞬間だけ。
      if (k === 'awaiting_start' || k === 'recording') {
        const det = k === 'awaiting_start' ? startSeqRef.current : stopSeqRef.current;
        const evt = det?.push(e.wearerHands, now) ?? null;
        if (evt === 'armed') {
          playSfx('countdown_tick');
          Vibration.vibrate(50);
        } else if (evt === 'complete') {
          if (k === 'awaiting_start') {
            playSfx('countdown_end');
            Vibration.vibrate(200);
            setState({ kind: 'recording', startTs: now, lastHandSeenTs: now, lastWarnTs: 0 });
          } else {
            Vibration.vibrate(200); // 停止音 (rec_stop) は finalizing effect が鳴らす
            clearAudioQueue();
            setState({ kind: 'finalizing' });
          }
        }
      }
    });
    return () => subc.remove();
  }, [config]);

  // state→audio (一方向): state.kind が変わったら、 その state の入場 cue を鳴らす。
  // 状態遷移はしない (= 遷移は ticker が getLastSpeechDone を見て決める)。 TTS を積んだら seq を
  // awaitedSpeechSeqRef に記録し、 ticker がその完了を判定する。
  // announcing だけは「session 起動 (activeConfigId) を待つ」 + 「enter_capture の後に続ける (keep)」。
  useEffect(() => {
    // 撮影完了後の案内: 「お疲れさま → 少し間 → 続けるなら手のひらを」 の二部構成。 待つのは最後の発話の seq。
    if (state.kind === 'next_task_announcing') {
      clearAudioQueue();
      enqueueSpeak(t('capture.tts.done'));
      enqueuePause(NEXT_TASK_PAUSE_MS);
      awaitedSpeechSeqRef.current = enqueueSpeak(t('capture.tts.continue'));
      return;
    }
    const cue = entryCue(state);
    if (!cue) return;
    // announcing の案内 TTS は「稼働中の session が選択中の構成と一致する」 まで積まない。
    // ⚠ これが無いと、 切替時に onSelectConfig が state を announcing にした瞬間、 activeConfigId が
    //    まだ旧構成 (truthy) のため handoff の enter_capture より先に TTS が積まれてしまう
    //    (= 初回オープンは activeConfigId=null から始まるので問題が出ず、 切替時だけ順序が崩れていた)。
    //    一致を要求すると、 handoff が enter_capture を積んでから setActiveConfigId(新) した後に初めて
    //    TTS が積まれ、 初回オープンと完全に同じ「enter 音 → 案内 TTS」 の順になる。
    if (state.kind === 'announcing' && (permission !== 'granted' || activeConfigId !== config.id)) return;
    if (!cue.keep) clearAudioQueue();
    if (cue.sfx) void enqueueSfx(cue.sfx);
    if (cue.tts) {
      awaitedSpeechSeqRef.current = enqueueSpeak(cue.tts);
    }
  }, [state.kind, permission, activeConfigId, config.id]);

  // 録画状態に入ったら native の startRecording を呼ぶ + recording 終了で finalize。
  // 二重発火 guard: recordingStartedRef + 「同 cycle で 1 度しか呼ばない」 を厳格化。
  useEffect(() => {
    if (state.kind === 'recording' && !recordingStartedRef.current) {
      recordingStartedRef.current = true;  // 同期で即 true、 後続 fire 防止
      aimStatsRef.current = new SessionAimStats();
      redoMonitorRef.current = new RedoMonitor();
      (async () => {
        try {
          const session = await config.startRecording(sink);
          recordingStartedAtRef.current = Date.now();
          sessionDirRef.current = session.sessionDir;
          // 録画開始の合図は countdown_end (= precapture_countdown 末尾で 1 度だけ鳴る) で完結。
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`${t('capture.recStartFailed')}: ${e?.message ?? e}`);
          setState({ kind: 'awaiting_start' });
        }
      })();
    }
    if (state.kind === 'finalizing') {
      (async () => {
        try {
          // 停止確定 → 残っている案内音声 (「このままキープ…」 等) を捨てて停止音を即鳴らせるようにする。
          clearAudioQueue();
          const session = await config.stopRecording(sink);
          sessionDirRef.current = session.sessionDir;

          // v0.1.4: ここでは自動アップロードしない。 state 'recorded' でローカル一覧 (マイビデオ) に
          // 積むだけ。 ユーザーがプレビュー確認 → 「アップロード」 した時に advanceClip が進める。
          // 録画尺 = native stop の wall-clock − 録画開始の wall-clock (= 端末申告)。
          const startedAt = recordingStartedAtRef.current;
          const durationMs = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : null;
          recordingStartedAtRef.current = 0;
          try {
            await enqueueRecording({
              config,
              session,
              durationMs,
              deviceModel: Device.modelId ?? null,
            });
          } catch (e) {
            sink({ step: 'capture', level: 'error', message: `保存失敗: ${errMsg(e)}` });
          }

          recordingStartedRef.current = false;
          sessionDirRef.current = null;

          // このクリップの手の在圏統計から次回の目標俯角を更新 (= 逐次補正)。
          const stats = aimStatsRef.current;
          aimStatsRef.current = null;
          redoMonitorRef.current = null;
          if (stats) {
            const applied = updateLearnedAim(stats);
            if (applied !== 0) {
              sink({
                step: 'capture', level: 'info',
                message: `照準の学習補正を ${applied > 0 ? '+' : ''}${applied.toFixed(1)}° 更新 (次回目標 ${aimTargetPitchDownDeg().toFixed(0)}° 下向き)`,
              });
            }
          }

          // 停止音 (= 撮影終了) が鳴り終わってから次タスク提案へ進む (= 音と表示のズレを無くす)。
          await enqueueSfx('rec_stop');
          if (stateRef.current.kind !== 'finalizing') return;
          // 終了の合図のあと少し間を置いてから次の案内へ (= 畳みかけない)。
          await delay(900);
          if (stateRef.current.kind !== 'finalizing') return;
          // 次タスク案内は state→audio effect が鳴らし、 完了で ticker が awaiting_palm に遷移する。
          awaitedSpeechSeqRef.current = 0; // 前 state の完了 seq との誤一致防止
          setState({ kind: 'next_task_announcing' });
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`${t('capture.recStopFailed')}: ${e?.message ?? e}`);
          setState({ kind: 'awaiting_start' });
        }
      })();
    }
  }, [state.kind]);

  // 状態遷移処理
  const tickState = useCallback(() => {
    const e = latestHandRef.current;
    const now = Date.now();
    const cur = stateRef.current;

    // 待っている発話 (= awaitedSpeechSeqRef) が「自然に最後まで言い終わった」 か。
    const speechDone = (): boolean => {
      const want = awaitedSpeechSeqRef.current;
      return want > 0 && getLastSpeechDone().seq === want;
    };

    switch (cur.kind) {
      case 'announcing': {
        // 取り付け案内を言い終わったら装着待ちへ。
        if (speechDone()) setState({ kind: 'mounting' });
        return;
      }
      case 'next_task_announcing': {
        // クリップ間は装着済みなので、 装着待ちを飛ばして照準確認へ。
        if (speechDone()) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'aim_adjust', stableSince: 0 });
        }
        return;
      }
      case 'mounting': {
        const reading = pitchRef.current;
        if (!reading.available) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'aim_confirmed' });
          return;
        }
        const track = mountTrackRef.current;
        const pitch = reading.pitchDownDeg;
        // 動いているか = 読めない加速度 (激しい動き) or tick 間の角度変化が大きい。
        const inMotion =
          pitch == null || track.lastPitch == null ||
          Math.abs(pitch - track.lastPitch) > MOUNT_STILL_DELTA_DEG;
        track.lastPitch = pitch;
        if (inMotion) {
          track.motionMs += 100; // ≒ ticker 周期
          track.stillSince = 0;
          return;
        }
        const wornRange = pitch >= MOUNT_WORN_PITCH_RANGE.min && pitch <= MOUNT_WORN_PITCH_RANGE.max;
        if (!wornRange) {
          track.stillSince = 0; // 静止しているが装着角度ではない (= 机置き等)。 黙って待つ
          return;
        }
        if (track.stillSince === 0) track.stillSince = now;
        // 取り付けの動きを一度は見ているか、 既装着でタイムアウトしたか。
        const handled = track.motionMs >= MOUNT_MOTION_MIN_MS || now - track.enteredTs >= MOUNT_TIMEOUT_MS;
        if (handled && now - track.stillSince >= MOUNT_STILL_MS) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'posture_announcing' });
        }
        return;
      }
      case 'posture_announcing': {
        // 姿勢案内を言い終わったら照準誘導へ。
        if (speechDone()) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'aim_adjust', stableSince: 0 });
        }
        return;
      }
      case 'aim_adjust': {
        const reading = pitchRef.current;
        if (!reading.available) {
          // 加速度計が使えない端末では誘導をスキップして開始案内へ。
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'aim_confirmed' });
          return;
        }
        const pitch = reading.pitchDownDeg;
        if (pitch == null) {
          // 読めない加速度が続く = ヘッドセットを外して扱っている。 装着待ちへ戻す。
          const since = aimNullSinceRef.current || now;
          aimNullSinceRef.current = since;
          if (now - since >= AIM_REMOUNT_NULL_MS) setState({ kind: 'mounting' });
          return;
        }
        aimNullSinceRef.current = 0;
        const err = pitch - aimTargetPitchDownDeg(); // 正 = 下向きすぎ

        // 交差ティック: 目標角をまたいだ瞬間に音 + 振動 (= どっちに傾けるかは言わず、 探させる)。
        const prevErr = aimPrevErrRef.current;
        aimPrevErrRef.current = err;
        if (prevErr != null && err * prevErr < 0 && now - aimLastCrossTsRef.current >= AIM_CROSS_MIN_INTERVAL_MS) {
          aimLastCrossTsRef.current = now;
          playSfx('countdown_tick');
          Vibration.vibrate(60);
        }

        if (Math.abs(err) <= AIM_TOLERANCE_DEG) {
          const since = cur.stableSince || now;
          if (now - since >= AIM_STABLE_MS) {
            // 目標付近でしばらく保持 → 確定。 到達音 + 長めの振動で「もう動かさなくていい」 を伝える。
            playSfx('detect_palm');
            Vibration.vibrate(400);
            awaitedSpeechSeqRef.current = 0;
            setState({ kind: 'aim_confirmed' });
          } else if (since !== cur.stableSince) {
            setState({ ...cur, stableSince: since });
          }
          return;
        }
        if (cur.stableSince !== 0) setState({ ...cur, stableSince: 0 });
        return;
      }
      case 'aim_confirmed': {
        // 照準確定 + 開始ジェスチャー案内を言い終わったら系列待ちへ。
        if (speechDone()) setState({ kind: 'awaiting_start' });
        return;
      }
      case 'awaiting_start':
        // 開始ジェスチャー (両手チョキのキープ) は subscription が検出して遷移させる。 ここでは何もしない。
        return;
      case 'recording': {
        if (!e) return;
        const handVisible = e.wearerHandCount >= 1;
        let lastHandSeen = cur.lastHandSeenTs;
        let lastWarn = cur.lastWarnTs;
        if (handVisible) {
          lastHandSeen = now;
        } else if (now - cur.lastHandSeenTs >= HAND_LOST_WARN_MS && now - cur.lastWarnTs >= WARN_REPEAT_MS) {
          // 警告は遷移を駆動しない副作用 (= fire-and-forget で enqueue)。
          void enqueueSfx('warn_hand_lost');
          enqueueSpeak(t('capture.tts.handLost'));
          lastWarn = now;
        }
        // 手が下端に外れ続ける (= 照準が上すぎるシグネチャ) なら 1 クリップ 1 回だけ「かけ直し」 を提案。
        // 位置ズレだけなら黙って統計に貯め、 次クリップ開始時の較正に任せる (= 作業を中断させない)。
        if (redoMonitorRef.current?.shouldSuggestRedo()) {
          void enqueueSfx('warn_hand_lost');
          enqueueSpeak(t('capture.tts.redoSuggest'));
        }
        // 終了ジェスチャー (両手チョキのキープ) は subscription が検出して finalizing へ遷移させる。
        if (lastHandSeen !== cur.lastHandSeenTs || lastWarn !== cur.lastWarnTs) {
          setState({ ...cur, lastHandSeenTs: lastHandSeen, lastWarnTs: lastWarn });
        }
        return;
      }
      case 'finalizing':
        return;
    }
  }, []);

  // 状態機械の単一ドライバ (= 100ms 周期)。 hand event はここでは駆動せず ref に積むだけなので、
  // tickState はこの ticker だけが回す (= 再描画は tickState 内の setState のみ)。
  useEffect(() => {
    const id = setInterval(() => {
      tickState();
    }, 100);
    return () => clearInterval(id);
  }, [tickState]);

  // 録画経過タイマー (= 0.5s 刻み。 native 録画開始時刻を基準にするので state 遷移で揺れない)
  useEffect(() => {
    if (state.kind !== 'recording') { setElapsedSec(0); return; }
    const id = setInterval(() => {
      const base = recordingStartedAtRef.current;
      if (base > 0) setElapsedSec(Math.floor((Date.now() - base) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [state.kind]);

  // クリーンアップ (= 録画中なら停止。 session 自体は handoff effect の unmount cleanup が止める)
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current) {
        runningConfigRef.current?.stopRecording(sink).catch(() => {});
      }
      clearAudioQueue(); // 保留中の音声 + 再生中を停止
    };
  }, []);

  const onBack = useCallback(() => {
    if (recordingStartedRef.current) {
      runningConfigRef.current?.stopRecording(sink).catch(() => {});
    }
    // 全画面 landscape 化に伴い、 退場時の portrait 先回りは不要になった (= タブも landscape)。
    // プレビューだけ隠してスムーズに戻る。
    setLeaving(true);
    requestAnimationFrame(() => navigation.goBack());
  }, [navigation]);

  // 撮影構成の切替 (= キャリブレーション待機中のみ)。 切替後はキャリブレーションを最初からやり直す。
  const onSelectConfig = useCallback((id: string) => {
    if (id === selectedConfigId) return;
    const k = stateRef.current.kind;
    const calibratePhase =
      k === 'announcing' || k === 'next_task_announcing' || k === 'mounting' ||
      k === 'posture_announcing' || k === 'aim_adjust' || k === 'aim_confirmed' ||
      k === 'awaiting_start';
    if (!calibratePhase) return;
    clearAudioQueue(); // 切替で旧構成の案内音声を止める
    setSelectedConfigId(id);
    setState({ kind: 'announcing' });
  }, [selectedConfigId]);

  // ─── ガード描画 ──────────────────────────────────────────────────

  // どの撮影構成も使えない端末だけ全画面で弾く (= 個別構成の非対応は preview placeholder で示す)。
  const availKnown = Object.keys(availByConfig).length > 0;
  const noConfigAvailable = availKnown && RECORDING_CONFIGS.every((c) => !availByConfig[c.id]);

  if (permission === 'pending' || available === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.emerald} />
        <Text style={styles.body}>{t('capture.preparing')}</Text>
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>{t('capture.permissionTitle')}</Text>
        <Text style={styles.body}>{t('capture.permissionBody')}</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }
  if (noConfigAvailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>{t('capture.unsupportedTitle')}</Text>
        <Text style={styles.body}>{t('capture.unsupportedBody')}</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  const isRecording = state.kind === 'recording';

  // 切替可能なのはキャリブレーション待機中のみ (= 録画フロー中は不可)。
  const inCaptureFlow = isRecording || state.kind === 'finalizing';
  const canSwitchConfig = !switching && !inCaptureFlow;
  void canSwitchConfig; // スイッチャ UI コメントアウト中も切替ロジックは温存

  // プレビューは「実際に稼働中の構成」 の native view を出す (= 切替完了後に swap)。
  const PreviewView =
    activeConfigId === 'arkit'
      ? ArkitCapturePreviewView
      : activeConfigId === 'ultra_wide'
        ? WideCapturePreviewView
        : null;

  // ─── HUD (= 画面下の字幕。 今やることを平易な日本語 1 文で) ────────────
  // 頭部装着中は画面が見えない前提: 音声が主チャネル、 画面は「装着前の準備」 と
  // 「外した瞬間の状態把握」 のためにある。 だからラベルや飾りではなく、 状態そのものを大きく言う。
  // 字幕は TTS の読み上げ文そのまま (= 音声とスクリーンで説明が一致する)。
  const hud = ((): { text: string; tone: 'normal' | 'accent' | 'dim' } | null => {
    switch (state.kind) {
      case 'announcing':
      case 'mounting':
        return { text: t('capture.tts.intro'), tone: 'normal' };
      case 'posture_announcing':
        return { text: t('capture.tts.posture'), tone: 'normal' };
      case 'aim_adjust':
        // 許容内で安定待ちなら「そのまま」、 探索中は説明文 (= TTS と同文)。
        if (state.stableSince !== 0) return { text: t('capture.hud.detecting'), tone: 'accent' };
        return { text: t('capture.tts.aimExplore'), tone: 'normal' };
      case 'aim_confirmed':
      case 'awaiting_start':
        return { text: t('capture.tts.aimOk'), tone: state.kind === 'aim_confirmed' ? 'accent' : 'normal' };
      case 'recording':
        return { text: t('capture.hud.recordingHint'), tone: 'dim' };
      case 'finalizing':
        return { text: t('capture.hud.saving'), tone: 'normal' };
      case 'next_task_announcing':
        return { text: `${t('capture.tts.done')} ${t('capture.tts.continue')}`, tone: 'normal' };
    }
  })();

  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        {leaving ? (
          // 退場中は黒画面 (= 遷移の間カメラ映像が残らないように)
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        ) : activeConfigId && PreviewView ? (
          <PreviewView style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.previewPlaceholder]}>
            <ActivityIndicator color={colors.emerald} />
            <Text style={styles.body}>
              {switching ? t('capture.switchingConfig', { config: config.id }) : t('capture.previewStarting')}
            </Text>
          </View>
        )}
      </View>

      {/* 録画中の全周枠 (= 遠目でも「録画している」 が一目で分かる、 カメラの文法) */}
      {isRecording ? <View style={styles.recFrame} pointerEvents="none" /> : null}

      {/*
        撮影構成スイッチャ (ultra_wide ⇄ arkit) は当面 arkit 固定運用のため UI を非表示にする
        (= DEFAULT_RECORDING_CONFIG が arkit)。 切替処理 (= onSelectConfig + session ハンドオフ
        effect: カメラ排他のため「旧 session 完全停止 → 解放待ち → 新 session 起動」 を直列化)
        はデリケートなのでロジックごと温存し、 ここの UI だけ畳む。 復活時はこのコメントを外す:

      {RECORDING_CONFIGS.length > 1 ? (
        <View
          style={[styles.configSwitcher, { bottom: safeBottom + 16, left: safeLeft, right: safeRight }]}
          pointerEvents={canSwitchConfig ? 'auto' : 'none'}
        >
          {RECORDING_CONFIGS.map((c) => {
            const selected = c.id === config.id;
            const avail = availByConfig[c.id];
            const disabled = avail === false || !canSwitchConfig || selected;
            return (
              <Pressable
                key={c.id}
                onPress={() => onSelectConfig(c.id)}
                disabled={disabled}
                style={[
                  styles.configChip,
                  selected && styles.configChipSel,
                  (avail === false || !canSwitchConfig) && styles.configChipDim,
                ]}
                hitSlop={6}
              >
                <Text style={[styles.configChipText, selected && styles.configChipTextSel]}>
                  {c.id}{avail === false ? ' x' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      */}

      {/* 左上: 戻る (録画中は緊急停止) */}
      <View style={[styles.chromeTopLeft, { top: safeTop + 12, left: safeLeft + 12 }]}>
        <Pressable
          accessibilityLabel={isRecording ? t('capture.emergencyStop') : t('common.back')}
          onPress={onBack}
          style={({ pressed }) => [
            styles.closeBtn,
            isRecording && styles.closeBtnRec,
            pressed && styles.closeBtnPressed,
          ]}
          hitSlop={8}
        >
          <Svg width={18} height={18} viewBox="0 0 18 18">
            <Line x1={4} y1={4} x2={14} y2={14} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
            <Line x1={14} y1={4} x2={4} y2={14} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>

      {/* 右上: 録画中 + 経過時間 (= 機材の読み出し) */}
      {isRecording ? (
        <View style={[styles.recBadge, { top: safeTop + 12, right: safeRight + 12 }]} pointerEvents="none">
          <PulsingDot />
          <Text style={styles.recBadgeLabel}>{t('capture.recordingLabel')}</Text>
          <Text style={styles.recBadgeTime}>{formatElapsed(elapsedSec)}</Text>
        </View>
      ) : null}

      {/* 下部: 指示字幕 (= TTS と同文。 グラデーションスクリムの上に、 遠くから読める大きさ) */}
      {hud ? (
        <View
          style={[styles.hud, { paddingBottom: safeBottom + 22, paddingLeft: safeLeft + 32, paddingRight: safeRight + 32 }]}
          pointerEvents="none"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setHudSize((cur) => (cur && cur.w === width && cur.h === height ? cur : { w: width, h: height }));
          }}
        >
          {hudSize ? (
            <Svg width={hudSize.w} height={hudSize.h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 1 1">
              <Defs>
                <SvgLinearGradient id="hudScrim" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#06070A" stopOpacity="0" />
                  <Stop offset="0.45" stopColor="#06070A" stopOpacity="0.58" />
                  <Stop offset="1" stopColor="#06070A" stopOpacity="0.9" />
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width="1" height="1" fill="url(#hudScrim)" />
            </Svg>
          ) : null}
          <View style={styles.hudMark} />
          <View style={styles.hudLine}>
            <Text
              style={[
                styles.hudText,
                hud.tone === 'accent' && styles.hudTextAccent,
                hud.tone === 'dim' && styles.hudTextDim,
              ]}
              numberOfLines={3}
            >
              {hud.text}
            </Text>
          </View>
          {/* 照準誘導・装着待ち中の俯角読み出し (= セットアップや介助者向け。 装着者は音声で足りる) */}
          {(state.kind === 'aim_adjust' || state.kind === 'mounting') && hudPitchDeg != null ? (
            <Text style={styles.hudReadout}>
              {t('capture.hud.aimReadout', {
                current: String(hudPitchDeg),
                target: String(Math.round(aimTargetPitchDownDeg())),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* エラー表示 (= 字幕の上) */}
      {error ? (
        <View
          style={[styles.chromeBottom, { bottom: safeBottom + 110, left: safeLeft + 16, right: safeRight + 16 }]}
          pointerEvents="none"
        >
          <View style={styles.errCard}>
            <Text style={styles.errBody} numberOfLines={3}>{error}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

// ─── 小部品 ───────────────────────────────────────────────────────────

/// 録画中ドット (= ゆっくり明滅。 静止画でも赤が残るよう opacity 1 → 0.35)。
const PulsingDot: React.FC = () => {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return <Animated.View style={[styles.recDot, { opacity: anim }]} />;
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return `${m}:${s2.toString().padStart(2, '0')}`;
}

// ─── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { ...StyleSheet.absoluteFillObject },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#000' },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 12, backgroundColor: colors.paper,
  },
  eyebrow: { ...typography.label, color: colors.textMute },
  body: { ...typography.body, color: colors.textInk, textAlign: 'center', maxWidth: 320 },
  btn: {
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 8, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  btnLabel: {
    color: colors.ink, fontSize: 14,
    fontFamily: fonts.sansSemibold,
  },

  // 撮影構成スイッチャ (= コメントアウト中の復活用に温存)
  configSwitcher: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  configChip: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(11,13,17,0.66)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  configChipSel: { backgroundColor: 'rgba(232,163,61,0.9)', borderColor: 'rgba(255,255,255,0.25)' },
  configChipDim: { opacity: 0.4 },
  configChipText: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.0,
  },
  configChipTextSel: { color: '#131519' },

  chromeTopLeft: { position: 'absolute' },
  chromeBottom: { position: 'absolute', alignItems: 'center' },

  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(11,13,17,0.66)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  closeBtnRec: { backgroundColor: 'rgba(224,85,72,0.9)' },
  closeBtnPressed: { opacity: 0.7 },

  // 録画中の全周枠
  recFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 3,
    borderColor: 'rgba(224,85,72,0.85)',
  },

  // 右上: ● 録画中 0:00
  recBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(11,13,17,0.66)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E05548' },
  recBadgeLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  recBadgeTime: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fonts.mono,
    fontSize: 12.5,
    letterSpacing: 0.5,
  },

  // 下部の指示字幕 (= 映画字幕の文法。 スクリムは SVG グラデーション、 文字は文章向けに整える)
  hud: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingTop: 52,
    alignItems: 'center',
  },
  // フィルムのリーダーマーク (= 字幕の座りを作る琥珀の小さな棒)
  hudMark: {
    width: 26,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.emerald,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  hudLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    maxWidth: 820,
  },
  hudText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 19.5,
    lineHeight: 31,
    letterSpacing: 0.3,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  hudTextAccent: { color: colors.emerald },
  hudTextDim: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 15.5,
    lineHeight: 24,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.4,
  },
  // 照準誘導中の俯角読み出し (= 機材の計器風、 字幕の下に小さく)
  hudReadout: {
    marginTop: 8,
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.72)',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  errCard: {
    backgroundColor: 'rgba(224,85,72,0.94)',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12,
    maxWidth: 480,
  },
  errBody: {
    color: '#fff',
    fontFamily: fonts.sansRegular,
    fontSize: 13,
  },
});
