import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Animated,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { signContent, type C2paAssertion } from '../native/c2paBridge';
import { saveToGallery } from '../utils/saveMedia';
import { colors, spacing } from '../theme';
import { t } from '../i18n';
import { SensorPreviewView } from '../components/SensorPreviewView';
import {
  buildAssertionsFromResults,
  findCapturedPhotoPath,
  getDefaultSensorSession,
  makeStaticPhotoWindow,
  startVideoStream,
  stopVideoStream,
} from '../sensors/captureFlow';
import type { StreamHandle } from '../sensors/types';
import { nativeSwitchCamera } from '../native/sensorSession';

// v0.1.1: Plan C 撮影スタック (AVCaptureSession / Camera2 を独自に駆動)。
// 旧 expo-camera の CameraView は撤去。flash/timer/zoom/grid/mirror 等の UX は
// Task 05 で SensorSession の Camera ISensor のプロパティとして再実装する。

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CameraScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const [capturing, setCapturing] = useState(false);
  const [signingCount, setSigningCount] = useState(0);
  const [lastAssetUri, setLastAssetUri] = useState<string | null>(null);
  const shutterScale = useRef(new Animated.Value(1)).current;

  // 動画モード (Task 03)
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [recording, setRecording] = useState(false);
  const [recordDurationMs, setRecordDurationMs] = useState(0);
  const streamHandleRef = useRef<StreamHandle | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // カメラ切替 (Task 05)
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [switching, setSwitching] = useState(false);
  const toggleFacing = useCallback(async () => {
    if (recording || switching) return;
    const next = facing === 'back' ? 'front' : 'back';
    setSwitching(true);
    try {
      await nativeSwitchCamera(next);
      setFacing(next);
    } catch (e) {
      console.warn('[CameraScreen] switchCamera error:', e);
    } finally {
      setSwitching(false);
    }
  }, [facing, recording, switching]);

  // SensorSession を起動時に lazy 初期化
  useEffect(() => {
    getDefaultSensorSession().catch((e) =>
      console.warn('[CameraScreen] sensor session init error:', e)
    );
  }, []);

  const fetchLastAsset = useCallback(async () => {
    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: 1,
        sortBy: [MediaLibrary.SortBy.modificationTime],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });
      setLastAssetUri(result.assets[0]?.uri ?? null);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchLastAsset(); }, [fetchLastAsset]));

  const allPermissionsGranted = cameraPermission?.granted && mediaPermission?.granted;

  const requestAllPermissions = useCallback(async () => {
    await requestCameraPermission();
    await requestMediaPermission();
  }, [requestCameraPermission, requestMediaPermission]);

  // 動画録画開始 / 停止 (Task 03)
  const startRecording = useCallback(async () => {
    if (recording) return;
    try {
      const handle = await startVideoStream({ lookbackMs: 1000 });
      streamHandleRef.current = handle;
      setRecording(true);
      setRecordDurationMs(0);
      const t0 = Date.now();
      recordTimerRef.current = setInterval(() => {
        setRecordDurationMs(Date.now() - t0);
      }, 100);
    } catch (e) {
      console.warn('[CameraScreen] startRecording error:', e);
      Alert.alert(t('camera.signErrorTitle'), String(e));
    }
  }, [recording]);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    const handle = streamHandleRef.current;
    if (!handle) return;
    streamHandleRef.current = null;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecording(false);
    setSigningCount((c) => c + 1);
    try {
      const { videoPath, assertions } = await stopVideoStream(handle);
      const signedPath = await signContent(videoPath, assertions);
      const signedUri = signedPath.startsWith('file://') ? signedPath : `file://${signedPath}`;
      await saveToGallery(signedUri);
      fetchLastAsset();
    } catch (e) {
      console.warn('[CameraScreen] stopRecording+sign error:', e);
      Alert.alert(t('camera.signErrorTitle'), t('camera.signError'));
    } finally {
      setSigningCount((c) => c - 1);
      setRecordDurationMs(0);
    }
  }, [recording, fetchLastAsset]);

  // 撮影 + 署名フロー (静止画)
  const captureAndSign = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setSigningCount((c) => c + 1);

    Animated.sequence([
      Animated.timing(shutterScale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(shutterScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    try {
      const session = await getDefaultSensorSession();
      const window = makeStaticPhotoWindow(1000); // ±1秒の IMU lookback
      const sessionResult = await session.capture(window);

      const photoPath = findCapturedPhotoPath(sessionResult.results);
      if (!photoPath) {
        const cameraResult = sessionResult.results.find((r) => r.api_path.includes('camera'));
        const reason =
          cameraResult?.unavailable_reason ??
          (cameraResult ? 'camera result has no output_path' : 'no camera result');
        throw new Error(`camera capture failed: ${reason}`);
      }

      const assertions: C2paAssertion[] = buildAssertionsFromResults(sessionResult.results, {
        startNs: window.startNs,
        durationMs: window.durationMs,
        lookbackMs: window.lookbackMs ?? 0,
      });

      const signedPath = await signContent(photoPath, assertions);
      const signedUri = signedPath.startsWith('file://') ? signedPath : `file://${signedPath}`;
      await saveToGallery(signedUri);
      fetchLastAsset();
    } catch (e) {
      console.warn('[CameraScreen] capture+sign error:', e);
      Alert.alert(t('camera.signErrorTitle'), t('camera.signError'));
    } finally {
      setSigningCount((c) => c - 1);
      setCapturing(false);
    }
  }, [capturing, fetchLastAsset, shutterScale]);

  if (!cameraPermission || !mediaPermission) {
    return <View style={styles.container} />;
  }

  if (!allPermissionsGranted) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <TouchableOpacity
            style={styles.closeButtonTop}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="close" size={28} color={colors.darkText} />
          </TouchableOpacity>
          <View style={styles.permissionContainer}>
            <Ionicons name="camera-outline" size={64} color={colors.textSecondary} />
            <Text style={styles.permissionText}>{t('camera.permissionMessage')}</Text>
            <TouchableOpacity style={styles.permissionButton} onPress={requestAllPermissions}>
              <Text style={styles.permissionButtonText}>{t('camera.permissionButton')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* トップバー */}
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.topButton} onPress={() => navigation.goBack()} disabled={recording}>
          <Ionicons name="close" size={28} color={recording ? colors.darkTextSecondary : colors.darkText} />
        </TouchableOpacity>

        {recording ? (
          <View style={styles.recIndicator}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>
              {(() => {
                const totalSec = Math.floor(recordDurationMs / 1000);
                const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
                const s = (totalSec % 60).toString().padStart(2, '0');
                return `${m}:${s}`;
              })()}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <TouchableOpacity
          style={styles.topButton}
          onPress={toggleFacing}
          disabled={recording || switching}
        >
          <Ionicons
            name="camera-reverse-outline"
            size={26}
            color={(recording || switching) ? colors.darkTextSecondary : colors.darkText}
          />
        </TouchableOpacity>
      </View>

      {/* カメラプレビュー (Plan C ネイティブビュー) */}
      <View style={styles.cameraContainer}>
        <SensorPreviewView style={styles.camera} />

        {/* 署名インジケーター */}
        {signingCount > 0 && (
          <View style={styles.signingIndicator}>
            <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
            <Text style={styles.signingText}>
              {t('camera.signing')} ({signingCount})
            </Text>
          </View>
        )}
      </View>

      {/* ボトム */}
      <View style={[styles.bottomArea, { paddingBottom: insets.bottom + 12 }]}>
        {/* モード切替 (録画中は無効) */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'photo' && styles.modeButtonActive]}
            onPress={() => !recording && setMode('photo')}
            disabled={recording}
          >
            <Text style={[styles.modeText, mode === 'photo' && styles.modeTextActive]}>
              {t('camera.photo')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'video' && styles.modeButtonActive]}
            onPress={() => !recording && setMode('video')}
            disabled={recording}
          >
            <Text style={[styles.modeText, mode === 'video' && styles.modeTextActive]}>
              {t('camera.video')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.shutterRow}>
          <TouchableOpacity
            style={styles.galleryThumb}
            onPress={() => navigation.navigate('CameraGallery')}
            disabled={recording}
          >
            {lastAssetUri ? (
              <Image source={{ uri: lastAssetUri }} style={styles.galleryThumbImage} />
            ) : (
              <View style={styles.galleryThumbEmpty}>
                <Ionicons name="images-outline" size={20} color={colors.darkTextSecondary} />
              </View>
            )}
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: shutterScale }] }}>
            <TouchableOpacity
              style={[
                styles.shutterOuter,
                capturing && styles.shutterDisabled,
                recording && styles.shutterRecording,
              ]}
              onPress={() => {
                if (mode === 'photo') captureAndSign();
                else if (recording) stopRecording();
                else startRecording();
              }}
              activeOpacity={0.7}
              disabled={capturing && !recording}
            >
              <View
                style={[
                  styles.shutterInner,
                  mode === 'video' && !recording && styles.shutterInnerVideo,
                  recording && styles.shutterInnerStop,
                ]}
              />
            </TouchableOpacity>
          </Animated.View>

          <View style={styles.galleryThumb} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  safeArea: { flex: 1 },
  cameraContainer: { flex: 1, overflow: 'hidden' },
  camera: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeButtonTop: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  bottomArea: {
    backgroundColor: colors.darkBg,
    paddingTop: spacing.md,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.darkText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.darkText,
  },
  shutterInnerVideo: { backgroundColor: colors.recording },
  shutterInnerStop: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.recording,
  },
  shutterRecording: { borderColor: colors.recording },
  shutterDisabled: { opacity: 0.5 },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 16,
  },
  modeButtonActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  modeText: { color: colors.darkTextSecondary, fontSize: 13, fontWeight: '500' },
  modeTextActive: { color: colors.darkText, fontWeight: '600' },
  recIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    gap: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.recording,
  },
  recText: { color: colors.darkText, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  galleryThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.overlayWhiteFaint,
  },
  galleryThumbImage: { width: '100%', height: '100%' },
  galleryThumbEmpty: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  signingIndicator: {
    position: 'absolute',
    top: spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    gap: 6,
  },
  signingText: { color: colors.darkText, fontSize: 12, fontWeight: '500' },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  permissionText: { color: colors.darkText, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  permissionButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 24,
    marginTop: spacing.md,
  },
  permissionButtonText: { color: colors.darkText, fontWeight: '600', fontSize: 14 },
});
