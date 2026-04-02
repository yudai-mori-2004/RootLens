import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Crypto from 'expo-crypto';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList, PublishResult } from '../navigation/types';
import { config } from '../config';
import { registerOnTitleProtocol } from '../services/titleProtocol';
import { readManifest } from '../native/c2paBridge';
import { colors, typography, spacing, radii, shadows } from '../theme';
import { t } from '../i18n';
import ShareBar from '../components/ShareBar';

// 仕様書 §2.4 公開パイプライン実行
// §6.1 パイプラインA: Title Protocol登録（クライアント側）
// §6.2 パイプラインB: R2直接アップロード + ページ作成
// 両パイプラインを並列実行

const DISPLAY_MAX_WIDTH = 1600;
const OGP_WIDTH = 1200;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Publishing'>;

type Phase = 'publishing' | 'done' | 'error';
type ProgressStep = 'reading' | 'extracting' | 'recording' | 'creating';

const STEP_KEYS: { key: ProgressStep; i18nKey: string }[] = [
  { key: 'reading', i18nKey: 'publishing.step.reading' },
  { key: 'extracting', i18nKey: 'publishing.step.extracting' },
  { key: 'recording', i18nKey: 'publishing.step.recording' },
  { key: 'creating', i18nKey: 'publishing.step.creating' },
];

/** ファイルパスからメディアタイプを推定 */
function detectMediaType(uri: string): 'image' | 'video' | 'audio' {
  const lower = uri.toLowerCase();
  if (lower.match(/\.(mp4|mov|m4v|avi|webm|mkv)$/)) return 'video';
  if (lower.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/)) return 'audio';
  return 'image';
}

/** メディアタイプに応じたMIMEタイプ */
function mimeForUpload(mediaType: string, ext: string): string {
  if (mediaType === 'video') return `video/${ext === 'mov' ? 'quicktime' : ext}`;
  if (mediaType === 'audio') return `audio/${ext}`;
  return 'image/jpeg';
}

