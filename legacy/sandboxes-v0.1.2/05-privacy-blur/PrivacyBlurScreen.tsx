import { ResizeMode, Video } from 'expo-av';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  HandPosePreviewView,
  startHandPoseRecording,
  stopHandPoseRecording,
} from '../../native/handPose';
import {
  isPrivacyBlurAvailable,
  processPrivacyBlur,
  type PrivacyBlurResult,
} from '../../units/privacy-blur';

// Sandbox 05 — Unit C (privacy blur) 単体検証スクリーン。
//
// **完全自己完結** — 他のサンドボックスや外部録画に依存しない。このスクリーン内で
// 録画して、その mp4 を Unit C に通す。
//
// Phase:
//   idle      → preview + Record ボタン
//   recording → preview + Stop ボタン (timer 表示)
//   processing → 録画 mp4 を blur 中、progress bar
//   done      → blur 後 mp4 のプレイヤー + stats + Record again

const COLORS = {
  bg: '#fafaf7',
  surface: '#ffffff',
  ink: '#0a1f44',
  inkSoft: '#13284e',
  body: '#1a2940',
  mute: '#5a6b7c',
  faint: '#8a96a3',
  border: '#e5e1d8',
  ok: '#1a7c47',
  err: '#a94e3c',
  recDot: '#a94e3c',
};
const FONTS = {
  display: 'Fraunces_500Medium',
  light: 'Fraunces_300Light',
  mono: 'Menlo',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'processing'; videoUri: string; pct: number; framesDone: number; totalFrames: number }
  | { kind: 'done'; videoUri: string; result: PrivacyBlurResult }
  | { kind: 'error'; message: string };

