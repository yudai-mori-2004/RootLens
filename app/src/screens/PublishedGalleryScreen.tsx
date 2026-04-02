import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Image,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { loadProfile, shortenAddress, syncUserToSupabase, type Profile } from '../store/profileStore';
import { config } from '../config';
import { useAuth } from '../hooks/useAuth';
import type { RootStackParamList, GalleryStackParamList } from '../navigation/types';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';

// 仕様書 §3.3 公開済みギャラリー（ホーム画面）
// - 3列グリッドレイアウト
// - 公開済みコンテンツと、編集途中のドラフトが並ぶ
// - ドラフトにはバッジが表示される
// - コンテンツが0件の場合は、撮影・ギャラリーへの誘導UIを表示する
// デザイン方針: 「ここに写真が並ぶ」空間を想像させる。
//   テキストとCTAは下に寄せ、上部は空けてギャラリー体験を予感させる。

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 3;
const SPACING = 2;
const SCREEN_WIDTH = Dimensions.get('window').width;
const ITEM_SIZE = (SCREEN_WIDTH - SPACING * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

// セルごとにランダムなアクセント色を割り当て、波のように明滅させる
const GHOST_TINTS = [
  colors.accent,     // ネイビー
  '#D97706',         // アンバー（暖色）
  '#0D9488',         // ティール
  colors.accent,
  '#C2410C',         // オレンジ寄り
  '#7C3AED',         // バイオレット
  colors.accent,
  '#0369A1',         // スカイブルー
  '#BE185D',         // ローズ
];

function GhostCell({ index }: { index: number }) {
  const baseOpacity = useRef(new Animated.Value(0.5)).current;
  const tintOpacity = useRef(new Animated.Value(0)).current;
  const tintColor = GHOST_TINTS[index % GHOST_TINTS.length];

  useEffect(() => {
    const delay = index * 150;

    // ベースの明滅
    const baseLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(baseOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(baseOpacity, { toValue: 0.5, duration: 900, useNativeDriver: true }),
      ]),
    );

    // 色付きレイヤーが時々ふわっと現れる
    const tintLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay + 2000 + index * 300),
        Animated.timing(tintOpacity, { toValue: 0.35, duration: 1200, useNativeDriver: true }),
        Animated.timing(tintOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
        Animated.delay(3000),
      ]),
    );

    baseLoop.start();
    tintLoop.start();
    return () => { baseLoop.stop(); tintLoop.stop(); };
  }, [index, baseOpacity, tintOpacity]);

  return (
    <View style={styles.ghostCell}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.ghostCellBase, { opacity: baseOpacity }]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.ghostCellTint, { backgroundColor: tintColor, opacity: tintOpacity }]} />
    </View>
  );
}

