import React, { useState } from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// 撮影フローの最終画面。
// First-time user 向けに「これで何が起こる」を説明する。
// 技術的な receipt (asset_id, content_hash, tx) は disclosure 内で curious user に。

type Props = NativeStackScreenProps<RootStackParamList, 'Done'>;

const HERO_DECOR = require('../../assets/decor/celebration.png');

export const DoneScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, rootNftAssetId, contentHash, staked, stakeTxSignature } = route.params;
  const task = findTask(taskId);
  const [showDetails, setShowDetails] = useState(false);

  const headline = staked ? 'Your clip is live.' : "It's saved on Solana.";
  const sub = staked
    ? 'AI labs can buy a license now. The moment they do, USDC lands in your wallet — settled on-chain.'
    : 'You can come back anytime to set it up to earn. Until you do, no licenses can be sold.';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HERO — celebration */}
        <View style={styles.hero}>
          <Image source={HERO_DECOR} style={styles.heroDecor} resizeMode="contain" />
          <View style={styles.eyebrowRow}>
            <View style={[styles.eyebrowDot, { backgroundColor: staked ? colors.emerald : colors.ink }]} />
            <Text style={[styles.eyebrow, { color: staked ? colors.emeraldDeep : colors.textMute }]}>
              {staked ? 'EARNING' : 'OWNED · NOT EARNING'}
            </Text>
          </View>
          <Text style={styles.heroTitle}>{headline}</Text>
          <Text style={styles.heroSub}>{sub}</Text>
        </View>

        {/* What you have now */}
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>WHAT YOU HAVE NOW</Text>
          <View style={styles.haveRow}>
            {task && (
              <Image source={task.illustration} style={styles.haveIllo} resizeMode="contain" />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.haveTitle}>{task?.name ?? 'Your clip'}</Text>
              <Text style={styles.haveSub}>
                One Root NFT in your wallet. {staked ? 'Set up to earn.' : 'Idle for now.'}
              </Text>
              {task && (
                <View style={styles.haveChip}>
                  <Text style={styles.haveChipCurr}>USDC</Text>
                  <Text style={styles.haveChipValue}>≈ {task.reward.toFixed(2)} per sale</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* What happens next */}
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>{staked ? 'WHAT HAPPENS NEXT' : 'WHEN YOU SET IT UP TO EARN'}</Text>
          <NextStep
            num={1}
            title="An AI lab finds your clip."
            body="They browse the marketplace and pick clips that match what they’re training on."
          />
          <NextStep
            num={2}
            title="They request a license."
            body="RootLens co-signs with you, so they can buy without bothering you."
          />
          <NextStep
            num={3}
            title="USDC lands in your wallet."
            body="Same transaction, no payouts queue. Your share lands directly in your wallet."
          />
        </View>

        {/* Tech disclosure (curious users) */}
        <View style={styles.detailsBlock}>
          <Pressable
            onPress={() => setShowDetails((v) => !v)}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.detailsToggle}>
              {showDetails ? 'Hide on-chain receipt' : 'On-chain receipt'}
            </Text>
          </Pressable>
          {showDetails && (
            <View style={styles.detailsBox}>
              {rootNftAssetId ? (
                <DetailRow
                  label="ASSET"
                  value={rootNftAssetId}
                  link={`https://solscan.io/token/${rootNftAssetId}?cluster=devnet`}
                />
              ) : null}
              <DetailRow label="HASH" value={contentHash} />
              {stakeTxSignature && (
                <DetailRow
                  label="STAKE TX"
                  value={stakeTxSignature}
                  link={`https://solscan.io/tx/${stakeTxSignature}?cluster=devnet`}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.bar}>
        <Pressable
          onPress={() => navigation.popToTop()}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>Record another clip</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// ---- helpers -----------------------------------------------------------

const NextStep: React.FC<{ num: number; title: string; body: string }> = ({ num, title, body }) => (
  <View style={styles.nextStep}>
    <View style={styles.nextStepBadge}>
      <Text style={styles.nextStepNum}>{num}</Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.nextStepTitle}>{title}</Text>
      <Text style={styles.nextStepBody}>{body}</Text>
    </View>
  </View>
);

const DetailRow: React.FC<{ label: string; value: string; link?: string }> = ({ label, value, link }) => {
  const inner = (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, link && styles.detailValueLink]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  if (link) {
    return (
      <Pressable
        onPress={() => Linking.openURL(link).catch(() => {})}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
};

// ---- styles ------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },

  // hero
  hero: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.borderEmerald,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  heroDecor: {
    width: 144,
    height: 144,
    marginBottom: spacing.sm,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrowDot: { width: 8, height: 8, borderRadius: 4 },
  eyebrow: { ...typography.label },
  heroTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    color: colors.ink,
    letterSpacing: -0.6,
    lineHeight: 36,
    textAlign: 'center',
    marginTop: 4,
  },
  heroSub: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 4,
  },

  // generic card
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  cardEyebrow: { ...typography.label, color: colors.textMute },

  // "what you have now"
  haveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  haveIllo: { width: 64, height: 64 },
  haveTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 17,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  haveSub: {
    ...typography.caption,
    color: colors.textBody,
    marginTop: 2,
    fontSize: 12.5,
  },
  haveChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.emeraldFaint,
    borderRadius: radii.sm,
  },
  haveChipCurr: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.emeraldDeep,
  },
  haveChipValue: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.emeraldDeep,
  },

  // next steps
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  nextStepBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  nextStepNum: {
    color: colors.textOnInk,
    fontFamily: fonts.serifMedium,
    fontSize: 13,
  },
  nextStepTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  nextStepBody: {
    ...typography.caption,
    color: colors.textBody,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 2,
  },

  // details
  detailsBlock: { gap: spacing.sm, marginTop: spacing.xs },
  detailsToggle: {
    ...typography.labelSmall,
    color: colors.textMute,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  detailsBox: {
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailRow: { gap: 2 },
  detailLabel: { ...typography.labelSmall, color: colors.textMute },
  detailValue: { ...typography.mono, color: colors.ink, fontSize: 11 },
  detailValueLink: { color: colors.emeraldDeep, textDecorationLine: 'underline' },

  // bottom bar
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.inkSoft },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    letterSpacing: 0.1,
  },
});