export default function PrivacyBlurScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const available = isPrivacyBlurAvailable();

  // ---- recording timer ----
  useEffect(() => {
    if (phase.kind === 'recording') {
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - phase.startedAt);
      }, 100);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setElapsedMs(0);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase]);

  const handleStartRecord = useCallback(async () => {
    try {
      await startHandPoseRecording();
      setPhase({ kind: 'recording', startedAt: Date.now() });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleStopAndBlur = useCallback(async () => {
    if (phase.kind !== 'recording') return;
    let videoUri: string;
    try {
      videoUri = await stopHandPoseRecording();
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setPhase({ kind: 'processing', videoUri, pct: 0, framesDone: 0, totalFrames: 0 });
    try {
      const result = await processPrivacyBlur(
        {
          inputUri: videoUri,
          ocrSampleStride: 3,
          textModel: 'fast',
          blurRadius: 32,
          detectionScale: 0.66,
        },
        (p) => {
          setPhase((cur) =>
            cur.kind === 'processing'
              ? { ...cur, pct: p.progress, framesDone: p.framesDone, totalFrames: p.totalFrames }
              : cur,
          );
        },
      );
      setPhase({ kind: 'done', videoUri, result });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [phase]);

  const reset = useCallback(() => setPhase({ kind: 'idle' }), []);

  // ---- render ----
  const showPreview = phase.kind === 'idle' || phase.kind === 'recording';

  return (
    <View style={styles.root}>
      {showPreview ? (
        <View style={styles.previewWrap}>
          <HandPosePreviewView style={styles.preview} />
          {phase.kind === 'recording' ? (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>REC {formatTime(elapsedMs)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.eyebrow}>UNIT C · PRIVACY BLUR (FACE-ONLY)</Text>
        <Text style={styles.head}>Record &{`\n`}face-blur on-device.</Text>
        <Text style={styles.lede}>
          Record a clip; on-device Vision face detector finds every face frame-by-frame and
          Gaussian-blurs them. Text blur is intentionally excluded — Vision OCR is a
          recognizer, not a stable detector for arbitrary scenes (PC screens etc.).
          Text-region detector (DBNet CoreML) is a follow-up unit.
        </Text>

        {!available ? (
          <Banner kind="err" label="MODULE UNAVAILABLE" body="iOS only. Run npx expo run:ios to rebuild." />
        ) : null}

        {phase.kind === 'idle' ? (
          <Pressable
            style={({ pressed }) => [styles.cta, !available && styles.ctaDisabled, pressed && available && styles.ctaPressed]}
            onPress={handleStartRecord}
            disabled={!available}
          >
            <Text style={styles.ctaLabel}>● Start recording</Text>
          </Pressable>
        ) : null}

        {phase.kind === 'recording' ? (
          <Pressable
            style={({ pressed }) => [styles.cta, styles.ctaStop, pressed && styles.ctaStopPressed]}
            onPress={handleStopAndBlur}
          >
            <Text style={styles.ctaLabel}>■ Stop & blur</Text>
          </Pressable>
        ) : null}

        {phase.kind === 'processing' ? (
          <View style={{ gap: 6 }}>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.round(phase.pct * 100)}%` }]} />
            </View>
            <View style={styles.progressRow}>
              <ActivityIndicator color={COLORS.ink} />
              <Text style={styles.progressText}>
                Blur {Math.round(phase.pct * 100)}% · {phase.framesDone}/{phase.totalFrames} frames
              </Text>
            </View>
          </View>
        ) : null}

        {phase.kind === 'error' ? <Banner kind="err" label="ERROR" body={phase.message} /> : null}

        {phase.kind === 'done' ? (
          <>
            <Section title="BLURRED OUTPUT">
              <Video
                style={styles.player}
                source={{ uri: phase.result.outputUri }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
              />
              <View style={styles.kvList}>
                <Kv label="Frames" value={phase.result.framesProcessed.toString()} />
                <Kv label="Wall time" value={`${(phase.result.durationMs / 1000).toFixed(2)}s`} />
                <Kv
                  label="Throughput"
                  value={
                    phase.result.framesProcessed > 0 && phase.result.durationMs > 0
                      ? `${((phase.result.framesProcessed / phase.result.durationMs) * 1000).toFixed(1)} fps`
                      : '—'
                  }
                />
                <Kv label="Faces (cumulative)" value={phase.result.facesBlurred.toString()} />
                <Kv
                  label="Output size"
                  value={`${phase.result.outputWidth}×${phase.result.outputHeight}`}
                />
                <Kv label="Output bytes" value={formatBytes(phase.result.outputBytes)} />
                <Kv label="Output URI" value={phase.result.outputUri.replace(/^file:\/\//, '')} mono />
              </View>
            </Section>
            <Section title="ORIGINAL (PRE-BLUR)">
              <Video
                style={styles.player}
                source={{ uri: phase.videoUri }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
              />
            </Section>
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              onPress={reset}
            >
              <Text style={styles.ctaLabel}>Record again</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---- helpers ----

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Kv: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <View style={styles.kvRow}>
    <Text style={styles.kvLabel}>{label}</Text>
    <Text
      style={[styles.kvValue, mono && { fontFamily: FONTS.mono, fontSize: 11 }]}
      numberOfLines={2}
    >
      {value}
    </Text>
  </View>
);

const Banner: React.FC<{ kind: 'err'; label: string; body: string }> = ({ kind, label, body }) => (
  <View style={[styles.banner, styles.bannerErr]}>
    <Text style={styles.bannerLabel}>{label}</Text>
    <Text style={styles.bannerBody}>{body}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  previewWrap: {
    height: 360,
    backgroundColor: '#000',
  },
  preview: { flex: 1 },
  recBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.recDot },
  recText: {
    color: '#fff',
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 0.6,
    fontWeight: '700',
  },

  body: { flex: 1 },
  bodyContent: { padding: 24, paddingBottom: 64, gap: 20 },

  eyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: COLORS.mute,
    fontWeight: '700',
  },
  head: {
    fontFamily: FONTS.light,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: COLORS.ink,
    marginTop: 4,
  },
  lede: { fontSize: 14, lineHeight: 20, color: COLORS.mute },

  cta: {
    backgroundColor: COLORS.ink,
    paddingVertical: 16,
    borderRadius: 4,
    alignItems: 'center',
  },
  ctaPressed: { backgroundColor: COLORS.inkSoft },
  ctaDisabled: { backgroundColor: COLORS.border },
  ctaStop: { backgroundColor: COLORS.recDot },
  ctaStopPressed: { backgroundColor: '#882f1f' },
  ctaLabel: {
    color: '#fafaf7',
    fontFamily: FONTS.display,
    fontSize: 15,
    letterSpacing: 0.2,
  },

  section: { gap: 12 },
  sectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    color: COLORS.mute,
    fontWeight: '700',
  },

  player: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: '#000',
    borderRadius: 4,
  },

  progressBarTrack: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: { height: 4, backgroundColor: COLORS.ink },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressText: { fontFamily: FONTS.mono, fontSize: 11, color: COLORS.mute },

  banner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 2,
    borderRadius: 4,
    gap: 4,
    backgroundColor: '#f4e4df',
    borderLeftColor: COLORS.err,
  },
  bannerErr: {},
  bannerLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '700',
    color: COLORS.err,
  },
  bannerBody: { fontSize: 12, lineHeight: 18, color: COLORS.body },

  kvList: { gap: 6 },
  kvRow: { flexDirection: 'row', gap: 12, alignItems: 'baseline' },
  kvLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.mute,
    width: 132,
    fontWeight: '600',
  },
  kvValue: { flex: 1, fontSize: 13, color: COLORS.ink },
});
