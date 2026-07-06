// 初回起動時のオンボーディング (UI_SPECS_JA §9)。
//
// 仕様の 5 step のうち、 v0.1.3 では以下を実装:
//   ✅ Step 1 ウェルカム (= 3 枚カルーセル、 温かいフリマ風イラスト)
//   ⏳ Step 2 KYC (= 第三者サービス連携、 別タスク)
//   ✅ Step 3 利用規約 + プライバシーポリシー 同意 (= 全文は LegalDocModal で読める)
//   ⏳ Step 4 カメラ権限 (= OS 権限ダイアログは撮影画面初回で出る)
//   ⏳ Step 5 チュートリアル (= 撮影モード初回で別途実装)
//
// デザイン方針 (= feedback_no_ai_slop_ui / project_portfolio_warm_furima):
//   抽象的な線画アイコン (= 旧 eye/shield/target SVG) は監視っぽく主婦向けに不適だったため、
//   assets/decor の温かいイラストに統一。 ジャーゴン (NFT/USDC/Solana) は出さない。
//
// 完了状態は AsyncStorage に永続化。 RootNavigator が起動時に判定して未完了なら Login の前に押し込む。

import React, { useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path } from 'react-native-svg';

import { useT, type TranslationKey } from '../i18n';
import { LegalDocModal } from '../components/LegalDocModal';
import type { LegalDocKey } from '../content/legalDocs.generated';
import { colors, fonts, radii, spacing, typography } from '../theme';

const STORAGE_KEY = 'rootlens.onboarding.completed.v1';

interface Slide {
  eyebrow: TranslationKey;
  headline: TranslationKey;
  body: TranslationKey;
  image: number; // require(...) asset
}

const SLIDES: Slide[] = [
  {
    eyebrow: 'onb.slide1.eyebrow',
    headline: 'onb.slide1.headline',
    body: 'onb.slide1.body',
    image: require('../../assets/decor/home-warm.png'),
  },
  {
    eyebrow: 'onb.slide2.eyebrow',
    headline: 'onb.slide2.headline',
    body: 'onb.slide2.body',
    image: require('../../assets/decor/privacy-shield.png'),
  },
  {
    eyebrow: 'onb.slide3.eyebrow',
    headline: 'onb.slide3.headline',
    body: 'onb.slide3.body',
    image: require('../../assets/decor/earnings-stack.png'),
  },
];

interface Props {
  onCompleted: () => void;
}

export const OnboardingScreen: React.FC<Props> = ({ onCompleted }) => {
  const [page, setPage] = useState(0);
  const [tosAccepted, setTosAccepted] = useState(false);

  const onWelcomeNext = () => setPage(1);

  const onComplete = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
    onCompleted();
  };

  if (page === 0) {
    return <WelcomeCarousel onNext={onWelcomeNext} />;
  }
  return (
    <TosConsent
      tosAccepted={tosAccepted}
      onToggle={() => setTosAccepted((v) => !v)}
      onContinue={onComplete}
      onBack={() => setPage(0)}
    />
  );
};

export async function isOnboardingCompleted(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

// ─── Welcome carousel ────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;

const WelcomeCarousel: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const t = useT();
  const [page, setPage] = useState(0);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.brandRow}>
        <BrandMark />
        <Text style={styles.brandText}>ROOTLENS</Text>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const p = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setPage(p);
        }}
        style={styles.carousel}
      >
        {SLIDES.map((slide) => (
          <Slide key={slide.image} slide={slide} />
        ))}
      </ScrollView>

      <View style={styles.pagerDots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.bottomActions}>
        <Pressable
          onPress={onNext}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>{page === SLIDES.length - 1 ? t('onb.continue') : t('onb.skip')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const Slide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const t = useT();
  return (
    <View style={[styles.slide, { width: SCREEN_W }]}>
      <View style={styles.illustrationPanel}>
        <Image source={slide.image} style={styles.illustration} resizeMode="cover" />
      </View>
      <Text style={styles.slideEyebrow}>{t(slide.eyebrow)}</Text>
      <Text style={styles.slideHeadline}>{t(slide.headline)}</Text>
      <Text style={styles.slideBody}>{t(slide.body)}</Text>
    </View>
  );
};

