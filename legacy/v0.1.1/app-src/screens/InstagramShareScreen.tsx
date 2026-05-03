import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';
import { loadSnsShareSettings, saveSnsShareSettings } from '../store/snsShareStore';
import SnsShareBadge from '../components/SnsShareBadge';
import ShareTextBox from '../components/ShareTextBox';
import CropPreview, { type CropRegion } from '../components/CropPreview';
import ImageExportCanvas, { type ImageExportHandle } from '../components/ImageExportCanvas';

// 仕様書 §3.7.1 Instagram シェア — 投稿(1:1) / ストーリー(9:16)

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'InstagramShare'>;
type Tab = 'post' | 'story';
type BadgeSize = 'S' | 'M' | 'L';

const TABS: { key: Tab; crop: { width: number; height: number }; aspectRatio: number }[] = [
  { key: 'post',  crop: { width: 1080, height: 1080 }, aspectRatio: 1 },
  { key: 'story', crop: { width: 1080, height: 1920 }, aspectRatio: 9 / 16 },
];

const BADGE_SCALES: { key: BadgeSize; scale: number }[] = [
  { key: 'S', scale: 0.65 }, { key: 'M', scale: 1.0 }, { key: 'L', scale: 1.35 },
];

const SCREEN_WIDTH = Dimensions.get('window').width;
const CROP_CHROME = (2 + 8) * 2;

function fitFrame(areaW: number, areaH: number, ar: number) {
  const maxW = areaW - CROP_CHROME, maxH = areaH - CROP_CHROME;
  const bw = { w: maxW, h: maxW / ar };
  return bw.h <= maxH ? bw : { w: maxH * ar, h: maxH };
}

