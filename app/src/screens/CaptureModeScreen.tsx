// 撮影モード (UI_SPECS_JA §4 + §5)。
//
// 1 画面内で「対話サブモード」 と 「カメラサブモード」 を切替える:
//   taskId == null  → 対話サブモード (= タスク選択 placeholder、 voice agent は task 13 で本実装)
//   taskId != null  → カメラサブモード (= captureFlow state machine 駆動)
//
// 視覚的断絶を作らないため、 ARKit session と hand tracking subscription は phase 切替で
// 持続する。 撮影完了で taskId=null に戻して次タスク待ちに復帰、 ループ可能 (UI_SPECS §2.2)。

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
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
import { findTask, TASKS, type TaskDef } from '../domain/taskCatalog';
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
import {
  buildDeviceContext,
  callVoiceAgent,
  speak,
  type AgentTurn,
} from '../services/voiceAgent';
import { colors, fonts, spacing, radii, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureMode'>;

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

export const CaptureModeScreen: React.FC<Props> = ({ navigation }) => {
  // 撮影中タスク (= null なら対話サブモード)。 撮影完了で null に戻して次タスク待ち。
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = taskId ? findTask(taskId) : null;
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
  }, [state.kind, taskId, task]);

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
  }, [state, navigation, taskId, task]);

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

  // reviewing → 「送る」: clipPipeline に enqueue して、 対話サブモードに戻る (UI_SPECS §2.2)。
  // ホームには戻らない (= ヘッドマウントを外さずに次タスクへループ可能)。
  const onReviewSend = useCallback(() => {
    if (state.kind !== 'reviewing' || !taskId) return;
    clipStore.enqueue({
      taskId,
      sessionDirUri: state.sessionDirUri,
      achievementConfidence: state.achievementConfidence,
      snapshotUri: state.snapshotUri ?? undefined,
    });
    // state machine と内部 ref を全部 reset して dialogue mode に戻る
    recordingFinalizedRef.current = false;
    recordingStartedRef.current = false;
    dispatch({ kind: 'retake' });
    setTaskId(null);
  }, [state, taskId]);

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

  // 緊急停止 / 戻るボタン。
  //   録画中: MCAP を保存して reviewing 状態へ
  //   カメラサブモード (= 待機中): dialogue に戻る (= タスク選択し直し)
  //   対話サブモード: Home タブへ
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
    } else if (taskId !== null) {
      // タスク選択済だがまだ未録画 → dialogue に戻ってタスク選び直し
      dispatch({ kind: 'retake' });
      setTaskId(null);
    } else {
      navigation.goBack();
    }
  }, [navigation, taskId]);

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
  // 手のスケルトン overlay は撮影中 (= task 確定後) のみ表示。 dialogue 中は出さない方が
  // 視覚的にクリーン。 task 13 で voice agent ON 後は dialogue 中も出す予定 (UI_SPECS §4.2)。
  const showOverlay = task !== null;

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
        {task && orientationMismatch ? (
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

      {/* 左上: 閉じる / 緊急停止。 SafeAreaView で orientation 変化時のレイアウト崩れを防ぐ。 */}
      <SafeAreaView style={styles.chromeTopLeftSafe} edges={['top', 'left']}>
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
      </SafeAreaView>

      {/* 中央上: タスク名 + 状態。 一行に詰めた pill (= 撮影中のみ表示) */}
      {task ? (
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
      ) : null}

      {/* 対話サブモード overlay (= taskId が無いとき) */}
      {!task ? (
        <DialogueOverlay
          onSelectTask={(id) => setTaskId(id)}
          onExit={() => navigation.goBack()}
          topInset={insets.top}
        />
      ) : null}

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

// ─── DialogueOverlay (UI_SPECS §4) ───────────────────────────────────
//
// 対話サブモードの画面。 Claude Haiku 4.5 ベースの AI エージェントと話す。
// voice agent の wake word / STT (= sherpa-onnx) が来るまでは text 入力で代用、
// AI 応答は TTS (= expo-speech) で読み上げる。 カメラプレビューは下に常時透ける。
//
// レイアウト:
//   上部 トースト: AI の最新応答 (= 数秒で fade out しても良いが、 まずは保持)
//   中部 トースト: ユーザの最新発話 (= STT 化された text 又は手動入力)
//   下部:
//     ① タスクタイル横スクロール (= UI_SPECS §4.5 ハンバーガーメニュー相当の fallback)
//     ② テキスト入力 (= STT 代用、 「Hey Lens」 mock)

const DialogueOverlay: React.FC<{
  onSelectTask: (taskId: string) => void;
  onExit: () => void;
  topInset: number;
}> = ({ onSelectTask, onExit, topInset }) => {
  const [userText, setUserText] = useState('');
  const [draft, setDraft] = useState('');
  const [agentText, setAgentText] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<AgentTurn[]>([]);

  const sendToAgent = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setError(null);
    setUserText(trimmed);
    setDraft('');
    setThinking(true);
    try {
      const ctx = buildDeviceContext({
        orientation: 'portrait',          // TODO: 実値を取る
        tracking_state: 'normal',         // TODO: ARKit 経由で取得
        hands_detected: { left: false, right: false },
        selected_task: null,
        clips_recorded_this_session: 0,
        current_mode: 'dialogue',
      });
      const resp = await callVoiceAgent({
        userText: trimmed,
        deviceContext: ctx,
        history: historyRef.current,
      });
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', text: trimmed },
        { role: 'assistant', text: resp.response_text },
      ];
      setAgentText(resp.response_text);
      speak(resp.response_text);

      // action 解釈
      if (resp.action.type === 'task_matched' && resp.action.task_id) {
        // 「基準確認しますか?」 のような確認ターン → ユーザの 「始めて」 待ち
        if (!resp.action.await_user_confirmation) {
          onSelectTask(resp.action.task_id);
        }
      } else if (resp.action.type === 'start_recording' && resp.action.task_id) {
        onSelectTask(resp.action.task_id);
      } else if (resp.action.type === 'end_session') {
        onExit();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setThinking(false);
    }
  }, [onSelectTask, onExit, thinking]);

  return (
    <View style={dialogueStyles.root} pointerEvents="box-none">
      {/* 全体に薄い scrim をかけてカメラプレビューを和らげる */}
      <View style={dialogueStyles.scrim} pointerEvents="none" />

      {/* 上部: AI 応答 toast (= 常時表示、 来たら更新) */}
      <View style={[dialogueStyles.topArea, { paddingTop: topInset + 12 }]} pointerEvents="none">
        {agentText ? (
          <View style={dialogueStyles.agentToast}>
            <Text style={dialogueStyles.agentToastEyebrow}>HEY LENS</Text>
            <Text style={dialogueStyles.agentToastText}>{agentText}</Text>
          </View>
        ) : (
          <View style={dialogueStyles.idlePrompt}>
            <Text style={dialogueStyles.idleEyebrow}>STT · TEXT FALLBACK</Text>
            <Text style={dialogueStyles.idleCue}>
              <Text style={dialogueStyles.idleCueAccent}>“Hey Lens.”</Text>
            </Text>
            <Text style={dialogueStyles.idleBody}>
              話しかけるか、 下のボックスに入力してください。
            </Text>
          </View>
        )}
        {userText ? (
          <View style={dialogueStyles.userToast}>
            <Text style={dialogueStyles.userToastIcon}>🎙</Text>
            <Text style={dialogueStyles.userToastText} numberOfLines={2}>{userText}</Text>
          </View>
        ) : null}
      </View>

      {/* 下部: タスクタイル + テキスト入力 */}
      <View style={dialogueStyles.bottomArea}>
        <Text style={dialogueStyles.pickerEyebrow}>QUICK PICK</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={dialogueStyles.pickerScroll}
        >
          {TASKS.map((task) => (
            <TaskTile key={task.id} task={task} onPress={() => onSelectTask(task.id)} />
          ))}
        </ScrollView>

        <View style={dialogueStyles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={thinking ? '考え中…' : '話しかける (例: 洗い物しよう)'}
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={dialogueStyles.input}
            editable={!thinking}
            onSubmitEditing={() => sendToAgent(draft)}
            returnKeyType="send"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Pressable
            onPress={() => sendToAgent(draft)}
            disabled={thinking || !draft.trim()}
            style={({ pressed }) => [
              dialogueStyles.sendBtn,
              (thinking || !draft.trim()) && dialogueStyles.sendBtnDisabled,
              pressed && dialogueStyles.sendBtnPressed,
            ]}
          >
            {thinking ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Svg width={16} height={16} viewBox="0 0 16 16">
                <Path d="M3 8h10m-3 -3 3 3 -3 3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </Svg>
            )}
          </Pressable>
        </View>
        {error ? (
          <Text style={dialogueStyles.errorText} numberOfLines={2}>AI: {error}</Text>
        ) : null}
      </View>
    </View>
  );
};

