// Settings タブ (= 横持ち、 扉カラム + 設定リスト)。
//
// セクションは「よく触る順」 に上から並べる:
//   • アカウント — アカウント ID / サインアウト
//   • アプリ     — 表示言語 / ストレージ使用量 / キャッシュクリア / バージョン
//   • サポート   — 利用規約 / プライバシーポリシー / お問い合わせ
//   • 撮影       — 解像度 / レート / ストリーム (= ほぼ触らないので下)
//   • 開発者向け — SERVER / ACCOUNT / AUTH PROVIDER / GitHub / 効果音テスト (= debug provider 時のみ)
//
// 行は Section が hairline で区切る (= 各行が罫線を持たない。 二重線を作らない)。

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Switch,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import { Camera } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';

import type { RootStackParamList } from '../app/types';

import { config } from '../config';
import { useAuth } from '../services/auth';
import { useT, useLocale, setLocale, type Locale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';
import { LegalDocModal } from '../components/LegalDocModal';
import { playSfxAwait, type SfxName } from '../services/captureSounds';
import {
  DEFAULT_CAPTURE_SETTINGS,
  loadCaptureSettings,
  saveCaptureSettings,
  type CaptureSettings,
  type CaptureResolution,
  type ImuRate,
  type RecordingRate,
} from '../services/captureSettings';
import type { LegalDocKey } from '../content/legalDocs.generated';
import { CAPTURE_FLOWS } from './captureFlow';
import {
  ArkitCapturePreviewView,
  analyzeCameraImuTimeValidation,
  getCameraImuTimeValidation,
  isArkitCaptureAvailable,
  setArkitCaptureSettings,
  setArkitDisplayOrientation,
  setArkitKeepAwake,
  startArkitRecording,
  startArkitSession,
  stopArkitRecording,
  stopArkitSession,
  type CameraImuTimeValidationResult,
} from '../native/arkitCapture';

type TimeValidationPhase = 'preparing' | 'ready' | 'running' | 'analyzing' | 'result' | 'error';

export const SettingsScreen: React.FC = () => {
  const { provider, state } = useAuth();
  const t = useT();
  const insets = useSafeAreaInsets();
  const locale = useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const ownerStr = state.status === 'authenticated' ? state.session.accountId : null;
  const [signingOut, setSigningOut] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);
  const [timeValidationOpen, setTimeValidationOpen] = useState(false);
  const [timeValidationPhase, setTimeValidationPhase] = useState<TimeValidationPhase>('preparing');
  const [timeValidationResult, setTimeValidationResult] = useState<CameraImuTimeValidationResult | null>(null);
  const [timeValidationError, setTimeValidationError] = useState('');
  const [timeValidationCountdown, setTimeValidationCountdown] = useState(25);
  const timeValidationRun = useRef(0);
  const timeValidationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeValidationStart = useRef<Promise<string> | null>(null);
  const timeValidationStop = useRef<Promise<string | null> | null>(null);
  const timeValidationRecording = useRef(false);
  const timeValidationSessionDir = useRef<string | null>(null);
  const timeValidationCleanup = useRef<Promise<void> | null>(null);

  // 撮影設定 (= Stera 同構成)。 保存は即時、 適用は次の撮影画面オープンから。
  const [cs, setCs] = useState<CaptureSettings>({ ...DEFAULT_CAPTURE_SETTINGS });
  useEffect(() => {
    loadCaptureSettings().then(setCs).catch(() => {});
    getCameraImuTimeValidation().then(setTimeValidationResult).catch(() => {});
  }, []);
  const updateCs = (patch: Partial<CaptureSettings>) => {
    setCs((cur) => {
      const next = { ...cur, ...patch };
      saveCaptureSettings(next).catch(() => {});
      return next;
    });
  };

  const version = (Constants.expoConfig?.version as string | undefined) ?? '0.1.0';

  // キャッシュサイズを起動時に計算
  useEffect(() => {
    void refreshCacheSize();
  }, []);

  const refreshCacheSize = async () => {
    try {
      const dir = FileSystem.cacheDirectory;
      if (!dir) return;
      const items = await FileSystem.readDirectoryAsync(dir);
      let total = 0;
      for (const name of items) {
        try {
          const info = await FileSystem.getInfoAsync(`${dir}${name}`, { size: true });
          if (info.exists && 'size' in info) total += (info as { size: number }).size;
        } catch {}
      }
      setCacheSize(total);
    } catch {
      setCacheSize(null);
    }
  };

  const onClearCache = () => {
    Alert.alert(
      t('settings.clearCacheTitle'),
      t('settings.clearCacheMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const dir = FileSystem.cacheDirectory;
              if (!dir) return;
              const items = await FileSystem.readDirectoryAsync(dir);
              for (const name of items) {
                await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
              }
            } catch {}
            void refreshCacheSize();
          },
        },
      ],
    );
  };

  const onLogout = () => {
    Alert.alert(
      t('settings.signOut'),
      provider.id === 'debug'
        ? t('settings.signOutDebugMessage')
        : t('settings.signOutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await provider.logout();
            } finally {
              setSigningOut(false);
            }
          },
        },
      ],
    );
  };

  const stopTemporaryValidationRecording = async (): Promise<string | null> => {
    if (timeValidationStop.current) return timeValidationStop.current;
    const stop = (async () => {
      if (timeValidationStart.current) {
        try { await timeValidationStart.current; } catch { return null; }
      }
      if (!timeValidationRecording.current) return timeValidationSessionDir.current;
      timeValidationRecording.current = false;
      const dir = await stopArkitRecording();
      timeValidationSessionDir.current = dir;
      return dir;
    })();
    timeValidationStop.current = stop;
    return stop;
  };

  const cleanupTimeValidation = async () => {
    if (timeValidationCleanup.current) return timeValidationCleanup.current;
    const cleanup = (async () => {
      let dir = timeValidationSessionDir.current;
      try {
        dir = await stopTemporaryValidationRecording() ?? dir;
      } catch {}
      await stopArkitSession().catch(() => {});
      await setArkitKeepAwake(false).catch(() => {});
      if (dir) await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
      timeValidationSessionDir.current = null;
    })();
    timeValidationCleanup.current = cleanup;
    try { await cleanup; } finally { timeValidationCleanup.current = null; }
  };

  useEffect(() => () => {
    timeValidationRun.current += 1;
    if (timeValidationTimer.current) clearInterval(timeValidationTimer.current);
    void cleanupTimeValidation();
  }, []);

  const openTimeValidation = async () => {
    const run = ++timeValidationRun.current;
    setTimeValidationOpen(true);
    setTimeValidationPhase('preparing');
    setTimeValidationError('');
    try {
      await cleanupTimeValidation();
      timeValidationStart.current = null;
      timeValidationStop.current = null;
      timeValidationRecording.current = false;
      timeValidationSessionDir.current = null;
      const existing = await Camera.getCameraPermissionsAsync();
      const permission = existing.granted ? existing : await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error(t('capture.permissionBody'));
      if (!await isArkitCaptureAvailable()) throw new Error(t('capture.unsupportedBody'));
      await setArkitCaptureSettings(JSON.stringify(cs));
      await setArkitDisplayOrientation('landscapeRight');
      await setArkitKeepAwake(true);
      await startArkitSession();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (timeValidationRun.current === run) setTimeValidationPhase('ready');
    } catch (error) {
      if (timeValidationRun.current !== run) return;
      setTimeValidationError(error instanceof Error ? error.message : String(error));
      setTimeValidationPhase('error');
    }
  };

  const closeTimeValidation = () => {
    timeValidationRun.current += 1;
    if (timeValidationTimer.current) {
      clearInterval(timeValidationTimer.current);
      timeValidationTimer.current = null;
    }
    setTimeValidationOpen(false);
    void cleanupTimeValidation();
  };

  const startTimeValidation = async () => {
    const run = ++timeValidationRun.current;
    setTimeValidationCountdown(25);
    setTimeValidationError('');
    setTimeValidationPhase('running');
    const startedAt = Date.now();
    if (timeValidationTimer.current) clearInterval(timeValidationTimer.current);
    timeValidationTimer.current = setInterval(() => {
      const remaining = Math.max(0, 25 - Math.floor((Date.now() - startedAt) / 1000));
      setTimeValidationCountdown(remaining);
    }, 250);
    let dir: string | null = null;
    try {
      const start = startArkitRecording().then((sessionDir) => {
        timeValidationRecording.current = true;
        timeValidationSessionDir.current = sessionDir;
        return sessionDir;
      });
      timeValidationStart.current = start;
      dir = await start;
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      if (timeValidationRun.current !== run) {
        await cleanupTimeValidation();
        return;
      }
      setTimeValidationPhase('analyzing');
      dir = await stopTemporaryValidationRecording();
      await stopArkitSession();
      await setArkitKeepAwake(false);
      if (!dir) throw new Error('Temporary RGB–IMU recording was not created');
      const result = await analyzeCameraImuTimeValidation(dir);
      if (timeValidationRun.current !== run) return;
      setTimeValidationResult(result);
      setTimeValidationPhase('result');
    } catch (error) {
      if (timeValidationRun.current !== run) return;
      setTimeValidationError(error instanceof Error ? error.message : String(error));
      setTimeValidationPhase('error');
    } finally {
      if (timeValidationTimer.current) {
        clearInterval(timeValidationTimer.current);
        timeValidationTimer.current = null;
      }
      if (dir) await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
      timeValidationSessionDir.current = null;
    }
  };

  return (
    <View style={[styles.root, { paddingLeft: insets.left }]}>
      {/* ── 左: 扉カラム (= マイビデオと対称) ── */}
      <View style={styles.aside}>
        <View style={styles.asideHead}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>
        <Text style={styles.footnote}>RootLens v{version}</Text>
      </View>

      {/* ── 右: 設定リスト (= 一列) ── */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Section title={t('settings.section.account')}>
          <Row
            label={t('settings.accountId')}
            value={ownerStr ? shortBase58(ownerStr) : t('settings.unauthenticated')}
            mono
          />
          {state.status === 'authenticated' ? (
            <ActionRow
              label={signingOut ? t('settings.signingOut') : t('settings.signOut')}
              onPress={onLogout}
              kind="danger"
              disabled={signingOut}
            />
          ) : (
            <ActionRow label={t('settings.signIn')} onPress={() => navigation.navigate('Login')} />
          )}
        </Section>

        <Section title={t('settings.section.app')}>
          <SegmentRow
            label={t('settings.languageLabel')}
            value={locale}
            options={[
              { value: 'ja', label: t('settings.languageJa') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
            onChange={(v) => setLocale(v as Locale)}
          />
          <Row
            label={t('settings.storageUsage')}
            value={cacheSize === null ? t('settings.calculating') : formatBytes(cacheSize)}
          />
          <ActionRow label={t('settings.clearCache')} onPress={onClearCache} kind="warn" />
          <Row label={t('settings.version')} value={version} />
        </Section>

        <Section title={t('settings.section.support')}>
          <ActionRow label={t('settings.terms')} onPress={() => setLegalDoc('terms-of-service')} />
          <ActionRow label={t('settings.privacy')} onPress={() => setLegalDoc('privacy-policy')} />
          <ActionRow
            label={t('settings.contact')}
            onPress={() => Linking.openURL('mailto:support@rootlens.io').catch(() => {})}
          />
        </Section>

        <Section title={t('settings.section.capture')}>
          <SegmentRow
            label={t('settings.capture.resolution')}
            value={cs.resolution}
            options={[
              { value: '1440p', label: t('settings.capture.res1440') },
              { value: '1080p', label: '1080p' },
              { value: '720p', label: '720p' },
            ]}
            onChange={(v) => updateCs({ resolution: v as CaptureResolution })}
          />
          <SwitchRow
            label={t('settings.capture.autoFocus')}
            value={cs.autoFocus}
            onChange={(v) => updateCs({ autoFocus: v })}
          />
          <SegmentRow
            label={t('settings.capture.recordingRate')}
            value={String(cs.recordingRate)}
            options={[
              { value: '15', label: '15 Hz' },
              { value: '30', label: '30 Hz' },
              { value: '60', label: '60 Hz' },
            ]}
            onChange={(v) => updateCs({ recordingRate: Number(v) as RecordingRate })}
          />
          <SwitchRow
            label={t('settings.capture.syncRate')}
            value={cs.syncRate}
            onChange={(v) => updateCs({ syncRate: v })}
          />
          {!cs.syncRate ? (
            <SegmentRow
              label={t('settings.capture.depthRate')}
              value={String(cs.depthRate)}
              options={[
                { value: '15', label: '15 Hz' },
                { value: '30', label: '30 Hz' },
                { value: '60', label: '60 Hz' },
              ]}
              onChange={(v) => updateCs({ depthRate: Number(v) as RecordingRate })}
            />
          ) : null}
          {!cs.syncRate ? (
            <SegmentRow
              label={t('settings.capture.pointCloudRate')}
              value={String(cs.pointCloudRate)}
              options={[
                { value: '15', label: '15 Hz' },
                { value: '30', label: '30 Hz' },
                { value: '60', label: '60 Hz' },
              ]}
              onChange={(v) => updateCs({ pointCloudRate: Number(v) as RecordingRate })}
            />
          ) : null}
          <SegmentRow
            label={t('settings.capture.imuRate')}
            value={String(cs.imuRateHz)}
            options={[
              { value: '50', label: '50 Hz' },
              { value: '100', label: '100 Hz' },
              { value: '200', label: '200 Hz' },
            ]}
            onChange={(v) => updateCs({ imuRateHz: Number(v) as ImuRate })}
          />
          <SwitchRow
            label={t('settings.capture.streamImu')}
            value={cs.streamImu}
            onChange={(v) => updateCs({ streamImu: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamDepth')}
            value={cs.streamDepth}
            onChange={(v) => updateCs({ streamDepth: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamPointCloud')}
            value={cs.streamPointCloud}
            onChange={(v) => updateCs({ streamPointCloud: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamMesh')}
            value={cs.streamMesh}
            onChange={(v) => updateCs({ streamMesh: v })}
          />
          {/* 撮影フロー (= 開始・終了の指示方法)。 選択肢は registry から自動生成 (= 新フロー追加時に
              ここを触らない)。 gesture = サムズアップ / voice = 音声コマンド。 */}
          <SegmentRow
            label={t('settings.capture.flow')}
            value={cs.captureFlow}
            options={CAPTURE_FLOWS.map((f) => ({ value: f.id, label: t(f.displayLabelKey) }))}
            onChange={(v) => updateCs({ captureFlow: v as CaptureSettings['captureFlow'] })}
          />
          {/* 自動サイクル撮影 (= N 分録画 → 休止 → 再開のループ)。 有効時のみ分数を出す。 */}
          <SwitchRow
            label={t('settings.capture.cycleEnabled')}
            value={cs.cycleEnabled}
            onChange={(v) => updateCs({ cycleEnabled: v })}
          />
          {cs.cycleEnabled ? (
            <StepperRow
              label={t('settings.capture.cycleRecord')}
              value={cs.cycleRecordMinutes}
              min={1}
              max={90}
              unit={t('settings.capture.minutesUnit')}
              onChange={(v) => updateCs({ cycleRecordMinutes: v })}
            />
          ) : null}
          {cs.cycleEnabled ? (
            <StepperRow
              label={t('settings.capture.cyclePause')}
              value={cs.cyclePauseMinutes}
              min={1}
              max={30}
              unit={t('settings.capture.minutesUnit')}
              onChange={(v) => updateCs({ cyclePauseMinutes: v })}
            />
          ) : null}
        </Section>

        <Section title={t('settings.section.sensorSync')}>
          {timeValidationResult ? (
            <>
              <Row
                label={t('settings.sensorSync.offset')}
                value={formatSignedMs(timeValidationResult.videoToImuOffsetMs)}
                mono
              />
              <Row
                label={t('settings.sensorSync.repeatability')}
                value={`σ ${timeValidationResult.standardDeviationMs.toFixed(2)} ms · ${formatSignedMs(timeValidationResult.rangeMinMs)}–${formatSignedMs(timeValidationResult.rangeMaxMs)}`}
                mono
              />
              <Row
                label={t('settings.sensorSync.quality')}
                value={timeValidationResult.quality === 'good'
                  ? t('settings.sensorSync.qualityGood')
                  : t('settings.sensorSync.qualityReview')}
              />
              <Row
                label={t('settings.sensorSync.configuration')}
                value={`${timeValidationResult.videoWidth}×${timeValidationResult.videoHeight} @ ${timeValidationResult.videoFps} fps · IMU ${timeValidationResult.imuRateHz} Hz`}
                mono
              />
              <Row
                label={t('settings.sensorSync.measuredAt')}
                value={formatMeasurementDate(timeValidationResult.measuredAt, locale)}
              />
            </>
          ) : (
            <Row label={t('settings.sensorSync.status')} value={t('settings.sensorSync.notMeasured')} />
          )}
          <ActionRow
            label={timeValidationResult
              ? t('settings.sensorSync.measureAgain')
              : t('settings.sensorSync.measure')}
            onPress={() => { void openTimeValidation(); }}
          />
        </Section>

        {/* ── 開発者向け (= debug provider 時のみ表示) ── */}
        {provider.id === 'debug' ? (
          <Section title={t('settings.section.developer')} tone="muted">
            <Row label="SERVER" value={config.serverUrl} mono onPress={() => Linking.openURL(config.serverUrl)} />
            <Row label="ACCOUNT" value={ownerStr ?? '—'} mono />
            <Row label="AUTH PROVIDER" value={provider.id} mono />
            <ActionRow
              label="GitHub"
              onPress={() => Linking.openURL('https://github.com/yudai-mori-2004/root-lens').catch(() => {})}
            />
          </Section>
        ) : null}

        {/* ── 効果音の試聴 (= tools/asset-gen/gen-sfx.py で再生成 → reload で反映) ── */}
        {provider.id === 'debug' ? (
          <Section title="効果音テスト" tone="muted">
            {SFX_NAMES.map((name) => (
              <ActionRow key={name} label={name} onPress={() => { void playSfxAwait(name); }} />
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
      <Modal
        visible={timeValidationOpen}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeTimeValidation}
      >
        <View style={styles.validationRoot}>
          {ArkitCapturePreviewView ? (
            <ArkitCapturePreviewView style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.validationPreviewFallback]} />
          )}
          <View style={styles.validationScrim} />
          <View style={styles.validationPanel}>
            <Text style={styles.validationEyebrow}>{t('settings.sensorSync.modalEyebrow')}</Text>
            <Text style={styles.validationTitle}>{t('settings.sensorSync.modalTitle')}</Text>

            {timeValidationPhase === 'preparing' ? (
              <View style={styles.validationStatus}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.validationBody}>{t('settings.sensorSync.preparing')}</Text>
              </View>
            ) : null}

            {timeValidationPhase === 'ready' ? (
              <>
                <Text style={styles.validationBody}>{t('settings.sensorSync.instructions')}</Text>
                <Text style={styles.validationNote}>{t('settings.sensorSync.noCorrection')}</Text>
                <Pressable style={styles.validationPrimary} onPress={() => { void startTimeValidation(); }}>
                  <Text style={styles.validationPrimaryLabel}>{t('settings.sensorSync.start')}</Text>
                </Pressable>
              </>
            ) : null}

            {timeValidationPhase === 'running' ? (
              <View style={styles.validationStatus}>
                <Text style={styles.validationCountdown}>{timeValidationCountdown}</Text>
                <Text style={styles.validationBody}>{t('settings.sensorSync.keepMoving')}</Text>
              </View>
            ) : null}

            {timeValidationPhase === 'analyzing' ? (
              <View style={styles.validationStatus}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.validationBody}>{t('settings.sensorSync.analyzing')}</Text>
              </View>
            ) : null}

            {timeValidationPhase === 'result' && timeValidationResult ? (
              <>
                <Text style={styles.validationResultValue}>
                  {formatSignedMs(timeValidationResult.videoToImuOffsetMs)}
                </Text>
                <Text style={styles.validationResultLabel}>{t('settings.sensorSync.offset')}</Text>
                <Text style={styles.validationBody}>
                  {`σ ${timeValidationResult.standardDeviationMs.toFixed(2)} ms · r ${timeValidationResult.peakCorrelation.toFixed(2)} · ${timeValidationResult.windowCount} ${t('settings.sensorSync.windows')}`}
                </Text>
                <Text style={styles.validationNote}>
                  {timeValidationResult.quality === 'good'
                    ? t('settings.sensorSync.resultGood')
                    : t('settings.sensorSync.resultReview')}
                </Text>
                <View style={styles.validationActions}>
                  <Pressable style={styles.validationSecondary} onPress={() => { void openTimeValidation(); }}>
                    <Text style={styles.validationSecondaryLabel}>{t('settings.sensorSync.measureAgain')}</Text>
                  </Pressable>
                  <Pressable style={styles.validationPrimary} onPress={closeTimeValidation}>
                    <Text style={styles.validationPrimaryLabel}>{t('common.close')}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {timeValidationPhase === 'error' ? (
              <>
                <Text style={styles.validationBody}>{t('settings.sensorSync.failed')}</Text>
                <Text style={styles.validationError}>{timeValidationError}</Text>
                <Pressable style={styles.validationPrimary} onPress={() => { void openTimeValidation(); }}>
                  <Text style={styles.validationPrimaryLabel}>{t('settings.sensorSync.retry')}</Text>
                </Pressable>
              </>
            ) : null}

            {timeValidationPhase !== 'result' ? (
              <Pressable style={styles.validationClose} onPress={closeTimeValidation}>
                <Text style={styles.validationCloseLabel}>{t('common.cancel')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const SFX_NAMES: SfxName[] = [
  'enter_capture', 'detect_palm', 'detect_thumbs_up', 'detect_cancel',
  'countdown_tick', 'countdown_end', 'rec_stop',
];

// ─── building blocks ────────────────────────────────────────────────────
// Section が行間の hairline を一元管理する (= 行コンポーネントは罫線を持たない)。

const Section: React.FC<{ title: string; tone?: 'normal' | 'muted'; children: React.ReactNode }> = ({
  title, tone, children,
}) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View>
      <View style={styles.sectionPill}>
        <Text style={[styles.sectionPillText, tone === 'muted' && { color: colors.textMute }]}>{title}</Text>
      </View>
      <View style={styles.sectionCard}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
};

const Row: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  onPress?: () => void;
}> = ({ label, value, mono, onPress }) => {
  const inner = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.rowValueMono, onPress && styles.rowValueLink]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.rowPressed]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
};

const Chevron: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Path d="M5 3.5 L9 7 L5 10.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ActionRow: React.FC<{
  label: string;
  onPress: () => void;
  kind?: 'warn' | 'danger' | 'normal';
  disabled?: boolean;
}> = ({ label, onPress, kind, disabled }) => {
  const color =
    kind === 'warn' ? colors.warn :
    kind === 'danger' ? colors.danger :
    colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      <Text style={[styles.actionRowLabel, { color }]}>{label}</Text>
      <Chevron color={kind ? color : colors.textFaint} />
    </Pressable>
  );
};

/// 1 行に収まるコンパクトなセグメント切替 (= ラベル左、 セグメント右)。
const SwitchRow: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, value, onChange }) => (
  <View style={styles.segmentRow}>
    <Text style={styles.rowLabelInline}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.accent, false: colors.border }}
      thumbColor="#FFFFFF"
    />
  </View>
);

/// 分数などの任意整数を −/+ で増減するステッパ (= ラベル左、 [−] 値 [+] 右)。
const StepperRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, unit, onChange }) => {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.rowLabelInline}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.segmentBtnPressed, value <= min && styles.rowDisabled]}
          hitSlop={6}
        >
          <Text style={styles.stepBtnLabel}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}{unit}</Text>
        <Pressable
          onPress={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.segmentBtnPressed, value >= max && styles.rowDisabled]}
          hitSlop={6}
        >
          <Text style={styles.stepBtnLabel}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

const SegmentRow: React.FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <View style={styles.segmentRow}>
    <Text style={styles.rowLabelInline}>{label}</Text>
    <View style={styles.segmentControl}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segmentBtn,
              active && styles.segmentBtnActive,
              pressed && !active && styles.segmentBtnPressed,
            ]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

// ─── helpers ────────────────────────────────────────────────────────────

function shortBase58(s: string | null | undefined): string {
  if (!s) return '—';
  if (s.length <= 16) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSignedMs(value: number): string {
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${Math.abs(value).toFixed(2)} ms`;
}

function formatMeasurementDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

// ─── styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },

  aside: {
    width: 236,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  asideHead: { gap: 6 },
  title: {
    fontFamily: fonts.serifLight,
    fontSize: 26,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  subtitle: { ...typography.caption, fontSize: 12, color: colors.textMute },

  list: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
    maxWidth: 560,
    width: '100%',
  },

  // LP のピル (= ink 地 + lime caps、 わずかに傾き)
  sectionPill: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#0A0416',
    transform: [{ rotate: '-1.5deg' }],
  },
  sectionPillText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: colors.paperDeep },
  rowDisabled: { opacity: 0.45 },
  rowLabel: { ...typography.captionMedium, color: colors.textBody },
  rowLabelInline: { ...typography.captionMedium, color: colors.textBody },
  rowValue: {
    ...typography.caption,
    color: colors.textMute,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueMono: { fontFamily: fonts.mono, fontSize: 12 },
  rowValueLink: { textDecorationLine: 'underline' },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  actionRowLabel: { ...typography.captionMedium, flexShrink: 1 },

  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  segmentControl: {
    flexDirection: 'row',
    gap: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 18,
    lineHeight: 20,
    color: colors.ink,
  },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
  },
  segmentBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  // 選択は LP の差し色でべた塗り (黄地 + 黒文字)
  segmentBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentBtnPressed: { opacity: 0.6 },
  // 選択のたびに font family が Medium → Semibold へ切り替わると Noto の縦メトリクスが
  // 変わって行がズレる。 両方 Semibold に固定して色だけ切り替える。
  segmentLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12.5,
    color: colors.textMute,
  },
  segmentLabelActive: {
    color: colors.textOnInk,
  },

  footnote: {
    ...typography.caption,
    color: colors.textFaint,
    fontFamily: fonts.dot,
    fontSize: 12,
  },

  validationRoot: { flex: 1, backgroundColor: '#05020A', alignItems: 'flex-end', justifyContent: 'center' },
  validationPreviewFallback: { backgroundColor: '#120B1B' },
  validationScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 2, 10, 0.46)',
  },
  validationPanel: {
    width: 430,
    marginRight: spacing.xl,
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(10, 4, 22, 0.93)',
    ...shadows.lg,
  },
  validationEyebrow: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  validationTitle: { fontFamily: fonts.serifLight, fontSize: 28, color: '#FFFFFF' },
  validationBody: { ...typography.body, color: 'rgba(255,255,255,0.88)', lineHeight: 22 },
  validationNote: { ...typography.caption, color: 'rgba(255,255,255,0.60)', lineHeight: 18 },
  validationStatus: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  validationCountdown: { fontFamily: fonts.mono, fontSize: 64, color: colors.accent },
  validationResultValue: { fontFamily: fonts.mono, fontSize: 42, color: colors.accent },
  validationResultLabel: { ...typography.captionMedium, color: 'rgba(255,255,255,0.60)' },
  validationError: { ...typography.caption, color: colors.danger, lineHeight: 18 },
  validationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  validationPrimary: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  validationPrimaryLabel: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.textOnInk },
  validationSecondary: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  validationSecondaryLabel: { fontFamily: fonts.sansSemibold, fontSize: 13, color: '#FFFFFF' },
  validationClose: { alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  validationCloseLabel: { ...typography.captionMedium, color: 'rgba(255,255,255,0.60)' },
});
