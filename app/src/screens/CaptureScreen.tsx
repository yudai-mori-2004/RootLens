// 撮影画面 (= v0.1.4)。 ジェスチャーキャリブレーション → 撮影 → ローカル保存、 の 3 手。
//
// 「キャリブレーション」 の意図 (= カメラの画角調整):
//   ユーザは両腕をまっすぐ前に伸ばし、 顔を指先に向ける。 その自然な視線状態でカメラ映像内に
//   両手が真ん中に映るように、 カメラの向きを物理的に微調整してもらう。 シビアに中央 (= ±5%)
//   に来た瞬間が baseline 確定。 中央外なら「カメラをもう少し ___ に向けてください」 と方向指示
//   → user が向きを調整 → もう一度腕を伸ばしてキープ → 再判定、 のループ。
//
// 2 layer:
//   1. キャリブレーション
//        - TTS: 「手のひらを上向きにして、 そのまま 1 秒キープしてください」
//        - open_palm を 1 秒 hold → 両手 bbox 中心を計算
//        - 中央 ±5% 以内 → baseline 保存 + 「ヘッドセット OK、 撮影を開始します」 → カウントダウン
//        - 外れ → 「ヘッドセットをもう少し ___ に向けてください」 → 手のひら待機に戻る
//   2. 撮影
//        - サムズアップ 1 秒 → 3 秒カウントダウン → 録画停止 → 次タスク提案 → キャリブレーションに戻る
//        - 両手が 5 秒以上画面から外れたら警告音 + TTS
//        - 1 本 ~100 分の長時間録画を想定した守り: 録画が乗ったら画面消灯 (タップで復帰)、
//          熱 critical / 空き容量低下 / 120 分で理由を読み上げて自動終了
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
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Camera } from 'expo-camera';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../app/types';
import { WideCapturePreviewView } from '../native/wideCapture';
import {
  ArkitCapturePreviewView,
  getArkitPowerState,
  getArkitThermalState,
  setArkitScreenDimmed,
  subscribeThermalState,
  type PowerState,
  type ThermalState,
} from '../native/arkitCapture';
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
import { enqueueSfx, enqueueSpeak, enqueuePause, clearAudioQueue, getLastSpeechDone, isSpeechSettled } from '../services/captureAudio';
import { applyCaptureSettingsToNative } from '../services/captureSettings';
import { useCameraPitch } from '../services/devicePitch';
import { GestureStabilizer } from '../domain/gestureDetect';
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
  // 角度」 で次の案内へ (追跡は mountTrackRef、 判定は ticker)。
  | { kind: 'mounting' }
  | { kind: 'palm_prompt' }                                // 装着完了 → パー案内 TTS 中
  | { kind: 'awaiting_palm' }                              // 両手パー待ち
  | { kind: 'palm_holding'; startTs: number }              // open_palm を 3 秒 hold 中
  | { kind: 'adjust_needed'; direction: AdjustDirection }  // 中央外。 案内 TTS 完了 (ticker 判定) 後に palm 受付
  | { kind: 'calibration_confirmed' }                      // キャリブ確定、 効果音 + TTS + 500ms 待機
  | { kind: 'precapture_countdown'; startTs: number }
  // armedSince: thumbs-up が連続検出され始めた時刻 (0=未検出)。 ARM デバウンスを state に内包。
  | { kind: 'recording'; startTs: number; lastHandSeenTs: number; lastWarnTs: number; armedSince: number }
  // lostSince: thumbs-up が見えなくなった時刻 (0=保持中)。 離脱ヒステリシスを state に内包。
  | { kind: 'stopping'; startTs: number; lostSince: number }
  | { kind: 'stopping_confirm'; startTs: number; lostSince: number }
  | { kind: 'finalizing' };

type AdjustDirection = 'up' | 'down';

// パーのキープ (= 検出ビープからこの時間キープで中央判定)
const PALM_HOLD_MS = 1000;
// 装着待ちの判定は「早く次へ進むための補助」 であって、 進行のゲートにしない。
// きれいな経路 (= 取り付けの動き → 静止 + 装着らしい角度) を検知したら早めに進み、
// 検知できなくても MOUNT_HARD_TIMEOUT_MS で必ず進む (= 判定失敗で詰む経路を作らない)。
const MOUNT_STILL_DELTA_DEG = 2;      // 1 tick (100ms) あたりの角度変化がこれ超 = 扱い中
const MOUNT_STILL_MS = 2000;
const MOUNT_MOTION_MIN_MS = 1000;     // 取り付けの動きと見なす累計時間
const MOUNT_HARD_TIMEOUT_MS = 8000;   // これを超えたら判定に関係なく次の案内へ
const MOUNT_WORN_PITCH_RANGE = { min: -40, max: 85 } as const; // 机に平置き (≈90°) だけ除外
// 停止フロー (= 人間目線): 頭部装着・両手で家事中・画面は見ない前提。 thumbs-up が ARM_MS 継続して
// 「検出」 → 即時音。 検出から HOLD_MS 立て続けると音声「そのまま立て続けると終了します」を流し、
// 音声を最後まで言い終わった時にまだ立て続けていたら停止確定 (= 固定秒で切らず、 案内を最後まで聞かせる)。
// ⚠ 停止まで「立て続け」 を要求: 家事中は手が常に動くので、 偶発検出は手が動いた瞬間にキャンセル → 録画継続。
//    意図的に手を止めて保持した時だけ止まる (= 誤停止で家事映像を失わない)。
// ⚠ 離脱判定は RELEASE_GRACE_MS のヒステリシス: 単フレームの検出フリッカーで即キャンセル (= 音声プチ切れ)
//    しないよう、 thumbs-up が連続して消えて初めて離脱とみなす。
const THUMBS_UP_ARM_MS = 300;
const THUMBS_UP_HOLD_MS = 700;   // ARM と合わせて計 1.0 秒キープでチャイム + 確認 TTS
// 離脱猶予を長めに (= 立て続けている最中の検出フリッカーを吸収。 意図的な離脱はこれより長く手を動かす)。
const RELEASE_GRACE_MS = 800;
// 開始カウント: 3,2,1 を COUNTDOWN_TICK_MS 間隔で刻む (= 120bpm)。 合計 = 3 * tick。
const COUNTDOWN_TICKS = 3;
const COUNTDOWN_TICK_MS = 500;
const HAND_LOST_WARN_MS = 5000;
const STOP_HINT_DELAY_MS = 3000;        // 録画開始から終了方法の案内までの間
const WARN_REPEAT_MS = 7000;            // 手が映ってない警告の繰り返し間隔 (= 間延びさせない)