function FloatingHeader() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  return (
    <View style={[styles.floatingHeader, { paddingTop: insets.top + spacing.xs }]}>
      <Text style={styles.brandTitle}>RootLens</Text>
      <TouchableOpacity
        onPress={() => navigation.navigate('Settings')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

interface PublishedItem {
  shortId: string;
  thumbnailUrl: string;
  contentCount: number;
  createdAt: string;
}

async function fetchMyPages(address: string): Promise<PublishedItem[]> {
  try {
    const res = await fetch(`${config.serverUrl}/api/v1/pages?address=${address}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default function PublishedGalleryScreen() {
  const navigation = useNavigation<Nav>();
  const { isAuthenticated, address } = useAuth();
  const [contents, setContents] = useState<PublishedItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const loggedIn = isAuthenticated === true && !!address;


  // フォーカスごとに毎回再取得（依存配列なし）
  // Privy hookの値はレンダー時に更新されるが、useFocusEffectの依存配列では
  // React Navigationのスタック間で再レンダーがトリガーされないことがある。
  // 毎回実行して最新状態を反映する。
  useFocusEffect(
    useCallback(() => {
      console.log('[Home] isAuthenticated:', isAuthenticated, 'address:', address);
      loadProfile().then(setProfile);

      if (!isAuthenticated || !address) {
        setContents([]);
        return;
      }

      loadProfile().then((p) => {
        syncUserToSupabase(address, p).catch(() => {});
        fetchMyPages(address)
          .then((items) => {
            console.log('[Home] pages:', items.length);
            setContents(items);
          })
          .catch((e) => {
            console.error('[Home] fetch error:', e);
            setContents([]);
          });
      });
    }, [isAuthenticated, address]),
  );

  if (contents.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <FloatingHeader />
        {/* ゴーストグリッド — 画面全体に広がる背景 */}
        <View style={styles.ghostGrid}>
          {Array.from({ length: 12 }).map((_, i) => (
            <GhostCell key={i} index={i} />
          ))}
        </View>

        {/* 下部カード — グリッドの上に浮くシート */}
        <View style={styles.bottomSheet}>
          <Text style={styles.emptyTitle}>{t('home.emptyTitle')}</Text>
          <Text style={styles.emptyDescription}>
            {t('home.emptyDescription')}
          </Text>

          <View style={styles.ctaGroup}>
            <TouchableOpacity
              style={styles.ctaPrimary}
              onPress={() => navigation.navigate('Camera')}
            >
              <Ionicons name="camera" size={20} color={colors.white} />
              <Text style={styles.ctaPrimaryText}>{t('home.ctaCamera')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ctaSecondary}
              onPress={() => navigation.navigate('Main', { screen: 'DeviceGalleryTab' } as any)}
            >
              <Ionicons name="images-outline" size={20} color={colors.accent} />
              <Text style={styles.ctaSecondaryText}>{t('home.ctaGallery')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const handlePress = (item: PublishedItem) => {
    navigation.navigate('Preview', {
      contentIds: [item.shortId],
      thumbnailUrl: item.thumbnailUrl,
    });
  };

  const profileHeader = loggedIn && profile && (profile.displayName || address) ? (
    <View style={styles.profileSection}>
      <View style={styles.profileTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile.displayName || '?')[0].toUpperCase()}
          </Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{contents.length}</Text>
            <Text style={styles.statLabel}>{t('profile.posts')}</Text>
          </View>
        </View>
      </View>
      {profile.displayName ? (
        <Text style={styles.profileName}>{profile.displayName}</Text>
      ) : null}
      {profile.bio ? (
        <Text style={styles.profileBio}>{profile.bio}</Text>
      ) : null}
      {address ? (
        <TouchableOpacity
          style={styles.addressRow}
          onPress={() => Clipboard.setStringAsync(address)}
        >
          <Text style={styles.profileAddress}>{shortenAddress(address)}</Text>
          <Ionicons name="copy-outline" size={12} color={colors.textHint} />
        </TouchableOpacity>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <FloatingHeader />
      <FlatList
        data={contents}
        numColumns={NUM_COLUMNS}
        keyExtractor={(item) => item.shortId}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={profileHeader}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.gridItem}
            onPress={() => handlePress(item)}
          >
            {item.thumbnailUrl ? (
              <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnail, styles.mockThumb]} />
            )}
            {item.contentCount > 1 && (
              <View style={styles.stackBadge}>
                <Ionicons name="copy-outline" size={14} color={colors.white} />
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  floatingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  // プロフィール (Instagram風)
  profileSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.white,
    fontSize: 26,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  profileName: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  profileBio: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  profileAddress: {
    ...typography.caption,
    color: colors.textHint,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  stackBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    padding: 2,
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
  mockThumb: {
    backgroundColor: colors.surfaceAlt,
  },
  draftBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.overlayDark,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  draftBadgeText: {
    color: colors.white,
    ...typography.small,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  ghostGrid: {
    flex: 1,
    width: SCREEN_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING / 2,
    paddingTop: SPACING / 2,
    alignContent: 'flex-start',
  },
  ghostCell: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: SPACING / 2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  ghostCellBase: {
    backgroundColor: colors.surfaceAlt,
  },
  ghostCellTint: {
    borderRadius: 2,
  },
  bottomSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  emptyDescription: {
    ...typography.body,
    color: colors.textSecondary,
  },
  ctaGroup: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  ctaPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radii.md,
    gap: spacing.sm,
  },
  ctaPrimaryText: {
    color: colors.white,
    ...typography.bodyMedium,
  },
  ctaSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  ctaSecondaryText: {
    color: colors.textPrimary,
    ...typography.bodyMedium,
  },
});
