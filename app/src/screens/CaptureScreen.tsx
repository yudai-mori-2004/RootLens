import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { Camera } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import {
  ArkitCapturePreviewView,
  captureArkitSnapshot,
  isArkitCaptureAvailable,
  setArkitDisplayOrientation,
  startArkitRecording,
  startArkitSession,
  stopArkitRecording,
  stopArkitSession,
  subscribeHandTrack,
  type DisplayOrientation,
  type HandTrackEvent,
} from '../native/arkitCapture';
import { useCaptureOrientationLock } from '../hooks/useScreenOrientation';
import { PhoneOrientationIcon } from '../components/PhoneOrientationIcon';
import { findTask } from '../domain/taskCatalog';
import { clipStore } from '../services/clipPipeline';
import * as FileSystem from 'expo-file-system';
import {
  captureReducer,
  describeState,
  initialCaptureState,
  COUNTDOWN_MS,
  type CaptureState,
} from '../domain/captureFlow';
import { evaluateTaskGate } from '../services/vlmGate';
import { RealtimeFeedback } from '../services/realtimeFeedback';
import { CaptureHandOverlay } from '../components/CaptureHandOverlay';
import { colors, spacing, radii } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

/// expo-screen-orientation の Orientation 値を native module の DisplayOrientation に写像。
/// FACE_UP / FACE_DOWN / UNKNOWN は portrait と同じ扱い (= 直立復帰時の fallback)。
function orientationFromOS(o: ScreenOrientation.Orientation): DisplayOrientation {
  switch (o) {
    case ScreenOrientation.Orientation.LANDSCAPE_LEFT:  return 'landscapeLeft';
    case ScreenOrientation.Orientation.LANDSCAPE_RIGHT: return 'landscapeRight';
    case ScreenOrientation.Orientation.PORTRAIT_UP:
    case ScreenOrientation.Orientation.PORTRAIT_DOWN:
    case ScreenOrientation.Orientation.UNKNOWN:
    default:
      return 'portrait';
  }
}

/// hand pose の緩い framing 判定。
/// handedness は使わない (Vision は egocentric で頻繁に "unknown" を返すため、 left/right
/// 必須にすると「画面に手があるのに rebreaking ない」 バグになる)。
/// 「visible な手が 2 つ以上ある」 で両手映ってる扱い。
/// その上で、 信頼度トップ 2 の visible 範囲の bbox が外周 margin に達しているなら edge。
function computeLooseFramingState(
  hands: import('../native/arkitCapture').WearerHandObservation[],
  confTh: number,
  margin: number,
): 'safe' | 'edge' | 'absent' {
  const visibleHands = hands.filter((h) => h.landmarks.some((l) => l.confidence >= confTh));
  if (visibleHands.length < 2) {
    return 'absent';
  }

  // 信頼度トップ 2 を採用 (= 装着者の両手と仮定)
  const top2 = [...visibleHands]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);

  const lo = margin;
  const hi = 1 - margin;
  const crossesEdge = (hand: (typeof top2)[0]): boolean => {
    const lms = hand.landmarks.filter((l) => l.confidence >= confTh);
    if (lms.length === 0) return false;
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const l of lms) {
      if (l.x < minX) minX = l.x;
      if (l.x > maxX) maxX = l.x;
      if (l.y < minY) minY = l.y;
      if (l.y > maxY) maxY = l.y;
    }
    return minX < lo || maxX > hi || minY < lo || maxY > hi;
  };

  return (crossesEdge(top2[0]) || crossesEdge(top2[1])) ? 'edge' : 'safe';
}