// ── 長時間録画 (= 1 本 ~100 分想定) の守り ──
// 熱源はカメラ ISP + ARKit + 手ポーズ推論で録画中は止められない。 削れる最大の発熱源が画面なので、
// 録画が乗ったら消灯する (= 輝度 0 + プレビュー描画停止。 タップで復帰)。 加えて、 続行できない状況
// (= 熱 critical / 空き容量枯渇 / 停止し忘れ) は理由を 1 回読み上げて通常の終了フローで安全に畳む。
const DIM_AFTER_MS = 15_000;            // 録画開始からこの時間で画面消灯
const REDIM_AFTER_TAP_MS = 8_000;       // タップ復帰からの再消灯
const MAX_RECORDING_MS = 120 * 60_000;  // 停止し忘れの安全弁 (= 100 分撮影 + 余裕)
const LOW_DISK_WARN_BYTES = 12 * 1024 ** 3;  // 録画開始時にこれ未満なら一言注意
const LOW_DISK_STOP_BYTES = 2 * 1024 ** 3;   // 録画中にこれを切ったら自動終了 (= writer が死ぬ前に)
const LOW_BATTERY_WARN_LEVEL = 0.35;         // 録画開始時にこれ未満 (未充電) なら一言注意
const LOW_BATTERY_STOP_LEVEL = 0.10;         // 録画中にこれを切ったら自動終了 (= 電池切れ死の前に)
const RESOURCE_POLL_MS = 30_000;             // 録画中の空き容量 / 電池のポーリング間隔

// 中央許容範囲 (= 縦方向のみ ±10%)。 左右は姿勢でほぼ決まるので見ない (2026-07-06 判断)。
const CALIBRATION_CENTER_MARGIN = 0.10;
const LANDMARK_CONF = 0.3;

const STORAGE_BASELINE_KEY = '@rootlens/calibration/baseline/v1';

// ─── 手の bbox 中心計算 ──────────────────────────────────────────────

interface HandBoundingBox {
  cx: number;  // 0..1
  cy: number;  // 0..1
  width: number;
  height: number;
}

