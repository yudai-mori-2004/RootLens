// アップロード同意ポップ (= マイビデオのカードタップで開く単一画面)。
//
// 左に動画プレビュー (= 何に同意するのかを見ながらチェックできる)、 右に個別チェック 3 つと
// 「同意してアップロード」。 ボタン 1 つで同意イベントの記録 → アップロード開始までを行い、
// 確認だけの二段目は置かない。 同意の記録が成功するまではアップロードを開始しない
// (= 証跡なしの同意を作らない)。 文言を変えたら services/consent.ts の
// UPLOAD_CONSENT_SUMMARY_VERSION を必ず上げる。
//
// 動画枠は 4:3 固定 (= 現行の録画アスペクト)。 読み込み前後でポップの寸法が変わらない。
// 旧 16:9 クリップは枠内 letterbox になる。

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
import { LegalDocBody } from './LegalDocModal';
import { getLegalDoc } from '../content/legalDocs.generated';
import { recordUploadConsent, type UploadConsentChecks } from '../services/consent';
import { useLocale, useT } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
  /** 同意記録の成功後に呼ぶ。 署名 → R2 → 登録 を開始する (再試行も同じ)。 */
  onUpload: (clip: Clip) => void;
  onRemove: (clip: Clip) => void;
}

const INITIAL_CHECKS: UploadConsentChecks = {
  age_and_right: false,
  no_third_party: false,
  terms_agreed: false,
};