export default function PublishingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { signedUris, address } = route.params;

  const [phase, setPhase] = useState<Phase>('publishing');
  const [currentStep, setCurrentStep] = useState<ProgressStep>('reading');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const publishingRef = useRef(false);
  const stepIndexRef = useRef(0);

  // ステップは前にしか進まない（並列処理で戻らないようにする）
  const advanceToStep = (step: ProgressStep) => {
    const idx = STEP_KEYS.findIndex(s => s.key === step);
    if (idx > stepIndexRef.current) {
      stepIndexRef.current = idx;
      setCurrentStep(step);
    }
  };

  // サムネイル生成（メディアタイプ別）
  const generateThumbnails = async (fileUri: string, mediaType: string) => {
    if (mediaType === 'image') {
      const [display, ogp] = await Promise.all([
        ImageManipulator.manipulateAsync(
          fileUri,
          [{ resize: { width: DISPLAY_MAX_WIDTH } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
        ),
        ImageManipulator.manipulateAsync(
          fileUri,
          [{ resize: { width: OGP_WIDTH } }],
          { compress: 0.80, format: ImageManipulator.SaveFormat.JPEG },
        ),
      ]);
      return { displayUri: display.uri, ogpUri: ogp.uri };
    }

    if (mediaType === 'video') {
      const thumb = await VideoThumbnails.getThumbnailAsync(fileUri, { time: 0 });
      const [display, ogp] = await Promise.all([
        ImageManipulator.manipulateAsync(
          thumb.uri,
          [{ resize: { width: DISPLAY_MAX_WIDTH } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
        ),
        ImageManipulator.manipulateAsync(
          thumb.uri,
          [{ resize: { width: OGP_WIDTH } }],
          { compress: 0.80, format: ImageManipulator.SaveFormat.JPEG },
        ),
      ]);
      return { displayUri: display.uri, ogpUri: ogp.uri };
    }

    // audio等: サムネイルなし（プレースホルダー）
    return { displayUri: null, ogpUri: null };
  };

  // 1件分のTP登録 + R2アップロードを実行
  const processOneContent = async (uri: string) => {
    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    const mediaType = detectMediaType(uri);
    const ext = uri.match(/\.(\w+)$/)?.[1] || 'jpg';
    const t0 = Date.now();
    const lap = (label: string) => console.log(`[PERF] ${label}: ${Date.now() - t0}ms`);

    advanceToStep('reading');

    const fileId = Crypto.randomUUID();

    advanceToStep('extracting');

    // パイプラインA (TP登録) と パイプラインB (R2アップロード) を並列実行
    const [tpResult, r2Urls] = await Promise.all([
      (async () => {
        // C2PAマニフェストから署名者情報を取得し、適切なcert extensionを選択
        lap('readManifest start');
        const manifest = await readManifest(fileUri);
        const signerOrg = manifest?.signer_org || 'RootLens';
        lap(`readManifest done (signer_org: ${signerOrg})`);

        lap('TP register start');
        const r = await registerOnTitleProtocol(fileUri, address, signerOrg, mediaType as 'image' | 'video');
        lap('TP register done');
        advanceToStep('recording');
        return r;
      })(),

      (async () => {
        // サムネイル生成
        lap('thumbnails start');
        const thumbs = await generateThumbnails(fileUri, mediaType);
        lap('thumbnails done');

        // presigned URL取得: サムネイル + OGP + (動画の場合) 本体
        const urlRequests: Promise<Response>[] = [];

        if (thumbs.displayUri) {
          urlRequests.push(
            fetch(config.uploadUrlEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId, contentType: 'image/jpeg', kind: 'content' }),
            }),
            fetch(config.uploadUrlEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId, contentType: 'image/jpeg', kind: 'ogp' }),
            }),
          );
        }

        // 動画・音声: 元ファイル本体もアップロード
        if (mediaType !== 'image') {
          urlRequests.push(
            fetch(config.uploadUrlEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId, contentType: mimeForUpload(mediaType, ext), kind: 'media' }),
            }),
          );
        }

        lap('presigned URL start');
        const urlResponses = await Promise.all(urlRequests);
        if (urlResponses.some(r => !r.ok)) {
          throw new Error('presigned URL の取得に失敗しました');
        }

        const urlData = await Promise.all(urlResponses.map(r => r.json()));
        lap('presigned URL done');

        // アップロード実行
        const uploads: Promise<any>[] = [];
        let displayPublicUrl = '';
        let ogpPublicUrl = '';
        let mediaPublicUrl = '';
        let idx = 0;

        if (thumbs.displayUri && thumbs.ogpUri) {
          displayPublicUrl = urlData[idx].publicUrl;
          uploads.push(FileSystem.uploadAsync(urlData[idx].uploadUrl, thumbs.displayUri, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          }));
          idx++;

          ogpPublicUrl = urlData[idx].publicUrl;
          uploads.push(FileSystem.uploadAsync(urlData[idx].uploadUrl, thumbs.ogpUri, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          }));
          idx++;
        }

        if (mediaType !== 'image') {
          mediaPublicUrl = urlData[idx].publicUrl;
          uploads.push(FileSystem.uploadAsync(urlData[idx].uploadUrl, fileUri, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': mimeForUpload(mediaType, ext) },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          }));
        }

        lap('R2 upload start');
        await Promise.all(uploads);
        lap('R2 upload done');

        return {
          displayPublicUrl: displayPublicUrl || mediaPublicUrl,
          ogpPublicUrl: ogpPublicUrl || displayPublicUrl || mediaPublicUrl,
          mediaUrl: mediaPublicUrl || '',
        };
      })(),
    ]);

    return {
      contentHash: tpResult.contentHash,
      txSignature: tpResult.txSignature,
      thumbnailUrl: r2Urls.displayPublicUrl,
      ogpImageUrl: r2Urls.ogpPublicUrl,
      mediaUrl: r2Urls.mediaUrl,
      mediaType,
    };
  };

  const publish = async () => {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPhase('publishing');
    setCurrentStep('reading');
    stepIndexRef.current = 0;
    setErrorMessage('');

    try {
      // 全コンテンツを一括並列処理
      const results = await Promise.all(
        signedUris.map((uri) => processOneContent(uri))
      );

      advanceToStep('creating');

      // 全コンテンツのメタデータを一括でサーバーに送信
      const publishRes = await fetch(config.publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: results.map(r => ({
            contentHash: r.contentHash,
            thumbnailUrl: r.thumbnailUrl,
            ogpImageUrl: r.ogpImageUrl,
            mediaUrl: r.mediaUrl,
            mediaType: r.mediaType,
          })),
          address: address || undefined,
        }),
      });

      if (!publishRes.ok) {
        const errBody = await publishRes.text();
        throw new Error(`ページ作成に失敗: ${errBody}`);
      }

      const serverData = await publishRes.json();

      const data: PublishResult = {
        shortId: serverData.shortId,
        pageUrl: serverData.pageUrl,
        thumbnailUrl: results[0]?.thumbnailUrl || '',
      };

      setResult(data);
      setPhase('done');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setErrorMessage(msg);
      setPhase('error');
    } finally {
      publishingRef.current = false;
    }
  };

  useEffect(() => {
    publish();
  }, []);

  const handleDone = () => {
    navigation.popToTop();
  };

  const handleShare = async () => {
    if (!result) return;
    try {
      await Share.share({ message: result.pageUrl });
    } catch (_) {}
  };

  // --- ローディング ---
  if (phase === 'publishing') {
    const currentStepIndex = STEP_KEYS.findIndex(s => s.key === currentStep);

    return (
      <SafeAreaView style={styles.loadingContainer}>
        <View style={styles.loadingSpacer} />
        <View style={styles.loadingBottom}>
          <Text style={styles.loadingTitle}>{t('publishing.loading')}</Text>
          <View style={styles.stepsContainer}>
            {STEP_KEYS.map((step, i) => {
              const isActive = i === currentStepIndex;
              const isDone = i < currentStepIndex;
              return (
                <View key={step.key} style={styles.stepRow}>
                  {isDone ? (
                    <Ionicons name="checkmark" size={16} color={colors.accent} />
                  ) : isActive ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <View style={styles.stepDotPending} />
                  )}
                  <Text style={[
                    styles.stepLabel,
                    isActive && styles.stepLabelActive,
                    isDone && styles.stepLabelDone,
                  ]}>
                    {t(step.i18nKey)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- エラー ---
  // デザイン方針: 下寄せ。エラーメッセージ+アクション。
  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <View style={styles.loadingSpacer} />
        <View style={styles.errorBottom}>
          <Text style={styles.errorTitle}>{t('publishing.errorTitle')}</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <View style={styles.errorActions}>
            <TouchableOpacity style={styles.retryButton} onPress={publish}>
              <Text style={styles.retryButtonText}>{t('publishing.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={handleDone}>
              <Text style={styles.cancelButtonText}>{t('publishing.back')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- 完了: WebViewで公開ページ表示 ---
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('publishing.doneTitle')}</Text>
        <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
          <Text style={styles.doneButtonText}>{t('publishing.done')}</Text>
        </TouchableOpacity>
      </View>

      {/* 共有バー — 仕様書 §3.7 */}
      <ShareBar
        pageUrl={result!.pageUrl}
        shortId={result!.shortId}
        thumbnailUrl={result!.thumbnailUrl}
        onShare={handleShare}
        onDelete={async () => {
          try {
            await fetch(`${config.serverUrl}/api/v1/pages/${result!.shortId}`, { method: 'DELETE' });
            handleDone();
          } catch {}
        }}
        navigation={navigation}
      />

      {/* 公開ページ WebView */}
      <WebView
        source={{ uri: result!.pageUrl }}
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // ローディング — 下寄せ
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingSpacer: {
    flex: 1,
  },
  loadingBottom: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  loadingTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  // プログレスステップ
  stepsContainer: {
    gap: spacing.lg,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 24,
  },
  stepDotPending: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  stepLabel: {
    ...typography.body,
    color: colors.textHint,
  },
  stepLabelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  stepLabelDone: {
    color: colors.textSecondary,
  },
  // エラー — 下寄せ
  errorBottom: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  errorTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
  },
  retryButtonText: {
    color: colors.white,
    ...typography.bodyMedium,
  },
  cancelButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    ...typography.bodyMedium,
  },
  // ヘッダー
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  doneButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: 18,
    borderRadius: radii.xl,
  },
  doneButtonText: {
    color: colors.white,
    ...typography.captionMedium,
  },
  // WebView
  webview: {
    flex: 1,
  },
  webviewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
