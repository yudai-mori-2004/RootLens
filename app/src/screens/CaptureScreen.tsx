// 撮影画面 (= v0.1.4)。 ジェスチャーキャリブレーション → 撮影 → ローカル保存、 の 3 手。
//
// 「キャリブレーション」 の意図 (= 重要、 過去の誤解を是正):
//   ユーザはリラックスした自然な姿勢で、 手元に視線を向ける。 体は動かさない。
//   その自然な視線状態でカメラ映像内に両手が真ん中に映るように、 ヘッドセットの装着角度を
//   物理的に微調整してもらう。 シビアに中央 (= ±5%) に来た瞬間が baseline 確定。
//   中央外なら「ヘッドセットをもう少し ___ に向けてください」 と方向指示 → user が装着角度を
//   調整 → 再度両手を上に向けて 1 秒キープ → 再判定、 のループ。
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
//        - 60 分は native 側で hard cap
//
// ⚠ v0.1.4: 録画停止後の自動アップロードは行わない。 クリップは state 'recorded' でローカル一覧
//    (マイビデオ) に積まれ、 ユーザーがプレビュー確認 → 「アップロード」 した時に advanceClip が
//    署名 → R2 → 登録 を進める (= DATA_SPECS §2)。
//
// 効果音は assets/sounds/*.mp3 から expo-av で再生 (= captureSounds service)。

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Camera } from 'expo-camera';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  | { kind: 'announcing' }                                 // 初回案内 TTS 中 (= 「手のひらを 3 秒キープ」)
  | { kind: 'next_task_announcing' }                       // 撮影完了後の次タスク提案 TTS 中
  | { kind: 'awaiting_palm' }                              // 「手のひらを上向きに 3 秒キープ」 待ち
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

type AdjustDirection = 'up' | 'down' | 'left' | 'right';

// 3 秒キープ (= TTS の言い終わりからカウント開始、 ユーザに余裕を持たせる)
const PALM_HOLD_MS = 3000;
// 停止フロー (= 人間目線): 頭部装着・両手で家事中・画面は見ない前提。 thumbs-up が ARM_MS 継続して
// 「検出」 → 即時音。 検出から HOLD_MS 立て続けると音声「そのまま立て続けると終了します」を流し、
// 音声を最後まで言い終わった時にまだ立て続けていたら停止確定 (= 固定秒で切らず、 案内を最後まで聞かせる)。
// ⚠ 停止まで「立て続け」 を要求: 家事中は手が常に動くので、 偶発検出は手が動いた瞬間にキャンセル → 録画継続。
//    意図的に手を止めて保持した時だけ止まる (= 誤停止で家事映像を失わない)。
// ⚠ 離脱判定は RELEASE_GRACE_MS のヒステリシス: 単フレームの検出フリッカーで即キャンセル (= 音声プチ切れ)
//    しないよう、 thumbs-up が連続して消えて初めて離脱とみなす。
const THUMBS_UP_ARM_MS = 300;
const THUMBS_UP_HOLD_MS = 1000;
// 離脱猶予を長めに (= 立て続けている最中の検出フリッカーを吸収。 意図的な離脱はこれより長く手を動かす)。
const RELEASE_GRACE_MS = 800;
// 開始カウント: 3,2,1 を COUNTDOWN_TICK_MS 間隔で刻む (= 秒ベースより速いテンポ)。 合計 = 3 * tick。
const COUNTDOWN_TICKS = 3;
const COUNTDOWN_TICK_MS = 750;
const HAND_LOST_WARN_MS = 5000;
const WARN_REPEAT_MS = 7000;            // 手が映ってない警告の繰り返し間隔 (= 間延びさせない)

// シビアな中央許容範囲 (= 各軸 ±5%)。 user フィードバック「めっちゃシビアに真ん中である必要がある」
const CALIBRATION_CENTER_MARGIN = 0.05;
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

