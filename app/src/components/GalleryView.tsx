import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Image,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useC2paCache, isTrustedAsset, getSignerLabel } from '../hooks/useC2paCache';
import { colors, typography, spacing, radii, shadows } from '../theme';
import { t } from '../i18n';

// 仕様書 §3.5 コンテンツ選択
// カメラギャラリーと端末ギャラリーの共通コンポーネント
// - C2PA署名付き → 選択可能、バッジ表示
// - C2PA署名なし → グレーアウト
// - 複数選択対応

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 3;
const SPACING = 2;
const SCREEN_WIDTH = Dimensions.get('window').width;
const ITEM_SIZE = (SCREEN_WIDTH - SPACING * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

interface GalleryViewProps {
  /** 閉じるボタンのコールバック。指定時のみ表示 */
  onClose?: () => void;
}

export default function GalleryView({ onClose }: GalleryViewProps) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = MediaLibrary.usePermissions();
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  const c2paStatus = useC2paCache(assets);

  const loadAssets = useCallback(
    async (after?: string) => {
      if (!permission?.granted) return;
      const result = await MediaLibrary.getAssetsAsync({
        first: 60,
        after,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.modificationTime],
      });
      if (after) {
        setAssets((prev) => [...prev, ...result.assets]);
      } else {
        setAssets(result.assets);
      }
      setEndCursor(result.endCursor);
      setHasMore(result.hasNextPage);
      setLoading(false);
    },
    [permission?.granted],
  );

  useFocusEffect(
    useCallback(() => {
      if (permission?.granted) {
        setLoading(true);
        setSelected([]);
        loadAssets();
      }
    }, [permission?.granted, loadAssets]),
  );

  const toggleSelect = (assetId: string) => {
    setSelected((prev) => {
      if (prev.includes(assetId)) {
        return prev.filter((id) => id !== assetId);
      }
      return [...prev, assetId];
    });
  };

  const handleShare = () => {
    const selectedAssets = selected
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is MediaLibrary.Asset => a != null);
    // v0.1.1: EditScreen 撤去 — カメラロール選択は Registration に直結。
    // 選択ファイルが既に C2PA 署名済みかどうかの判定は Task 05 で扱う (Registration 側)。
    const uris = selectedAssets.map((a) => a.uri);
    if (uris.length > 0) {
      navigation.navigate('Registration', { signedUris: uris });
      setSelected([]);
    }
  };

  const handleLoadMore = () => {
    if (hasMore && endCursor) {
      loadAssets(endCursor);
    }
  };

  // パーミッション未取得
  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        {onClose && (
          <TouchableOpacity style={[styles.closeBtn, { position: 'absolute', top: insets.top + 8, left: 12 }]} onPress={onClose}>
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <Ionicons name="images-outline" size={64} color={colors.textDisabled} />
        <Text style={styles.permissionText}>
          {t('gallery.permissionMessage')}
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>{t('gallery.permissionButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* モーダル時のみ閉じるボタン */}
      {onClose && (
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={assets}
        numColumns={NUM_COLUMNS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.grid}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => {
          const selectionIndex = selected.indexOf(item.id);
          const isSelected = selectionIndex >= 0;
          const trusted = isTrustedAsset(c2paStatus, item.id);
          const selectable = trusted === true;
          const checking = trusted === null;
          const signerLabel = selectable ? getSignerLabel(c2paStatus, item.id) : null;

          return (
            <TouchableOpacity
              style={styles.gridItem}
              onPress={() => selectable && toggleSelect(item.id)}
              activeOpacity={selectable ? 0.7 : 1}
              disabled={!selectable}
            >
              <Image source={{ uri: item.uri }} style={styles.thumbnail} />
              {/* 動画バッジ */}
              {item.mediaType === 'video' && (
                <View style={styles.videoBadge}>
                  <Ionicons name="videocam" size={11} color={colors.white} />
                  {item.duration > 0 && (
                    <Text style={styles.videoDuration}>
                      {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}
                    </Text>
                  )}
                </View>
              )}
              {/* 非選択可能: グレーアウト */}
              {!selectable && !checking && (
                <View style={styles.greyOverlay} />
              )}
              {/* チェック中 */}
              {checking && (
                <View style={styles.checkingOverlay}>
                  <ActivityIndicator size="small" color={colors.white} />
                </View>
              )}
              {/* 本物証明バッジ（§3.1.2: C2PA → 本物証明） + 署名者ラベル */}
              {selectable && (
                <View style={styles.c2paBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.white} />
                  {signerLabel && <Text style={styles.c2paBadgeText}>{signerLabel}</Text>}
                </View>
              )}
              {/* 選択インジケーター */}
              {selectable && (
                <View
                  style={[
                    styles.selectIndicator,
                    isSelected && styles.selectIndicatorActive,
                  ]}
                >
                  {isSelected && (
                    <Text style={styles.selectNumber}>{selectionIndex + 1}</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* フローティングCTA（選択時に下部表示） */}
      {selected.length > 0 && (
        <View style={[styles.floatingCta, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.floatingRow}>
            <Text style={styles.floatingCount}>
              {t('gallery.selectedCount', { count: selected.length })}
            </Text>
            <TouchableOpacity onPress={() => setSelected([])}>
              <Text style={styles.floatingClear}>{t('editTool.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.floatingButton} onPress={handleShare}>
            <Text style={styles.floatingButtonText}>{t('gallery.shareButton')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    padding: SPACING,
  },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: SPACING / 2,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
  },
  selectIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.overlayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectIndicatorActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  selectNumber: {
    color: colors.white,
    ...typography.small,
    fontWeight: '700',
  },
  greyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayMedium,
    borderRadius: 2,
  },
  checkingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayLight,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.overlayDark,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  videoDuration: {
    color: colors.white,
    ...typography.small,
    fontVariant: ['tabular-nums'],
  },
  c2paBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  c2paBadgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '700',
  },
  permissionText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  permissionButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.md,
  },
  permissionButtonText: {
    color: colors.white,
    ...typography.title,
  },
  // フローティングCTA
  floatingCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
    ...shadows.md,
  },
  floatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  floatingCount: {
    ...typography.captionMedium,
    color: colors.textPrimary,
  },
  floatingClear: {
    ...typography.captionMedium,
    color: colors.textHint,
  },
  floatingButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radii.md,
  },
  floatingButtonText: {
    color: colors.white,
    ...typography.title,
  },
});