function computeHandBoundingBox(hands: HandTrackEvent['wearerHands']): HandBoundingBox | null {
  const visible = hands.filter((h) => h.landmarks.some((l) => l.confidence >= LANDMARK_CONF));
  if (visible.length < 2) return null;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const hand of visible) {
    for (const lm of hand.landmarks) {
      if (lm.confidence < LANDMARK_CONF) continue;
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/// 「カメラをどっち向きに動かせば手が中央に来るか」 を返す (= 縦方向のみ)。
/// 手が画面下ならカメラも下に向けてもらえば手は中央に来る (= 1 対 1)。 許容内なら null。
function computeAdjustDirection(bbox: HandBoundingBox): AdjustDirection | null {
  const dy = bbox.cy - 0.5;
  if (Math.abs(dy) <= CALIBRATION_CENTER_MARGIN) return null;
  return dy > 0 ? 'down' : 'up';
}

// ─── 音声ガイド ───────────────────────────────────────────────────────
//
// ⚠ アーキ原則: 音声 (SFX/TTS) は state の副作用として state→audio effect が enqueue するだけ。
//    状態遷移は音声 callback で駆動しない (= captureAudio の getLastSpeechDone を ticker が読んで判定)。
//    この方針で「キャンセルした前試行の onDone が新試行で誤発火」 類の競合が原理的に起きない。

// キャリブレーション音声ガイドの文言。
// トーン = 機内アナウンス調 (= 丁寧・穏やか・誰にでも明確、 砕けすぎない)。
// 文言は i18n 辞書 (capture.tts.*) に locale 別で持つ。 ja は読み間違い回避済 (= 「方」「開いて」 不使用)。
function calibAdjustText(d: AdjustDirection): string {
  return d === 'up' ? t('capture.tts.adjustUp') : t('capture.tts.adjustDown');
}

// 各 state の「入場時に鳴らす cue」。 sfx → tts の順でキューに積まれる。 announcing だけは enter_capture
// 効果音 (handoff が積む) の後に続けたいので clearAudioQueue しない (= keep)。
function entryCue(s: CaptureState): { sfx?: SfxName; tts?: string; keep?: boolean } | null {
  switch (s.kind) {
    case 'announcing':
      return { tts: t('capture.tts.intro'), keep: true };
    case 'palm_prompt':
      return { tts: t('capture.tts.palmPrompt') };
    // next_task_announcing は二部構成 (お疲れさま → 間 → 続けるなら) なので state→audio effect で個別に積む。
    case 'adjust_needed':
      return { tts: calibAdjustText(s.direction) };
    case 'calibration_confirmed':
      // 検出ビープ (detect_palm) はジェスチャー確定時に即時再生する専用 effect が鳴らす
      // (= キュー非経由で不発しない + アイコン表示と同期)。 ここは確定 TTS のみ。
      return { tts: t('capture.tts.confirmed') };
    case 'stopping':
      // 保持の前半 (= ARM 後) は無音。 作業中の偶然の検出で音を出さない。
      return null;
    case 'stopping_confirm':
      // 1.3 秒保持しきって初めて合図 (= ピロ) + 「撮影を終了します。」。 読み終わりまで保持で確定。
      return { sfx: 'detect_thumbs_up', tts: t('capture.tts.stoppingConfirm') };
    default:
      return null;
  }
}

// ─── キャリブレーション baseline 保存 ─────────────────────────────────

interface CalibrationBaseline {
  cx: number;
  cy: number;
  width: number;
  height: number;
  savedAt: number;
}

async function saveBaseline(bbox: HandBoundingBox): Promise<void> {
  const data: CalibrationBaseline = { ...bbox, savedAt: Date.now() };
  await AsyncStorage.setItem(STORAGE_BASELINE_KEY, JSON.stringify(data));
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
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  // 録画経過秒 (= 右上の読み出し)。 基準は native 録画開始の wall-clock (recordingStartedAtRef)。
  const [elapsedSec, setElapsedSec] = useState(0);
  // HUD スクリムの実寸 (= SVG は % サイズが効かないので onLayout で測って px 指定する)
  const [hudSize, setHudSize] = useState<{ w: number; h: number } | null>(null);
  // 平滑化済みジェスチャー (= GestureOverlay 表示 + 再描画 trigger)。
  const [currentGesture, setCurrentGesture] = useState<'open_palm' | 'thumbs_up' | null>(null);

  const latestHandRef = useRef<HandTrackEvent | null>(null);
  // 手検出イベントの最終到着時刻 (= 検出ストリーム自体が止まっている時に「映せ」 と言わないため)
  const lastHandEventAtRef = useRef(0);
  // 直近の手ロスト警告の発話 seq (= 前の警告が決着するまで次を積まない)
  const lastWarnSeqRef = useRef(0);
  // 時間方向の平滑化 (= 5/5 実装の GestureStabilizer 相当、 ~167ms)。 単フレームのノイズで
  // hold が崩れる/ちらつくのを防ぐ。 両手要件は「2 手揃った frame gesture だけを投入」で担保する。
  const gestureStabilizerRef = useRef(new GestureStabilizer(5));
  const stableGestureRef = useRef<'open_palm' | 'thumbs_up' | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 長時間録画の守り (= 熱 / 空き容量 / 電池 / 画面消灯)。 判定は ticker、 ここは観測値の置き場。
  const thermalRef = useRef<ThermalState>('nominal');
  const freeDiskRef = useRef<number | null>(null);
  const powerRef = useRef<PowerState | null>(null);
  const autoStopReasonRef = useRef<string | null>(null); // finalizing 冒頭で 1 回読む自動終了の理由
  const [dimmed, setDimmed] = useState(false);
  const wakeUntilRef = useRef(0); // タップ復帰後、 この時刻までは再消灯しない

  const recordingStartedRef = useRef(false);
  // 終了方法の案内 (= 録画開始から数秒後に 1 回だけ)
  const stopHintSpokenRef = useRef(false);
  // 録画尺 (= POST /api/clips の durationMs) 算出用に、 native 録画開始の wall-clock を控える。
  const recordingStartedAtRef = useRef(0);
  const sessionDirRef = useRef<string | null>(null);

  // 装着判定 (= 取り付けの動き → 静止 + 装着らしい俯角)。 加速度計は装着待ちの間だけ回す。
  const pitchRef = useCameraPitch(state.kind === 'announcing' || state.kind === 'mounting');
  const mountTrackRef = useRef({ enteredTs: 0, lastPitch: null as number | null, motionMs: 0, stillSince: 0 });
  useEffect(() => {
    if (state.kind === 'mounting') {
      mountTrackRef.current = { enteredTs: Date.now(), lastPitch: null, motionMs: 0, stillSince: 0 };
    }
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

  // 熱状態の購読 (= native は録画中のみ発火) + 空き容量 / 電池の初期値。
  useEffect(() => {
    getArkitThermalState().then((s) => { thermalRef.current = s; }).catch(() => {});
    getArkitPowerState().then((p) => { powerRef.current = p; }).catch(() => {});
    FileSystem.getFreeDiskStorageAsync().then((b) => { freeDiskRef.current = b; }).catch(() => {});
    const sub = subscribeThermalState(({ state: s }) => {
      thermalRef.current = s;
      sink({
        step: 'capture',
        level: s === 'critical' ? 'error' : 'info',
        message: `端末の熱状態: ${s}`,
      });
    });
    return () => sub.remove();
  }, []);

  // 録画中の空き容量 / 電池ポーリング (= 30 秒ごと。 判定は ticker が ref を見る)。
  useEffect(() => {
    const k = state.kind;
    const active = k === 'recording' || k === 'stopping' || k === 'stopping_confirm';
    if (!active) return;
    let cancelled = false;
    const poll = () => {
      FileSystem.getFreeDiskStorageAsync()
        .then((b) => { if (!cancelled) freeDiskRef.current = b; })
        .catch(() => {});
      getArkitPowerState()
        .then((p) => { if (!cancelled) powerRef.current = p; })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, RESOURCE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [state.kind]);

  // バックグラウンド移行 = その場で通常どおり撮影終了 (2026-07-06 ユーザー判断: 復帰継続はしない。
  // 中断を挟んだ時系列は学習データに使えないので、 撮れていた分を 1 本として救って畳む)。
  // 終了処理は native の background 実行猶予 (= stopRecording の beginBackgroundTask) 内で走り、
  // 間に合わず kill された場合も fragmented mp4 + 起動時の孤児回収で拾える。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background') return;
      const k = stateRef.current.kind;
      if (k === 'recording' || k === 'stopping' || k === 'stopping_confirm') {
        autoStopReasonRef.current = t('capture.tts.autoStopBackground');
        setState({ kind: 'finalizing' });
      } else if (k === 'precapture_countdown') {
        // まだ録画が始まっていない → 開始せずパー待ちに戻す (= 復帰したらやり直し)。
        clearAudioQueue();
        setState({ kind: 'awaiting_palm' });
      }
    });
    return () => sub.remove();
  }, []);

  // 画面消灯の driver: 録画が DIM_AFTER_MS 乗ったら消灯。 録画フローを抜けたら必ず復帰。
  useEffect(() => {
    const k = state.kind;
    const active = k === 'recording' || k === 'stopping' || k === 'stopping_confirm';
    if (!active) {
      setDimmed(false);
      wakeUntilRef.current = 0;
      return;
    }
    const id = setInterval(() => {
      const started = recordingStartedAtRef.current;
      const now = Date.now();
      if (started > 0 && now - started >= DIM_AFTER_MS && now >= wakeUntilRef.current) {
        setDimmed(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [state.kind]);

  // 消灯を native に反映 (= 輝度 + プレビュー描画)。 unmount では必ず復帰させる。
  useEffect(() => {
    setArkitScreenDimmed(dimmed).catch(() => {});
  }, [dimmed]);
  useEffect(() => {
    return () => { setArkitScreenDimmed(false).catch(() => {}); };
  }, []);

  // hand track subscription (= アクティブ構成のストリームを購読、 切替で貼り替え)。
  // ⚠ ここで tickState() を呼ばない: native イベントは ~15-30Hz で来るので、 毎イベント
  //    setState すると再描画ストーム → "Maximum update depth" でクラッシュする。 状態機械は
  //    下の 100ms ticker が単独で進める。 ここは ref 更新 + gesture が変わった時だけ再描画。
  useEffect(() => {
    gestureStabilizerRef.current.reset();
    const subc = config.subscribeHandTrack((e) => {
      latestHandRef.current = e;
      lastHandEventAtRef.current = Date.now();
      // 両手揃った時だけ frame gesture を採用 (= 両手要件) し、 時間方向に平滑化する。
      // ノイズ 1 フレームでは確定が変わらない (= 5 連続同一で確定。 ~167ms @30Hz)。
      const frameG = e.wearerHandCount >= 2 ? frameGesture(e.wearerHands) : null;
      const stable = gestureStabilizerRef.current.push(frameG);
      stableGestureRef.current = stable;
      setCurrentGesture((prev) => (prev === stable ? prev : stable));
    });
    return () => subc.remove();
  }, [config]);

  // 関連フェーズのジェスチャー (= キャリブ中のパー / 撮影中のサムズ) が立ち上がった瞬間に確定ビープを
  // 即時再生する。 直列音声キュー (= 状態遷移で clearAudioQueue される) を経由しないので不発しない。
  // 撮影中の open_palm / キャリブ中の thumbs_up は無関係なので鳴らさない。 音はパー/サムズ共通 (= 好評の音)。
  const prevShownRef = useRef<'open_palm' | 'thumbs_up' | null>(null);
  useEffect(() => {
    const shown = relevantGesture(currentGesture, state.kind);
    const prev = prevShownRef.current;
    prevShownRef.current = shown;
    if (shown && shown !== prev) playSfx('detect_palm');
  }, [currentGesture, state.kind]);

  // state→audio (一方向): state.kind が変わったら、 その state の入場 cue を鳴らす。
  // 状態遷移はしない (= 遷移は ticker が getLastSpeechDone を見て決める)。 TTS を積んだら seq を
  // awaitedSpeechSeqRef に記録し、 ticker がその完了を判定する。
  // announcing だけは「session 起動 (activeConfigId) を待つ」 + 「enter_capture の後に続ける (keep)」。
  useEffect(() => {
    // 撮影完了後の案内: 「お疲れさま → 少し間 → 続けるなら手のひらを」 の二部構成。 待つのは最後の発話の seq。
    if (state.kind === 'next_task_announcing') {
      clearAudioQueue();
      awaitedSpeechSeqRef.current = enqueueSpeak(t('capture.tts.done'));
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
      stopHintSpokenRef.current = false;
      (async () => {
        try {
          const session = await config.startRecording(sink);
          recordingStartedAtRef.current = Date.now();
          sessionDirRef.current = session.sessionDir;
          // 録画開始の合図は countdown_end (= precapture_countdown 末尾で 1 度だけ鳴る) で完結。
          // 空き容量 / 電池が心もとない時だけ一言 (= 長時間撮影は途中終了があり得ると先に伝える)。
          if (freeDiskRef.current !== null && freeDiskRef.current < LOW_DISK_WARN_BYTES) {
            enqueueSpeak(t('capture.tts.lowDisk'));
          }
          const power = powerRef.current;
          if (power !== null && power.level >= 0 && !power.charging && power.level < LOW_BATTERY_WARN_LEVEL) {
            enqueueSpeak(t('capture.tts.lowBattery'));
          }
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`${t('capture.recStartFailed')}: ${e?.message ?? e}`);
          setState({ kind: 'awaiting_palm' });
        }
      })();
    }
    if (state.kind === 'finalizing') {
      (async () => {
        try {
          // 停止確定 → 残っている案内音声 (「このままキープ…」 等) を捨てて停止音を即鳴らせるようにする。
          clearAudioQueue();
          // 自動終了 (= 熱 / 容量 / 長時間) はここで理由を 1 回だけ読む (= 保存と並行して再生される)。
          const autoStopReason = autoStopReasonRef.current;
          autoStopReasonRef.current = null;
          if (autoStopReason) enqueueSpeak(autoStopReason);
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
          setState({ kind: 'awaiting_palm' });
        }
      })();
    }
  }, [state.kind]);

  // 状態遷移処理
  const tickState = useCallback(() => {
    // ⚠ ここで「手イベント未着なら return」 しない: 手検出が遅延/停止しても、 案内・装着待ち・
    //    音声完了の遷移は止めない。 e が必要な branch (= palm 判定・録画) だけ個別に guard する。
    const e = latestHandRef.current;
    const now = Date.now();
    const cur = stateRef.current;
    // 平滑化済みジェスチャー (= subscription で stabilizer に通した確定値)。 両手要件 + 時間平滑は
    // ここに織り込み済みなので、 状態機械は瞬間の wearerHandCount を見ずに gesture だけで判定する。
    const gesture = stableGestureRef.current;

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
        // クリップ間は装着済みなので、 装着待ちを飛ばしてパー待ちへ (= 案内は done TTS に含む)。
        if (speechDone()) setState({ kind: 'awaiting_palm' });
        return;
      }
      case 'mounting': {
        const track = mountTrackRef.current;
        // ⚠ ゲートにしない: 判定がどう転んでも HARD_TIMEOUT で必ず次へ進む。
        //    (以前は装着角度の範囲に入らない限り進めず、 装着したまま手元を見下ろす普通の姿勢
        //     (= 俯角 70° 超) で詰んでいた。)
        const timedOut = now - track.enteredTs >= MOUNT_HARD_TIMEOUT_MS;
        const reading = pitchRef.current;
        if (!reading.available || timedOut) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'palm_prompt' });
          return;
        }
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
          track.stillSince = 0; // 静止しているが装着角度ではなさそう → 早期通過はしない (timeout 待ち)
          return;
        }
        if (track.stillSince === 0) track.stillSince = now;
        // きれいな経路: 取り付けの動きを見たあと、 装着らしい角度で静止 → 早めに次へ。
        if (track.motionMs >= MOUNT_MOTION_MIN_MS && now - track.stillSince >= MOUNT_STILL_MS) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'palm_prompt' });
        }
        return;
      }
      case 'palm_prompt': {
        // パー案内を言い終わったら検出開始へ。
        if (speechDone()) setState({ kind: 'awaiting_palm' });
        return;
      }
      case 'awaiting_palm': {
        if (gesture === 'open_palm') {
          setState({ kind: 'palm_holding', startTs: now });
        }
        return;
      }
      case 'palm_holding': {
        if (gesture !== 'open_palm') {
          setState({ kind: 'awaiting_palm' });
          return;
        }
        if (now - cur.startTs >= PALM_HOLD_MS) {
          if (!e) return; // 手イベント未着 (= 稀)。 次 tick で再判定
          const bbox = computeHandBoundingBox(e.wearerHands);
          if (!bbox) {
            setState({ kind: 'awaiting_palm' });
            return;
          }
          const dir = computeAdjustDirection(bbox);
          // voiced state へ入る前に sentinel (= 前 state の完了済 seq との誤一致を防ぐ)。 cue 再生は effect。
          awaitedSpeechSeqRef.current = 0;
          if (dir === null) {
            saveBaseline(bbox).catch(() => {});
            setState({ kind: 'calibration_confirmed' });
          } else {
            setState({ kind: 'adjust_needed', direction: dir });
          }
        }
        return;
      }
      case 'calibration_confirmed': {
        // 確定音 + TTS を言い終わって 500ms 経ったら開始カウントダウンへ。
        const done = getLastSpeechDone();
        if (speechDone() && now - done.at >= 500) {
          setState({ kind: 'precapture_countdown', startTs: now });
        }
        return;
      }
      case 'adjust_needed': {
        // 案内 TTS を言い終わるまで palm 受付しない (= 案内の中断防止)。
        if (speechDone() && gesture === 'open_palm') {
          setState({ kind: 'palm_holding', startTs: now });
        }
        return;
      }
      case 'precapture_countdown':
        // 開始カウントダウンは専用 timer (countdown driver effect) が駆動。 ここでは何もしない。
        return;
      case 'recording': {
        // 長時間録画の安全弁 (= 手検出と無関係に判定)。 続行できない状況は理由を積んで終了フローへ。
        // 判定順 = 危険度順: 熱 critical (放置すると OS がカメラごと殺す) > 容量 (writer が書けなく
        // なる) > 電池 (突然死 = 台帳登録前に消える) > 長時間。
        const startedAt = recordingStartedAtRef.current;
        const power = powerRef.current;
        const batteryLow =
          power !== null && power.level >= 0 && !power.charging && power.level <= LOW_BATTERY_STOP_LEVEL;
        const autoStopReason =
          thermalRef.current === 'critical' ? t('capture.tts.autoStopHot')
          : freeDiskRef.current !== null && freeDiskRef.current < LOW_DISK_STOP_BYTES ? t('capture.tts.autoStopDisk')
          : batteryLow ? t('capture.tts.autoStopBattery')
          : startedAt > 0 && now - startedAt >= MAX_RECORDING_MS ? t('capture.tts.autoStopLong')
          : null;
        if (autoStopReason) {
          autoStopReasonRef.current = autoStopReason;
          setState({ kind: 'finalizing' });
          return;
        }
        if (!e) return;
        // 録画が乗ってきた頃に、 終了方法を 1 回だけ案内する (= 遷移を駆動しない副作用)。
        if (!stopHintSpokenRef.current && now - cur.startTs >= STOP_HINT_DELAY_MS) {
          stopHintSpokenRef.current = true;
          enqueueSpeak(t('capture.tts.stopHint'));
        }
        const handVisible = e.wearerHandCount >= 1;
        let lastHandSeen = cur.lastHandSeenTs;
        let lastWarn = cur.lastWarnTs;
        if (handVisible) {
          lastHandSeen = now;
        } else if (
          now - cur.lastHandSeenTs >= HAND_LOST_WARN_MS &&
          now - cur.lastWarnTs >= WARN_REPEAT_MS &&
          // 検出ストリームが生きている時だけ警告する (= イベントが止まっている時の「手が無い」 は
          // 検出側の問題であって装着者の問題ではない)。
          now - lastHandEventAtRef.current < 2000 &&
          // 前の警告がまだキュー内 / 再生中なら積まない (= 溜まった警告の連続再生を構造的に防ぐ)。
          isSpeechSettled(lastWarnSeqRef.current)
        ) {
          // 警告は遷移を駆動しない副作用 (= fire-and-forget で enqueue)。
          void enqueueSfx('warn_hand_lost');
          lastWarnSeqRef.current = enqueueSpeak(t('capture.tts.handLost'));
          lastWarn = now;
        }
        // thumbs-up を ARM_MS 連続検出で stopping へ (= armedSince を state に内包)。
        const isThumbsUp = gesture === 'thumbs_up';
        let armedSince = cur.armedSince;
        if (isThumbsUp) {
          if (armedSince === 0) armedSince = now;
          if (now - armedSince >= THUMBS_UP_ARM_MS) {
            // stopping の入場効果音 (detect_thumbs_up) は state→audio effect が鳴らす。
            setState({ kind: 'stopping', startTs: now, lostSince: 0 });
            return;
          }
        } else {
          armedSince = 0;
        }
        if (lastHandSeen !== cur.lastHandSeenTs || lastWarn !== cur.lastWarnTs || armedSince !== cur.armedSince) {
          setState({ ...cur, lastHandSeenTs: lastHandSeen, lastWarnTs: lastWarn, armedSince });
        }
        return;
      }
      case 'stopping': {
        const thumbsUp = gesture === 'thumbs_up';
        if (!thumbsUp) {
          // 離脱ヒステリシス (= 単フレームのフリッカーでは切らない)。 lostSince を state に内包。
          const lostSince = cur.lostSince === 0 ? now : cur.lostSince;
          if (now - lostSince >= RELEASE_GRACE_MS) {
            setState({ kind: 'recording', startTs: cur.startTs, lastHandSeenTs: now, lastWarnTs: 0, armedSince: 0 });
          } else if (lostSince !== cur.lostSince) {
            setState({ ...cur, lostSince });
          }
          return;
        }
        // HOLD_MS 立て続け → stopping_confirm (案内 cue は effect が再生)。 sentinel を立てて入る。
        if (now - cur.startTs >= THUMBS_UP_HOLD_MS) {
          awaitedSpeechSeqRef.current = 0;
          setState({ kind: 'stopping_confirm', startTs: now, lostSince: 0 });
          return;
        }
        if (cur.lostSince !== 0) setState({ ...cur, lostSince: 0 }); // フリッカー復帰
        return;
      }
      case 'stopping_confirm': {
        const thumbsUp = gesture === 'thumbs_up';
        if (!thumbsUp) {
          const lostSince = cur.lostSince === 0 ? now : cur.lostSince;
          if (now - lostSince >= RELEASE_GRACE_MS) {
            // 本当に離した → キャンセルして録画継続 (= 確認 TTS も止める)。
            // 止め方が分からなくて離した可能性が高いので、 1 秒おいて終了方法をもう一度案内する
            // (= 直列キューなので、 すぐ再挑戦して stopping_confirm に入れば cue が上書きする)。
            clearAudioQueue();
            enqueuePause(1000);
            enqueueSpeak(t('capture.tts.stopHint'));
            setState({ kind: 'recording', startTs: now, lastHandSeenTs: now, lastWarnTs: 0, armedSince: 0 });
          } else if (lostSince !== cur.lostSince) {
            setState({ ...cur, lostSince });
          }
          return;
        }
        // 案内を最後まで言い終わり、 かつ今も立て続けている → 停止確定。 キャンセルされた前試行の発話は
        // 自然完了扱いにならない (captureAudio) + awaitedSpeechSeqRef は現試行の seq なので、 誤 finalize しない。
        if (speechDone()) {
          setState({ kind: 'finalizing' });
          return;
        }
        if (cur.lostSince !== 0) setState({ ...cur, lostSince: 0 }); // フリッカー復帰
        return;
      }
      case 'finalizing':
        return;
    }
  }, []);

  // 状態機械の単一ドライバ (= 100ms 周期)。 hand event はここでは駆動せず ref に積むだけなので、
  // tickState はこの ticker だけが回す (= 再描画は tickState 内の setState / countdown / gesture 変化のみ)。
  useEffect(() => {
    const id = setInterval(() => {
      tickState();
    }, 100);
    return () => clearInterval(id);
  }, [tickState]);

  // 開始カウントダウンの単一ドライバ (= 数字表示・tick 音・終了 → recording 遷移を 1 つの timer で)。
  // 音と数字を同じ step 判定で同時に出すので、 両者がずれない。
  useEffect(() => {
    if (state.kind !== 'precapture_countdown') {
      setCountdownRemaining(null);
      return;
    }
    const startTs = state.startTs;
    let lastStep = 0;
    let ended = false;
    const update = () => {
      const elapsed = Date.now() - startTs;
      if (!ended && elapsed >= COUNTDOWN_TICKS * COUNTDOWN_TICK_MS) {
        ended = true;
        setCountdownRemaining(null);
        playSfx('countdown_end'); // 録画開始の合図 (= 即時再生)
        setState({ kind: 'recording', startTs: Date.now(), lastHandSeenTs: Date.now(), lastWarnTs: 0, armedSince: 0 });
        return;
      }
      const step = COUNTDOWN_TICKS - Math.floor(elapsed / COUNTDOWN_TICK_MS); // 3 → 2 → 1
      if (step !== lastStep && step >= 1 && step <= COUNTDOWN_TICKS) {
        lastStep = step;
        setCountdownRemaining(step);
        playSfx('countdown_tick'); // 数字更新と同じ瞬間に鳴らす = 完全同期 (待ち無しの即時再生)
      }
    };
    update();
    const id = setInterval(update, 50);
    return () => clearInterval(id);
  }, [state]);

  // 録画経過タイマー (= 0.5s 刻み。 native 録画開始時刻を基準にするので state 遷移で揺れない)
  useEffect(() => {
    const k = state.kind;
    const active = k === 'recording' || k === 'stopping' || k === 'stopping_confirm';
    if (!active) { setElapsedSec(0); return; }
    const id = setInterval(() => {
      const base = recordingStartedAtRef.current;
      if (base > 0) setElapsedSec(Math.floor((Date.now() - base) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [state.kind]);

  // 録画を止めて台帳登録まで行う (= ✕ 緊急停止 / unmount 用)。 通常フローの finalize と同じ結末に
  // する: 撮れていた分を 1 本のクリップとして一覧に残す (= 以前は停止だけして登録せず、 孤児にしていた)。
  // finalizing 中は何もしない (= 通常フローが停止処理中。 二重 stop は native writer を壊す)。
  const stopAndRegisterImmediately = useCallback(() => {
    if (!recordingStartedRef.current) return;
    if (stateRef.current.kind === 'finalizing') return;
    recordingStartedRef.current = false;
    const cfg = runningConfigRef.current;
    const startedAt = recordingStartedAtRef.current;
    recordingStartedAtRef.current = 0;
    if (!cfg) return;
    cfg.stopRecording(sink)
      .then((session) =>
        enqueueRecording({
          config: cfg,
          session,
          durationMs: startedAt > 0 ? Math.max(0, Date.now() - startedAt) : null,
          deviceModel: Device.modelId ?? null,
        }),
      )
      .catch(() => {});
  }, []);

  // クリーンアップ (= 録画中なら停止 + 登録。 session 自体は handoff effect の unmount cleanup が止める)
  useEffect(() => {
    return () => {
      stopAndRegisterImmediately();
      clearAudioQueue(); // 保留中の音声 + 再生中を停止
    };
  }, [stopAndRegisterImmediately]);

  const onBack = useCallback(() => {
    stopAndRegisterImmediately();
    // 全画面 landscape 化に伴い、 退場時の portrait 先回りは不要になった (= タブも landscape)。
    // プレビューだけ隠してスムーズに戻る。
    setLeaving(true);
    requestAnimationFrame(() => navigation.goBack());
  }, [navigation, stopAndRegisterImmediately]);

  // 撮影構成の切替 (= キャリブレーション待機中のみ)。 切替後はキャリブレーションを最初からやり直す。
  const onSelectConfig = useCallback((id: string) => {
    if (id === selectedConfigId) return;
    const k = stateRef.current.kind;
    const calibratePhase =
      k === 'announcing' || k === 'next_task_announcing' || k === 'mounting' ||
      k === 'palm_prompt' || k === 'awaiting_palm' || k === 'palm_holding' ||
      k === 'adjust_needed' || k === 'calibration_confirmed';
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

  const isRecording =
    state.kind === 'recording' ||
    state.kind === 'stopping' ||
    state.kind === 'stopping_confirm';

  // 切替可能なのはキャリブレーション待機中のみ (= 録画フロー中は不可)。
  const inCaptureFlow = isRecording || state.kind === 'precapture_countdown' || state.kind === 'finalizing';
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
  const hud = ((): { text: string; tone: 'normal' | 'accent' | 'dim'; arrow?: AdjustDirection } | null => {
    switch (state.kind) {
      case 'announcing':
      case 'mounting':
        return { text: t('capture.tts.intro'), tone: 'normal' };
      case 'palm_prompt':
      case 'awaiting_palm':
        return { text: t('capture.tts.palmPrompt'), tone: 'normal' };
      case 'palm_holding':
        return { text: t('capture.hud.detecting'), tone: 'accent' };
      case 'adjust_needed':
        return { text: calibAdjustText(state.direction), tone: 'normal', arrow: state.direction };
      case 'calibration_confirmed':
        return { text: t('capture.tts.confirmed'), tone: 'accent' };
      case 'precapture_countdown':
        return { text: t('capture.hud.countdown'), tone: 'normal' };
      case 'recording':
        return { text: t('capture.hud.recordingHint'), tone: 'dim' };
      case 'stopping':
      case 'stopping_confirm':
        return { text: t('capture.tts.stoppingConfirm'), tone: 'accent' };
      case 'finalizing':
        return { text: t('capture.hud.saving'), tone: 'normal' };
      case 'next_task_announcing':
        return { text: t('capture.tts.done'), tone: 'normal' };
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
        {countdownRemaining !== null ? (
          <View style={styles.countdownOverlay} pointerEvents="none">
            <Text style={styles.countdownText}>{countdownRemaining}</Text>
          </View>
        ) : null}
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
          {hud.arrow ? <ArrowGlyph dir={hud.arrow} /> : <View style={styles.hudMark} />}
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

      {/* 画面消灯 (= 長時間録画の省電力)。 OLED は黒 = 消灯なので全面黒 + ごく暗い録画ドットだけ。
          どこをタップしても復帰する (= 復帰後しばらくして再消灯)。 */}
      {dimmed ? (
        <Pressable
          accessibilityLabel={t('capture.recordingLabel')}
          style={styles.dimOverlay}
          onPress={() => {
            wakeUntilRef.current = Date.now() + REDIM_AFTER_TAP_MS;
            setDimmed(false);
          }}
        >
          <View style={[styles.dimDot, { top: safeTop + 14, right: safeRight + 14 }]} />
        </Pressable>
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

/// 方向矢印 (= カメラをどっちに向けるか。 琥珀の大きめグリフ)。
const ArrowGlyph: React.FC<{ dir: AdjustDirection }> = ({ dir }) => {
  const rotate = dir === 'up' ? '0deg' : '180deg';
  return (
    <View style={{ transform: [{ rotate }], marginBottom: 8 }}>
      <Svg width={30} height={30} viewBox="0 0 26 26" fill="none">
        <Path d="M13 21 V6 M6.5 12.5 L13 6 L19.5 12.5" stroke={colors.emerald} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return `${m}:${s2.toString().padStart(2, '0')}`;
}

// per-hand gesture を 1 フレームのジェスチャーに集約する (= 判定ポリシー = TS 側が持つ本丸)。
// 非 null の手が全て同じサインなら採用、 null の手は無視 (= 片手の単フレーム検出落ちを吸収して
// チカチカを抑える)、 異なるサインが混在したら不成立 (null)。 両手前提は呼び出し側の
// wearerHandCount>=2 + ARM/HOLD の継続要求で担保する (= ここでは手の枚数は見ない)。
function frameGesture(
  hands: { gesture: 'open_palm' | 'thumbs_up' | null }[],
): 'open_palm' | 'thumbs_up' | null {
  let g: 'open_palm' | 'thumbs_up' | null = null;
  for (const h of hands) {
    if (h.gesture == null) continue;
    if (g === null) g = h.gesture;
    else if (g !== h.gesture) return null;
  }
  return g;
}

// 現フェーズで「意味のある」 ジェスチャーだけを通す (= 確定ビープのゲート)。
//   キャリブ中 → open_palm のみ。 撮影中の thumbs_up は即時ビープしない
//   (= 作業中の偶然の検出で鳴るのが不快。 合図は保持しきった後の stopping_confirm 入場音で出す)。
const CALIB_KINDS: CaptureState['kind'][] = [
  'announcing', 'next_task_announcing', 'mounting', 'palm_prompt',
  'awaiting_palm', 'palm_holding', 'adjust_needed', 'calibration_confirmed',
];
function relevantGesture(
  g: 'open_palm' | 'thumbs_up' | null,
  kind: CaptureState['kind'],
): 'open_palm' | 'thumbs_up' | null {
  if (g === 'open_palm') return CALIB_KINDS.includes(kind) ? 'open_palm' : null;
  return null;
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

  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontFamily: fonts.mono,
    fontSize: 116,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },

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

  // 画面消灯 (= 長時間録画)。 ドットはごく暗い赤 (= 発光を最小にしつつ「録画中」 が分かる)。
  dimOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 10 },
  dimDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#571510' },
});