/// 両手の各ランドマークから bbox を作り、 画面の各辺を「最も大きく」 はみ出している方向を返す。
/// すべての辺で margin 以内に収まっていれば null。
function computeDriftDirection(
  hands: import('../native/arkitCapture').WearerHandObservation[],
  margin: number,
): 'left' | 'right' | 'top' | 'bottom' | null {
  let leftOver = 0, rightOver = 0, topOver = 0, bottomOver = 0;
  for (const hand of hands) {
    const lms = hand.landmarks.filter((l) => l.confidence > 0.3);
    if (lms.length === 0) continue;
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const l of lms) {
      if (l.x < minX) minX = l.x;
      if (l.x > maxX) maxX = l.x;
      if (l.y < minY) minY = l.y;
      if (l.y > maxY) maxY = l.y;
    }
    leftOver   = Math.max(leftOver,   margin - minX);
    rightOver  = Math.max(rightOver,  maxX - (1 - margin));
    topOver    = Math.max(topOver,    margin - minY);
    bottomOver = Math.max(bottomOver, maxY - (1 - margin));
  }
  const maxOver = Math.max(leftOver, rightOver, topOver, bottomOver);
  if (maxOver <= 0) return null;
  if (maxOver === leftOver) return 'left';
  if (maxOver === rightOver) return 'right';
  if (maxOver === topOver) return 'top';
  return 'bottom';
}

