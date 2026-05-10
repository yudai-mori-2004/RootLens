import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import {
  HandPosePreviewView,
  captureHandPoseSnapshot,
  startHandPoseRecording,
  stopHandPoseRecording,
  type HandPoseEvent,
} from '../../../native/handPose';
import { HandPoseOverlay } from '../../01-hand-pose-gesture/HandPoseOverlay';
import {
  evaluateTaskGate,
  DEFAULT_VLM_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  type VlmResult,
  type VlmProvider,
} from '../../02-vlm-task-gate/vlmClient';
import {
  captureReducer,
  classifyHands,
  initialCaptureSub,
  statusText,
} from '../stateMachine';
import { CountdownOverlay } from './CountdownOverlay';
import { HandStatusBadge } from './HandStatusBadge';
import type { TaskDef } from '../tasks';
import { colors, fonts, hairline, radius, space, type } from '../theme';

// Sandbox 04 capture view: state machine + frame stream + native recording / snapshot.
//
// Asset hooks (optional, place later):
//   assets/sandbox-04/sounds/warning.mp3 — warning sound when hands leave frame.
//   Currently uses Vibration only. To add audio, load via expo-av Audio.Sound.createAsync(require('...')).

const DEFAULT_PROVIDER: VlmProvider = DEFAULT_VLM_PROVIDER;
const DEFAULT_VLM_MODEL = DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER];
const API_KEY_BY_PROVIDER: Record<VlmProvider, string> = {
  gemini: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  claude: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '',
  openai: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
};

interface Props {
  task: TaskDef;
  onComplete: (result: {
    videoUri: string | null;
    endSnapshotUri: string | null;
    durationMs: number;
    vlmEnd: VlmResult | null;
    vlmEndError: string | null;
  }) => void;
  onCancel: () => void;
}

export const CaptureView: React.FC<Props> = ({ task, onComplete, onCancel }) => {
  const [state, dispatch] = useReducer(captureReducer, initialCaptureSub);
  const [hands, setHands] = useState<HandPoseEvent['hands']>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const recordingStartedRef = useRef(false);
  const recordingStartTsRef = useRef<number | null>(null);

  const prevHandsOkRef = useRef(true);

  // Persistent VLM-NG feedback. Independent of state machine's transient `feedback` field.
  // Cleared only when VLM passes (transition into countdown).
  const [vlmStartFeedback, setVlmStartFeedback] = useState<{ reason: string; score: number } | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewSize({ width, height });
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

  // VLM start check
  useEffect(() => {
    if (state.kind !== 'vlm_start_checking') return;
    let cancelled = false;
    (async () => {
      try {
        const snapshotUri = await captureHandPoseSnapshot();
        const result = await evaluateTaskGate({
          provider: DEFAULT_PROVIDER,
          apiKey: API_KEY_BY_PROVIDER[DEFAULT_PROVIDER],
          model: DEFAULT_VLM_MODEL,
          imageUri: snapshotUri,
          taskName: task.name,
          conditionText: task.startCondition,
        });
        if (cancelled) return;
        if (result.match) {
          setVlmStartFeedback(null);
        } else {
          setVlmStartFeedback({ reason: result.reason, score: result.score });
        }
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

  // Start recording on countdown → recording transition (once)
  useEffect(() => {
    if (state.kind === 'recording' && !recordingStartedRef.current) {
      recordingStartedRef.current = true;
      recordingStartTsRef.current = Date.now();
      (async () => {
        try {
          const uri = await startHandPoseRecording();
          setVideoUri(uri);
        } catch (err) {
          console.warn('[sandbox 04] startRecording failed', err);
        }
      })();
    }
  }, [state.kind]);

  // Finalizing: stop recording + end-VLM check, then onComplete
  useEffect(() => {
    if (state.kind !== 'finalizing') return;
    let cancelled = false;
    (async () => {
      let finalVideoUri: string | null = null;
      let vlmEnd: VlmResult | null = null;
      let vlmEndError: string | null = null;

      try {
        finalVideoUri = await stopHandPoseRecording();
      } catch (err) {
        finalVideoUri = videoUri;
        console.warn('[sandbox 04] stopRecording failed', err);
      }

      let endSnapshotUri: string | null = null;
      try {
        endSnapshotUri = await captureHandPoseSnapshot();
        vlmEnd = await evaluateTaskGate({
          provider: DEFAULT_PROVIDER,
          apiKey: API_KEY_BY_PROVIDER[DEFAULT_PROVIDER],
          model: DEFAULT_VLM_MODEL,
          imageUri: endSnapshotUri,
          taskName: task.name,
          conditionText: task.endCondition,
        });
      } catch (err) {
        vlmEndError = (err as Error).message;
      }

      if (cancelled) return;
      const durationMs = recordingStartTsRef.current
        ? Date.now() - recordingStartTsRef.current
        : 0;
      onComplete({ videoUri: finalVideoUri, endSnapshotUri, durationMs, vlmEnd, vlmEndError });
    })();
    return () => { cancelled = true; };
  }, [state.kind, task, videoUri, onComplete]);

  // Vibrate when hands leave frame during recording
  useLayoutEffect(() => {
    const isRec = state.kind === 'recording' || state.kind === 'thumbs_up_holding';
    const currentHandsOk = isRec ? state.handsOk : true;
    if (prevHandsOkRef.current && !currentHandsOk) {
      Vibration.vibrate(200);
    }
    prevHandsOkRef.current = currentHandsOk;
  }, [state]);

  // Cleanup: stop recording if user navigates away
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current) {
        stopHandPoseRecording().catch(() => { /* ignore */ });
      }
    };
  }, []);

  const showOverlay = state.kind !== 'vlm_start_checking' && state.kind !== 'finalizing';
  const isRecording = state.kind === 'recording' || state.kind === 'thumbs_up_holding';
  const handsOkForBadge = isRecording ? state.handsOk : true;

  return (
    <View style={styles.root}>
      {/* Top status bar (white surface) */}
      <View style={styles.topBar}>
        <View style={styles.topBarMain}>
          <View style={styles.topBarHeader}>
            <Text style={styles.topBarTask}>{task.name}</Text>
            {isRecording ? <RecPill /> : null}
          </View>
          <Text style={styles.topBarStatus} numberOfLines={2}>
            {statusText(state)}
          </Text>
          {vlmStartFeedback ? (
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackLabel}>
                START · {String(vlmStartFeedback.score).padStart(2, '0')}/100
              </Text>
              <Text style={styles.feedbackBody} numberOfLines={3}>{vlmStartFeedback.reason}</Text>
            </View>
          ) : null}
        </View>
        {isRecording ? (
          <View style={styles.topBarTrail}>
            <HandStatusBadge handsOk={handsOkForBadge} />
          </View>
        ) : null}
      </View>

      {/* Camera area */}
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
          <CheckingOverlay
            label={state.kind === 'vlm_start_checking' ? 'Checking start condition' : 'Checking end condition'}
          />
        ) : null}
      </View>

      {/* Bottom bar (white surface) */}
      <View style={styles.bottomBar}>
        <Pressable style={styles.cancelLink} onPress={onCancel} hitSlop={12}>
          <Text style={styles.cancelText}>← Cancel</Text>
        </Pressable>
        <RecordingTip />
      </View>
    </View>
  );
};

