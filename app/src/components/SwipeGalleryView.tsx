import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  FlatList,
  ViewToken,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Zoomable } from '@likashefqet/react-native-image-zoom';
import * as MediaLibrary from 'expo-media-library';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useC2paCache, isTrustedAsset } from '../hooks/useC2paCache';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';
import VideoSeekBar from './VideoSeekBar';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const { width: W, height: H } = Dimensions.get('window');

interface Props { onClose: () => void }

export default function SwipeGalleryView({ onClose }: Props) {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = MediaLibrary.usePermissions();
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const listRef = useRef<FlatList>(null);
  const c2pa = useC2paCache(assets);
  const contentH = H - insets.top - 52;

  const loadAssets = useCallback(async (after?: string) => {
    if (!permission?.granted) return;
    const r = await MediaLibrary.getAssetsAsync({
      first: 60, after,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [MediaLibrary.SortBy.modificationTime],
    });
    setAssets(prev => after ? [...prev, ...r.assets] : r.assets);
    setEndCursor(r.endCursor);
    setHasMore(r.hasNextPage);
    setLoading(false);
  }, [permission?.granted]);

  useFocusEffect(useCallback(() => {
    if (permission?.granted) { setLoading(true); setSelected([]); setIndex(0); loadAssets(); }
  }, [permission?.granted, loadAssets]));

  useEffect(() => {
    if (assets.length > 0 && index >= assets.length - 5 && hasMore && endCursor) loadAssets(endCursor);
  }, [index, assets.length, hasMore, endCursor, loadAssets]);

  const onViewChanged = useRef((info: { viewableItems: ViewToken[] }) => {
    if (info.viewableItems.length > 0 && info.viewableItems[0].index != null)
      setIndex(info.viewableItems[0].index);
  }).current;
  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const toggleSelect = useCallback((id: string) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]), []);
  const handleShare = useCallback(() => {
    // v0.1.1: EditScreen 撤去 — カメラロール選択は Registration へ直結。
    const uris = selected
      .map(id => assets.find(a => a.id === id))
      .filter((a): a is MediaLibrary.Asset => !!a)
      .map(a => a.uri);
    if (uris.length > 0) { nav.navigate('Registration', { signedUris: uris }); setSelected([]); }
  }, [selected, assets, nav]);

  const indexRef = useRef(index);
  indexRef.current = index;

  const renderItem = useCallback(({ item, index: i }: { item: MediaLibrary.Asset; index: number }) => (
    <Slide item={item} width={W} height={contentH} isCurrent={i === indexRef.current} setScrollEnabled={setScrollEnabled} />
  ), [contentH]);
  const getItemLayout = useCallback((_: any, i: number) => ({ length: W, offset: W * i, index: i }), []);

  if (!permission) return <View style={st.bg} />;
  if (!permission.granted) return (
    <View style={[st.center, { paddingTop: insets.top }]}>
      <TouchableOpacity style={{ position: 'absolute', top: insets.top + 8, left: 12 }} onPress={onClose}>
        <Ionicons name="close" size={28} color={colors.textPrimary} />
      </TouchableOpacity>
      <Ionicons name="images-outline" size={64} color={colors.textDisabled} />
      <Text style={st.permText}>{t('gallery.permissionMessage')}</Text>
      <TouchableOpacity style={st.permBtn} onPress={requestPermission}><Text style={st.permBtnText}>{t('gallery.permissionButton')}</Text></TouchableOpacity>
    </View>
  );
  if (loading) return <View style={[st.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.accent} /></View>;

  const asset = assets[index];
  const selectable = asset ? isTrustedAsset(c2pa, asset.id) === true : false;
  const selIdx = asset ? selected.indexOf(asset.id) : -1;

  return (
    <GestureHandlerRootView style={[st.bg, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={28} color={colors.darkText} /></TouchableOpacity>
        <Text style={st.counter}>{assets.length > 0 ? `${index + 1} / ${assets.length}` : ''}</Text>
        {selectable && asset ? (
          <TouchableOpacity style={[st.sel, selIdx >= 0 && st.selActive]} onPress={() => toggleSelect(asset.id)}>
            {selIdx >= 0 && <Text style={st.selNum}>{selIdx + 1}</Text>}
          </TouchableOpacity>
        ) : <View style={{ width: 32 }} />}
      </View>

      <FlatList
        ref={listRef} data={assets} horizontal pagingEnabled decelerationRate="fast"
        showsHorizontalScrollIndicator={false} keyExtractor={item => item.id}
        renderItem={renderItem} getItemLayout={getItemLayout}
        onViewableItemsChanged={onViewChanged} viewabilityConfig={viewConfig}
        onEndReached={() => { if (hasMore && endCursor) loadAssets(endCursor); }}
        onEndReachedThreshold={3}
        windowSize={3} maxToRenderPerBatch={2} initialNumToRender={1} removeClippedSubviews
        scrollEnabled={scrollEnabled} overScrollMode="never" bounces={false}
      />

      {selected.length > 0 && (
        <View style={[st.cta, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.ctaRow}>
            <Text style={st.ctaCount}>{t('gallery.selectedCount', { count: selected.length })}</Text>
            <TouchableOpacity onPress={() => setSelected([])}><Text style={st.ctaClear}>{t('editTool.cancel')}</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={st.ctaBtn} onPress={handleShare}><Text style={st.ctaBtnText}>{t('gallery.shareButton')}</Text></TouchableOpacity>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

// ==================== Slide ====================
const Slide = React.memo(function Slide({
  item, width, height, isCurrent, setScrollEnabled,
}: {
  item: MediaLibrary.Asset; width: number; height: number; isCurrent: boolean;
  setScrollEnabled: (v: boolean) => void;
}) {
  if (item.mediaType === 'video') {
    return <VideoSlide item={item} width={width} height={height} isCurrent={isCurrent} setScrollEnabled={setScrollEnabled} />;
  }
  return <ImageSlide item={item} width={width} height={height} setScrollEnabled={setScrollEnabled} />;
});

// ==================== ImageSlide (ピンチズーム) ====================
function ImageSlide({
  item, width, height, setScrollEnabled,
}: {
  item: MediaLibrary.Asset; width: number; height: number;
  setScrollEnabled: (v: boolean) => void;
}) {
  return (
    <View style={{ width, height }}>
      <Zoomable
        minScale={1}
        maxScale={5}
        doubleTapScale={3}
        isDoubleTapEnabled
        isSingleTapEnabled={false}
        onInteractionStart={() => setScrollEnabled(false)}
        onInteractionEnd={() => setScrollEnabled(true)}
        style={{ width, height }}
      >
        <Image source={{ uri: item.uri }} style={{ width, height }} resizeMode="contain" />
      </Zoomable>
    </View>
  );
}

// ==================== VideoSlide ====================
function VideoSlide({
  item, width, height, isCurrent, setScrollEnabled,
}: {
  item: MediaLibrary.Asset; width: number; height: number; isCurrent: boolean;
  setScrollEnabled: (v: boolean) => void;
}) {
  const videoRef = useRef<Video>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const seekingRef = useRef(false);

  const assetW = item.width || width;
  const assetH = item.height || height;
  const fitScale = Math.min(width / assetW, height / assetH);
  const fitW = Math.round(assetW * fitScale);
  const fitH = Math.round(assetH * fitScale);
  const fitLeft = Math.round((width - fitW) / 2);
  const fitTop = Math.round((height - fitH) / 2);

  useEffect(() => {
    if (!isCurrent) { videoRef.current?.pauseAsync(); setPlaying(false); setShowVideo(false); setVideoStarted(false); videoStartedRef.current = false; }
  }, [isCurrent]);

  const handleTap = () => {
    if (!showVideo) { setShowVideo(true); return; }
    if (playing) { videoRef.current?.pauseAsync(); setPlaying(false); }
    else { videoRef.current?.playAsync(); setPlaying(true); }
  };

  const videoStartedRef = useRef(false);
  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (!seekingRef.current) setPosMs(status.positionMillis);
    if (status.durationMillis) setDurMs(status.durationMillis);
    if (status.isPlaying && !videoStartedRef.current) {
      videoStartedRef.current = true;
      setVideoStarted(true);
    }
    if (status.didJustFinish) setPlaying(false);
  }, []);

  const seekTo = useCallback((fraction: number) => {
    if (durMs <= 0) return;
    const ms = Math.round(fraction * durMs);
    videoRef.current?.setPositionAsync(ms);
    setPosMs(ms);
  }, [durMs]);

  const progress = durMs > 0 ? posMs / durMs : 0;
  const fmtTime = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  return (
    <View style={{ width, height, backgroundColor: colors.darkBg }}>
      <TouchableOpacity style={{ width, height }} activeOpacity={1} onPress={handleTap}>
        <Image source={{ uri: item.uri }} style={{ width, height }} resizeMode="contain" />
      </TouchableOpacity>

      {showVideo && isCurrent && (
        <TouchableOpacity
          style={{ position: 'absolute', left: fitLeft, top: fitTop, width: fitW, height: fitH }}
          activeOpacity={1} onPress={handleTap}
        >
          <Video ref={videoRef} source={{ uri: item.uri }}
            style={{ width: fitW, height: fitH }}
            resizeMode={ResizeMode.STRETCH} shouldPlay isLooping={false}
            progressUpdateIntervalMillis={200} onPlaybackStatusUpdate={onStatus} />
        </TouchableOpacity>
      )}

      {!playing && !videoStarted && (
        <View style={st.playOverlay} pointerEvents="none">
          <View style={st.playCircle}><Ionicons name="play" size={32} color={colors.darkText} /></View>
        </View>
      )}

      {/* シークバー — 画面下部固定、FlatListの外ではなくSlide内 */}
      {showVideo && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <VideoSeekBar
            posMs={posMs} durMs={durMs} playing={playing}
            onTogglePlay={handleTap}
            onSeek={(ms) => { videoRef.current?.setPositionAsync(ms); setPosMs(ms); }}
            onSeekStart={() => { seekingRef.current = true; setScrollEnabled(false); }}
            onSeekEnd={() => { seekingRef.current = false; setScrollEnabled(true); }}
          />
        </View>
      )}

      {!showVideo && item.duration > 0 && (
        <View style={st.vidBadge} pointerEvents="none">
          <Ionicons name="videocam" size={14} color={colors.white} />
          <Text style={st.vidDur}>{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}</Text>
        </View>
      )}
    </View>
  );
}


// ==================== Styles ====================
const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.darkBg },
  center: { flex: 1, backgroundColor: colors.darkBg, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, height: 52 },
  counter: { ...typography.captionMedium, color: colors.darkTextSecondary, fontVariant: ['tabular-nums'] },
  sel: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.darkTextSecondary, alignItems: 'center', justifyContent: 'center' },
  selActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  selNum: { color: colors.white, fontSize: 14, fontWeight: '700' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.overlayMedium, alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  vidBadge: { position: 'absolute', bottom: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.overlayDark, borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  vidDur: { color: colors.white, ...typography.caption, fontVariant: ['tabular-nums'] },
  // パーミッション
  permText: { ...typography.body, color: colors.darkTextSecondary, textAlign: 'center' },
  permBtn: { backgroundColor: colors.accent, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, borderRadius: radii.md },
  permBtnText: { color: colors.white, ...typography.title },
  // CTA
  cta: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.darkBg, borderTopWidth: 1, borderTopColor: colors.darkSeparator, gap: spacing.md },
  ctaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ctaCount: { ...typography.captionMedium, color: colors.darkText },
  ctaClear: { ...typography.captionMedium, color: colors.darkTextSecondary },
  ctaBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radii.md },
  ctaBtnText: { color: colors.white, ...typography.title },
});
