import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../theme';

/**
 * 動画シークバーコンポーネント (SwipeGalleryView で使用)
 */
interface VideoSeekBarProps {
  posMs: number;
  durMs: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  /** シーク操作開始時（親のスクロール無効化等に使う） */
  onSeekStart?: () => void;
  /** シーク操作終了時 */
  onSeekEnd?: () => void;
}

export default function VideoSeekBar({
  posMs, durMs, playing, onTogglePlay, onSeek, onSeekStart, onSeekEnd,
}: VideoSeekBarProps) {
  const progress = durMs > 0 ? posMs / durMs : 0;
  const barWidthRef = useSharedValue(0);
  const localProgress = useSharedValue(progress);

  useEffect(() => { localProgress.value = progress; }, [progress]);

  const onLayout = useCallback((e: any) => { barWidthRef.value = e.nativeEvent.layout.width; }, []);

  const seekStartJS = useCallback(() => { onSeekStart?.(); }, [onSeekStart]);
  const seekEndJS = useCallback((frac: number) => {
    if (durMs > 0) onSeek(Math.round(frac * durMs));
    onSeekEnd?.();
  }, [durMs, onSeek, onSeekEnd]);

  const pan = Gesture.Pan()
    .onStart(() => { runOnJS(seekStartJS)(); })
    .onUpdate((e) => {
      if (barWidthRef.value > 0) {
        localProgress.value = Math.max(0, Math.min(1, e.x / barWidthRef.value));
      }
    })
    .onEnd((e) => {
      if (barWidthRef.value > 0) {
        const frac = Math.max(0, Math.min(1, e.x / barWidthRef.value));
        runOnJS(seekEndJS)(frac);
      }
    });

  const tap = Gesture.Tap()
    .onEnd((e) => {
      if (barWidthRef.value > 0) {
        const frac = Math.max(0, Math.min(1, e.x / barWidthRef.value));
        runOnJS(seekEndJS)(frac);
      }
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${localProgress.value * 100}%` as any,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: localProgress.value * Math.max(barWidthRef.value, 1) - 7,
  }));

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <View style={st.bar}>
      <TouchableOpacity onPress={onTogglePlay} style={st.playBtn}>
        <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.darkText} />
      </TouchableOpacity>
      <Text style={st.time}>{fmtTime(posMs)}</Text>
      <GestureDetector gesture={gesture}>
        <View style={st.seekOuter} onLayout={onLayout}>
          <View style={st.seekTrack} />
          <Animated.View style={[st.seekFill, fillStyle]} />
          <Animated.View style={[st.seekThumb, thumbStyle]} />
        </View>
      </GestureDetector>
      <Text style={st.time}>{fmtTime(durMs)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.overlayDark,
    gap: spacing.sm,
  },
  playBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  time: { color: colors.darkText, fontSize: 11, fontVariant: ['tabular-nums'] },
  seekOuter: { flex: 1, height: 32, justifyContent: 'center' },
  seekTrack: { height: 3, backgroundColor: colors.darkTextDisabled, borderRadius: 1.5 },
  seekFill: { position: 'absolute', height: 3, backgroundColor: colors.darkText, borderRadius: 1.5, top: 14.5, left: 0 },
  seekThumb: { position: 'absolute', top: 9, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.darkText },
});