const TIPS = [
  'Keep both hands in frame at all times.',
  'Move at a natural pace — don’t rush.',
  'Avoid harsh backlighting from windows behind you.',
  'Show the surface clearly before reaching in.',
  'Both hands working together makes the best clip.',
  'If you drop something, pick it up calmly.',
  'No narration needed — ambient sound is fine.',
  'Stand at a comfortable working distance.',
  'Soft daylight beats overhead spotlights.',
];

const RecordingTip: React.FC = () => {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(id);
  }, []);
  return <Text style={styles.tipText} numberOfLines={1}>{TIPS[idx]}</Text>;
};

const RecPill: React.FC = () => (
  <View style={styles.recPill}>
    <View style={styles.recDot} />
    <Text style={styles.recLabel}>REC</Text>
  </View>
);

const CheckingOverlay: React.FC<{ label: string }> = ({ label }) => (
  <View style={styles.checkingOverlay}>
    <View style={styles.checkingCard}>
      <ActivityIndicator color={colors.bgInk} />
      <Text style={styles.checkingLabel}>{label}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgWarm },

  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.m,
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: space.m,
    backgroundColor: colors.bgWhite,
    ...hairline('bottom'),
  },
  topBarMain: { flex: 1, gap: space.s },
  topBarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  topBarTask: {
    flex: 1,
    fontFamily: fonts.displayMedium,
    fontSize: 17,
    color: colors.textInk,
    letterSpacing: -0.2,
  },
  topBarStatus: {
    ...type.bodyS,
    color: colors.textMute,
  },
  topBarTrail: {
    paddingTop: 2,
  },

  feedbackCard: {
    marginTop: space.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.s,
    backgroundColor: colors.statusErrorSoft,
    borderLeftWidth: 2,
    borderLeftColor: colors.statusError,
    gap: 2,
  },
  feedbackLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.statusError,
    fontWeight: '600',
  },
  feedbackBody: {
    ...type.bodyS,
    color: colors.textBody,
  },
  feedbackMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.0,
    color: colors.textFaint,
    marginTop: 2,
  },

  previewContainer: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#000' },

  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.s,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bgInk,
  },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.recDot },
  recLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.textOnInk,
    fontWeight: '700',
  },

  checkingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 31, 68, 0.42)',
  },
  checkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.xl,
    paddingVertical: space.m,
    backgroundColor: colors.bgScrim,
    borderRadius: radius.s,
  },
  checkingLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textInk,
    textTransform: 'uppercase',
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: Platform.OS === 'ios' ? space.xl : space.m,
    backgroundColor: colors.bgWhite,
    ...hairline('top'),
  },
  cancelLink: { paddingVertical: space.xs },
  cancelText: { ...type.body, color: colors.textInk, fontWeight: '500' },
  tipText: {
    flex: 1,
    marginLeft: space.l,
    textAlign: 'right',
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMute,
    fontStyle: 'italic',
  },
});
