// 利用規約 / プライバシーポリシーの全文ビューア。
//
// 正本は document/v0.1.3/legal/<doc>/<locale>.md。 ビルド時に scripts/gen-legal.mjs が
// HTML 化したものを WebView で表示する (= 単一ソース、 オフライン可)。
// オンボーディング・設定の両方から開ける共通モーダル。

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Svg, { Line } from 'react-native-svg';

import { useLocale } from '../i18n';
import { getLegalDoc, type LegalDocKey } from '../content/legalDocs.generated';
import { colors, fonts, spacing } from '../theme';

interface Props {
  doc: LegalDocKey | null;
  onClose: () => void;
}

const pageHtml = (bodyHtml: string): string => `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  body { margin:0; padding:18px 18px 56px; background:${colors.paper}; color:${colors.textBody};
    font-family:-apple-system,"Hiragino Sans","Helvetica Neue",sans-serif;
    font-size:15px; line-height:1.75; -webkit-text-size-adjust:100%; }
  h1 { font-size:21px; line-height:1.4; color:${colors.ink}; margin:0 0 14px; letter-spacing:-0.01em; }
  h2 { font-size:17px; color:${colors.ink}; margin:26px 0 8px; }
  h3 { font-size:15px; color:${colors.ink}; margin:18px 0 6px; }
  p { margin:0 0 12px; }
  ul { margin:0 0 12px; padding-left:20px; }
  li { margin:0 0 6px; }
  strong { color:${colors.ink}; font-weight:600; }
  code { background:${colors.paperDeep}; padding:1px 5px; border-radius:4px; font-size:13px; }
  blockquote { margin:0 0 16px; padding:12px 14px; background:#fff;
    border:1px solid ${colors.border}; border-left:3px solid ${colors.emerald}; border-radius:10px; }
  blockquote > :last-child { margin-bottom:0; }
  table { border-collapse:collapse; width:100%; margin:0 0 12px; font-size:13px; }
  th,td { border:1px solid ${colors.border}; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#fff; color:${colors.ink}; }
  hr { border:none; border-top:1px solid ${colors.border}; margin:20px 0; }
</style></head><body>${bodyHtml}</body></html>`;

export const LegalDocModal: React.FC<Props> = ({ doc, onClose }) => {
  const locale = useLocale();
  const content = doc ? getLegalDoc(locale, doc) : null;

  return (
    <Modal
      visible={doc !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>{content?.title ?? ''}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            >
              <Svg width={16} height={16} viewBox="0 0 16 16">
                <Line x1={4} y1={4} x2={12} y2={12} stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                <Line x1={12} y1={4} x2={4} y2={12} stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
        </View>

        {content ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: pageHtml(content.html) }}
            style={styles.web}
            showsVerticalScrollIndicator={false}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },

  header: {
    paddingTop: 8,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.paper,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.serifSemibold,
    fontSize: 20,
    color: colors.ink,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  closeBtnPressed: { backgroundColor: colors.paperDeep },

  web: { flex: 1, backgroundColor: colors.paper },
});