export default function InstagramShareScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { pageUrl, thumbnailUrl } = route.params;

  const [tab, setTab] = useState<Tab>('post');
  const [showWatermark, setShowWatermark] = useState(true);
  const [badgeSize, setBadgeSize] = useState<BadgeSize>('M');
  const [username, setUsername] = useState('');
  const [editingUsername, setEditingUsername] = useState(false);
  const [cropAreaSize, setCropAreaSize] = useState({ w: SCREEN_WIDTH, h: 300 });
  const [busy, setBusy] = useState(false);
  const cropRegionRef = useRef<CropRegion | undefined>(undefined);
  const exportRef = useRef<ImageExportHandle>(null);

  const tabDef = TABS.find(tb => tb.key === tab)!;
  const badgeScale = BADGE_SCALES.find(b => b.key === badgeSize)!.scale;
  const frame = fitFrame(cropAreaSize.w, cropAreaSize.h, tabDef.aspectRatio);

  useEffect(() => {
    loadSnsShareSettings().then((s) => {
      setShowWatermark(s.showWatermark);
      if (s.instagramUsername) setUsername(s.instagramUsername);
    });
  }, []);

  const compositeImage = useCallback(async () => {
    if (!exportRef.current) throw new Error('Export canvas not mounted');
    return exportRef.current.doExport({
      sourceUrl: thumbnailUrl,
      width: tabDef.crop.width, height: tabDef.crop.height,
      cropRegion: cropRegionRef.current,
      badge: showWatermark
        ? { icon: 'qr', qrValue: pageUrl, username, badgeScale }
        : null,
    });
  }, [thumbnailUrl, tabDef, showWatermark, pageUrl, username, badgeScale]);

  const handleShare = async () => {
    setBusy(true);
    try {
      await Clipboard.setStringAsync(`${pageUrl}\n${t('share.defaultCta')}`);
      const filePath = await compositeImage();
      await Sharing.shareAsync(filePath, { mimeType: 'image/jpeg', UTI: 'public.jpeg' });
    } catch (e) {
      Alert.alert(t('common.error'), String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateUsername = useCallback((v: string) => {
    const clean = v.replace(/^@/, '');
    setUsername(clean);
    loadSnsShareSettings().then((s) => saveSnsShareSettings({ ...s, instagramUsername: clean }));
  }, []);

  const finishEditUsername = useCallback(() => {
    setUsername((u) => u.trim());
    setEditingUsername(false);
  }, []);

  const toggleWatermark = useCallback(() => {
    setShowWatermark((prev) => {
      const next = !prev;
      loadSnsShareSettings().then((s) => saveSnsShareSettings({ ...s, showWatermark: next }));
      return next;
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ImageExportCanvas ref={exportRef} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('share.instagram')}</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.tabBar}>
        {TABS.map(({ key }) => (
          <TouchableOpacity key={key} style={styles.tab} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {key === 'post' ? t('share.post') : t('share.story')}
            </Text>
            {tab === key && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.cropArea}
        onLayout={(e) => setCropAreaSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <CropPreview
          imageUri={thumbnailUrl}
          aspectRatio={tabDef.aspectRatio}
          frameWidth={frame.w}
          onCropChange={(r) => { cropRegionRef.current = r; }}
          badgeScale={badgeScale}
          badge={showWatermark ? <SnsShareBadge icon="qr" qrValue={pageUrl} username={username} /> : undefined}
        />
      </View>

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <TouchableOpacity style={styles.toggleRow} onPress={toggleWatermark}>
            <Ionicons name={showWatermark ? 'checkbox' : 'square-outline'} size={22}
              color={showWatermark ? colors.accent : colors.textHint} />
            <Text style={styles.toggleLabel}>{t('share.showWatermark')}</Text>
          </TouchableOpacity>
          {showWatermark && (
            <View style={styles.sizeSelector}>
              {BADGE_SCALES.map(({ key }) => (
                <TouchableOpacity key={key}
                  style={[styles.sizeButton, badgeSize === key && styles.sizeButtonActive]}
                  onPress={() => setBadgeSize(key)}>
                  <Text style={[styles.sizeText, badgeSize === key && styles.sizeTextActive]}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        <View style={[styles.usernameRow, !showWatermark && styles.dimmed]}
          pointerEvents={showWatermark ? 'auto' : 'none'}>
          <Ionicons name="logo-instagram" size={18} color={colors.textSecondary} />
          {editingUsername ? (
            <TextInput style={styles.usernameInput} placeholder="username"
              placeholderTextColor={colors.textHint} value={username}
              onChangeText={updateUsername}
              onBlur={finishEditUsername} onSubmitEditing={finishEditUsername}
              autoCapitalize="none" autoCorrect={false} returnKeyType="done" autoFocus />
          ) : (
            <TouchableOpacity style={styles.usernameDisplay} onPress={() => setEditingUsername(true)}>
              <Text style={username ? styles.usernameText : styles.usernamePlaceholder}>
                {username || 'username'}
              </Text>
              <Ionicons name="pencil" size={16} color={colors.textHint} />
            </TouchableOpacity>
          )}
        </View>
        <ShareTextBox text={pageUrl} />
      </View>

      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.shareButton, busy && styles.busy]} onPress={handleShare} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.shareButtonText}>{t('share.action')}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, height: 52,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  tabBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.lg, height: 44,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: { paddingHorizontal: spacing.lg, paddingBottom: 10, position: 'relative' },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textHint, letterSpacing: 0.5 },
  tabTextActive: { color: colors.textPrimary },
  tabIndicator: {
    position: 'absolute', bottom: -1, left: spacing.lg, right: spacing.lg,
    height: 2, backgroundColor: colors.textPrimary, borderRadius: 1,
  },
  cropArea: {
    flex: 1, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.md,
  },
  controls: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 0, gap: 10,
  },
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleLabel: { ...typography.body, color: colors.textPrimary },
  sizeSelector: { flexDirection: 'row', backgroundColor: '#EEEEEE', borderRadius: radii.sm, padding: 2 },
  sizeButton: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 5 },
  sizeButtonActive: { backgroundColor: colors.accent },
  sizeText: { fontSize: 12, fontWeight: '600', color: colors.textHint },
  sizeTextActive: { fontSize: 12, fontWeight: '700', color: colors.white },
  usernameRow: { flexDirection: 'row', alignItems: 'center', height: 40, gap: spacing.sm },
  usernameDisplay: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  usernameText: { flex: 1, ...typography.body, color: colors.textPrimary },
  usernamePlaceholder: { flex: 1, ...typography.body, color: colors.textHint },
  usernameInput: {
    flex: 1, ...typography.body, color: colors.textPrimary,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.accent,
  },
  dimmed: { opacity: 0.4 },
  actionBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  shareButton: {
    height: 52, borderRadius: radii.md, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  busy: { opacity: 0.7 },
  shareButtonText: { fontSize: 16, fontWeight: '600', color: colors.white, letterSpacing: 0.3 },
});
