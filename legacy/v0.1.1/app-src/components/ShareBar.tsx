import React, { useState, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  Modal, Pressable, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';
import { config } from '../config';

// 仕様書 §3.7 共有バー

interface ShareBarProps {
  pageUrl: string;
  shortId: string;
  thumbnailUrl: string;
  onShare: () => void;
  onDelete: () => void;
  navigation: any;
}

export default function ShareBar({
  pageUrl, shortId, thumbnailUrl,
  onShare, onDelete, navigation,
}: ShareBarProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionSaving, setCaptionSaving] = useState(false);

  const handleCopyLink = useCallback(() => {
    Clipboard.setStringAsync(pageUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }, [pageUrl]);

  const handleOpenCaption = () => {
    setMenuOpen(false);
    setCaptionOpen(true);
  };

  const handleSaveCaption = async () => {
    setCaptionSaving(true);
    try {
      const res = await fetch(`${config.serverUrl}/api/v1/pages/${shortId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: captionText }),
      });
      if (!res.ok) throw new Error('save failed');
      setCaptionOpen(false);
      Alert.alert(t('share.captionSaved'));
    } catch {
      Alert.alert(t('share.captionError'));
    } finally {
      setCaptionSaving(false);
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);
    Alert.alert(
      t('menu.deleteConfirm'),
      t('menu.deleteConfirmMessage'),
      [
        { text: t('share.menuCancel'), style: 'cancel' },
        { text: t('share.menuDelete'), style: 'destructive', onPress: onDelete },
      ],
    );
  };

  return (
    <>
      <View style={styles.shareBar}>
        {/* URL chip — タップでコピー */}
        <TouchableOpacity style={styles.urlChip} onPress={handleCopyLink} activeOpacity={0.7}>
          <Ionicons
            name={linkCopied ? 'checkmark' : 'link-outline'}
            size={14}
            color={linkCopied ? colors.success : colors.accent}
          />
          <Text
            style={linkCopied ? styles.urlCopiedText : styles.urlText}
            numberOfLines={1}
          >
            {linkCopied ? t('share.copied') : `rootlens.io/p/${shortId}`}
          </Text>
        </TouchableOpacity>

        {/* SNS pills */}
        <TouchableOpacity
          style={styles.snsPill}
          onPress={() => navigation.navigate('TwitterShare', { pageUrl, shortId, thumbnailUrl })}
        >
          <Text style={styles.snsPillIcon}>𝕏</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.snsPill}
          onPress={() => navigation.navigate('InstagramShare', { pageUrl, shortId, thumbnailUrl })}
        >
          <Ionicons name="logo-instagram" size={18} color={colors.white} />
        </TouchableOpacity>

        {/* ユーティリティ */}
        <TouchableOpacity style={styles.utilButton} onPress={onShare}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Ionicons name="share-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.utilButton} onPress={() => setMenuOpen(true)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* メニュー */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSheet}>
            <TouchableOpacity style={styles.menuItem} onPress={handleOpenCaption}>
              <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('share.menuEditCaption')}</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={[styles.menuItemText, { color: colors.error }]}>{t('share.menuDelete')}</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuItemText}>{t('share.menuCancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* キャプション編集モーダル */}
      <Modal visible={captionOpen} transparent animationType="slide" onRequestClose={() => setCaptionOpen(false)}>
        <KeyboardAvoidingView
          style={styles.captionModalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.menuOverlay} onPress={() => setCaptionOpen(false)} />
          <View style={styles.captionSheet}>
            <View style={styles.captionHeader}>
              <Text style={styles.captionTitle}>{t('share.menuEditCaption')}</Text>
              <TouchableOpacity
                style={styles.captionSaveButton}
                onPress={handleSaveCaption}
                disabled={captionSaving}
              >
                <Text style={[styles.captionSaveText, captionSaving && styles.captionSaveDisabled]}>
                  {t('share.captionSave')}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.captionInput}
              value={captionText}
              onChangeText={setCaptionText}
              placeholder={t('share.captionPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              multiline
              autoFocus
              maxLength={500}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  shareBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accentLight,
    gap: spacing.sm,
  },
  // URL chip
  urlChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    marginRight: spacing.sm,
  },
  urlText: {
    ...typography.captionMedium,
    color: colors.accent,
  },
  urlCopiedText: {
    ...typography.captionMedium,
    color: colors.success,
  },
  // SNS pills
  snsPill: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snsPillIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  // Utility
  utilButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Menu
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: 34,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  menuItemText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginHorizontal: spacing.lg,
  },
  // Caption modal
  captionModalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  captionSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: 34,
  },
  captionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  captionTitle: {
    ...typography.body,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  captionSaveButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  captionSaveText: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.accent,
  },
  captionSaveDisabled: {
    opacity: 0.4,
  },
  captionInput: {
    ...typography.body,
    color: colors.textPrimary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
