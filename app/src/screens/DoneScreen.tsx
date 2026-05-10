import React from 'react';
import { Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { colors, typography, spacing, radii } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Done'>;

export const DoneScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, rootNftAssetId, contentHash, staked, stakeTxSignature } = route.params;
  const task = findTask(taskId);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>{staked ? '✓ STAKED' : '✓ MINTED'}</Text>
        <Text style={styles.heading}>
          {staked
            ? 'Your clip is on-chain and licensable.'
            : 'Your clip is on-chain. (Stake later to enable licensing.)'}
        </Text>
        <Text style={styles.lede}>
          Task: {task?.name ?? taskId}
        </Text>

        {rootNftAssetId ? (
          <FieldBlock label="Root NFT asset id" value={rootNftAssetId} />
        ) : null}
        <FieldBlock label="Content hash" value={contentHash} />
        {stakeTxSignature ? (
          <FieldBlock
            label="Stake tx"
            value={stakeTxSignature}
            url={`https://solscan.io/tx/${stakeTxSignature}?cluster=devnet`}
          />
        ) : null}

        <View style={styles.note}>
          <Text style={styles.noteText}>
            {staked
              ? 'License NFT issuance happens server-side when an AI lab purchases. The on-chain program splits USDC 95% to your wallet, 5% to RootLens, in one atomic tx.'
              : 'You can return later to set the delegate (stake) and start earning.'}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.ctaLabel}>Record another clip</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const FieldBlock: React.FC<{ label: string; value: string; url?: string }> = ({ label, value, url }) => {
  const inner = (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={2}>{value}</Text>
    </View>
  );
  if (url) return <Pressable onPress={() => Linking.openURL(url)}>{inner}</Pressable>;
  return inner;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  eyebrow: { ...typography.label, color: colors.success, letterSpacing: 1.6 },
  heading: { ...typography.heading, color: colors.textPrimary },
  lede: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },

  field: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    gap: 2,
  },
  fieldLabel: { ...typography.label, color: colors.textHint, letterSpacing: 1.2 },
  fieldValue: { fontFamily: 'Menlo', fontSize: 11, color: colors.accent },

  note: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.accentLight,
    borderRadius: radii.md,
  },
  noteText: { ...typography.caption, color: colors.textPrimary, lineHeight: 18 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.background,
  },
  cta: {
    paddingVertical: spacing.lg, borderRadius: radii.md,
    backgroundColor: colors.accent, alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.accentDark },
  ctaLabel: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