/// 「ヘッドセットをどっち向きに動かせば手が中央に来るか」 を返す。
/// 手が画面下なら ヘッドセットも下に向けてもらえば手は中央に来る (= 1 対 1)。
/// 許容範囲内なら null (= 中央 OK)。
function computeAdjustDirection(bbox: HandBoundingBox): AdjustDirection | null {
  const dx = bbox.cx - 0.5;
  const dy = bbox.cy - 0.5;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX <= CALIBRATION_CENTER_MARGIN && absY <= CALIBRATION_CENTER_MARGIN) return null;
  if (absY >= absX) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}

// ─── 音声ガイド ───────────────────────────────────────────────────────
//
// ⚠ アーキ原則: 音声 (SFX/TTS) は state の副作用として state→audio effect が enqueue するだけ。
//    状態遷移は音声 callback で駆動しない (= captureAudio の getLastSpeechDone を ticker が読んで判定)。
//    この方針で「キャンセルした前試行の onDone が新試行で誤発火」 類の競合が原理的に起きない。

// キャリブレーション音声ガイドの文言。
// トーン = 機内アナウンス調 (= 丁寧・穏やか・誰にでも明確、 砕けすぎない)。
// 文言は i18n 辞書 (capture.tts.*) に locale 別で持つ。 ja は読み間違い回避済 (= 「方」「開いて」 不使用)。
const NEXT_TASK_PAUSE_MS = 1000;
function calibAdjustText(d: AdjustDirection): string {
  switch (d) {
    case 'up':    return t('capture.tts.adjustUp');
    case 'down':  return t('capture.tts.adjustDown');
    case 'left':  return t('capture.tts.adjustLeft');
    case 'right': return t('capture.tts.adjustRight');
  }
}

