// Mentra がアップロード済みの映像を iPhone で確認し、同意をクリップへ結び付ける画面。
// 動画は R2 からストリーミングし、同意後も同じ content_hash のサーバ行を使い続ける。

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import Svg, { Path } from 'react-native-svg';

import { ClipApiError, fetchClipMediaUrl, type ServerClipStatus } from '../dataflow';
import { getLegalDoc } from '../content/legalDocs.generated';
import { useUploadedClipFrame } from '../services/clipFrames';
import type { UploadConsentChecks } from '../services/consent';
import { useLocale, useT } from '../i18n';
import { formatCardDate, formatCardTime, formatDuration } from './ClipCard';
import { LegalDocBody } from './LegalDocModal';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: ServerClipStatus | null;
  onClose: () => void;
  onConsent: (clip: ServerClipStatus, checks: UploadConsentChecks) => Promise<void>;
  onDelete: (clip: ServerClipStatus) => Promise<void>;
}

const INITIAL_CHECKS: UploadConsentChecks = {
  location_permission: false,
  no_third_party: false,
  terms_agreed: false,
};

export const GlassesClipReviewModal: React.FC<Props> = ({ visible, clip, onClose, onConsent, onDelete }) => {
  const t = useT();
  const locale = useLocale();
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<null | ClipApiError['kind']>(null);
  const [checks, setChecks] = useState<UploadConsentChecks>(INITIAL_CHECKS);
  const [sending, setSending] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const frame = useUploadedClipFrame(
    clip ? clip.contentHash : null,
    clip ? clip.contentHash : null,
  );
  const poster: ImageSourcePropType | undefined = frame ? { uri: frame } : undefined;

  useEffect(() => {
    setMediaUrl(null);
    setMediaError(null);
    setChecks(INITIAL_CHECKS);
    setSending(false);
    setConsentError(false);
    setShowTerms(false);
    setDeleting(false);
    setDeleteError(false);
    if (!visible || !clip) return;

    let cancelled = false;
    void fetchClipMediaUrl(clip.contentHash)
      .then((url) => { if (!cancelled) setMediaUrl(url); })
      .catch((e) => {
        if (!cancelled) setMediaError(e instanceof ClipApiError ? e.kind : 'server');
      });
    return () => { cancelled = true; };
  }, [visible, clip?.contentHash]);

  if (!clip) return null;

  const createdMs = clip.createdAt ? new Date(clip.createdAt).getTime() : Date.now();
  const duration = formatDuration(clip.durationMs);
  const allChecked = checks.location_permission && checks.no_third_party && checks.terms_agreed;
  const toggle = (key: keyof UploadConsentChecks) => {
    setChecks((current) => ({ ...current, [key]: !current[key] }));
  };
  const confirm = async () => {
    if (!allChecked || sending) return;
    setSending(true);
    setConsentError(false);
    try {
      await onConsent(clip, checks);
    } catch {
      setSending(false);
      setConsentError(true);
    }
  };
  const remove = async () => {
    if (deleting || sending) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDelete(clip);
    } catch {
      setDeleting(false);
      setDeleteError(true);
    }
  };
  const requestDelete = () => {
    Alert.alert(
      t('serverDelete.title'),
      t('serverDelete.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('serverDelete.confirm'), style: 'destructive', onPress: () => void remove() },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['landscape']}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.videoPane}>
            <View style={styles.videoBox}>
              {mediaUrl ? (
                <Video
                  source={{ uri: mediaUrl }}
                  style={styles.video}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  shouldPlay={!showTerms}
                  isLooping
                />
              ) : (
                <View style={styles.videoPlaceholder}>
                  {poster ? <Image source={poster} style={styles.videoPoster} resizeMode="cover" /> : null}
                  <View style={styles.videoOverlay}>
                    {mediaError ? (
                      <Text style={styles.videoErrorText}>
                        {t(
                          mediaError === 'not-found'
                            ? 'history.videoNotFound'
                            : mediaError === 'unauthorized'
                              ? 'history.videoUnauthorized'
                              : mediaError === 'network'
                                ? 'history.videoNetwork'
                                : 'history.videoServer',
                        )}
                      </Text>
                    ) : (
                      <ActivityIndicator color={colors.paper} />
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.side}>
            <Text style={styles.eyebrow}>{t('glassesReview.consentTitle')}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {formatCardDate(createdMs)} {formatCardTime(createdMs)}
            </Text>
            <Text style={styles.meta}>{duration ?? ''}</Text>

            <View style={styles.checks}>
              <CheckRow
                checked={checks.location_permission}
                label={t('upload.consentCheckLocation')}
                onPress={() => toggle('location_permission')}
              />
              <CheckRow
                checked={checks.no_third_party}
                label={t('upload.consentCheckNoThirdParty')}
                onPress={() => toggle('no_third_party')}
              />
              <CheckRow
                checked={checks.terms_agreed}
                label={(
                  <>
                    {t('upload.consentCheckTermsPrefix')}
                    <Text style={styles.termsLink} onPress={() => setShowTerms(true)}>
                      {t('upload.consentCheckTermsLink')}
                    </Text>
                    {t('upload.consentCheckTermsSuffix')}
                  </>
                )}
                onPress={() => toggle('terms_agreed')}
              />
            </View>

            <View style={styles.spacer} />
            {consentError ? (
              <Text style={styles.consentErrorText}>{t('glassesReview.consentError')}</Text>
            ) : null}
            {deleteError ? <Text style={styles.deleteErrorText}>{t('serverDelete.error')}</Text> : null}
            <Pressable
              onPress={() => void confirm()}
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
                  <Text style={styles.primaryBtnLabel}>{t('glassesReview.consentSending')}</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnLabel}>{t('glassesReview.consentConfirm')}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={requestDelete}
              disabled={deleting || sending}
              style={({ pressed }) => [
                styles.deleteBtn,
                (deleting || sending) && styles.primaryBtnDisabled,
                pressed && !deleting && !sending && styles.pressedDim,
              ]}
            >
              {deleting ? (
                <View style={styles.btnRow}>
                  <ActivityIndicator size="small" color={colors.danger} />
                  <Text style={styles.deleteBtnLabel}>{t('serverDelete.deleting')}</Text>
                </View>
              ) : (
                <Text style={styles.deleteBtnLabel}>{t('common.delete')}</Text>
              )}
            </Pressable>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedDim]}>
              <Text style={styles.closeBtnLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>

          {showTerms ? (
            <View style={styles.termsOverlay}>
              <View style={styles.termsHeader}>
                <Text style={styles.termsTitle} numberOfLines={1}>
                  {getLegalDoc(locale, 'terms-of-service').title}
                </Text>
                <Pressable onPress={() => setShowTerms(false)} hitSlop={10} style={styles.termsCloseBtn}>
                  <Svg width={14} height={14} viewBox="0 0 14 14">
                    <Path d="M3 3 L11 11 M11 3 L3 11" stroke={colors.ink} strokeWidth={1.7} strokeLinecap="round" />
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

const CheckRow: React.FC<{
  checked: boolean;
  label: React.ReactNode;
  onPress: () => void;
}> = ({ checked, label, onPress }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.checkRow, pressed && styles.pressedDim]} hitSlop={4}>
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? (
        <Svg width={12} height={12} viewBox="0 0 13 13">
          <Path d="M2.5 7 L5.3 9.8 L10.5 3.8" stroke="#131519" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
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
  videoPane: { flex: 52, alignSelf: 'stretch', backgroundColor: '#0B0D11', justifyContent: 'center' },
  videoBox: { width: '100%', aspectRatio: 16 / 9 },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1 },
  videoPoster: { ...StyleSheet.absoluteFillObject, opacity: 0.45 },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  videoErrorText: { ...typography.caption, color: colors.paper, textAlign: 'center' },
  side: { flex: 48, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignSelf: 'stretch' },
  eyebrow: { ...typography.labelSmall, color: colors.accentDeep, marginBottom: 6 },
  title: { fontFamily: fonts.serifMedium, fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: colors.ink },
  meta: { ...typography.caption, fontSize: 12, color: colors.textMute, marginTop: 2 },
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
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkLabel: { ...typography.caption, fontSize: 12.5, lineHeight: 18, color: colors.textBody, flex: 1 },
  termsLink: { color: colors.ink, textDecorationLine: 'underline', fontFamily: fonts.sansSemibold },
  spacer: { flex: 1, minHeight: spacing.md },
  consentErrorText: { ...typography.caption, fontSize: 11.5, color: colors.danger, marginBottom: spacing.sm },
  deleteErrorText: { ...typography.caption, fontSize: 11.5, color: colors.danger, marginBottom: spacing.sm },
  primaryBtn: {
    borderRadius: radii.full,
    backgroundColor: colors.ink,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.32 },
  primaryBtnPressed: { opacity: 0.78 },
  primaryBtnLabel: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.textOnInk },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deleteBtn: {
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  deleteBtnLabel: { ...typography.captionMedium, color: colors.danger },
  closeBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 3 },
  closeBtnLabel: { ...typography.captionMedium, color: colors.textMute },
  pressedDim: { opacity: 0.55 },
  termsOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.paper, padding: spacing.lg },
  termsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  termsTitle: { fontFamily: fonts.serifMedium, fontSize: 18, color: colors.ink, flex: 1 },
  termsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
