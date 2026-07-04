// 撮影画面 (= v0.1.4、 DATA_SPECS §2)。
//
// 「録画開始 → 停止 → 自動的に署名 + アップロード」 の最小フロー。
// 旧 CalibrationCaptureScreen のキャリブレーション ceremony / TTS 音声ガイド / palm gesture 検出 /
// 方向ガイダンス / 連続タスク撮影誘導は v0.1.4 で全部撤去した (= ボタン操作に一本化)。
//
// 状態機械 (画面ローカル):
//   ready → countdown (3..1) → recording → confirm_stop (録画は継続) → finalizing → ready
//
// 録画停止後の送信 (署名 → R2 → 登録) は dataflow の advanceClip が背景で進める。
// この画面は useCurrentClip() で進捗チップを出すだけ (= 撮影ループを止めない)。

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import { Camera } from 'expo-camera';
import * as Device from 'expo-device';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../app/types';
import { WideCapturePreviewView } from '../native/wideCapture';
import { ArkitCapturePreviewView } from '../native/arkitCapture';
import {
  DEFAULT_RECORDING_CONFIG,
  RECORDING_CONFIGS,
  getRecordingConfig,
  enqueueRecording,
  advanceClip,
  storeEventSink,
  teeToConsole,
  type RecordingConfig,
} from '../dataflow';
import { useCurrentClip } from '../clips/hooks';
import { playSfx, preloadCaptureSounds, unloadCaptureSounds } from '../services/captureSounds';
import { useT } from '../i18n';
import { colors, fonts, typography } from '../theme';

// dataflow の進捗を Metro ログにもミラーする sink。
const sink = teeToConsole(storeEventSink, 'capture');

// 構成切替時にカメラが解放されるのを待つ猶予 (= AVCaptureSession を stop してから
// 次の session を start するまで。 カメラは排他リソースなので即貼り直すとクラッシュする)。
const CAMERA_RELEASE_DELAY_MS = 450;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 録画前カウントダウン: 3,2,1 を tick 間隔で刻む。
const COUNTDOWN_TICKS = 3;
const COUNTDOWN_TICK_MS = 750;

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureMode'>;

