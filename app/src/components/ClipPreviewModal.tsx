// アップロードフロー (= マイビデオのカードタップで開く 2 段構成)。
//
//   Step 1 同意 (consent):
//     tester-consent §2 の層1要約 (アップロード適合版) + 3 チェック + 全文リンク。
//     「同意して進む」 で consent-log-spec 準拠の同意イベントをサーバに記録し (= 証跡)、
//     成功したときだけ Step 2 へ進む。 文言を変えたら services/consent.ts の
//     UPLOAD_CONSENT_SUMMARY_VERSION を必ず上げる。
//   Step 2 確認 (preview):
//     ローカル録画 mp4 をその場で再生して中身を確認 → 「アップロードする」。
//     削除は「元に戻せない」 を確認ダイアログで念押ししてから実行。
//
// 横持ち前提。 Step 1 = 左 要約 / 右 チェック + アクション。 Step 2 = 左 動画 / 右 アクション。

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { ResizeMode, Video } from 'expo-av';

import type { Clip } from '../dataflow';
import { localVideoUri, formatDuration, formatCardDate, formatCardTime, configLabel } from './ClipCard';
import { LegalDocModal } from './LegalDocModal';
import { recordUploadConsent, type UploadConsentChecks } from '../services/consent';
import { useT } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
  /// 「アップロードする」 (= 署名 → R2 → 登録 を開始)。 error クリップの再試行も同じ。
  onUpload: (clip: Clip) => void;
  onRemove: (clip: Clip) => void;
}

const INITIAL_CHECKS: UploadConsentChecks = {
  age18_and_location_right: false,
  no_third_party: false,
  agree_terms: false,
};

