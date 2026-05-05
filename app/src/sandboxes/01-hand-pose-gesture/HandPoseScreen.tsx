import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Camera } from 'expo-camera';
import {
  HAND_LANDMARK_INDICES as J,
  HandPosePreviewView,
  type HandObservation,
  type HandPoseEvent,
} from '../../native/handPose';
import { HandPoseOverlay } from './HandPoseOverlay';
import { detectGesture, GestureStabilizer, type GestureLabel } from './gesture';

// Sandbox 01: Hand Pose + Gesture
//
// 検証目的:
//   - iOS Vision / Android MediaPipe HandLandmarker から 21 joint がリアルタイム取得できるか
//   - 両手フレーム外検出 → 警告 UI が機能するか
//   - thumbs-up / open-palm を区別できるか (チャタリング防止込み)
//   - hand pose data を JSON で取り出せるか
//
// 統合実装フェーズへの移植時の注意:
//   - 本 screen のカメラは hand-pose module 専用 session。統合時は sensor-session と
//     カメラパイプライン共有 (AVCaptureMultiCam / shared SurfaceProvider) に切り替え
//   - SVG overlay は Skia への置換可能。30fps で 21*2 joint = 42 Circle + 21 Line では
//     react-native-svg でも十分

const GESTURE_LABEL_JA: Record<GestureLabel, string> = {
  thumbs_up: '👍 サムズアップ',
  open_palm: '✋ パー',
};

export default function HandPoseScreen() {
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [hands, setHands] = useState<HandObservation[]>([]);
  const [frameMeta, setFrameMeta] = useState<{ width: number; height: number; ts: string }>({
    width: 0,
    height: 0,
    ts: '0',
  });
  const [stableGesture, setStableGesture] = useState<GestureLabel | null>(null);
  const [fps, setFps] = useState(0);
  const [paused, setPaused] = useState(false);

  // FPS 計測 (frame 間隔の指数移動平均)
  const lastFrameTsRef = useRef<number>(0);
  const fpsEmaRef = useRef<number>(0);
  // 1 つだけ stabilizer を持つ (両手の場合 score 高い方の gesture を採用)
  const stabilizerRef = useRef(new GestureStabilizer(5));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await Camera.requestCameraPermissionsAsync();
      if (cancelled) return;
      setPermission(result.granted ? 'granted' : 'denied');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewSize({ width, height });
  }, []);

  const onHandPose = useCallback((e: { nativeEvent: HandPoseEvent }) => {
    const ev = e.nativeEvent;
    setHands(ev.hands);
    setFrameMeta({ width: ev.image_width, height: ev.image_height, ts: ev.timestamp_ns });

    // FPS 更新 (wall-clock)
    const now = Date.now();
    const last = lastFrameTsRef.current;
    if (last > 0) {
      const dtMs = now - last;
      if (dtMs > 0) {
        const instant = 1000 / dtMs;
        fpsEmaRef.current = fpsEmaRef.current * 0.8 + instant * 0.2;
        setFps(fpsEmaRef.current);
      }
    }
    lastFrameTsRef.current = now;

    // Gesture 判定 (score 高い方の手)
    const primary = pickPrimaryHand(ev.hands);
    const raw = primary ? detectGesture(primary) : null;
    const stable = stabilizerRef.current.push(raw);
    setStableGesture(stable);
  }, []);

  // フレーム外警告: 両手いずれかの主要 joint (wrist + 中指 MCP) が画像外にあるか低 confidence
  const frameOutWarning = useMemo(() => computeFrameOutWarning(hands), [hands]);

  const handleCopyJSON = useCallback(async () => {
    const snapshot = {
      timestamp_ns: frameMeta.ts,
      image_width: frameMeta.width,
      image_height: frameMeta.height,
      hands,
    };
    await Clipboard.setStringAsync(JSON.stringify(snapshot, null, 2));
    Alert.alert('コピーしました', `${hands.length} 手分の landmark JSON をクリップボードにコピー`);
  }, [hands, frameMeta]);

  if (permission === 'pending') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.text}>カメラ権限を確認中…</Text>
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          カメラ権限がありません。{Platform.OS === 'ios' ? '設定' : 'Settings'} アプリで有効にしてください。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.previewContainer} onLayout={onLayout}>
        <HandPosePreviewView
          style={StyleSheet.absoluteFill}
          paused={paused}
          onHandPose={onHandPose}
        />
        <HandPoseOverlay
          hands={hands}
          width={previewSize.width}
          height={previewSize.height}
          minConfidence={0.3}
        />
        {frameOutWarning ? (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>{frameOutWarning}</Text>
          </View>
        ) : null}
        {stableGesture ? (
          <View style={styles.gestureBadge}>
            <Text style={styles.gestureText}>{GESTURE_LABEL_JA[stableGesture]}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.statRow}>
          <Stat label="FPS" value={fps > 0 ? fps.toFixed(1) : '—'} />
          <Stat label="手の数" value={String(hands.length)} />
          <Stat
            label="frame"
            value={frameMeta.width > 0 ? `${frameMeta.width}×${frameMeta.height}` : '—'}
          />
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, paused && styles.buttonActive]}
            onPress={() => setPaused((p) => !p)}
          >
            <Text style={styles.buttonText}>{paused ? '再開' : '一時停止'}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={handleCopyJSON}>
            <Text style={styles.buttonText}>JSON コピー</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function pickPrimaryHand(hands: HandObservation[]): HandObservation | null {
  if (hands.length === 0) return null;
  return hands.reduce((best, cur) => (cur.score > best.score ? cur : best), hands[0]);
}

/**
 * 両手撮影の品質ガイド: フレーム外に出ている手の警告メッセージを返す。
 *   - 0 手 → 「両手をフレームに入れてください」
 *   - 1 手 → 「もう片方の手もフレームに入れてください」
 *   - 任意の手で wrist or 中指 MCP が画像範囲端に近い → 「手がフレーム端に近づいています」
 */
function computeFrameOutWarning(hands: HandObservation[]): string | null {
  if (hands.length === 0) return '両手をフレームに入れてください';
  if (hands.length === 1) return 'もう片方の手もフレームに入れてください';
  const margin = 0.02;
  for (const h of hands) {
    const wrist = h.landmarks[J.WRIST];
    const middleMcp = h.landmarks[J.MIDDLE_MCP];
    for (const lm of [wrist, middleMcp]) {
      if (!lm) continue;
      if (lm.x < margin || lm.x > 1 - margin || lm.y < margin || lm.y > 1 - margin) {
        return '手がフレーム端に近づいています';
      }
    }
  }
  return null;
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', padding: 24 },
  text: { color: '#fff', fontSize: 14, marginTop: 12, textAlign: 'center' },
  previewContainer: { flex: 1, position: 'relative', overflow: 'hidden' },
  warningBanner: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(220, 38, 38, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  warningText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  gestureBadge: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  gestureText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: 'rgba(34, 197, 94, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24,
    overflow: 'hidden',
  },
  bottomBar: { backgroundColor: '#111', padding: 12, gap: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statLabel: { color: '#888', fontSize: 11 },
  statValue: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 2 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  buttonActive: { backgroundColor: '#dc2626' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