type CaptureState =
  | { kind: 'ready' }
  | { kind: 'countdown'; startTs: number }
  | { kind: 'recording'; startTs: number }
  | { kind: 'confirm_stop'; startTs: number }   // 停止確認中も録画は継続 (= 誤タップで映像を失わない)
  | { kind: 'finalizing' };

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
  const [available, setAvailable] = useState<boolean | null>(null);

  // 撮影構成 (ultra_wide ⇄ arkit)。 selected = ユーザー選択、 active = 実際に session 稼働中。
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

  const [state, setState] = useState<CaptureState>({ kind: 'ready' });
  const [error, setError] = useState<string | null>(null);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  // 録画経過秒 (= REC pill に表示)。
  const [elapsedSec, setElapsedSec] = useState(0);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const recordingStartedRef = useRef(false);
  // 録画尺 (= POST /api/clips の durationMs) 算出用に、 native 録画開始の wall-clock を控える。
  const recordingStartedAtRef = useRef(0);

  // 送信進捗チップ用 (= dataflow store の進行中クリップ)。
  const currentClip = useCurrentClip();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

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

  // 撮影構成の session ハンドオフ。 config が変わるたびに
  // 「旧 session 完全停止 (await) → カメラ解放待ち → 新 session 開始」 を直列実行する。
  // permission 許可後のみ動く。 ⚠ この直列化はカメラ排他のため壊しやすい、 順序を変えないこと。
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

  // 画面が landscapeRight に固定されるので、 native にも landscapeRight を固定で渡す。
  useEffect(() => {
    config.setDisplayOrientation('landscapeRight').catch(() => {});
  }, [config]);

  // 開始カウントダウンの単一ドライバ (= 数字表示・tick 音・終了 → recording 遷移を 1 つの timer で)。
  useEffect(() => {
    if (state.kind !== 'countdown') {
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
        playSfx('countdown_end'); // 録画開始の合図
        setState({ kind: 'recording', startTs: Date.now() });
        return;
      }
      const step = COUNTDOWN_TICKS - Math.floor(elapsed / COUNTDOWN_TICK_MS); // 3 → 2 → 1
      if (step !== lastStep && step >= 1 && step <= COUNTDOWN_TICKS) {
        lastStep = step;
        setCountdownRemaining(step);
        playSfx('countdown_tick');
      }
    };
    update();
    const id = setInterval(update, 50);
    return () => clearInterval(id);
  }, [state]);

  // recording に入ったら native の startRecording。 二重発火 guard は recordingStartedRef。
  useEffect(() => {
    if (state.kind === 'recording' && !recordingStartedRef.current) {
      recordingStartedRef.current = true;  // 同期で即 true、 後続 fire 防止
      (async () => {
        try {
          await config.startRecording(sink);
          recordingStartedAtRef.current = Date.now();
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`${t('capture.recStartFailed')}: ${e?.message ?? e}`);
          setState({ kind: 'ready' });
        }
      })();
    }
    if (state.kind === 'finalizing') {
      (async () => {
        try {
          const session = await config.stopRecording(sink);
          playSfx('rec_stop');

          // クリップを起こして dataflow の段レジュームランナーで前進させる
          // (= 背景実行、 撮影ループを止めない)。 進捗は useCurrentClip のチップに出る。
          const capturedConfig = config;
          const startedAt = recordingStartedAtRef.current;
          const durationMs = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : null;
          recordingStartedAtRef.current = 0;
          void (async () => {
            try {
              const clipId = await enqueueRecording({
                config: capturedConfig,
                session,
                durationMs,
                deviceModel: Device.modelId ?? null,
              });
              await advanceClip(clipId, sink);
            } catch (e) {
              sink({ step: 'capture', level: 'error', message: `送信失敗: ${errMsg(e)}` });
            }
          })();

          recordingStartedRef.current = false;
          setState({ kind: 'ready' });
        } catch (e: any) {
          recordingStartedRef.current = false;
          setError(`${t('capture.recStopFailed')}: ${e?.message ?? e}`);
          setState({ kind: 'ready' });
        }
      })();
    }
  }, [state.kind]);

  // 録画経過タイマー (= REC pill の mm:ss)。
  useEffect(() => {
    if (state.kind !== 'recording' && state.kind !== 'confirm_stop') {
      setElapsedSec(0);
      return;
    }
    const startTs = state.startTs;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTs) / 1000)), 500);
    return () => clearInterval(id);
  }, [state]);

  // クリーンアップ (= 録画中なら停止。 session 自体は handoff effect の unmount cleanup が止める)
  useEffect(() => {
    return () => {
      if (recordingStartedRef.current) {
        runningConfigRef.current?.stopRecording(sink).catch(() => {});
      }
    };
  }, []);

  const onBack = useCallback(() => {
    if (recordingStartedRef.current) {
      runningConfigRef.current?.stopRecording(sink).catch(() => {});
    }
    // 戻りを滑らかに (= rns の orientation 適用が dismiss 後にずれて「ホームが一瞬 landscape」 になる
    // 既知問題への対策)。 ① プレビューを隠す ② rns に portrait を先回り要求して現画面を回転させる
    // ③ 回転を始める猶予 (1 frame) を与えてから pop。 → ホームは最初から portrait で出る。
    setLeaving(true);
    navigation.setOptions({ orientation: 'portrait' });
    requestAnimationFrame(() => navigation.goBack());
  }, [navigation]);

  // 撮影構成の切替 (= ready 中のみ)。
  const onSelectConfig = useCallback((id: string) => {
    if (id === selectedConfigId) return;
    if (stateRef.current.kind !== 'ready') return;
    setSelectedConfigId(id);
  }, [selectedConfigId]);

  const onPressRecord = useCallback(() => {
    if (stateRef.current.kind !== 'ready') return;
    setError(null);
    setState({ kind: 'countdown', startTs: Date.now() });
  }, []);

  const onPressStop = useCallback(() => {
    const cur = stateRef.current;
    if (cur.kind !== 'recording') return;
    setState({ kind: 'confirm_stop', startTs: cur.startTs });
  }, []);

  const onConfirmStop = useCallback(() => {
    if (stateRef.current.kind !== 'confirm_stop') return;
    setState({ kind: 'finalizing' });
  }, []);

  const onCancelStop = useCallback(() => {
    const cur = stateRef.current;
    if (cur.kind !== 'confirm_stop') return;
    setState({ kind: 'recording', startTs: cur.startTs });
  }, []);

  // ─── ガード描画 ──────────────────────────────────────────────────

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

  const isRecording = state.kind === 'recording' || state.kind === 'confirm_stop';
  const canSwitchConfig = !switching && state.kind === 'ready';

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
          // 退場中は黒画面 (= portrait へ回転する間 landscape のカメラ映像が残らないように)
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

      {/* 右上: REC indicator + 経過時間 */}
      {isRecording ? (
        <View style={[styles.chromeTopRight, { top: safeTop + 12, right: safeRight + 12 }]} pointerEvents="none">
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recLabel}>REC {formatElapsed(elapsedSec)}</Text>
          </View>
        </View>
      ) : null}

      {/* 下中央: 録画開始 / 停止ボタン */}
      {state.kind === 'ready' ? (
        <View style={[styles.shutterWrap, { bottom: safeBottom + 24 }]}>
          <Pressable
            accessibilityLabel={t('capture.recordStartA11y')}
            onPress={onPressRecord}
            style={({ pressed }) => [styles.shutterBtn, pressed && styles.shutterBtnPressed]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      ) : null}
      {state.kind === 'recording' ? (
        <View style={[styles.shutterWrap, { bottom: safeBottom + 24 }]}>
          <Pressable
            accessibilityLabel={t('capture.recordStopA11y')}
            onPress={onPressStop}
            style={({ pressed }) => [styles.shutterBtn, styles.shutterBtnRec, pressed && styles.shutterBtnPressed]}
          >
            <View style={styles.shutterStopSquare} />
          </Pressable>
        </View>
      ) : null}
      {state.kind === 'finalizing' ? (
        <View style={[styles.shutterWrap, { bottom: safeBottom + 24 }]} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {/* 停止確認 (= 録画は継続中。 誤タップで映像を失わない) */}
      {state.kind === 'confirm_stop' ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('capture.stopConfirmTitle')}</Text>
            <View style={styles.confirmRow}>
              <Pressable
                onPress={onCancelStop}
                style={({ pressed }) => [styles.confirmBtn, pressed && styles.confirmBtnPressed]}
              >
                <Text style={styles.confirmBtnLabel}>{t('capture.stopConfirmContinue')}</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmStop}
                style={({ pressed }) => [styles.confirmBtn, styles.confirmBtnStop, pressed && styles.confirmBtnPressed]}
              >
                <Text style={[styles.confirmBtnLabel, styles.confirmBtnLabelStop]}>{t('capture.stopConfirmStop')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/* 撮影構成スイッチャ (= ready 中のみ操作可) */}
      {RECORDING_CONFIGS.length > 1 && state.kind === 'ready' ? (
        <View
          style={[styles.configSwitcher, { bottom: safeBottom + 116, left: safeLeft, right: safeRight }]}
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

      {/* 左下: 送信進捗チップ (= 直前クリップの 署名 → アップロード → 登録) */}
      {currentClip && !isRecording && state.kind !== 'countdown' ? (
        <View
          style={[styles.uploadChipWrap, { bottom: safeBottom + 24, left: safeLeft + 16 }]}
          pointerEvents="none"
        >
          <UploadChip
            state={currentClip.state}
            progress={currentClip.uploadProgress ?? 0}
            errorMessage={currentClip.errorMessage}
          />
        </View>
      ) : null}

      {/* エラー表示 (= 録画開始/停止の失敗。 下中央) */}
      {error ? (
        <View
          style={[styles.chromeBottom, { bottom: safeBottom + 96, left: safeLeft + 16, right: safeRight + 16 }]}
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

// ─── 送信進捗チップ ──────────────────────────────────────────────────

const UploadChip: React.FC<{
  state: 'uploading' | 'uploaded' | 'error';
  progress: number;
  errorMessage?: string | null;
}> = ({ state, progress, errorMessage }) => {
  const t = useT();
  if (state === 'uploaded') {
    return (
      <View style={[styles.uploadChip, styles.uploadChipDone]}>
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Path d="M2.5 7.5 L5.5 10.5 L11.5 4" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
        <Text style={styles.uploadChipText}>{t('capture.uploadDone')}</Text>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View style={[styles.uploadChip, styles.uploadChipErr]}>
        <Text style={styles.uploadChipText} numberOfLines={1}>
          {t('clip.errorEyebrow')}{errorMessage ? ` · ${errorMessage}` : ''}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.uploadChip}>
      <ActivityIndicator color="#fff" size="small" />
      <Text style={styles.uploadChipText}>
        {t('clip.uploading')} · {Math.round(progress * 100)}%
      </Text>
    </View>
  );
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  chromeBottom: { position: 'absolute', alignItems: 'center' },

  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(14,31,68,0.65)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  closeBtnRec: { backgroundColor: 'rgba(220,38,38,0.85)' },
  closeBtnPressed: { opacity: 0.7 },

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

  // 録画開始 / 停止ボタン (= カメラアプリ風の丸シャッター)
  shutterWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  shutterBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  shutterBtnRec: { borderColor: 'rgba(255,255,255,0.9)' },
  shutterBtnPressed: { opacity: 0.75 },
  shutterInner: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#dc2626',
  },
  shutterStopSquare: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: '#dc2626',
  },

  // 停止確認
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  confirmCard: {
    backgroundColor: 'rgba(14,31,68,0.95)',
    borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 20,
    gap: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    minWidth: 300,
  },
  confirmTitle: {
    color: '#fff',
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    textAlign: 'center',
  },
  confirmRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  confirmBtn: {
    paddingVertical: 10, paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  confirmBtnStop: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  confirmBtnPressed: { opacity: 0.75 },
  confirmBtnLabel: { color: '#fff', fontFamily: fonts.sansSemibold, fontSize: 14 },
  confirmBtnLabelStop: { color: '#fff' },

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

  // 送信進捗チップ
  uploadChipWrap: { position: 'absolute' },
  uploadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(14,31,68,0.85)',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    maxWidth: 320,
  },
  uploadChipDone: { backgroundColor: 'rgba(16,185,129,0.9)' },
  uploadChipErr: { backgroundColor: 'rgba(220,38,38,0.9)' },
  uploadChipText: {
    color: '#fff',
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
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
