// Camera タブの暫定 entry 画面。
//
// UI_SPECS_JA §4 の対話サブモード (= 音声 AI でタスクを選ぶ) が task 13 で実装される
// までの繋ぎ。 voice-first のフィーチャーは未提供であることを正直に示しつつ、
// タップでタスクを選ぶ手動経路 (UI_SPECS §4.5 のハンバーガーメニュー相当) を提供する。
//
// デザイン方針 (= Editorial Fintech):
//   • 上部: voice dialogue が来ることを示唆する大型 ledge (= "HEY LENS" mock)
//   • 下部: 手動タスク選択カードを 2 列グリッドで並べる
//
// task 14 で対話サブモードに置き換えた時点で本ファイルは削除予定。

import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList } from '../app/types';
import { TASKS, type TaskDef } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const CameraEntryScreen: React.FC = () => {
  const nav = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <VoiceLedge />
        <View style={styles.divider} />
        <ManualPicker
          onSelect={(id) => nav.navigate('TaskBriefing', { taskId: id })}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── voice ledge ───────────────────────────────────────────────────────
// 「ヘイレンズ」 と話しかける UI の placeholder。 task 13 で本物の音声検出に
// 置き換える前提なので、 ここでは見た目だけ。 タップしても何も起きない (= 「準備中」 表示)。

const VoiceLedge: React.FC = () => (
  <View style={styles.voiceLedge}>
    <Text style={styles.voiceEyebrow}>VOICE · COMING SOON</Text>
    <Text style={styles.voiceCue}>
      <Text style={styles.voiceCueAccent}>“Hey Lens.”</Text>
    </Text>
    <Text style={styles.voiceBody}>
      話しかけてタスクを選ぶ対話モードは次の更新で。 今は下のカードから選んで撮影を始めてください。
    </Text>
    <View style={styles.voiceMicWrap}>
      <MicGlyph />
    </View>
  </View>
);

const MicGlyph: React.FC = () => (
  <Svg width={56} height={56} viewBox="0 0 56 56" fill="none">
    <Circle cx={28} cy={28} r={27} stroke={colors.border} strokeWidth={1} />
    <Circle cx={28} cy={28} r={20} stroke={colors.borderInk} strokeWidth={1} strokeDasharray="2 4" opacity={0.4} />
    <Path
      d="M28 18a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0v-6a4 4 0 0 0-4-4z"
      stroke={colors.ink} strokeWidth={1.6} fill="none"
    />
    <Path d="M20 28v0a8 8 0 0 0 16 0" stroke={colors.ink} strokeWidth={1.6} strokeLinecap="round" />
    <Path d="M28 36v4" stroke={colors.ink} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
);

// ─── manual picker ─────────────────────────────────────────────────────

const ManualPicker: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => (
  <View style={styles.pickerSection}>
    <View style={styles.pickerHeader}>
      <Text style={styles.pickerEyebrow}>SELECT TASK · MANUAL</Text>
      <Text style={styles.pickerHint}>Tap a card to begin briefing</Text>
    </View>
    <View style={styles.grid}>
      {TASKS.map((task) => (
        <TaskTile key={task.id} task={task} onPress={() => onSelect(task.id)} />
      ))}
    </View>
  </View>
);

const TaskTile: React.FC<{ task: TaskDef; onPress: () => void }> = ({ task, onPress }) => {
  const [lo, hi] = task.durationMin;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileIlloFrame}>
        <Image source={task.illustration} style={styles.tileIllo} resizeMode="contain" />
      </View>
      <View style={styles.tileBody}>
        <Text style={styles.tileName} numberOfLines={1}>{task.name}</Text>
        <View style={styles.tileMeta}>
          <Text style={styles.tileMetaText}>{lo}–{hi}m</Text>
          <View style={styles.tileMetaDot} />
          <Text style={styles.tileMetaText}>{task.intensity}</Text>
        </View>
      </View>
    </Pressable>
  );
};

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xxxl },

  // voice ledge
  voiceLedge: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  voiceEyebrow: {
    ...typography.label,
    color: colors.textMute,
  },
  voiceCue: {
    fontFamily: fonts.serifLight,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.8,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  voiceCueAccent: {
    fontFamily: fonts.serifMedium,
  },
  voiceBody: {
    ...typography.body,
    color: colors.textBody,
    maxWidth: 320,
    marginTop: spacing.xs,
  },
  voiceMicWrap: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.xl,
  },

  divider: {
    height: 1,
    marginHorizontal: spacing.xl,
    backgroundColor: colors.border,
  },

  // picker
  pickerSection: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },
  pickerHeader: {
    gap: 4,
  },
  pickerEyebrow: {
    ...typography.label,
    color: colors.textMute,
  },
  pickerHint: {
    ...typography.caption,
    color: colors.textMute,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    width: '47.5%',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  tilePressed: {
    backgroundColor: colors.paperDeep,
    transform: [{ scale: 0.99 }],
  },
  tileIlloFrame: {
    aspectRatio: 1,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tileIllo: {
    width: '90%',
    height: '90%',
  },
  tileBody: {
    padding: spacing.md,
    gap: 6,
  },
  tileName: {
    fontFamily: fonts.serifMedium,
    fontSize: 16,
    letterSpacing: -0.1,
    color: colors.ink,
  },
  tileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tileMetaText: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: colors.textMute,
  },
  tileMetaDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: colors.textFaint,
  },
});
