import React from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Share, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { config } from '../config';
import { colors, typography, spacing } from '../theme';
import { t } from '../i18n';
import ShareBar from '../components/ShareBar';

// 仕様書 §3.7 公開ページプレビュー

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Preview'>;

export default function PreviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const shortId = route.params.contentIds[0];
  const thumbnailUrl = route.params.thumbnailUrl || '';
  const pageUrl = `${config.serverUrl}/p/${shortId}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('preview.publishedPage')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ShareBar
        pageUrl={pageUrl}
        shortId={shortId}
        thumbnailUrl={thumbnailUrl}
        onShare={async () => { try { await Share.share({ message: pageUrl }); } catch {} }}
        onDelete={async () => {
          try {
            await fetch(`${config.serverUrl}/api/v1/pages/${shortId}`, { method: 'DELETE' });
            navigation.goBack();
          } catch {}
        }}
        navigation={navigation}
      />

      <WebView
        source={{ uri: pageUrl }}
        style={styles.webview}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <ActivityIndicator size="small" color={colors.textHint} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, height: 52,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  webview: { flex: 1 },
  webviewLoading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