export const ClipPreviewModal: React.FC<Props> = ({ visible, clip, onClose, onUpload, onRemove }) => {
  const t = useT();
  const [step, setStep] = useState<'consent' | 'preview'>('consent');
  const [checks, setChecks] = useState<UploadConsentChecks>(INITIAL_CHECKS);
  const [sending, setSending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);

  // 開くたび / 対象が変わるたびに最初からやり直す (= 動画ごとに同意 + 確認してもらう)
  useEffect(() => {
    setStep('consent');
    setChecks(INITIAL_CHECKS);
    setSending(false);
    setConsentError(null);
  }, [visible, clip?.id]);

  if (!clip) return null;
  const uri = localVideoUri(clip);
  const dur = formatDuration(clip.durationMs);
  const allChecked = checks.age18_and_location_right && checks.no_third_party && checks.agree_terms;

  const toggle = (key: keyof UploadConsentChecks) =>
    setChecks((c) => ({ ...c, [key]: !c[key] }));

  const onProceed = async () => {
    if (!allChecked || sending) return;
    setSending(true);
    setConsentError(null);
    try {
      // 同意イベントをサーバに記録 (= append-only の証跡)。 成功するまで進まない。
      await recordUploadConsent({
        checks,
        clipLocalId: clip.id,
        clipCreatedAt: clip.createdAt,
        recordingConfig: clip.recordingConfigId,
      });
      setStep('preview');
    } catch {
      setConsentError(t('upload.consentError'));
    } finally {
      setSending(false);
    }
  };

  const onPressDelete = () => {
    Alert.alert(
      t('upload.deleteTitle'),
      t('upload.deleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('upload.deleteConfirm'), style: 'destructive', onPress: () => onRemove(clip) },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* シート内タップでは閉じない */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {step === 'consent' ? (
            <>
              {/* ── Step 1 左: 層1 要約 ── */}
              <View style={[styles.consentLeft, styles.consentLeftContent]}>
                <Text style={styles.eyebrow}>{t('upload.consentTitle')}</Text>
                <Text style={styles.consentIntro}>{t('upload.consentIntro')}</Text>
                <View style={styles.bullets}>
                  {(['upload.consentBullet1', 'upload.consentBullet2', 'upload.consentBullet3'] as const).map((k) => (
                    <View key={k} style={styles.bulletRow}>
                      <View style={styles.bulletDot} />
                      <Text style={styles.bulletText}>{t(k)}</Text>
                    </View>
                  ))}
                </View>
                <Pressable onPress={() => setShowTerms(true)} style={({ pressed }) => [styles.readFull, pressed && styles.pressedDim]} hitSlop={6}>
                  <Text style={styles.readFullLabel}>{t('upload.consentReadFull')}</Text>
                  <Svg width={12} height={12} viewBox="0 0 12 12">
                    <Path d="M4 2.5 L8 6 L4 9.5" stroke={colors.emerald} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                </Pressable>
              </View>

              <View style={styles.consentDivider} />

              {/* ── Step 1 右: チェック + アクション ── */}
              <View style={styles.consentRight}>
                <CheckRow
                  checked={checks.age18_and_location_right}
                  label={t('upload.consentCheckAge')}
                  onPress={() => toggle('age18_and_location_right')}
                />
                <CheckRow
                  checked={checks.no_third_party}
                  label={t('upload.consentCheckNoThirdParty')}
                  onPress={() => toggle('no_third_party')}
                />
                <CheckRow
                  checked={checks.agree_terms}
                  label={t('upload.consentCheckTerms')}
                  onPress={() => toggle('agree_terms')}
                />

                <View style={styles.spacer} />

                {consentError ? <Text style={styles.consentErrorText}>{consentError}</Text> : null}

                <Pressable
                  onPress={onProceed}
                  disabled={!allChecked || sending}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (!allChecked || sending) && styles.primaryBtnDisabled,
                    pressed && allChecked && !sending && styles.primaryBtnPressed,
                  ]}
                >
                  {sending ? (
                    <View style={styles.btnRow}>
                      <ActivityIndicator size="small" color={colors.textOnInk} />
                      <Text style={styles.primaryBtnLabel}>{t('upload.consentSending')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryBtnLabel}>{t('upload.consentProceed')}</Text>
                  )}
                </Pressable>
                <Pressable onPress={onClose} style={({ pressed }) => [styles.subBtnCenter, pressed && styles.pressedDim]} hitSlop={6}>
                  <Text style={styles.subBtnLabel}>{t('common.close')}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* ── Step 2 左: 動画プレビュー ── */}
              <View style={styles.videoWrap}>
                {uri ? (
                  <Video
                    source={{ uri }}
                    style={styles.video}
                    resizeMode={ResizeMode.CONTAIN}
                    useNativeControls
                    shouldPlay
                    isLooping
                  />
                ) : (
                  <View style={styles.videoMissing}>
                    <Svg width={40} height={40} viewBox="0 0 40 40" fill="none">
                      <Circle cx={20} cy={20} r={18.5} stroke={colors.textFaint} strokeWidth={1.4} />
                      <Polygon points="16,12.5 28,20 16,27.5" fill={colors.textFaint} />
                    </Svg>
                  </View>
                )}
              </View>

              {/* ── Step 2 右: 確認 + アクション ── */}
              <View style={styles.side}>
                <Text style={styles.eyebrow}>{t('upload.confirmTitle')}</Text>
                <Text style={styles.title} numberOfLines={1}>
                  {formatCardDate(clip.createdAt)} {formatCardTime(clip.createdAt)}
                </Text>
                <Text style={styles.meta}>
                  {dur ?? ''}
                  {dur && clip.recordingConfigId ? '  ·  ' : ''}
                  {clip.recordingConfigId ? configLabel(clip.recordingConfigId) : ''}
                </Text>

                {clip.state === 'error' && clip.errorMessage ? (
                  <Text style={styles.errorNote} numberOfLines={2}>{clip.errorMessage}</Text>
                ) : null}

                <Text style={styles.hint}>{t('upload.confirmHint')}</Text>

                <View style={styles.spacer} />

                {/* 同意済みの証跡表示 */}
                <View style={styles.consentedRow}>
                  <Svg width={13} height={13} viewBox="0 0 13 13">
                    <Path d="M2.5 7 L5.3 9.8 L10.5 3.8" stroke={colors.success} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                  <Text style={styles.consentedLabel}>{t('upload.consentedNote')}</Text>
                </View>

                <Pressable
                  onPress={() => onUpload(clip)}
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                >
                  <Text style={styles.primaryBtnLabel}>{t('upload.action')}</Text>
                </Pressable>

                <View style={styles.subRow}>
                  <Pressable onPress={onPressDelete} style={({ pressed }) => [styles.subBtn, pressed && styles.pressedDim]} hitSlop={6}>
                    <Text style={styles.subBtnLabelDanger}>{t('common.delete')}</Text>
                  </Pressable>
                  <View style={styles.subDivider} />
                  <Pressable onPress={onClose} style={({ pressed }) => [styles.subBtn, pressed && styles.pressedDim]} hitSlop={6}>
                    <Text style={styles.subBtnLabel}>{t('common.close')}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>

      {/* 利用条件 全文 (= 層2 正本。 同意はこの全文に対して成立する) */}
      <LegalDocModal doc={showTerms ? 'tester-consent' : null} onClose={() => setShowTerms(false)} />
    </Modal>
  );
};

