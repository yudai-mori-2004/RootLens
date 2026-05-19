import React from 'react';
import {
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { TASKS, type TaskDef } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// JOB タブ — タイミー風の縦スクロールカードリスト。
// 各カードは:
//   • 縦長 illustration (Gemini 生成、navy outline + emerald accent)
//   • Fraunces medium のタスク名 + 1-2 行の blurb
//   • Footer: intensity / duration / reward の小さい mono pills
// タップで撮影フロー (Capture) へ遷移する。

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const JobScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={TASKS}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Header />}
        renderItem={({ item }) => (
          <JobCard task={item} onPress={() => nav.navigate('TaskBriefing', { taskId: item.id })} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
      />
    </SafeAreaView>
  );
};

// ---- Header ------------------------------------------------------------

const Header: React.FC = () => (
  <View style={styles.header}>
    <View style={styles.headerTop}>
      <Text style={styles.brand}>RootLens</Text>
      <View style={styles.statusPill}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>DEVNET</Text>
      </View>
    </View>
    <Text style={styles.headerLede}>
      Pick a chore. Record once. Earn when an AI lab licenses your clip.
    </Text>
  </View>
);

// ---- Card --------------------------------------------------------------

const JobCard: React.FC<{ task: TaskDef; onPress: () => void }> = ({ task, onPress }) => {
  const [lo, hi] = task.durationMin;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.illoFrame}>
        <Image source={task.illustration} style={styles.illo} resizeMode="contain" />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{task.name}</Text>
        <Text style={styles.cardBlurb}>{task.blurb}</Text>

        <View style={styles.cardFooter}>
          <View style={styles.pillRow}>
            <Pill label={task.intensity} variant="ink" />
            <Pill label={`${lo}–${hi} MIN`} variant="ghost" />
          </View>
          <View style={styles.rewardChip}>
            <Text style={styles.rewardCurrency}>USDC</Text>
            <Text style={styles.rewardValue}>{task.reward.toFixed(2)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

const Pill: React.FC<{ label: string; variant: 'ink' | 'ghost' }> = ({ label, variant }) => (
  <View style={[styles.pill, variant === 'ink' ? styles.pillInk : styles.pillGhost]}>
    <Text style={[styles.pillLabel, variant === 'ink' && { color: colors.textOnInk }]}>{label}</Text>
  </View>
);

// ---- Styles ------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },

  // header
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.borderEmerald,
    backgroundColor: colors.emeraldFaint,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald,
  },
  statusText: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
  },
  headerLede: {
    ...typography.body,
    color: colors.textBody,
    fontFamily: fonts.sansRegular,
    fontSize: 15.5,
    lineHeight: 22,
  },

  // card
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardPressed: {
    backgroundColor: colors.paperDeep,
    transform: [{ scale: 0.995 }],
  },
  illoFrame: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  illo: {
    width: '92%',
    height: '100%',
  },
  cardBody: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.title,
    color: colors.ink,
  },
  cardBlurb: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 14,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  pillInk: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  pillGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  pillLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },
  rewardChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: colors.emeraldSoft,
    borderWidth: 1,
    borderColor: colors.borderEmerald,
  },
  rewardCurrency: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.emeraldDeep,
  },
  rewardValue: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.emeraldDeep,
    fontWeight: '600',
  },
});
