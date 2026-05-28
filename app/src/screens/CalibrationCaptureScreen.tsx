// 新撮影モード (= UI_SPECS_JA.md §4 + 2026-05-27 大方針転換)。
//
// 旧 CaptureModeScreen の置換: 対話サブモード + VLM gate + hand framing BGM + 音声 AI を全撤去。
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
// 効果音は assets/sounds/*.mp3 から expo-av で再生 (= captureSounds service)。

import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
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
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../app/types';
import {
  WideCapturePreviewView,
  captureWideSnapshot,
  isWideCaptureAvailable,
  setWideDisplayOrientation,
  startWideRecording,
  startWideSession,
  stopWideRecording,
  stopWideSession,
  subscribeWideHandTrack,
  type DisplayOrientation,
  type HandTrackEvent,
} from '../native/wideCapture';
import { clipStore } from '../services/clipPipeline';
import {
  playSfx,
  preloadCaptureSounds,
  unloadCaptureSounds,
} from '../services/captureSounds';
import { colors, fonts, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureMode'>;

// ─── 状態定義 ─────────────────────────────────────────────────────────

type CaptureState =
  | { kind: 'announcing' }                                 // 初回案内 TTS 中 (= 「手のひらを 3 秒キープ」)
  | { kind: 'next_task_announcing' }                       // 撮影完了後の次タスク提案 TTS 中
  | { kind: 'awaiting_palm' }                              // 「手のひらを上向きに 3 秒キープ」 待ち
  | { kind: 'palm_holding'; startTs: number }              // open_palm を 3 秒 hold 中
  | { kind: 'adjust_needed'; direction: AdjustDirection; acceptPalm: boolean }  // 中央外、 TTS 読み上げ完了で acceptPalm=true
  | { kind: 'calibration_confirmed' }                      // キャリブ確定、 効果音 + TTS + 500ms 待機
  | { kind: 'precapture_countdown'; startTs: number; lastTick: number }
  | { kind: 'recording'; startTs: number; lastHandSeenTs: number; lastWarnTs: number }
  | { kind: 'stopping'; startTs: number }
  | { kind: 'stopping_announcing' }   // playSfxThenSpeak 発話中、 二重発火防止
  | { kind: 'stop_countdown'; startTs: number; lastTick: number }
  | { kind: 'finalizing' };

type AdjustDirection = 'up' | 'down' | 'left' | 'right';

// 3 秒キープ (= TTS の言い終わりからカウント開始、 ユーザに余裕を持たせる)
const PALM_HOLD_MS = 3000;
const THUMBS_UP_HOLD_MS = 1000;
const PRECAPTURE_COUNTDOWN_MS = 3000;
const STOP_COUNTDOWN_MS = 3000;
const HAND_LOST_WARN_MS = 5000;
const WARN_REPEAT_MS = 4000;

// シビアな中央許容範囲 (= 各軸 ±5%)。 user フィードバック「めっちゃシビアに真ん中である必要がある」
const CALIBRATION_CENTER_MARGIN = 0.05;
const LANDMARK_CONF = 0.3;

const STORAGE_BASELINE_KEY = '@rootlens/calibration/baseline/v1';

// ─── orientation 写像 ─────────────────────────────────────────────────

function orientationFromOS(o: ScreenOrientation.Orientation): DisplayOrientation {
  switch (o) {
    case ScreenOrientation.Orientation.LANDSCAPE_LEFT:  return 'landscapeLeft';
    case ScreenOrientation.Orientation.LANDSCAPE_RIGHT: return 'landscapeRight';
    default: return 'landscapeRight';
  }
}

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

// ─── TTS ────────────────────────────────────────────────────────────
//
// 「言い終わってからカウント開始」 を保証するため、 onDone callback を取れる形にする。
// speak() を await したい場合は Promise を返す変種を使う。

function speak(text: string, onDone?: () => void): void {
  Speech.stop();
  Speech.speak(text, {
    language: 'ja-JP',
    rate: 1.05,
    pitch: 1.0,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

/// 効果音 → 短 wait (= sfx の release tail を抜ける) → TTS、 のシーケンス化 helper。
/// 同時発火による「ピー + 読み上げ重なる」 カオスを根絶する。
/// SFX_TAIL_MS は detect_palm 等の短 sfx の余韻が消えるまでの目安。
const SFX_TO_TTS_GAP_MS = 350;
function playSfxThenSpeak(sfx: import('../services/captureSounds').SfxName, text: string, onDone?: () => void): void {
  playSfx(sfx);
  setTimeout(() => speak(text, onDone), SFX_TO_TTS_GAP_MS);
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
    case 'down':  return 'ヘッドセットをもう少し下に向けてください';
    case 'up':    return 'ヘッドセットをもう少し上に向けてください';
    case 'left':  return 'ヘッドセットをもう少し左に向けてください';
    case 'right': return 'ヘッドセットをもう少し右に向けてください';
  }
}

// ─── 画面本体 ─────────────────────────────────────────────────────────

export const CalibrationCaptureScreen: React.FC<Props> = (props) => (
  <SafeAreaProvider>
    <CalibrationCaptureBody {...props} />
  </SafeAreaProvider>
);

const CalibrationCaptureBody: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const STATUS_BAR_H = 20;
  const safeTop = Math.max(insets.top, STATUS_BAR_H);
  const safeLeft = insets.left;
  const safeRight = insets.right;
  const safeBottom = insets.bottom;

  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [available, setAvailable] = useState<boolean | null>(null);
  // 起動直後は announcing から始める (= TTS 「手のひらを上向きに 3 秒キープ」 を最後まで言わせる)
  const [state, setState] = useState<CaptureState>({ kind: 'announcing' });
  const [error, setError] = useState<string | null>(null);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [currentGesture, setCurrentGesture] = useState<'open_palm' | 'thumbs_up' | null>(null);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  const latestHandRef = useRef<HandTrackEvent | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const recordingStartedRef = useRef(false);
  const sessionDirRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // landscape lock
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // 効果音 preload (= 起動時に Sound インスタンスを全部展開)
  useEffect(() => {
    preloadCaptureSounds().catch(() => {});
    return () => {
      unloadCaptureSounds().catch(() => {});
    };
  }, []);

  // 権限 + 機能サポート確認
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
        const ok = await isWideCaptureAvailable();
        if (cancelled) return;
        setAvailable(ok);
      } catch {
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // wide-capture session 起動 / 停止
  useEffect(() => {
    if (!available) return;
    startWideSession().catch((e) => setError(`WideSession start failed: ${e?.message ?? e}`));
    // 進入効果音 + 案内 TTS
    playSfx('enter_capture');
    return () => {
      stopWideSession().catch(() => {});
    };
  }, [available]);

  // OS orientation を native に push
  useEffect(() => {
    const pushNative = (oriValue: ScreenOrientation.Orientation | null) => {
      const d = oriValue !== null ? orientationFromOS(oriValue) : 'landscapeRight';
      setWideDisplayOrientation(d).catch(() => {});
    };
    ScreenOrientation.getOrientationAsync().then(pushNative).catch(() => pushNative(null));
    const sub = ScreenOrientation.addOrientationChangeListener((e) =>
      pushNative(e.orientationInfo.orientation),
    );
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, []);

  // hand track subscription
  useEffect(() => {
    const sub = subscribeWideHandTrack((e) => {
      latestHandRef.current = e;
      setCurrentGesture(e.gesture);
      tickState();
    });
    return () => sub.remove();
  }, []);

  // announcing 進入時に案内 TTS を発話、 完了で awaiting_palm に遷移 (= 言い終わってから検出開始)。
  // announcedRef 撤去版: 「進入のたびに必ず TTS」 = ループ復帰時も毎回案内される。
  // ただし「enter_capture 効果音 + 起動 TTS の同時発火」 を避けるため、 初回 announcing は
  // 少し wait してから speak (= SFX_TO_TTS_GAP_MS を共通利用)。
  useEffect(() => {
    if (state.kind !== 'announcing' || permission !== 'granted' || !available) return;
    const t = setTimeout(() => {
      if (stateRef.current.kind !== 'announcing') return;
      speak('手のひらを上向きにして、 そのまま 3 秒キープしてください', () => {
        if (stateRef.current.kind === 'announcing') {
          setState({ kind: 'awaiting_palm' });
        }
      });
    }, SFX_TO_TTS_GAP_MS);
    return () => clearTimeout(t);
  }, [state.kind, permission, available]);

  // 録画状態に入ったら native の startRecording を呼ぶ + recording 終了で finalize。
  // 二重発火 guard: recordingStartedRef + 「同 cycle で 1 度しか呼ばない」 を厳格化。
  useEffect(() => {
    if (state.kind === 'recording' && !recordingStartedRef.current) {
      recordingStartedRef.current = true;  // 同期で即 true、 後続 fire 防止
      (async () => {
        try {
          const dir = await startWideRecording();
          sessionDirRef.current = dir;
          // 録画開始の合図は countdown_end (= precapture_countdown 末尾で 1 度だけ鳴る) で完結。
          // rec_start.mp3 はここでは鳴らさない (= 二重発火による カオス回避)。
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`録画開始失敗: ${e?.message ?? e}`);
          setState({ kind: 'awaiting_palm' });
          announcedRef.current = false;
        }
      })();
    }
    if (state.kind === 'finalizing') {
      (async () => {
        try {
          const dir = await stopWideRecording();
          sessionDirRef.current = dir;
          playSfx('rec_stop');

          clipStore.enqueue({ sessionDirUri: dir });
          recordingStartedRef.current = false;
          sessionDirRef.current = null;

          // rec_stop が鳴り終わるまで wait (= 600ms)、 そのあと次タスク提案 TTS
          // (= 「録画停止音」 と「お疲れさま...」 が被るカオスを排除)
          await new Promise((r) => setTimeout(r, 600));
          let snap = '';
          try { snap = await captureWideSnapshot(); } catch {}
          if (stateRef.current.kind !== 'finalizing') return;
          // 次タスク提案 TTS は next_task_announcing state で扱う (= 検出停止 + 重複 TTS 回避)
          setState({ kind: 'next_task_announcing' });
          speakNextTaskSuggestion(snap, () => {
            if (stateRef.current.kind === 'next_task_announcing') {
              // 次タスク提案文に「また手のひらを上向きに 3 秒キープ」 が含まれるので awaiting_palm 直行
              setState({ kind: 'awaiting_palm' });
            }
          });
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`録画停止失敗: ${e?.message ?? e}`);
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

    switch (cur.kind) {
      case 'announcing':
      case 'next_task_announcing': {
        // TTS 案内中。 検出停止 (= 言い終わるまで状態遷移しない)。
        return;
      }
      case 'awaiting_palm': {
        if (e.wearerHandCount >= 2 && e.gesture === 'open_palm') {
          setState({ kind: 'palm_holding', startTs: now });
        }
        return;
      }
      case 'palm_holding': {
        if (!(e.wearerHandCount >= 2 && e.gesture === 'open_palm')) {
          setState({ kind: 'awaiting_palm' });
          return;
        }
        if (now - cur.startTs >= PALM_HOLD_MS) {
          // 3s 保持完了 → bbox 中央判定
          const bbox = computeHandBoundingBox(e.wearerHands);
          if (!bbox) {
            setState({ kind: 'awaiting_palm' });
            return;
          }
          const dir = computeAdjustDirection(bbox);
          if (dir === null) {
            // キャリブ確定: 効果音 → 350ms → TTS → onDone → 500ms 静寂 → countdown
            saveBaseline(bbox).catch(() => {});
            setState({ kind: 'calibration_confirmed' });
            playSfxThenSpeak('detect_palm', 'ヘッドセット OK、 撮影を開始します', () => {
              if (stateRef.current.kind !== 'calibration_confirmed') return;
              setTimeout(() => {
                if (stateRef.current.kind !== 'calibration_confirmed') return;
                setState({ kind: 'precapture_countdown', startTs: Date.now(), lastTick: 0 });
              }, 500);
            });
          } else {
            // 中央外れ → ヘッドセット調整指示。 TTS 完了まで palm 受付しない (= acceptPalm: false)
            setState({ kind: 'adjust_needed', direction: dir, acceptPalm: false });
            speak(
              `${headsetGuidance(dir)}。 そのあともう一度、 手のひらを上に向けて 3 秒キープしてください`,
              () => {
                // onDone: 同じ adjust_needed state なら acceptPalm を true に
                setState((prev) =>
                  prev.kind === 'adjust_needed' ? { ...prev, acceptPalm: true } : prev,
                );
              },
            );
          }
        }
        return;
      }
      case 'calibration_confirmed': {
        // 効果音 + TTS + 500ms 待機中。 何も検出しない (= キャリブ確定済みなので gesture 待たない)
        return;
      }
      case 'adjust_needed': {
        // TTS 読み上げ完了 (= acceptPalm: true) 後でないと palm 受付しない (= 案内の中断防止)
        if (!cur.acceptPalm) return;
        if (e.wearerHandCount >= 2 && e.gesture === 'open_palm') {
          setState({ kind: 'palm_holding', startTs: now });
        }
        return;
      }
      case 'precapture_countdown': {
        // キャリブ確定後の開始 countdown。 ジェスチャー継続要求はしない (= ヘッドセット baseline 確定済)。
        // tick 効果音 (= 残り 3,2,1 秒のタイミングで 1 回ずつ)
        const elapsed = now - cur.startTs;
        const remainingSec = Math.ceil((PRECAPTURE_COUNTDOWN_MS - elapsed) / 1000);
        if (remainingSec !== cur.lastTick && remainingSec >= 1 && remainingSec <= 3) {
          playSfx('countdown_tick');
          setState({ ...cur, lastTick: remainingSec });
        }
        if (elapsed >= PRECAPTURE_COUNTDOWN_MS) {
          // countdown_end が録画開始の合図 (= rec_start 二重発火を避けるため end のみで完結)
          playSfx('countdown_end');
          setState({ kind: 'recording', startTs: now, lastHandSeenTs: now, lastWarnTs: 0 });
        }
        return;
      }
      case 'recording': {
        const handVisible = e.wearerHandCount >= 1;
        let lastHandSeen = cur.lastHandSeenTs;
        let lastWarn = cur.lastWarnTs;
        if (handVisible) {
          lastHandSeen = now;
        } else if (now - cur.lastHandSeenTs >= HAND_LOST_WARN_MS && now - cur.lastWarnTs >= WARN_REPEAT_MS) {
          // 効果音 → 350ms → TTS (= 同時発火による警告音と読み上げの被りを排除)
          playSfxThenSpeak('warn_hand_lost', '手がカメラに映っていません');
          lastWarn = now;
        }
        if (e.wearerHandCount >= 2 && e.gesture === 'thumbs_up') {
          setState({ kind: 'stopping', startTs: now });
          return;
        }
        if (lastHandSeen !== cur.lastHandSeenTs || lastWarn !== cur.lastWarnTs) {
          setState({ ...cur, lastHandSeenTs: lastHandSeen, lastWarnTs: lastWarn });
        }
        return;
      }
      case 'stopping': {
        if (!(e.wearerHandCount >= 2 && e.gesture === 'thumbs_up')) {
          setState({ kind: 'recording', startTs: cur.startTs, lastHandSeenTs: Date.now(), lastWarnTs: 0 });
          return;
        }
        if (Date.now() - cur.startTs >= THUMBS_UP_HOLD_MS) {
          // 効果音 → 350ms → TTS → onDone → stop_countdown (= 同時発火排除)
          // 二重発火防止のため stopping_announcing に flip してから sfx+TTS を撃つ
          setState({ kind: 'stopping_announcing' });
          playSfxThenSpeak('detect_thumbs_up', 'そのままキープ。 撮影を終了します', () => {
            if (stateRef.current.kind !== 'stopping_announcing') return;
            setState({ kind: 'stop_countdown', startTs: Date.now(), lastTick: 0 });
          });
          return;
        }
        return;
      }
      case 'stopping_announcing': {
        // 発話中、 判定なし。 onDone で stop_countdown に遷移する。
        return;
      }
      case 'stop_countdown': {
        const elapsed = Date.now() - cur.startTs;
        const remainingSec = Math.ceil((STOP_COUNTDOWN_MS - elapsed) / 1000);
        if (remainingSec !== cur.lastTick && remainingSec >= 1 && remainingSec <= 3) {
          playSfx('countdown_tick');
          setState({ ...cur, lastTick: remainingSec });
        }
        if (elapsed >= STOP_COUNTDOWN_MS) {
          playSfx('countdown_end');
          setState({ kind: 'finalizing' });
        }
        return;
      }
      case 'finalizing':
        return;
    }
  }, []);

  // 100ms 周期 ticker (= hand event が来ない期間も countdown / 警告 timer を進める)
  useEffect(() => {
    const id = setInterval(() => {
      tickState();
      forceRender();
    }, 100);
    return () => clearInterval(id);
  }, [tickState]);

  // countdown 残り秒の表示更新
  useEffect(() => {
    let timeoutMs: number | null = null;
    let startTs: number | null = null;
    if (state.kind === 'precapture_countdown') {
      timeoutMs = PRECAPTURE_COUNTDOWN_MS;
      startTs = state.startTs;
    } else if (state.kind === 'stop_countdown') {
      timeoutMs = STOP_COUNTDOWN_MS;
      startTs = state.startTs;
    }
    if (timeoutMs === null || startTs === null) {
      setCountdownRemaining(null);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - startTs!;
      const remaining = Math.max(0, timeoutMs! - elapsed);
      setCountdownRemaining(Math.ceil(remaining / 1000));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current) {
        stopWideRecording().catch(() => {});
      }
      Speech.stop();
    };
  }, []);

  const onBack = useCallback(() => {
    if (recordingStartedRef.current) {
      stopWideRecording().catch(() => {});
    }
    navigation.goBack();
  }, [navigation]);

  // ─── ガード描画 ──────────────────────────────────────────────────

  if (permission === 'pending' || available === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>準備中…</Text>
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>権限が必要です</Text>
        <Text style={styles.body}>iOS 設定でカメラを許可してください。</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>戻る</Text>
        </Pressable>
      </View>
    );
  }
  if (!available) {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>非対応端末</Text>
        <Text style={styles.body}>この端末では超広角カメラが使えません。</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>戻る</Text>
        </Pressable>
      </View>
    );
  }

  const isRecording =
    state.kind === 'recording' ||
    state.kind === 'stopping' ||
    state.kind === 'stopping_announcing' ||
    state.kind === 'stop_countdown';

  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        <WideCapturePreviewView style={StyleSheet.absoluteFill} />
        {countdownRemaining !== null ? (
          <View style={styles.countdownOverlay} pointerEvents="none">
            <Text style={styles.countdownText}>{countdownRemaining}</Text>
          </View>
        ) : null}
      </View>

      {/* 左上: 戻る */}
      <View style={[styles.chromeTopLeft, { top: safeTop + 12, left: safeLeft + 12 }]}>
        <Pressable
          accessibilityLabel={isRecording ? '緊急停止' : '戻る'}
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

      {/* ジェスチャー可視化 (= 画面中央上に固定 2 個並び、 検出時のみ表示)
          bbox トラッキングなし、 左右の手の有無で個別に表示 / 非表示。 */}
      <GestureOverlay event={latestHandRef.current} topInset={safeTop} />


      {/* エラー表示 (= 下中央) */}
      {error ? (
        <View
          style={[styles.chromeBottom, { bottom: safeBottom + 16, left: safeLeft + 16, right: safeRight + 96 }]}
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

// ─── 次タスク提案 ─────────────────────────────────────────────────────

const NEXT_TASK_SUGGESTIONS = [
  '次は洗濯物畳みとか、 食器の片付けとかどうですか',
  '次は料理の下準備、 もしくは机周りの整理整頓どうですか',
  '次は掃除、 もしくは勉強や読書を撮ってみてはどうですか',
  '次は工作や DIY、 食事の支度はどうですか',
];

function speakNextTaskSuggestion(_snapshotUri: string, onDone?: () => void): void {
  const idx = Math.floor(Math.random() * NEXT_TASK_SUGGESTIONS.length);
  speak(
    `お疲れさま、 クリップ完了。 ${NEXT_TASK_SUGGESTIONS[idx]}。 また手のひらを上向きにして、 3 秒キープすると始まります`,
    onDone,
  );
}

// ─── ジェスチャー可視化 component (= 画面中央上に 2 個固定、 検出時のみ出る) ────
//
// 仕様:
//   - bbox トラッキング無し、 位置は固定 (= 画面上部中央 2 個並び)
//   - gesture 検出時のみ表示 (= null は非表示)
//   - 左右それぞれの手の有無で個別に表示 / 非表示 (= 片手だけなら 1 個、 両手なら 2 個)
//   - 黄色の絵文字風アイコン + navy 丸枠 (= Gemini Imagen 生成)

const HAND_ICONS = {
  open_palm: require('../../assets/icons/hand_open_palm.png'),
  thumbs_up: require('../../assets/icons/hand_thumbs_up.png'),
};

const GestureOverlay: React.FC<{
  event: HandTrackEvent | null;
  topInset: number;
}> = ({ event, topInset }) => {
  if (!event || event.gesture === null || event.wearerHands.length === 0) return null;
  const src = HAND_ICONS[event.gesture];

  // 左右の手が visible か (= landmarks に conf >= LANDMARK_CONF が 1 つ以上ある)
  const leftVisible = event.wearerHands.some(
    (h) => h.handedness === 'left' && h.landmarks.some((l) => l.confidence >= LANDMARK_CONF),
  );
  const rightVisible = event.wearerHands.some(
    (h) => h.handedness === 'right' && h.landmarks.some((l) => l.confidence >= LANDMARK_CONF),
  );
  // handedness が 'unknown' のみの場合は左右両方を立てて 1 個だけ出す fallback
  const handednessKnown = leftVisible || rightVisible;
  const showLeft = handednessKnown ? leftVisible : event.wearerHands.length >= 1;
  const showRight = handednessKnown ? rightVisible : event.wearerHands.length >= 2;

  return (
    <View
      style={[styles.gestureTop, { top: topInset + 64 }]}
      pointerEvents="none"
    >
      {showLeft ? (
        <Image source={src} style={[styles.handIcon, { transform: [{ scaleX: -1 }] }]} resizeMode="contain" />
      ) : (
        <View style={styles.handIconSpacer} />
      )}
      {showRight ? (
        <Image source={src} style={styles.handIcon} resizeMode="contain" />
      ) : (
        <View style={styles.handIconSpacer} />
      )}
    </View>
  );
};

// ─── 状態 → 表示文 ──────────────────────────────────────────────────

function describeState(s: CaptureState): string {
  switch (s.kind) {
    case 'announcing':            return 'CALIBRATE  ·  案内中…';
    case 'next_task_announcing':  return '次タスク提案中…';
    case 'awaiting_palm':         return 'CALIBRATE  ·  手のひらを上に向けて 3 秒キープ';
    case 'palm_holding':          return 'CALIBRATE  ·  検出中…';
    case 'adjust_needed':         return `CALIBRATE  ·  ${headsetGuidance(s.direction)}`;
    case 'calibration_confirmed': return 'CALIBRATED  ·  まもなく開始';
    case 'precapture_countdown':  return 'STARTING';
    case 'recording':             return 'RECORDING  ·  サムズアップで終了';
    case 'stopping':              return 'STOPPING  ·  サムズアップ検出中';
    case 'stopping_announcing':   return 'STOPPING  ·  終了案内中…';
    case 'stop_countdown':        return 'STOPPING';
    case 'finalizing':            return 'FINALIZING';
  }
}

// ─── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { ...StyleSheet.absoluteFillObject },
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
  handIconSpacer: {
    // 片手しか出てない時に位置を中央キープするための空 view
    width: 96,
    height: 96,
    opacity: 0,
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

  gesturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  gestureLabel: {
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
