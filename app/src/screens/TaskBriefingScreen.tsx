import React from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { PhoneOrientationIcon } from '../components/PhoneOrientationIcon';
import { colors, fonts, radii, spacing, typography } from '../theme';

// 撮影直前の briefing 画面。
//
// 役割:
//   1. これから撮影するタスクの内容を再提示 (= 取り違えていないか)
//   2. 撮影 orientation (portrait / landscape) を視覚的に伝え、 mount を整えてもらう
//   3. start / end condition (= VLM gate に渡される判定基準) を見せる
//   4. CTA tap で Capture へ push (= ここで OS rotation アニメが走る)
//
// portrait のままで表示し、 user の tap で Capture screen に移動。 Capture 側で
// useCaptureOrientationLock が走り、 必要なら OS が rotation アニメで横向きに変える。
// この遷移を 「これから横向きになります」 という暗黙の予告として機能させる。

type Nav = NativeStackNavigationProp<RootStackParamList, 'TaskBriefing'>;
type Route = NativeStackScreenProps<RootStackParamList, 'TaskBriefing'>['route'];

export const TaskBriefingScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const task = findTask(route.params.taskId);

  if (!task) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Task not found: {route.params.taskId}</Text>
          <Pressable onPress={() => nav.goBack()} style={styles.errorBack}>
            <Text style={styles.errorBackLabel}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const [lo, hi] = task.durationMin;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroFrame}>
          <Image source={task.illustration} style={styles.hero} resizeMode="contain" />
        </View>

        <Text style={styles.title}>{task.name}</Text>
        <Text style={styles.blurb}>{task.blurb}</Text>

        <OrientationCallout orientation={task.orientation} />

        <Section label="Start condition">
          <Text style={styles.sectionBody}>{task.startCondition}</Text>
        </Section>
        <Section label="End condition">
          <Text style={styles.sectionBody}>{task.endCondition}</Text>
        </Section>

        <View style={styles.metaRow}>
          <MetaPill label="Intensity" value={task.intensity} />
          <MetaPill label="Duration" value={`${lo}–${hi} min`} />
          <MetaPill label="Reward" value={`${task.reward.toFixed(2)} USDC`} accent />
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          onPress={() => nav.replace('Capture', { taskId: task.id })}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>撮影を開始</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// MARK: - Orientation callout
//
// 撮影向きを一目で伝える呼び出し要素。 phone icon は SVG (PhoneOrientationIcon)。
// label には小さい caps-track の eyebrow を添え、 全体のリズムを他の section と合わせる。

const OrientationCallout: React.FC<{ orientation: 'portrait' | 'landscape' }> = ({ orientation }) => {
  const isLandscape = orientation === 'landscape';
  return (
    <View style={styles.orientationCallout}>
      <View style={styles.orientationIconWrap}>
        <PhoneOrientationIcon orientation={orientation} size={104} />
      </View>
      <View style={styles.orientationText}>
        <Text style={styles.orientationEyebrow}>MOUNT</Text>
        <Text style={styles.orientationLabel}>
          {isLandscape ? 'Landscape' : 'Portrait'}
        </Text>
        <Text style={styles.orientationHint}>
          {isLandscape
            ? '横向きに mount を整えてから開始してください'
            : '縦向きに mount を整えてから開始してください'}
        </Text>
      </View>
    </View>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionLabel}>{label}</Text>
    {children}
  </View>
);

const MetaPill: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <View style={[styles.metaPill, accent && styles.metaPillAccent]}>
    <Text style={[styles.metaPillLabel, accent && styles.metaPillLabelAccent]}>{label}</Text>
    <Text style={[styles.metaPillValue, accent && styles.metaPillValueAccent]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },

  heroFrame: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  hero: { width: '92%', height: '100%' },

  title: { ...typography.display2, color: colors.ink },
  blurb: { ...typography.body, color: colors.textBody, lineHeight: 22 },

  orientationCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.emeraldFaint,
    borderWidth: 1,
    borderColor: colors.borderEmerald,
    borderRadius: radii.lg,
  },
  orientationIconWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orientationText: { flex: 1, gap: 2 },
  orientationEyebrow: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
  },
  orientationLabel: {
    ...typography.title,
    color: colors.ink,
  },
  orientationHint: {
    ...typography.caption,
    color: colors.textBody,
    marginTop: 4,
    lineHeight: 19,
  },

  section: { gap: spacing.xs },
  sectionLabel: { ...typography.label, color: colors.textMute },
  sectionBody: { ...typography.body, color: colors.textInk, lineHeight: 22 },

  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metaPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: 2,
  },
  metaPillAccent: {
    borderColor: colors.borderEmerald,
    backgroundColor: colors.emeraldSoft,
  },
  metaPillLabel: { ...typography.labelSmall, color: colors.textMute },
  metaPillLabelAccent: { color: colors.emeraldDeep },
  metaPillValue: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
    marginTop: 2,
  },
  metaPillValueAccent: {
    fontFamily: fonts.mono,
    color: colors.emeraldDeep,
  },

  ctaBar: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
  },
  cta: {
    height: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.inkSoft },
  ctaLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    color: colors.textOnInk,
    letterSpacing: 0.3,
  },

  errorText: { ...typography.body, color: colors.danger },
  errorBack: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ink,
  },
  errorBackLabel: { color: colors.textOnInk, fontFamily: fonts.sansSemibold },
});
