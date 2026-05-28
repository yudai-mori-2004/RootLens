// 初回起動時のオンボーディング (UI_SPECS_JA §9)。
//
// 仕様の 5 step のうち、 v0.1.3 では以下を実装:
//   ✅ Step 1 ウェルカム (= 3 枚カルーセル、 概要説明)
//   ⏳ Step 2 KYC (= 第三者サービス連携、 別タスク)
//   ✅ Step 3 利用規約 + プライバシーポリシー 同意
//   ⏳ Step 4 カメラ権限 (= OS 権限ダイアログは撮影画面初回で出る)。 マイク権限は不要 (= 2026-05-27 音声入力撤去)
//   ⏳ Step 5 チュートリアル (= 撮影モード初回で別途実装)
//
// 完了状態は AsyncStorage に永続化。 RootNavigator が起動時に判定して
// 未完了なら Login の前に押し込む。

import React, { useState } from 'react';
import {
  Dimensions,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts, radii, spacing, typography } from '../theme';

const STORAGE_KEY = 'rootlens.onboarding.completed.v1';

interface Slide {
  eyebrow: string;
  headline: string;
  body: string;
  glyph: 'eye' | 'shield' | 'circle';
}

const SLIDES: Slide[] = [
  {
    eyebrow: 'CAPTURE',
    headline: 'Record household chores.',
    body: 'カメラを頭やネックストラップに装着して、 普段の家事をそのまま記録。 ジェスチャーで開始 / 終了。',
    glyph: 'eye',
  },
  {
    eyebrow: 'PRIVACY',
    headline: 'Faces blurred on device.',
    body: 'Apple Vision で映像内の顔を端末上でぼかしてから署名 + アップロード。 元映像はサーバに送りません。',
    glyph: 'shield',
  },
  {
    eyebrow: 'EARN',
    headline: 'Own each clip as an NFT.',
    body: '署名済クリップは Solana 上の Root NFT になります。 AI 企業がライセンス購入すると USDC で収益発生。',
    glyph: 'circle',
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
          <Slide key={slide.eyebrow} slide={slide} />
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
          <Text style={styles.ctaLabel}>{page === SLIDES.length - 1 ? 'CONTINUE' : 'SKIP'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const Slide: React.FC<{ slide: Slide }> = ({ slide }) => (
  <View style={[styles.slide, { width: SCREEN_W }]}>
    <View style={styles.glyphWrap}>
      <SlideGlyph kind={slide.glyph} />
    </View>
    <Text style={styles.slideEyebrow}>{slide.eyebrow}</Text>
    <Text style={styles.slideHeadline}>{slide.headline}</Text>
    <Text style={styles.slideBody}>{slide.body}</Text>
  </View>
);

const SlideGlyph: React.FC<{ kind: 'eye' | 'shield' | 'circle' }> = ({ kind }) => {
  switch (kind) {
    case 'eye':
      return (
        <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
          <Circle cx={60} cy={60} r={58} stroke={colors.ink} strokeWidth={1.4} />
          <Path d="M14 60 Q60 20 106 60 Q60 100 14 60 Z" stroke={colors.ink} strokeWidth={1.6} fill="none" />
          <Circle cx={60} cy={60} r={14} stroke={colors.emerald} strokeWidth={1.8} />
          <Circle cx={60} cy={60} r={5} fill={colors.emerald} />
        </Svg>
      );
    case 'shield':
      return (
        <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
          <Circle cx={60} cy={60} r={58} stroke={colors.ink} strokeWidth={1.4} />
          <Path
            d="M60 22 L88 36 V60 Q88 84 60 98 Q32 84 32 60 V36 Z"
            stroke={colors.ink}
            strokeWidth={1.6}
            fill="none"
          />
          <Circle cx={60} cy={58} r={10} fill={colors.emeraldSoft} stroke={colors.emerald} strokeWidth={1.6} />
          <Path d="M55 58 l4 4 l8 -8" stroke={colors.emeraldDeep} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      );
    case 'circle':
      return (
        <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
          <Circle cx={60} cy={60} r={58} stroke={colors.ink} strokeWidth={1.4} />
          <Circle cx={60} cy={60} r={30} stroke={colors.emerald} strokeWidth={1.6} />
          <Circle cx={60} cy={60} r={8} fill={colors.emerald} />
          <Path
            d="M60 12 v18 M60 90 v18 M12 60 h18 M90 60 h18"
            stroke={colors.ink}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </Svg>
      );
  }
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
}> = ({ tosAccepted, onToggle, onContinue, onBack }) => (
  <SafeAreaView style={styles.root}>
    <View style={styles.brandRow}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
        <Text style={styles.backChevron}>‹</Text>
      </Pressable>
      <BrandMark />
      <Text style={styles.brandText}>ROOTLENS</Text>
    </View>

    <ScrollView contentContainerStyle={styles.tosScroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.tosEyebrow}>STEP 2 OF 2 · TERMS OF USE</Text>
      <Text style={styles.tosHeadline}>使い始める前に。</Text>
      <Text style={styles.tosLede}>
        RootLens を使うと、 撮影 / アップロード / NFT 化 / ライセンス販売の各処理に同意したことになります。
        概要を確認のうえ、 全文へのリンクから本文をチェックしてください。
      </Text>

      <View style={styles.tosCard}>
        <SummaryBullet text="撮影クリップは端末上で顔ぼかし + C2PA 署名され、 暗号化 R2 ストレージに保存されます。" />
        <SummaryBullet text="ステーキング後、 ライセンスを購入した AI 企業に映像が引き渡されます。 撤回はできません。" />
        <SummaryBullet text="ライセンス売上の 95% が撮影者、 5% が運営に分配されます。" />
        <SummaryBullet text="本人が映る場合のみ撮影してください。 第三者の顔は端末側ぼかしで対応しますが、 居住者の同意は撮影者の責任で取得してください。" />
      </View>

      <View style={styles.linksRow}>
        <Text style={styles.linkText}>利用規約</Text>
        <View style={styles.linkDot} />
        <Text style={styles.linkText}>プライバシーポリシー</Text>
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
          利用規約 と プライバシーポリシー を読み、 同意します
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
        <Text style={styles.ctaLabel}>CONTINUE</Text>
      </Pressable>
    </View>
  </SafeAreaView>
);

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
  glyphWrap: { marginBottom: spacing.xl, alignSelf: 'flex-start' },
  slideEyebrow: { ...typography.label, color: colors.textMute },
  slideHeadline: {
    fontFamily: fonts.serifLight,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.6,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  slideBody: {
    ...typography.body,
    color: colors.textBody,
    marginTop: spacing.sm,
    maxWidth: 340,
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
  bulletText: { flex: 1, ...typography.body, color: colors.textBody, fontSize: 13.5, lineHeight: 19 },

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