const BrandMark: React.FC = () => (
  <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
    <Circle cx={11} cy={11} r={10} stroke={colors.ink} strokeWidth={1.4} />
    <Circle cx={11} cy={11} r={5} stroke={colors.ink} strokeWidth={1.4} />
    <Path d="M11 1v5M11 16v5M1 11h5M16 11h5" stroke={colors.ink} strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

// ─── ToS consent ─────────────────────────────────────────────────────

const TosConsent: React.FC<{
  tosAccepted: boolean;
  onToggle: () => void;
  onContinue: () => void;
  onBack: () => void;
}> = ({ tosAccepted, onToggle, onContinue, onBack }) => {
  const t = useT();
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.brandRow}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <BrandMark />
        <Text style={styles.brandText}>ROOTLENS</Text>
      </View>

      <ScrollView contentContainerStyle={styles.tosScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.tosEyebrow}>{t('onb.tosEyebrow')}</Text>
        <Text style={styles.tosHeadline}>{t('onb.tosHeadline')}</Text>
        <Text style={styles.tosLede}>
          {t('onb.tosLede')}
        </Text>

        <View style={styles.tosCard}>
          <SummaryBullet text={t('onb.bullet1')} />
          <SummaryBullet text={t('onb.bullet2')} />
          <SummaryBullet text={t('onb.bullet3')} />
          <SummaryBullet text={t('onb.bullet4')} />
        </View>

        <View style={styles.linksRow}>
          <Pressable onPress={() => setLegalDoc('terms-of-service')} hitSlop={8}>
            <Text style={styles.linkText}>{t('settings.terms')}</Text>
          </Pressable>
          <View style={styles.linkDot} />
          <Pressable onPress={() => setLegalDoc('privacy-policy')} hitSlop={8}>
            <Text style={styles.linkText}>{t('settings.privacy')}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.tosFooter}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.checkboxRow, pressed && { opacity: 0.7 }]}
        >
          <View style={[styles.checkbox, tosAccepted && styles.checkboxChecked]}>
            {tosAccepted ? (
              <Svg width={14} height={14} viewBox="0 0 14 14">
                <Path d="M3 7 l3 3 l5 -6" stroke={colors.card} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </Svg>
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>
            {t('onb.tosConsent')}
          </Text>
        </Pressable>

        <Pressable
          onPress={onContinue}
          disabled={!tosAccepted}
          style={({ pressed }) => [
            styles.cta,
            !tosAccepted && styles.ctaDisabled,
            pressed && tosAccepted && styles.ctaPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>{t('onb.continue')}</Text>
        </Pressable>
      </View>

      <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
};

const SummaryBullet: React.FC<{ text: string }> = ({ text }) => (
  <View style={styles.bulletRow}>
    <View style={styles.bulletDot} />
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

// ─── styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  brandText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2.4,
    color: colors.ink,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  backChevron: { fontSize: 28, color: colors.ink, marginTop: -4 },

  carousel: { flex: 1 },

  slide: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  illustrationPanel: {
    width: '100%',
    aspectRatio: 1.2,
    backgroundColor: '#ffffff',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  illustration: { width: '100%', height: '100%' },
  slideEyebrow: { ...typography.label, color: colors.textMute },
  slideHeadline: {
    fontFamily: fonts.serifLight,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  slideBody: {
    ...typography.body,
    color: colors.textBody,
    marginTop: spacing.sm,
    maxWidth: 360,
    lineHeight: 23,
  },

  pagerDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.ink,
  },

  bottomActions: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  cta: {
    backgroundColor: colors.ink,
    paddingVertical: 18,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.inkSoft },
  ctaDisabled: { opacity: 0.4 },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },

  tosScroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  tosEyebrow: { ...typography.label, color: colors.textMute },
  tosHeadline: {
    fontFamily: fonts.serifLight,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.6,
    color: colors.ink,
    marginTop: 4,
  },
  tosLede: {
    ...typography.body,
    color: colors.textBody,
    marginTop: spacing.xs,
    lineHeight: 23,
  },

  tosCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: colors.emerald,
    marginTop: 7,
  },
  bulletText: { flex: 1, ...typography.body, color: colors.textBody, fontSize: 13.5, lineHeight: 20 },

  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  linkText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  linkDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textFaint },

  tosFooter: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderInk,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  checkboxLabel: {
    flex: 1,
    ...typography.body,
    color: colors.textBody,
    fontSize: 13.5,
    lineHeight: 19,
  },
});
