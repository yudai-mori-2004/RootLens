import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Camera } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import {
  HandPosePreviewView,
  captureHandPoseSnapshot,
  startHandPoseRecording,
  stopHandPoseRecording,
  type HandPoseEvent,
} from '../native/handPose';
import { evaluateTaskGate, type VlmGateResult } from '../services/vlmGate';
import {
  captureReducer,
  classifyHands,
  initialCaptureSub,
  statusText,
} from '../domain/captureStateMachine';
import { findTask } from '../domain/taskCatalog';
import { HandPoseOverlay } from '../components/HandPoseOverlay';
import { CountdownOverlay } from '../components/CountdownOverlay';
import { HandStatusBadge } from '../components/HandStatusBadge';
import { colors, typography, spacing, radii } from '../theme';

// SPECS_JA §2.3 step 2-6: ジェスチャ検出 → start VLM gate → 録画 → end VLM gate → 結果。
// 旧 sandbox 04 CaptureView から salvage、VLM 呼出を Unit H mobile SDK に差し替え。

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

export const CaptureScreen: React.FC<Props> = ({ route, navigation }) => {
  const task = findTask(route.params.taskId);
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [state, dispatch] = useReducer(captureReducer, initialCaptureSub);
  const [hands, setHands] = useState<HandPoseEvent['hands']>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [vlmStartFeedback, setVlmStartFeedback] = useState<{ reason: string; score: number } | null>(null);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const recordingStartedRef = useRef(false);
  const recordingStartTsRef = useRef<number | null>(null);
  const prevHandsOkRef = useRef(true);
  const completedRef = useRef(false);

  // ---- Camera permission ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await Camera.getCameraPermissionsAsync();
        if (cancelled) return;
        if (existing.granted) {
          setPermission('granted');
          return;
        }
        const requested = await Camera.requestCameraPermissionsAsync();
        if (cancelled) return;
        setPermission(requested.granted ? 'granted' : 'denied');
      } catch {
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Frame ingest ----
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setPreviewSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  }, []);

  const onHandPose = useCallback((e: { nativeEvent: HandPoseEvent }) => {
    const ev = e.nativeEvent;
    setHands(ev.hands);
    const features = classifyHands(ev.hands);
    dispatch({
      kind: 'frame',
      ts: Date.now(),
      bothPalms: features.bothPalms,
      bothThumbsUp: features.bothThumbsUp,
      anyHandDetected: features.anyHandDetected,
    });
  }, []);

  // ---- Side effect 1: VLM start gate ----
  useEffect(() => {
    if (state.kind !== 'vlm_start_checking' || !task) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshotUri = await captureHandPoseSnapshot();
        const result = await evaluateTaskGate({
          imageUri: snapshotUri,
          taskName: task.name,
          conditionText: task.startCondition,
        });
        if (cancelled) return;
        if (result.match) setVlmStartFeedback(null);
        else setVlmStartFeedback({ reason: result.reason, score: result.score });
        dispatch({ kind: 'vlmStartResult', match: result.match, reason: result.reason });
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message;
        setVlmStartFeedback({ reason: `VLM error: ${msg}`, score: 0 });
        dispatch({ kind: 'vlmStartError', message: msg });
      }
    })();
    return () => { cancelled = true; };
  }, [state.kind, task]);

  // ---- Side effect 2: Start recording on countdown→recording ----
  useEffect(() => {
    if (state.kind !== 'recording' || recordingStartedRef.current) return;
    recordingStartedRef.current = true;
    recordingStartTsRef.current = Date.now();
    (async () => {
      try {
        const uri = await startHandPoseRecording();
        setVideoUri(uri);
      } catch (err) {
        console.warn('[CaptureScreen] startRecording failed', err);
      }
    })();
  }, [state.kind]);

  // ---- Side effect 3: Finalize → stop recording + end VLM → navigate ----
  useEffect(() => {
    if (state.kind !== 'finalizing' || !task || completedRef.current) return;
    completedRef.current = true;
    let cancelled = false;
    (async () => {
      let finalVideoUri: string | null = null;
      let vlmEnd: VlmGateResult | null = null;
      let vlmEndError: string | null = null;

      try {
        finalVideoUri = await stopHandPoseRecording();
      } catch (err) {
        finalVideoUri = videoUri;
        console.warn('[CaptureScreen] stopRecording failed', err);
      }

      try {
        const endSnapshot = await captureHandPoseSnapshot();
        vlmEnd = await evaluateTaskGate({
          imageUri: endSnapshot,
          taskName: task.name,
          conditionText: task.endCondition,
        });
      } catch (err) {
        vlmEndError = (err as Error).message;
      }

      if (cancelled || !finalVideoUri) return;
      const durationMs = recordingStartTsRef.current ? Date.now() - recordingStartTsRef.current : 0;
      navigation.replace('Review', {
        taskId: route.params.taskId,
        videoUri: finalVideoUri,
        vlmEnd,
        vlmEndError,
        durationMs,
      });
    })();
    return () => { cancelled = true; };
  }, [state.kind, task, videoUri, route.params.taskId, navigation]);

  // ---- Side effect 4: Vibrate when hands leave frame during recording ----
  useLayoutEffect(() => {
    const isRec = state.kind === 'recording' || state.kind === 'thumbs_up_holding';
    const currentHandsOk = isRec ? state.handsOk : true;
    if (prevHandsOkRef.current && !currentHandsOk) Vibration.vibrate(200);
    prevHandsOkRef.current = currentHandsOk;
  }, [state]);

  // ---- Cleanup: stop recording if user navigates away mid-record ----
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current && !completedRef.current) {
        stopHandPoseRecording().catch(() => {});
      }
    };
  }, []);

  if (!task) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.statusEyebrow}>NOT FOUND</Text>
        <Text style={styles.statusBody}>Task “{route.params.taskId}” not found.</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (permission === 'pending') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.statusEyebrow}>CAMERA</Text>
        <Text style={styles.statusBody}>Checking access…</Text>
      </SafeAreaView>
    );
  }
  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.statusEyebrow}>PERMISSION REQUIRED</Text>
        <Text style={styles.statusBody}>
          Allow camera access in iOS Settings, then return here.
        </Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnLabel}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const showOverlay = state.kind !== 'vlm_start_checking' && state.kind !== 'finalizing';
  const isRecording = state.kind === 'recording' || state.kind === 'thumbs_up_holding';
  const handsOkForBadge = isRecording ? state.handsOk : true;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.topBarMain}>
          <View style={styles.topBarHeader}>
            <Text style={styles.topBarTask}>{task.name}</Text>
            {isRecording ? (
              <View style={styles.recPill}>
                <View style={styles.recDot} />
                <Text style={styles.recLabel}>REC</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.topBarStatus} numberOfLines={2}>{statusText(state)}</Text>
          {vlmStartFeedback ? (
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackLabel}>
                START · {String(vlmStartFeedback.score).padStart(2, '0')}/100
              </Text>
              <Text style={styles.feedbackBody} numberOfLines={3}>{vlmStartFeedback.reason}</Text>
            </View>
          ) : null}
        </View>
        {isRecording ? <HandStatusBadge handsOk={handsOkForBadge} /> : null}
      </View>

      <View style={styles.previewContainer} onLayout={onLayout}>
        <HandPosePreviewView style={StyleSheet.absoluteFill} onHandPose={onHandPose} />
        {showOverlay ? (
          <HandPoseOverlay
            hands={hands}
            width={previewSize.width}
            height={previewSize.height}
            minConfidence={0.3}
          />
        ) : null}
        {state.kind === 'countdown' ? <CountdownOverlay startTs={state.startTs} /> : null}
        {state.kind === 'vlm_start_checking' || state.kind === 'finalizing' ? (
          <View style={styles.checkingOverlay}>
            <View style={styles.checkingCard}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.checkingLabel}>
                {state.kind === 'vlm_start_checking' ? 'Checking start condition' : 'Checking end condition'}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.bottomBar}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>← Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background,
  },
  statusEyebrow: { ...typography.label, color: colors.textSecondary, letterSpacing: 1.6 },
  statusBody: { ...typography.body, color: colors.textPrimary, textAlign: 'center', maxWidth: 320 },
  btn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
    backgroundColor: colors.accent, borderRadius: radii.md,
  },
  btnLabel: { color: colors.white, fontSize: 14, fontWeight: '600' },

  topBar: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  topBarMain: { flex: 1, gap: spacing.sm },
  topBarHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBarTask: { flex: 1, ...typography.title, color: colors.textPrimary },
  topBarStatus: { ...typography.caption, color: colors.textSecondary },

  recPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radii.full, backgroundColor: colors.accent,
  },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.recording },
  recLabel: { fontSize: 9, letterSpacing: 1.4, color: colors.white, fontWeight: '700' },

  feedbackCard: {
    marginTop: spacing.sm, padding: spacing.sm,
    borderRadius: radii.sm, backgroundColor: colors.errorLight,
    borderLeftWidth: 2, borderLeftColor: colors.error, gap: 2,
  },
  feedbackLabel: { ...typography.label, color: colors.error, letterSpacing: 1.4 },
  feedbackBody: { ...typography.caption, color: colors.textPrimary },

  previewContainer: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },

  checkingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.overlayMedium,
  },
  checkingCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radii.md,
  },
  checkingLabel: { ...typography.captionMedium, color: colors.textPrimary, letterSpacing: 1.2 },

  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  cancelText: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
});