export const ClipPreviewModal: React.FC<Props> = ({ visible, clip, onClose, onUpload, onRemove }) => {
  const t = useT();
  const locale = useLocale();
  const [checks, setChecks] = useState<UploadConsentChecks>(INITIAL_CHECKS);
  const [sending, setSending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);

  // 開くたび / 対象が変わるたびに最初からやり直す (= 動画ごとに同意してもらう)
  useEffect(() => {
    setChecks(INITIAL_CHECKS);
    setSending(false);
    setConsentError(null);
    setShowTerms(false);
  }, [visible, clip?.id]);

  if (!clip) return null;
  const uri = localVideoUri(clip);
  const dur = formatDuration(clip.durationMs);
  const allChecked = checks.age_and_right && checks.no_third_party && checks.terms_agreed;

  const toggle = (key: keyof UploadConsentChecks) =>
    setChecks((c) => ({ ...c, [key]: !c[key] }));

  const onConsentAndUpload = async () => {
    if (!allChecked || sending) return;
    setSending(true);
    setConsentError(null);
    try {
      // 同意イベントをサーバに記録 (= append-only の証跡)。 成功したときだけアップロードを開始する。
      await recordUploadConsent({
        checks,
        clipLocalId: clip.id,
        clipCreatedAt: clip.createdAt,
        recordingConfig: clip.recordingConfigId,
      });
      onUpload(clip); // モーダルは閉じ、 進捗はカード側で見せる
    } catch {
      setConsentError(t('upload.consentError'));
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
          {/* ── 左: 動画プレビュー (= 黒ステージの中に 4:3 固定枠を中央配置。 読み込み前後で
              寸法が変わらず、 右カラムが縦に伸びても隙間が地の色にならない) ── */}
          <View style={styles.videoPane}>
            <View style={styles.videoBox}>
            {uri ? (
              <Video
                source={{ uri }}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay={!showTerms}
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
          </View>

          {/* ── 右: 同意チェック + アクション ── */}
          <View style={styles.side}>
            <Text style={styles.eyebrow}>{t('upload.consentTitle')}</Text>
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

            <View style={styles.checks}>
              <CheckRow
                checked={checks.age_and_right}
                label={t('upload.consentCheckAge')}
                onPress={() => toggle('age_and_right')}
              />
              <CheckRow
                checked={checks.no_third_party}
                label={t('upload.consentCheckNoThirdParty')}
                onPress={() => toggle('no_third_party')}
              />
              <CheckRow
                checked={checks.terms_agreed}
                label={t('upload.consentCheckTerms')}
                onPress={() => toggle('terms_agreed')}
              />
              {/* 全文リンクは規約チェックの直下 (= 意味的に紐づく位置。 アップロードボタンから離して誤タップを防ぐ) */}
              <Pressable onPress={() => setShowTerms(true)} style={({ pressed }) => [styles.readFull, pressed && styles.pressedDim]} hitSlop={6}>
                <Text style={styles.readFullLabel}>{t('upload.consentReadFull')}</Text>
                <Svg width={12} height={12} viewBox="0 0 12 12">
                  <Path d="M4 2.5 L8 6 L4 9.5" stroke={colors.emerald} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </Svg>
              </Pressable>
            </View>

            <View style={styles.spacer} />

            {consentError ? <Text style={styles.consentErrorText}>{consentError}</Text> : null}

            <Pressable
              onPress={onConsentAndUpload}
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
                <Text style={styles.primaryBtnLabel}>{t('upload.consentAndUpload')}</Text>
              )}
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

          {/* 利用規約 全文 (= 同意はこの全文に対して成立する)。 別シートに出すと横持ちで
              ノッチにはみ出るので、 同じポップの中に重ねて表示する (= 寸法もそのまま)。 */}
          {showTerms ? (
            <View style={styles.termsOverlay}>
              <View style={styles.termsHeader}>
                <Text style={styles.termsTitle} numberOfLines={1}>
                  {getLegalDoc(locale, 'terms-of-service').title}
                </Text>
                <Pressable
                  onPress={() => setShowTerms(false)}
                  hitSlop={10}
                  style={({ pressed }) => [styles.termsCloseBtn, pressed && styles.pressedDim]}
                >
                  <Svg width={14} height={14} viewBox="0 0 14 14">
                    <Path d="M3 3 L11 11 M11 3 L3 11" stroke={colors.ink} strokeWidth={1.7} strokeLinecap="round" fill="none" />
                  </Svg>
                </Pressable>
              </View>
              <LegalDocBody doc="terms-of-service" />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

// ─── チェック行 ─────────────────────────────────────────────────────────

const CheckRow: React.FC<{
  checked: boolean;
  label: string;
  onPress: () => void;
}> = ({ checked, label, onPress }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.checkRow, pressed && styles.pressedDim]} hitSlop={4}>
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? (
        <Svg width={12} height={12} viewBox="0 0 13 13">
          <Path d="M2.5 7 L5.3 9.8 L10.5 3.8" stroke="#131519" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      ) : null}
    </View>
    <Text style={styles.checkLabel}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 8, 0.6)',
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
    width: '92%',
    maxWidth: 860,
    ...shadows.pop,
  },

  // 黒ステージ (= 右カラムの高さいっぱい) の中に 4:3 固定枠を中央配置。
  videoPane: {
    flex: 52,
    alignSelf: 'stretch',
    backgroundColor: '#0B0D11',
    justifyContent: 'center',
  },
  videoBox: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  video: { width: '100%', height: '100%' },
  videoMissing: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  side: {
    flex: 48,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    alignSelf: 'stretch',
  },
  eyebrow: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
    marginBottom: 6,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  meta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMute,
    marginTop: 2,
  },
  errorNote: {
    ...typography.caption,
    fontSize: 12,
    color: colors.danger,
    marginTop: 6,
  },

  checks: { marginTop: spacing.lg, gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  checkLabel: {
    ...typography.caption,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textBody,
    flex: 1,
  },

  readFull: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 30, // チェックボックス幅 + gap (= 規約チェックの文言に揃えてぶら下げる)
  },
  readFullLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12.5,
    color: colors.emerald,
  },

  spacer: { flex: 1, minHeight: spacing.lg },

  // 規約全文のポップ内オーバーレイ (= シートと同寸に重ねる)
  termsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
  },
  termsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  termsTitle: {
    flex: 1,
    fontFamily: fonts.serifMedium,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  termsCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },

  consentErrorText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.danger,
    marginBottom: 8,
  },

  primaryBtn: {
    borderRadius: radii.full,
    backgroundColor: colors.emerald,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: '#131519',
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 14,
  },
  subBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  subDivider: { width: 1, height: 14, backgroundColor: colors.border },
  subBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.textMute,
  },
  subBtnLabelDanger: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.danger,
  },
  pressedDim: { opacity: 0.55 },
});