export const CaptureScreen: React.FC<Props> = ({ route, navigation }) => {
  const task = findTask(route.params.taskId);
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, dispatch] = useReducer(captureReducer, initialCaptureState);
  const [handEvent, setHandEvent] = useState<HandTrackEvent | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);

  // Orientation: task spec に従って lock + 実値の追跡。
  //   - task が 'landscape' なら LANDSCAPE (LEFT / RIGHT 両許可、 OS が物理位置で選択)
  //   - task が 'portrait' なら PORTRAIT_UP
  // 一致判定は useWindowDimensions の幅 / 高さ比で行う (= layout が一番信頼できる、
  // ScreenOrientation API は UNKNOWN を返す瞬間があり判定がフラつく)。
  // 物理 LEFT / RIGHT は ScreenOrientation listener から取って native に push する。
  useCaptureOrientationLock(task?.orientation ?? 'portrait');
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const layoutIsLandscape = winW > winH;
  const taskWantsLandscape = (task?.orientation ?? 'portrait') === 'landscape';
  const orientationMismatch = task ? layoutIsLandscape !== taskWantsLandscape : false;
  // hand event subscribe コールバックは初回 render に bind されるので、 mismatch 値の参照は ref 経由
  const orientationMismatchRef = useRef(false);
  useEffect(() => { orientationMismatchRef.current = orientationMismatch; }, [orientationMismatch]);

  // 録画状態とそれに紐づくリソースの ref
  const recordingStartedRef = useRef(false);
  const recordingFinalizedRef = useRef(false);
  const recordingStartTsRef = useRef<number | null>(null);
  const lastHandlEventRef = useRef<HandTrackEvent | null>(null);

  // ドリフト方向音声ガイド用の state
  const driftStartTsRef = useRef<number | null>(null);
  const lastSpokenDirRef = useRef<'left' | 'right' | 'top' | 'bottom' | null>(null);
  const DRIFT_VOICE_DELAY_MS = 3000;
  const FRAME_SAFE_MARGIN = 0.08;   // HandTracker.frameSafeMargin と一致

  // hand pose 緩い条件 framing 判定:
  //   - 2 つ以上 visible (= 1+ ランドマーク confidence >= 0.3) なら 「両手映ってる」 扱い
  //   - 信頼度トップ 2 の visible 範囲の bbox が画面外周 8% に達していたら edge
  //   - それ以外 (= 片手 / 0 手) は絶対的には absent だが、 ms 単位の検出ジッタは下のブリッジで吸収
  const LANDMARK_CONF = 0.3;
  const SAFE_MARGIN = 0.08;

  // 検出ジッタブリッジ: 直近 visible だった状態を 400ms 保持する。
  // 作業中に一瞬片手しか取れない瞬間 (Vision の単発ミス) で音楽が途切れないようにするため。
  // 1.5 秒級の遮蔽 fallback とは別物。 ms 単位のジッタだけを均す目的。
  const lastNonAbsentRef = useRef<{ state: 'safe' | 'edge'; ts: number } | null>(null);
  const DETECTION_JITTER_BRIDGE_MS = 400;

  // 権限と機能サポートの確認
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

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
        const ok = await isArkitCaptureAvailable();
        if (cancelled) return;
        setAvailable(ok);
      } catch {
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ARSession 起動 / 停止 (= プレビュー描画 + HandTracker)
  useEffect(() => {
    if (!available) return;
    startArkitSession().catch((e) => setError(`ARSession start failed: ${e?.message ?? e}`));
    return () => {
      stopArkitSession().catch(() => {});
    };
  }, [available]);

  // OS orientation を購読し、 native (ARKit / Vision) に伝達する。
  // mount mismatch 判定自体は useWindowDimensions ベースで上で行う、 これは LEFT / RIGHT
  // の細分化と native push 専用。 OS が UNKNOWN (= 端末が水平) を返した場合は layout から
  // 推定 (landscape → landscapeRight、 portrait → portrait) で fallback。
  useEffect(() => {
    if (!task) return;
    const pushNative = (oriValue: ScreenOrientation.Orientation | null) => {
      let d = oriValue !== null ? orientationFromOS(oriValue) : null;
      if (d === null || (taskWantsLandscape && d === 'portrait') || (!taskWantsLandscape && d !== 'portrait')) {
        // OS が task と合わない / UNKNOWN を返す → layout fallback
        d = layoutIsLandscape ? 'landscapeRight' : 'portrait';
      }
      setArkitDisplayOrientation(d).catch(() => {});
    };
    ScreenOrientation.getOrientationAsync().then(pushNative).catch(() => pushNative(null));
    const sub = ScreenOrientation.addOrientationChangeListener((e) => pushNative(e.orientationInfo.orientation));
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, [task, taskWantsLandscape, layoutIsLandscape]);

  // HandTrack イベント購読 + reducer に転送 + フィードバック発火
  // orientationMismatch 中は reducer に流さない (= mount が整うまで gesture / state を
  // 進めない、 = mismatch 中の hand 検出は意味のある landmark じゃない可能性が高い)
  useEffect(() => {
    const sub = subscribeHandTrack((e) => {
      setHandEvent(e);
      lastHandlEventRef.current = e;
      if (orientationMismatchRef.current) return;
      dispatch({
        kind: 'frame',
        ts: Date.now(),
        gesture: e.gesture,
        wearerHandCount: e.wearerHandCount,
      });
      // 録画中のみフィードバック発火
      if (recordingStartedRef.current && !recordingFinalizedRef.current) {
        const rawState = computeLooseFramingState(e.wearerHands, LANDMARK_CONF, SAFE_MARGIN);

        // 検出ジッタブリッジ: raw が absent でも、 直近 400ms 内に safe/edge を見ていたら
        // その状態を維持する。 「片手しか取れない一瞬」 で音楽が途切れないようにする。
        let framingState: 'safe' | 'edge' | 'absent' = rawState;
        const nowTs = Date.now();
        if (rawState !== 'absent') {
          lastNonAbsentRef.current = { state: rawState, ts: nowTs };
        } else if (
          lastNonAbsentRef.current !== null &&
          nowTs - lastNonAbsentRef.current.ts <= DETECTION_JITTER_BRIDGE_MS
        ) {
          framingState = lastNonAbsentRef.current.state;
        }

        RealtimeFeedback.onFramingState(framingState);
        // ドリフト方向音声ガイド: edge が 3 秒続いたら 1 度だけ喋る
        const isDrift = framingState === 'edge';
        if (isDrift) {
          const now = Date.now();
          if (driftStartTsRef.current === null) {
            driftStartTsRef.current = now;
          }
          if (now - driftStartTsRef.current >= DRIFT_VOICE_DELAY_MS) {
            const dir = computeDriftDirection(e.wearerHands, FRAME_SAFE_MARGIN);
            if (dir && dir !== lastSpokenDirRef.current) {
              lastSpokenDirRef.current = dir;
              RealtimeFeedback.speakDriftDirection(dir);
            }
          }
        } else {
          // 安全ゾーン内 or 両手揃ってない時は ドリフトタイマー / 最終発話方向 をリセット
          driftStartTsRef.current = null;
          lastSpokenDirRef.current = null;
        }
      }
    });
    return () => sub.remove();
  }, []);

  // VLM 事前チェック (= state が vlm_start_checking に入ったら 1 回呼ぶ)
  useEffect(() => {
    if (state.kind !== 'vlm_start_checking' || !task) return;
    let cancelled = false;
    (async () => {
      // 最終確認: 直近フレームで本当に両手 open_palm が見えているか。 reducer で確認済だが
      // VLM 呼び出し直前の最新情報でもう一度ガードする (= 1 秒経過直後にズレるケース対策)
      const last = lastHandlEventRef.current;
      if (!last || last.wearerHandCount < 2 || last.gesture !== 'open_palm') {
        dispatch({ kind: 'vlmStartError', message: '両手の構えが外れました' });
        return;
      }
      try {
        const snapshot = await captureArkitSnapshot();
        if (cancelled) return;
        const result = await evaluateTaskGate({
          imageUri: snapshot,
          taskName: task.name,
          conditionText: task.startCondition,
        });
        if (cancelled) return;
        dispatch({ kind: 'vlmStartResult', match: result.match, reason: result.reason });
      } catch (e: any) {
        if (cancelled) return;
        dispatch({ kind: 'vlmStartError', message: e?.message ?? String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [state.kind, route.params.taskId, task]);

  // カウントダウンの残り秒表示
  useEffect(() => {
    if (state.kind !== 'countdown') {
      setCountdownRemaining(null);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - state.startTs;
      const remaining = Math.max(0, COUNTDOWN_MS - elapsed);
      setCountdownRemaining(Math.ceil(remaining / 1000));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state]);

  // recording 状態に入ったら録画開始 / finalizing で停止
  useEffect(() => {
    if (state.kind === 'recording' && !recordingStartedRef.current) {
      recordingStartedRef.current = true;
      recordingStartTsRef.current = Date.now();
      (async () => {
        try {
          await startArkitRecording();
          await RealtimeFeedback.onRecordingStart();
        } catch (e: any) {
          recordingStartedRef.current = false;
          recordingStartTsRef.current = null;
          setError(`録画開始に失敗: ${e?.message ?? e}`);
        }
      })();
    }
    if (state.kind === 'finalizing' && !recordingFinalizedRef.current) {
      recordingFinalizedRef.current = true;
      (async () => {
        try {
          const sessionDirUri = await stopArkitRecording();
          await RealtimeFeedback.onRecordingStop();
          // VLM 事後チェック (= 達成確度の取得)。 失敗しても reviewing には進む
          let achievementConfidence = 0;
          let snapshotUri: string | null = null;
          try {
            snapshotUri = await captureArkitSnapshot();
            if (task && snapshotUri) {
              const res = await evaluateTaskGate({
                imageUri: snapshotUri,
                taskName: task.name,
                conditionText: task.endCondition,
              });
              achievementConfidence = res.score;
            }
          } catch (e) {
            console.warn('[Capture] VLM end check failed', e);
          }
          // reviewing 状態に遷移 (= 撮影者が「送る / 撮り直す」 を選ぶ)
          dispatch({ kind: 'reviewReady', sessionDirUri, achievementConfidence, snapshotUri });
          // 終了 finalize はこのターンで完了、 次の録画開始に備えてフラグを reset
          recordingStartedRef.current = false;
        } catch (e: any) {
          recordingFinalizedRef.current = false;
          setError(`録画停止に失敗: ${e?.message ?? e}`);
        }
      })();
    }
  }, [state, navigation, route.params.taskId, task]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current && !recordingFinalizedRef.current) {
        stopArkitRecording().catch(() => {});
        RealtimeFeedback.onRecordingStop().catch(() => {});
      }
    };
  }, []);

  const onPreviewLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewSize({ width, height });
  }, []);

  // reviewing → 「送る」: clipPipeline に enqueue して Main の Collection タブへ遷移
  const onReviewSend = useCallback(() => {
    if (state.kind !== 'reviewing') return;
    clipStore.enqueue({
      taskId: route.params.taskId,
      sessionDirUri: state.sessionDirUri,
      achievementConfidence: state.achievementConfidence,
      snapshotUri: state.snapshotUri ?? undefined,
    });
    // popToTop() だけだと Main の先頭タブ (= Job) に戻ってしまう。
    // 明示的に Collection タブを指定して遷移、 user が新クリップを即見られるようにする。
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main', state: { routes: [{ name: 'Collection' }], index: 0 } as any }],
    });
  }, [state, navigation, route.params.taskId]);

  // reviewing → 「撮り直す」: セッションディレクトリ丸ごと破棄して await_palm に戻る
  const onReviewRetake = useCallback(() => {
    if (state.kind !== 'reviewing') return;
    const { sessionDirUri } = state;
    (async () => {
      try {
        const path = sessionDirUri.startsWith('file://') ? sessionDirUri.replace('file://', '') : sessionDirUri;
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch (e) {
        console.warn('[Capture] failed to delete discarded session dir', e);
      }
    })();
    recordingFinalizedRef.current = false;
    dispatch({ kind: 'retake' });
  }, [state]);

  // 緊急停止ボタン (= ハンドサインが効かないときの脱出口)。
  // 録画中だった場合は MCAP を保存して reviewing 状態に遷移する (= 撮影者が「送る / 撮り直す」 を選ぶ)。
  // 録画前だった場合は前画面に戻る。
  const onEmergencyStop = useCallback(() => {
    if (recordingStartedRef.current && !recordingFinalizedRef.current) {
      recordingFinalizedRef.current = true;
      (async () => {
        try {
          const sessionDirUri = await stopArkitRecording();
          await RealtimeFeedback.onRecordingStop();
          let snapshotUri: string | null = null;
          try { snapshotUri = await captureArkitSnapshot(); } catch {}
          dispatch({ kind: 'reviewReady', sessionDirUri, achievementConfidence: 0, snapshotUri });
          recordingStartedRef.current = false;
        } catch (e: any) {
          setError(`録画停止に失敗: ${e?.message ?? e}`);
        }
      })();
    } else {
      navigation.goBack();
    }
  }, [navigation]);

  if (!task) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.eyebrow}>NOT FOUND</Text>
        <Text style={styles.body}>Task "{route.params.taskId}" not found.</Text>
      </SafeAreaView>
    );
  }
  if (permission === 'pending' || available === null) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.eyebrow}>CAMERA</Text>
        <Text style={styles.body}>準備中…</Text>
      </SafeAreaView>
    );
  }
  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.eyebrow}>権限が必要です</Text>
        <Text style={styles.body}>iOS 設定でカメラを許可してください。</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>戻る</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!available) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.eyebrow}>非対応端末</Text>
        <Text style={styles.body}>この端末では ARKit ワールドトラッキングが使えません。</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>戻る</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isRecording = state.kind === 'recording' || state.kind === 'thumbs_up_holding' || state.kind === 'finalizing';
  // 録画中もオーバーレイ (= ボックス + ランドマーク) を描く。 ストラップ時は見えないが、
  // 手元に持って確認する時 / 他人が補助する時に framing がわかる。 GPU 負荷は SVG 数十要素なので軽い。
  const showOverlay = true;

  return (
    <View style={styles.root}>
      {/* Camera preview は画面全体を占有 (= 黒い chrome 領域なし) */}
      <View style={styles.preview} onLayout={onPreviewLayout}>
        <ArkitCapturePreviewView style={StyleSheet.absoluteFill} />
        {showOverlay && previewSize.width > 0 && handEvent ? (
          <CaptureHandOverlay
            width={previewSize.width}
            height={previewSize.height}
            hands={handEvent.wearerHands}
            wellFramed={computeLooseFramingState(handEvent.wearerHands, LANDMARK_CONF, SAFE_MARGIN) === 'safe'}
            imageWidth={handEvent.imageWidth}
            imageHeight={handEvent.imageHeight}
          />
        ) : null}
        {state.kind === 'countdown' && countdownRemaining !== null ? (
          <View style={styles.countdownOverlay} pointerEvents="none">
            <Text style={styles.countdownText}>{countdownRemaining}</Text>
          </View>
        ) : null}
        {orientationMismatch ? (
          <View style={styles.orientationGate} pointerEvents="none">
            <View style={styles.orientationGateIcon}>
              <PhoneOrientationIcon
                orientation={task.orientation}
                size={108}
                stroke="#FFFFFF"
                accent={colors.emerald}
                withRotationHint
              />
            </View>
            <Text style={styles.orientationGateEyebrow}>ROTATE MOUNT</Text>
            <Text style={styles.orientationGateTitle}>
              {task.orientation === 'landscape' ? 'Landscape orientation' : 'Portrait orientation'}
            </Text>
            <Text style={styles.orientationGateBody}>
              {task.orientation === 'landscape'
                ? 'mount を横向きに合わせると撮影を開始できます'
                : 'mount を縦向きに合わせると撮影を開始できます'}
            </Text>
          </View>
        ) : null}

        {state.kind === 'reviewing' ? (
          <ReviewOverlay
            confidence={state.achievementConfidence}
            onSend={onReviewSend}
            onRetake={onReviewRetake}
          />
        ) : null}
      </View>

      {/* 左上: 閉じる / 緊急停止。 circular で 40pt 角、 landscape でも邪魔にならない */}
      <View style={[styles.chromeTopLeft, { top: insets.top + 12, left: insets.left + 12 }]}>
        <Pressable
          accessibilityLabel={isRecording ? '緊急停止' : '戻る'}
          onPress={onEmergencyStop}
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

      {/* 中央上: タスク名 + 状態。 一行に詰めた pill。 タップ無し、 視認のみ */}
      <View
        style={[styles.chromeTopCenter, { top: insets.top + 12, left: insets.left + 60, right: insets.right + 60 }]}
        pointerEvents="none"
      >
        <View style={styles.headerPill}>
          <Text style={styles.headerTask} numberOfLines={1}>{task.name}</Text>
          <View style={styles.headerSep} />
          <Text style={styles.headerStatus} numberOfLines={1}>{describeState(state)}</Text>
        </View>
      </View>

      {/* 右上: REC indicator (録画中のみ) */}
      {isRecording ? (
        <View
          style={[styles.chromeTopRight, { top: insets.top + 12, right: insets.right + 12 }]}
          pointerEvents="none"
        >
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recLabel}>REC</Text>
          </View>
        </View>
      ) : null}

      {/* エラーは画面下部に floating で */}
      {error ? (
        <View
          style={[styles.chromeBottom, { bottom: insets.bottom + 16, left: insets.left + 16, right: insets.right + 16 }]}
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

// ─── ReviewOverlay ───────────────────────────────────────────────────
//
// 撮影終了直後に表示する全画面オーバレイ。 達成確度 + 「送る / 撮り直す」 を提示。
// SPECS_JA §2.4 step 6 そのもの。 タスク達成確度は VLM がフレームから算出した数値で、
// 品質スコア (= server pipeline) とは別物 (= SPECS §2.3 用語整理を参照)。

const ReviewOverlay: React.FC<{
  confidence: number;
  onSend: () => void;
  onRetake: () => void;
}> = ({ confidence, onSend, onRetake }) => {
  const value = Math.max(0, Math.min(100, Math.round(confidence)));
  // 達成確度の表示色: 70 以上 → emerald、 40-69 → 中立、 40 未満 → warn 系
  const tone =
    value >= 70 ? colors.emerald :
    value >= 40 ? '#FFFFFF' :
    colors.gold;
  return (
    <View style={styles.reviewOverlay} pointerEvents="auto">
      <View style={styles.reviewCard}>
        <Text style={styles.reviewEyebrow}>録画完了</Text>
        <View style={styles.reviewNumberRow}>
          <Text style={[styles.reviewNumber, { color: tone }]}>{value}</Text>
          <Text style={[styles.reviewPercent, { color: tone }]}>%</Text>
        </View>
        <Text style={styles.reviewLabel}>達成確度</Text>
        <Text style={styles.reviewBody}>
          開始 / 終了条件への合致度です。{value < 60 ? ' 低めなので、 もう一度試すこともできます。' : ''}
        </Text>
        <View style={styles.reviewActions}>
          <Pressable
            onPress={onRetake}
            style={({ pressed }) => [styles.reviewBtn, styles.reviewBtnSecondary, pressed && styles.reviewBtnPressed]}
          >
            <Text style={[styles.reviewBtnLabel, styles.reviewBtnLabelSecondary]}>撮り直す</Text>
          </Pressable>
          <Pressable
            onPress={onSend}
            style={({ pressed }) => [styles.reviewBtn, styles.reviewBtnPrimary, pressed && styles.reviewBtnPressed]}
          >
            <Text style={[styles.reviewBtnLabel, styles.reviewBtnLabelPrimary]}>送る</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.lg, gap: spacing.sm,
    backgroundColor: colors.paper,
  },
  eyebrow: { color: colors.textMute, fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  preview: { flex: 1, backgroundColor: '#000' },

  // Floating chrome (= 画面の上に被せる UI 要素、 full-width バーは持たない)
  chromeTopLeft: { position: 'absolute' },
  chromeTopCenter: { position: 'absolute', alignItems: 'center' },
  chromeTopRight: { position: 'absolute' },
  chromeBottom: { position: 'absolute' },

  // 閉じる / 緊急停止: 40pt 円形ボタン
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(8,18,38,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  closeBtnPressed: { backgroundColor: 'rgba(8,18,38,0.78)' },
  closeBtnRec: {
    backgroundColor: 'rgba(178,58,46,0.65)',
    borderColor: 'rgba(255,255,255,0.18)',
  },

  // タスク名 + 状態を 1 行にまとめた pill
  headerPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 8,
    backgroundColor: 'rgba(8,18,38,0.55)',
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    maxWidth: '100%',
  },
  headerTask: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  headerSep: {
    width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.22)',
    marginHorizontal: spacing.sm,
  },
  headerStatus: {
    color: 'rgba(255,255,255,0.78)', fontSize: 12,
    flexShrink: 1,
  },

  // REC indicator
  recPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(178,58,46,0.85)', borderRadius: 999,
  },
  recDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },
  recLabel: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },

  // エラー floating card
  errCard: {
    backgroundColor: 'rgba(178,58,46,0.20)',
    borderRadius: radii.md, padding: spacing.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  errBody: { color: '#FCC', fontSize: 12 },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  countdownText: {
    color: '#fff', fontSize: 120, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  // 録画完了直後の review overlay (= 達成確度 + 送る/撮り直す)
  reviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,18,38,0.78)',
    paddingHorizontal: spacing.lg,
  },
  reviewCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: 'rgba(14,31,68,0.92)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  reviewEyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10, letterSpacing: 1.8, fontWeight: '700',
  },
  reviewNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm,
  },
  reviewNumber: {
    fontSize: 92,
    fontWeight: '300',
    letterSpacing: -3,
    lineHeight: 96,
  },
  reviewPercent: {
    fontSize: 28,
    fontWeight: '400',
    marginLeft: 4,
  },
  reviewLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  reviewBody: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    width: '100%',
  },
  reviewBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  reviewBtnPrimary: {
    backgroundColor: '#fff',
  },
  reviewBtnPressed: { opacity: 0.7 },
  reviewBtnLabel: {
    fontSize: 14, fontWeight: '600', letterSpacing: 0.3,
  },
  reviewBtnLabelSecondary: { color: '#fff' },
  reviewBtnLabelPrimary: { color: colors.ink },

  orientationGate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,18,38,0.86)',
    paddingHorizontal: spacing.xl,
  },
  orientationGateIcon: { marginBottom: spacing.lg },
  orientationGateEyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10, letterSpacing: 1.8, fontWeight: '700',
    marginBottom: spacing.xs,
  },
  orientationGateTitle: {
    color: '#fff', fontSize: 22, fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  orientationGateBody: {
    color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 22,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center',
  },
  emergencyBtn: {
    paddingHorizontal: 32, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  emergencyLabel: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  btn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radii.sm,
  },
  btnLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
