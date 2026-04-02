import React, { useState, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  Modal, Pressable, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';

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

  const handleCopyLink = useCallback(() => {
    Clipboard.setStringAsync(pageUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }, [pageUrl]);

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
});