// 各 state の「入場時に鳴らす cue」。 sfx → tts の順でキューに積まれる。 announcing だけは enter_capture
// 効果音 (handoff が積む) の後に続けたいので clearAudioQueue しない (= keep)。
function entryCue(s: CaptureState): { sfx?: SfxName; tts?: string; keep?: boolean } | null {
  switch (s.kind) {
    case 'announcing':
      return { tts: t('capture.tts.intro'), keep: true };
    // next_task_announcing は二部構成 (お疲れさま → 間 → 続けるなら) なので state→audio effect で個別に積む。
    case 'adjust_needed':
      return { tts: calibAdjustText(s.direction) };
    case 'calibration_confirmed':
      // 検出ビープ (detect_palm) はジェスチャー確定時に即時再生する専用 effect が鳴らす
      // (= キュー非経由で不発しない + アイコン表示と同期)。 ここは確定 TTS のみ。
      return { tts: t('capture.tts.confirmed') };
    case 'stopping':
      // 検出ビープ (detect_thumbs_up) は即時再生 effect が鳴らすのでここでは何もしない。
      return null;
    case 'stopping_confirm':
      return { tts: t('capture.tts.stoppingConfirm') };
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

// ─── 方向 → ヘッドセット案内文 ──────────────────────────────────────

function headsetGuidance(direction: AdjustDirection): string {
  switch (direction) {
    case 'down':  return t('capture.guide.down');
    case 'up':    return t('capture.guide.up');
    case 'left':  return t('capture.guide.left');
    case 'right': return t('capture.guide.right');
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
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  // 平滑化済みジェスチャー (= GestureOverlay 表示 + 再描画 trigger)。
  const [currentGesture, setCurrentGesture] = useState<'open_palm' | 'thumbs_up' | null>(null);

  const latestHandRef = useRef<HandTrackEvent | null>(null);
  // 時間方向の平滑化 (= 5/5 実装の GestureStabilizer 相当、 ~167ms)。 単フレームのノイズで
  // hold が崩れる/ちらつくのを防ぐ。 両手要件は「2 手揃った frame gesture だけを投入」で担保する。
  const gestureStabilizerRef = useRef(new GestureStabilizer(5));
  const stableGestureRef = useRef<'open_palm' | 'thumbs_up' | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const recordingStartedRef = useRef(false);
  // 録画尺 (= POST /api/clips の durationMs) 算出用に、 native 録画開始の wall-clock を控える。
  const recordingStartedAtRef = useRef(0);
  const sessionDirRef = useRef<string | null>(null);
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
  //    下の 100ms ticker が単独で進める。 ここは ref 更新 + gesture が変わった時だけ再描画。
  useEffect(() => {
    gestureStabilizerRef.current.reset();
    const subc = config.subscribeHandTrack((e) => {
      latestHandRef.current = e;
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
      (async () => {
        try {
          const session = await config.startRecording(sink);
          recordingStartedAtRef.current = Date.now();
          sessionDirRef.current = session.sessionDir;
          // 録画開始の合図は countdown_end (= precapture_countdown 末尾で 1 度だけ鳴る) で完結。
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
    const e = latestHandRef.current;
    if (!e) return;
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
      case 'announcing':
      case 'next_task_announcing': {
        // 案内 TTS を言い終わったら検出開始へ (= ticker が完了 seq を判定。 音声 callback では遷移しない)。
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
            // 本当に離した → キャンセルして録画継続 (= 案内音声も止める)。
            clearAudioQueue();
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
      k === 'announcing' || k === 'next_task_announcing' || k === 'awaiting_palm' ||
      k === 'palm_holding' || k === 'adjust_needed' || k === 'calibration_confirmed';
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
        <ActivityIndicator color={colors.accent} />
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

  // プレビューは「実際に稼働中の構成」 の native view を出す (= 切替完了後に swap)。
  const PreviewView =
    activeConfigId === 'arkit'
      ? ArkitCapturePreviewView
      : activeConfigId === 'ultra_wide'
        ? WideCapturePreviewView
        : null;

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
            <ActivityIndicator color={colors.accent} />
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

      {/* 撮影構成スイッチャ (ultra_wide ⇄ arkit)。 キャリブレーション待機中のみ操作可。
          切替処理 (= onSelectConfig + session ハンドオフ effect) はカメラ排他のため
          「旧 session 完全停止 → 解放待ち → 新 session 起動」 を直列化する (壊しやすいので触らない)。 */}
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

      {/* 左上: 戻る */}
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

      {/* 中央上: 状態ピル */}
      <View
        style={[styles.chromeTopCenter, { top: safeTop + 12, left: safeLeft + 60, right: safeRight + 60 }]}
        pointerEvents="none"
      >
        <View style={styles.headerPill}>
          <Text style={styles.headerStatus} numberOfLines={1}>{describeState(state)}</Text>
        </View>
      </View>

      {/* 右上: REC indicator */}
      {isRecording ? (
        <View style={[styles.chromeTopRight, { top: safeTop + 12, right: safeRight + 12 }]} pointerEvents="none">
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recLabel}>REC</Text>
          </View>
        </View>
      ) : null}

      {/* ジェスチャー可視化 (= 画面中央上に固定 2 個並び、 検出時のみ表示) */}
      <GestureOverlay gesture={relevantGesture(currentGesture, state.kind)} topInset={safeTop} />

      {/* エラー表示 (= 下中央) */}
      {error ? (
        <View
          style={[styles.chromeBottom, { bottom: safeBottom + 64, left: safeLeft + 16, right: safeRight + 96 }]}
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

// ─── ジェスチャー可視化 component (= 画面中央上に両手アイコンを並べ、 確定ジェスチャー時のみ表示) ────

const HAND_ICONS = {
  open_palm: require('../../assets/icons/hand_open_palm.png'),
  thumbs_up: require('../../assets/icons/hand_thumbs_up.png'),
};

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

// 現フェーズで「意味のある」 ジェスチャーだけを通す (= UI 表示 + 確定ビープのゲート)。
//   キャリブ中    → open_palm のみ (= サムズは無関係)
//   撮影中        → thumbs_up のみ (= 撮影開始後はパー UI 不要)
//   それ以外(カウントダウン/finalizing 等) → 非表示
const CALIB_KINDS: CaptureState['kind'][] = [
  'announcing', 'next_task_announcing', 'awaiting_palm', 'palm_holding', 'adjust_needed', 'calibration_confirmed',
];
const RECORDING_KINDS: CaptureState['kind'][] = ['recording', 'stopping', 'stopping_confirm'];
function relevantGesture(
  g: 'open_palm' | 'thumbs_up' | null,
  kind: CaptureState['kind'],
): 'open_palm' | 'thumbs_up' | null {
  if (g === 'open_palm') return CALIB_KINDS.includes(kind) ? 'open_palm' : null;
  if (g === 'thumbs_up') return RECORDING_KINDS.includes(kind) ? 'thumbs_up' : null;
  return null;
}

// ジェスチャー UI は「両手の合議で確定した平滑化ジェスチャー」 にのみ紐づける (= 確定時に両手アイコンを
// 一緒に出し、 それ以外は非表示)。 平滑化済みなので一瞬の片手落ちでは消えない。
const GestureOverlay: React.FC<{
  gesture: 'open_palm' | 'thumbs_up' | null;
  topInset: number;
}> = ({ gesture, topInset }) => {
  if (gesture === null) return null;
  const src = HAND_ICONS[gesture];
  return (
    <View style={[styles.gestureTop, { top: topInset + 64 }]} pointerEvents="none">
      <Image source={src} style={styles.handIcon} resizeMode="contain" />
      <Image source={src} style={[styles.handIcon, { transform: [{ scaleX: -1 }] }]} resizeMode="contain" />
    </View>
  );
};

// ─── 状態 → 表示文 ──────────────────────────────────────────────────

function describeState(s: CaptureState): string {
  switch (s.kind) {
    case 'announcing':            return t('capture.state.announcing');
    case 'next_task_announcing':  return t('capture.state.nextTaskAnnouncing');
    case 'awaiting_palm':         return t('capture.state.awaitingPalm');
    case 'palm_holding':          return t('capture.state.palmHolding');
    case 'adjust_needed':         return `${t('capture.state.calibratePrefix')}  ·  ${headsetGuidance(s.direction)}`;
    case 'calibration_confirmed': return t('capture.state.calibrated');
    case 'precapture_countdown':  return t('capture.state.starting');
    case 'recording':             return t('capture.state.recording');
    case 'stopping':              return t('capture.state.stopping');
    case 'stopping_confirm':      return t('capture.state.stoppingConfirm');
    case 'finalizing':            return t('capture.state.finalizing');
  }
}

// ─── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { ...StyleSheet.absoluteFillObject },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#000' },

  // 撮影構成スイッチャ (= 画面下中央のチップ列)
  configSwitcher: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  configChip: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(14,31,68,0.65)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  configChipSel: { backgroundColor: 'rgba(16,185,129,0.85)', borderColor: 'rgba(255,255,255,0.3)' },
  configChipDim: { opacity: 0.4 },
  configChipText: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.0,
  },
  configChipTextSel: { color: '#fff' },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 12, backgroundColor: colors.paper,
  },
  eyebrow: { ...typography.label, color: colors.textMute },
  body: { ...typography.body, color: colors.textInk, textAlign: 'center', maxWidth: 320 },
  btn: {
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 8, backgroundColor: colors.ink,
  },
  btnLabel: {
    color: colors.textOnInk, fontSize: 14,
    fontFamily: fonts.sansSemibold,
  },

  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontFamily: fonts.serifMedium,
    fontSize: 120,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },

  chromeTopLeft: { position: 'absolute' },
  chromeTopRight: { position: 'absolute' },
  chromeTopCenter: { position: 'absolute', alignItems: 'center' },
  chromeBottom: { position: 'absolute', alignItems: 'center' },

  // 画面中央上に並ぶジェスチャーアイコン (= 2 個並び、 検出時のみ表示)
  gestureTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  handIcon: {
    width: 96,
    height: 96,
  },

  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(14,31,68,0.65)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  closeBtnRec: { backgroundColor: 'rgba(220,38,38,0.85)' },
  closeBtnPressed: { opacity: 0.7 },

  headerPill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(14,31,68,0.65)',
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  headerStatus: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.2,
  },

  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(220,38,38,0.95)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  recLabel: {
    color: '#fff',
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    letterSpacing: 1.4,
  },

  errCard: {
    backgroundColor: 'rgba(220,38,38,0.92)',
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

// Suppress unused warning
void Circle;
void Path;