const TaskTile: React.FC<{ task: TaskDef; onPress: () => void }> = ({ task, onPress }) => {
  const [lo, hi] = task.durationMin;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [dialogueStyles.tile, pressed && dialogueStyles.tilePressed]}
    >
      <View style={dialogueStyles.tileIlloFrame}>
        <Image source={task.illustration} style={dialogueStyles.tileIllo} resizeMode="contain" />
      </View>
      <View style={dialogueStyles.tileBody}>
        <Text style={dialogueStyles.tileName} numberOfLines={1}>{task.name}</Text>
        <Text style={dialogueStyles.tileMeta}>{lo}–{hi}m · {task.intensity}</Text>
      </View>
    </Pressable>
  );
};

const dialogueStyles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,18,38,0.42)' },

  topArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },

  // AI 応答 toast (UI_SPECS §4.2 上部トースト)
  agentToast: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  agentToastEyebrow: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.emeraldDeep,
  },
  agentToastText: {
    fontFamily: fonts.serifMedium,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: colors.ink,
  },

  // idle prompt (= AI 応答がまだ無いときの placeholder)
  idlePrompt: {
    gap: 4,
    alignItems: 'flex-start',
  },
  idleEyebrow: {
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.7)',
  },
  idleCue: {
    fontFamily: fonts.serifLight,
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -0.5,
    color: '#fff',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  idleCueAccent: { fontFamily: fonts.serifMedium },
  idleBody: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 2,
  },

  // ユーザ発話 toast (UI_SPECS §4.2 下部トースト、 ただし機能上は上に配置)
  userToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(14,31,68,0.78)',
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    maxWidth: '85%',
  },
  userToastIcon: { fontSize: 14 },
  userToastText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: '#fff',
    flexShrink: 1,
  },

  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    gap: spacing.sm,
  },

  pickerEyebrow: {
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.55)',
    paddingHorizontal: spacing.xl,
  },
  pickerScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },

  // 入力行 (= STT 代用 text input)
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(14,31,68,0.78)',
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.emerald,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnPressed: { opacity: 0.7 },
  errorText: {
    paddingHorizontal: spacing.xl,
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: '#FCC',
    marginTop: 4,
  },
  tile: {
    width: 138,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  tilePressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  tileIlloFrame: {
    aspectRatio: 1,
    backgroundColor: 'rgba(248,244,237,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  tileIllo: { width: '92%', height: '92%' },
  tileBody: {
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  tileName: {
    fontFamily: fonts.serifMedium,
    fontSize: 14,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  tileMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMute,
    letterSpacing: 0.3,
  },
});

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
  // SafeAreaView 版: 自身が absolute で top-left に固定、 内側に safe-area padding が乗る。
  // orientation 変化時に inset 計算が一拍遅れる現象を回避する。
  chromeTopLeftSafe: {
    position: 'absolute', top: 0, left: 0,
    padding: 12,
  },
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