// ─── チェック行 ─────────────────────────────────────────────────────────

const CheckRow: React.FC<{ checked: boolean; label: string; onPress: () => void }> = ({
  checked, label, onPress,
}) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.checkRow, pressed && styles.pressedDim]} hitSlop={4}>
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? (
        <Svg width={12} height={12} viewBox="0 0 12 12">
          <Path d="M2 6.2 L4.8 9 L10 3.4" stroke={colors.textOnInk} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      ) : null}
    </View>
    <Text style={styles.checkLabel}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    width: '90%',
    maxWidth: 820,
    maxHeight: '92%',
    ...shadows.pop,
  },

  // ── Step 1: 同意 ──
  consentLeft: { flex: 55 },
  consentLeftContent: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  consentIntro: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMute,
  },
  bullets: { gap: spacing.sm + 2, marginTop: 2 },
  bulletRow: { flexDirection: 'row', gap: spacing.sm + 1, alignItems: 'flex-start' },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.emerald,
    marginTop: 6.5,
  },
  bulletText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textBody,
    flex: 1,
  },
  readFull: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  readFullLabel: {
    ...typography.captionMedium,
    fontSize: 12,
    color: colors.emerald,
  },
  consentDivider: { width: 1, backgroundColor: colors.border },
  consentRight: {
    flex: 45,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.4,
    borderColor: colors.textMute,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  checkLabel: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textBody,
    flex: 1,
  },
  consentErrorText: {
    ...typography.caption,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.danger,
  },

  // ── Step 2: 確認 ──
  // aspectRatio は付けない: side の高さにストレッチし、 動画は CONTAIN で箱内 letterbox する
  videoWrap: {
    flex: 56,
    alignSelf: 'stretch',
    backgroundColor: '#0B0D11',
  },
  video: { width: '100%', height: '100%' },
  videoMissing: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  side: {
    flex: 44,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignSelf: 'stretch',
    minHeight: 300,
  },
  eyebrow: {
    ...typography.labelSmall,
    color: colors.emerald,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  meta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMute,
    marginTop: 4,
  },
  errorNote: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  hint: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textBody,
    marginTop: spacing.md,
  },
  spacer: { flex: 1, minHeight: spacing.md },

  consentedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm + 2,
  },
  consentedLabel: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.success,
  },

  // ── 共有ボタン ──
  primaryBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radii.full,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnPressed: { backgroundColor: colors.emeraldDeep },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.textOnInk,
    letterSpacing: 0.4,
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  subDivider: { width: 1, height: 12, backgroundColor: colors.border },
  subBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  subBtnCenter: { paddingVertical: 8, alignSelf: 'center' },
  subBtnLabel: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: colors.textMute },
  subBtnLabelDanger: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: colors.danger },
  pressedDim: { opacity: 0.55 },
});
