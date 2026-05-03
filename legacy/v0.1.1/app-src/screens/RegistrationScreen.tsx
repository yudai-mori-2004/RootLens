import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { usePrivy, useEmbeddedSolanaWallet, useLoginWithOAuth } from '@privy-io/expo';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';
import { loadProfile, syncUserToSupabase } from '../store/profileStore';

// 仕様書 §3.7 登録準備画面
// §2.4: 公開時にのみログインを求める

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Registration'>;

const SCREEN_WIDTH = Dimensions.get('window').width;

type FlowPhase = 'idle' | 'logging-in' | 'waiting-wallet' | 'syncing';

export default function RegistrationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { signedUris } = route.params;

  const { isReady, user, logout } = usePrivy();
  const isAuthenticated = !!user;
  const { login: loginOAuth } = useLoginWithOAuth();
  const wallet = useEmbeddedSolanaWallet();
  const walletAddress = wallet?.wallets?.[0]?.address ?? null;

  const [phase, setPhase] = useState<FlowPhase>('idle');
  const [pendingPublish, setPendingPublish] = useState(false);

  // ウォレットアドレスが取得できたら自動で次のステップに進む
  useEffect(() => {
    if (pendingPublish && walletAddress && phase === 'waiting-wallet') {
      proceedToPublish(walletAddress);
    }
  }, [pendingPublish, walletAddress, phase]);

  const proceedToPublish = useCallback(async (address: string) => {
    setPhase('syncing');
    try {
      const profile = await loadProfile();
      await syncUserToSupabase(address, profile);
      navigation.navigate('Publishing', { signedUris, address });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || String(e));
    } finally {
      setPhase('idle');
      setPendingPublish(false);
    }
  }, [navigation, signedUris]);

  const handleRegister = async () => {
    // Privy初期化を待つ
    if (!isReady) {
      setPhase('waiting-wallet');
      return;
    }


    // 既にログイン済み + ウォレットあり → 即publish
    if (isAuthenticated && walletAddress) {
      setPhase('syncing');
      await proceedToPublish(walletAddress);
      return;
    }

    // 未ログイン → Google OAuth headless ログイン
    // useLogin (PrivyElements UI) は iOS でモーダルが表示されないため、
    // useLoginWithOAuth で直接ブラウザ OAuth を使用する
    if (!isAuthenticated) {
      setPhase('logging-in');
      try {
        await loginOAuth({ provider: 'google' });
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (!msg.toLowerCase().includes('already logged in') && !msg.toLowerCase().includes('already_logged_in')) {
          setPhase('idle');
          return;
        }
      }
    }

    // ログイン完了 → ウォレットを待つ
    if (walletAddress) {
      // 既にある
      await proceedToPublish(walletAddress);
    } else {
      // ウォレット生成を待つ（useEffectが検知して自動で進む）
      setPhase('waiting-wallet');
      setPendingPublish(true);
      // 10秒タイムアウト
      setTimeout(() => {
        setPendingPublish((current) => {
          if (current) {
            Alert.alert(t('common.error'), 'Wallet creation timed out');
            setPhase('idle');
          }
          return false;
        });
      }, 10000);
    }
  };

  const handleBack = () => {
    if (phase !== 'idle') return;
    navigation.goBack();
  };

  const busy = phase !== 'idle';

  const statusLabel = {
    'idle': '',
    'logging-in': t('login.button'),
    'waiting-wallet': t('app.checking'),
    'syncing': t('common.loading'),
  }[phase];

  const previewPad = spacing.xl;
  const previewWidth = SCREEN_WIDTH - previewPad * 2;
  const multiThumbSize = (previewWidth - spacing.sm * 2) / 3;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} disabled={busy}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {signedUris.length === 1 ? (
          <Image
            source={{ uri: signedUris[0].startsWith('file://') ? signedUris[0] : `file://${signedUris[0]}` }}
            style={[styles.heroImage, { width: previewWidth, height: previewWidth * 1.1 }]}
          />
        ) : (
          <View style={[styles.multiGrid, { width: previewWidth }]}>
            {signedUris.slice(0, 6).map((uri, i) => (
              <Image
                key={i}
                source={{ uri: uri.startsWith('file://') ? uri : `file://${uri}` }}
                style={[styles.multiThumb, { width: multiThumbSize, height: multiThumbSize }]}
              />
            ))}
          </View>
        )}

        <Text style={styles.caption}>
          {t('registration.summaryTitle', { count: signedUris.length })}
        </Text>
        <Text style={styles.subCaption}>
          {t('registration.summaryText')}
        </Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.publishButton, busy && styles.publishButtonDisabled]}
          onPress={handleRegister}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.publishButtonText}>{t('registration.button')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, height: 52 },
  backButton: { width: 40, height: 40, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'center', alignItems: 'center' },
  heroImage: { borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  multiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  multiThumb: { borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  caption: { ...typography.bodyMedium, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xl },
  subCaption: { ...typography.caption, color: colors.textHint, textAlign: 'center', marginTop: spacing.xs },
  footer: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  statusText: { ...typography.caption, color: colors.textSecondary },
  publishButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, paddingVertical: 16, borderRadius: radii.md },
  publishButtonDisabled: { opacity: 0.6 },
  publishButtonText: { color: colors.white, ...typography.title },
});
