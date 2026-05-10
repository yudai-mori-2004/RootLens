import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TaskDef } from '../tasks';
import { colors, fonts, hairline, radius, space, type } from '../theme';

interface Props {
  task: TaskDef;
  onStart: () => void;
  onBack: () => void;
}

export const BriefView: React.FC<Props> = ({ task, onStart, onBack }) => {
  const { width: winWidth } = useWindowDimensions();
  const illustrationSize = Math.min(winWidth - space.xl * 2, 540);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.taskEmoji}>{task.emoji}</Text>
          <Text style={styles.taskName}>{task.name}</Text>
          <Text style={styles.taskSub}>Show us how it’s done.</Text>
        </View>

        <View style={styles.sections}>
          <Section
            label="Start"
            condition={task.startCondition}
            illustration={task.startIllustration}
            size={illustrationSize}
          />
          <Section
            label="End"
            condition={task.endCondition}
            illustration={task.endIllustration}
            size={illustrationSize}
          />
        </View>

        <View style={styles.protocol}>
          <Text style={styles.protocolEyebrow}>How it works</Text>
          <Text style={styles.protocolLead}>No buttons. Hand signs only.</Text>
          <Step n="1" action="Show both palms to start." detail="Hold 1 second. ✋ ✋" />
          <Step n="2" action="Countdown 3, 2, 1." detail="Keep palms open." />
          <Step n="3" action="Do the task." detail="Keep both hands in frame." />
          <Step n="4" action="Show both thumbs up to finish." detail="Hold 1 second. 👍 👍" />
        </View>
      </ScrollView>

      <View style={styles.bar}>
        <Pressable style={styles.backLink} onPress={onBack} hitSlop={12}>
          <Text style={styles.backLinkText}>← Back</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]} onPress={onStart}>
          <Text style={styles.ctaLabel}>Begin</Text>
        </Pressable>
      </View>
    </View>
  );
};

const Section: React.FC<{
  label: string;
  condition: string;
  illustration?: TaskDef['startIllustration'];
  size: number;
}> = ({ label, condition, illustration, size }) => (
  <View style={styles.section}>
    <Text style={styles.sectionLabel}>{label}</Text>
    {illustration ? (
      <Image
        source={illustration}
        style={[styles.illustration, { width: size, height: size }]}
        resizeMode="cover"
      />
    ) : (
      <View style={[styles.illustration, styles.illustrationPlaceholder, { width: size, height: size }]}>
        <Text style={styles.illustrationPlaceholderText}>illustration · pending</Text>
      </View>
    )}
    <Text style={styles.condition}>{condition}</Text>
  </View>
);

const Step: React.FC<{ n: string; action: string; detail: string }> = ({ n, action, detail }) => (
  <View style={styles.step}>
    <Text style={styles.stepNum}>{n}</Text>
    <View style={styles.stepBody}>
      <Text style={styles.stepAction}>{action}</Text>
      <Text style={styles.stepDetail}>{detail}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgWarm },
  scroll: { paddingBottom: space.xxxxl },

  hero: {
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.xl,
    gap: space.s,
    alignItems: 'flex-start',
    ...hairline('bottom'),
  },
  taskEmoji: { fontSize: 40, marginBottom: space.s },
  taskName: { ...type.display1, color: colors.textInk },
  taskSub: { ...type.body, color: colors.textMute, marginTop: 2 },

  sections: { gap: space.xxl, paddingTop: space.xl, paddingHorizontal: space.xl },
  section: { gap: space.s },
  sectionLabel: { ...type.caps, color: colors.textInk },

  illustration: {
    borderRadius: radius.s,
    backgroundColor: colors.bgWhite,
    ...hairline('all'),
  },
  illustrationPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  illustrationPlaceholderText: { ...type.monoS, color: colors.textFaint },

  condition: { ...type.bodyL, color: colors.textBody },

  protocol: {
    marginTop: space.xxl,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.l,
    ...hairline('top'),
  },
  protocolEyebrow: {
    fontFamily: fonts.displayMedium,
    fontSize: 16,
    color: colors.textInk,
    letterSpacing: -0.1,
  },
  protocolLead: {
    ...type.body,
    color: colors.textMute,
    marginTop: -space.s,
    marginBottom: space.xs,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.m,
  },
  stepNum: { ...type.monoS, color: colors.textFaint, minWidth: 16, marginTop: 4 },
  stepBody: { flex: 1, gap: 2 },
  stepAction: {
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textInk,
    letterSpacing: -0.1,
  },
  stepGesture: {
    fontSize: 17,
    letterSpacing: 1,
  },
  stepDetail: { ...type.bodyS, color: colors.textMute },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.m,
    paddingBottom: space.xl,
    backgroundColor: colors.bgWhite,
    ...hairline('top'),
    gap: space.l,
  },
  backLink: { paddingVertical: space.s, paddingRight: space.m },
  backLinkText: { ...type.body, color: colors.textInk, fontWeight: '500' },
  cta: {
    backgroundColor: colors.bgInk,
    paddingHorizontal: space.xxl,
    paddingVertical: space.m,
    borderRadius: radius.s,
  },
  ctaPressed: { backgroundColor: colors.bgInkSoft },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
