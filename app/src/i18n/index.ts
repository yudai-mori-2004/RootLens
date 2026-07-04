// 多言語化 (i18n) 基盤。 対応言語: ja (デフォルト) / en。
//
// 設計:
//   • `ja` 辞書を Source of Truth とし、 そのキー集合から TranslationKey 型を導出する。
//   • `en` は `Record<TranslationKey, string>` なので、 キー漏れは型エラーになる。
//   • `t(key, params)` は module レベルの currentLocale を読む純粋関数 (= サービス層からも呼べる)。
//   • React component は `useT()` / `useLocale()` で locale 変更時に再描画される。

import { useEffect, useState } from 'react';
import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Locale = 'ja' | 'en';

const LOCALE_KEY = 'rootlens_locale';

function getDeviceLocale(): Locale {
  let locale = 'ja';
  try {
    if (Platform.OS === 'ios') {
      locale = NativeModules.SettingsManager?.settings?.AppleLocale ||
               NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] || 'ja';
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier || 'ja';
    }
  } catch {}
  return locale.startsWith('en') ? 'en' : 'ja';
}

let currentLocale: Locale = getDeviceLocale();

type LocaleListener = (locale: Locale) => void;
const listeners: Set<LocaleListener> = new Set();

export function addLocaleListener(fn: LocaleListener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  void AsyncStorage.setItem(LOCALE_KEY, locale);
  listeners.forEach(fn => fn(locale));
}

export async function initLocale() {
  try {
    const saved = await AsyncStorage.getItem(LOCALE_KEY);
    if (saved === 'ja' || saved === 'en') {
      currentLocale = saved;
      listeners.forEach(fn => fn(currentLocale));
    }
  } catch {}
}

// ── 辞書 ───────────────────────────────────────────────────────────────
// ja を Source of Truth とする。 名前空間は画面/機能ごと (settings., home., clip., capture. ...)。

const ja = {
  // ── 共通 ──
  'common.error': 'エラー',
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.loading': '読み込み中…',
  'common.processing': '処理中…',
  'common.retry': '再試行',
  'common.done': '完了',
  'common.close': '閉じる',
  'common.back': '戻る',
  'common.save': '保存する',
  'common.saved': '保存しました',

  // ── App (起動 / デバイス証明書ゲート) ──
  'app.deviceCertificate': 'デバイス証明書',
  'app.checking': '確認中…',
  'app.provisioning': '取得中…',
  'app.setupFailed': 'セットアップに失敗しました',
  'app.unknownError': '原因不明のエラー',
  'app.retry': '再試行',

  // ── Settings ──
  'settings.title': '設定',
  'settings.subtitle': 'RootLens · フィジカル AI 訓練データ市場',
  'settings.section.account': 'アカウント',
  'settings.section.notifications': '通知',
  'settings.section.capture': '撮影',
  'settings.section.data': 'データ',
  'settings.section.support': 'サポート',
  'settings.section.appInfo': 'アプリ情報',
  'settings.section.developer': 'デベロッパー',
  'settings.section.language': '言語',

  'settings.wallet': 'ウォレット',
  'settings.unauthenticated': '未認証',
  'settings.authProvider': '認証プロバイダ',
  'settings.kycStatus': 'KYC 状態',
  'settings.kycPending': '未対応 (= 次の更新で実装)',

  'settings.pushNotifications': 'プッシュ通知',
  'settings.pushNotificationsDesc': 'クリップ処理完了 / ライセンス販売の通知',
  'settings.pushNotImplemented': '未実装 (= expo-notifications 統合予定)',

  'settings.handOverlay': 'ハンドトラッキング表示',
  'settings.handOverlayDesc': 'プレビュー上に手のスケルトンを描画',
  'settings.handOverlaySoon': '次の更新で有効化',
  'settings.recalibrate': 'キャリブレーション再校正',
  'settings.bgmTrack': 'BGM トラック',

  'settings.storageUsage': 'ストレージ使用量',
  'settings.calculating': '計算中…',
  'settings.clearCache': 'キャッシュをクリア',
  'settings.clearCacheTitle': 'キャッシュをクリア',
  'settings.clearCacheMessage': '撮影中の一時ファイルを削除します。 アップロード待ちのクリップは消えません。',

  'settings.terms': '利用規約',
  'settings.privacy': 'プライバシーポリシー',
  'settings.contact': 'お問い合わせ',

  'settings.version': 'バージョン',
  'settings.build': 'ビルド',
  'settings.githubRepo': 'GitHub リポジトリ',

  'settings.languageLabel': '表示言語',
  'settings.languageDesc': 'アプリ全体の表示言語と音声案内',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  'settings.signOut': 'サインアウト',
  'settings.signingOut': 'サインアウト中…',
  'settings.signOutDebugMessage': 'デバッグウォレットを削除して再生成します。 撮影済みクリップは新しい wallet からは見えなくなります。',
  'settings.signOutMessage': 'サインアウトします。',

  // ── Home / Collection ──
  'home.collection': 'コレクション',
  'home.lifetimeEarnings': '累計収益',
  'home.licensesSold': 'ライセンス販売',
  'home.clips': 'クリップ',
  'home.yourClips': 'あなたのクリップ',
  'home.yourClipsHint': '撮影したクリップはここで状態が見えます。 「準備完了」 のカードをタップするとステーキング画面が開きます。',
  'home.dasError': 'DAS エラー',
  'home.noWallet': 'ウォレットなし',
  'home.noWalletHint': '認証 provider が初期化中、 もしくは未認証です。 設定画面で確認してください。',
  'home.noClipsYet': 'まだクリップがありません',
  'home.noClipsHint': '中央のカメラボタンから撮影を始めると、 撮影完了後ここに表示されます。',

  // ── Clip card ──
  'clip.uploading': 'アップロード中',
  'clip.uploaded': 'アップロード済み',
  'clip.processing': '準備中…',
  'clip.ready': '準備完了',
  'clip.qualityReward': '品質 {score} · ${low}〜${high}',
  'clip.stakeCta': '出品',
  'clip.statusStaked': '販売中',
  'clip.statLic': 'ライセンス',
  'clip.statEarned': '収益',
  'clip.errorEyebrow': '処理エラー',
  'clip.errorDefault': 'サーバ処理が失敗しました。 タップで詳細を確認。',
  'clip.tryAgain': 'もう一度試す',
  'clip.viewDetailA11y': 'クリップの詳細を見る',
  'clip.viewErrorA11y': 'クリップのエラー詳細を見る',

  // ── 出品シート (= 旧 Stake sheet) ──
  'stake.title': '出品の確認',
  'stake.clipEyebrow': '動画',
  'stake.blurPreview': 'ぼかしの確認',
  'stake.blurPreviewHint': '再生して、 顔と文字がきちんとぼかされているか確認してください',
  'stake.qualityScore': '品質スコア',
  'stake.qualityScoreHint': '自動でつけた評価です',
  'stake.rewardRange': '想定の報酬',
  'stake.rewardRangeHint': '売れたときの目安です。 実際の価格は別途決まります',
  'stake.confirmHeading': '出品の前に、 2つだけ確認',
  'stake.attestTitle': '撮影内容の確認',
  'stake.attestBody': 'この動画には、 自分以外の人・お子さん・浴室など人に見られたくない場所が映っていません。',
  'stake.irrevocableTitle': '取り消せない点について',
  'stake.consentBody': 'この動画を AI の学習用データとして販売することに同意します。 一度売れると、 買った会社からは取り消せません。',
  'stake.cta': '出品する',
  'stake.confirmTitle': '出品しますか？',
  'stake.confirmBody': '出品すると、 この動画は AI 企業に売れるようになります。 一度売れると、 買った会社からは取り消せません。',
  'stake.confirmExecute': '出品する',
  'stake.previewPreparing': 'プレビューを準備中…',
  'stake.previewNotReady': 'プレビュー準備中',
  'stake.totalScore': '合計スコア',
  'stake.layer1': 'Layer 1 メタデータ',
  'stake.layer2': 'Layer 2 フレーム解析',
  'stake.layer3': 'Layer 3 VLM 採点',

  // ── Clip detail sheet ──
  'detail.qualityScore': '品質スコア',
  'detail.breakdown': '内訳',
  'detail.onChain': 'オンチェーン',
  'detail.signatureHash': '署名ハッシュ',
  'detail.error': 'エラー',
  'detail.scoringInProgress': 'まだ採点中です。',
  'detail.noBreakdown': 'スコア内訳がありません。',
  'detail.rootAsset': 'ルートアセット',
  'detail.delegate': 'デリゲート',
  'detail.licensesSold': '売れた数',
  'detail.revenue': '収入',
  'detail.stakeThisClip': 'この動画を出品する',
  'detail.scoreHint': '自動でつけた評価です',
  'detail.sales': '販売状況',
  'detail.showDetails': '詳しい内訳',
  'detail.deleteThis': 'この動画を削除',

  // ── Capture flow: ガード / UI ──
  'capture.preparing': '準備中…',
  'capture.permissionTitle': '権限が必要です',
  'capture.permissionBody': 'iOS 設定でカメラを許可してください。',
  'capture.unsupportedTitle': '非対応端末',
  'capture.unsupportedBody': 'この端末では対応する撮影構成がありません。',
  'capture.switchingConfig': '構成切替中… (→ {config})',
  'capture.previewStarting': 'プレビュー起動待ち…',
  'capture.emergencyStop': '緊急停止',
  'capture.recStartFailed': '録画開始失敗',
  'capture.recStopFailed': '録画停止失敗',
  'capture.recordStartA11y': '録画を開始',
  'capture.recordStopA11y': '録画を停止',
  'capture.stopConfirmTitle': '録画を終了しますか？',
  'capture.stopConfirmStop': '終了する',
  'capture.stopConfirmContinue': '続ける',
  'capture.uploadDone': 'アップロード完了',

  // ── Onboarding ──
  'onb.slide1.eyebrow': 'おうちで、 かんたん',
  'onb.slide1.headline': '家事をするだけ。',
  'onb.slide1.body': 'カメラを身につけて、 いつもの家事をするだけ。 むずかしい操作はいりません。',
  'onb.slide2.eyebrow': 'プライバシー',
  'onb.slide2.headline': '顔は自動でぼかします。',
  'onb.slide2.body': '送る前に、 端末の中で顔をぼかします。 元の映像はそのまま外に出ません。',
  'onb.slide3.eyebrow': 'おこづかいに',
  'onb.slide3.headline': '売れたら、 収入に。',
  'onb.slide3.body': '撮った動画が AI の学習に使われると、 報酬が入ります。',
  'onb.skip': 'スキップ',
  'onb.continue': '次へ',
  'onb.tosEyebrow': 'ステップ 2 / 2 · 利用規約',
  'onb.tosHeadline': '使い始める前に。',
  'onb.tosLede': 'RootLens を使うと、 動画の撮影・保存・販売について、 利用規約とプライバシーポリシーに同意したことになります。 特に大切な点をまとめました。',
  'onb.bullet1': '撮った動画は、 AI やロボットの学習用データとして企業に販売されることがあります。',
  'onb.bullet2': '売れる前ならいつでも削除できます。 ただし一度売れた後は、 買った企業の手元からは取り消せません。',
  'onb.bullet3': '撮影は、 ご自身だけが映るようにしてください。 ご家族や来客、 お子さんは映さないでください。',
  'onb.bullet4': '浴室・寝室・トイレや、 人の顔・名前・書類など、 人に見られたくないものが映る場所では撮影しないでください。',
  'onb.tosConsent': '利用規約 と プライバシーポリシー を読み、 同意します',

  // ── Login ──
  'login.heroLineA': '家事を、 撮る。',
  'login.heroBPrefix': '',
  'login.heroBAccent': 'AI',
  'login.heroBSuffix': ' から稼ぐ。',
  'login.lede': '端末を装着したまま家事を記録。 クリップは署名・顔ぼかしされ、 あなたが所有する Root NFT として Solana 上にミントされます。',
  'login.debugWallet': 'デバッグウォレット · 自動生成',
  'login.providerNote': 'Privy 埋め込みウォレットは次の更新で。 今は端末ローカルにデバッグ wallet を作成して使います。',
  'login.signInFailed': 'サインイン失敗',
  'login.signIn': 'サインイン',
  'login.tos': '続行することで利用規約とプライバシーポリシーに同意したものとみなされます。',

  // ── Tab bar ──
  'tab.home': 'ホーム',
  'tab.settings': '設定',
  'tab.captureA11y': '撮影モードを開始',

  // ── マイビデオ (= 旧 Collection / ポートフォリオ。 主婦向けに平易語) ──
  'portfolio.title': 'マイビデオ',
  // 温かい挨拶 (= 家事感。 web くさい固定タイトルの代わりに、 時間帯であいさつ)
  'portfolio.greetingMorning': 'おはようございます',
  'portfolio.greetingDay': 'こんにちは',
  'portfolio.greetingEvening': 'こんばんは',
  'portfolio.greetingNight': 'おつかれさまです',
  'portfolio.greetingSub': 'おうちの時間が、 少しずつ収入になります',
  'portfolio.modeTimeA11y': '撮影時間を見る',
  'portfolio.modeMoneyA11y': '収入を見る',
  'portfolio.totalCaptureTime': 'これまでの撮影時間',
  'portfolio.dailyCapture': '日ごとの撮影時間',
  'portfolio.totalRevenue': 'これまでの収入',
  'portfolio.soldHours': '売れた動画の時間',
  'portfolio.sold': '売れた数',
  'portfolio.cumulativeRevenue': '収入の推移',
  'portfolio.noEarningsYet': 'まだ収入はありません',
  'portfolio.incomeEmptyHint': '出品した動画が売れると、 ここに収入が増えていきます',
  'portfolio.noCaptureYet': 'まだ撮影がありません',
  'portfolio.sectionAwaiting': '準備中',
  'portfolio.sectionApproval': '出品できます',
  'portfolio.sectionOnSale': '販売中',
  'portfolio.sectionAwaitingHint': '準備が終わるまで少しお待ちください',
  'portfolio.sectionApprovalHint': '内容を確認して出品しましょう',
  'portfolio.sectionOnSaleHint': '今 販売している動画です',
  'portfolio.emptyTitle': 'まだ動画がありません',
  'portfolio.emptyHint': '中央のカメラボタンから撮影を始めると、 ここに並びます。',
} as const;

export type TranslationKey = keyof typeof ja;

const en: Record<TranslationKey, string> = {
  // ── Common ──
  'common.error': 'Error',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.loading': 'Loading…',
  'common.processing': 'Processing…',
  'common.retry': 'Retry',
  'common.done': 'Done',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.saved': 'Saved',

  // ── App (startup / device certificate gate) ──
  'app.deviceCertificate': 'Device certificate',
  'app.checking': 'Checking…',
  'app.provisioning': 'Provisioning…',
  'app.setupFailed': 'Setup failed',
  'app.unknownError': 'Unknown error',
  'app.retry': 'Retry',

  // ── Settings ──
  'settings.title': 'Settings',
  'settings.subtitle': 'RootLens · Physical AI training-data marketplace',
  'settings.section.account': 'Account',
  'settings.section.notifications': 'Notifications',
  'settings.section.capture': 'Capture',
  'settings.section.data': 'Data',
  'settings.section.support': 'Support',
  'settings.section.appInfo': 'About',
  'settings.section.developer': 'Developer',
  'settings.section.language': 'Language',

  'settings.wallet': 'Wallet',
  'settings.unauthenticated': 'Not signed in',
  'settings.authProvider': 'Auth provider',
  'settings.kycStatus': 'KYC status',
  'settings.kycPending': 'Coming in a future update',

  'settings.pushNotifications': 'Push notifications',
  'settings.pushNotificationsDesc': 'Clip processing & license sale alerts',
  'settings.pushNotImplemented': 'Not yet available (expo-notifications)',

  'settings.handOverlay': 'Hand-tracking overlay',
  'settings.handOverlayDesc': 'Draw the hand skeleton over the preview',
  'settings.handOverlaySoon': 'Coming in a future update',
  'settings.recalibrate': 'Recalibrate',
  'settings.bgmTrack': 'BGM track',

  'settings.storageUsage': 'Storage used',
  'settings.calculating': 'Calculating…',
  'settings.clearCache': 'Clear cache',
  'settings.clearCacheTitle': 'Clear cache',
  'settings.clearCacheMessage': 'Deletes temporary capture files. Clips waiting to upload are kept.',

  'settings.terms': 'Terms of Service',
  'settings.privacy': 'Privacy Policy',
  'settings.contact': 'Contact',

  'settings.version': 'Version',
  'settings.build': 'Build',
  'settings.githubRepo': 'GitHub repository',

  'settings.languageLabel': 'Display language',
  'settings.languageDesc': 'App display language and voice guidance',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  'settings.signOut': 'Sign out',
  'settings.signingOut': 'Signing out…',
  'settings.signOutDebugMessage': 'Deletes and regenerates the debug wallet. Captured clips will no longer be visible from the new wallet.',
  'settings.signOutMessage': 'You will be signed out.',

  // ── Home / Collection ──
  'home.collection': 'Collection',
  'home.lifetimeEarnings': 'Lifetime earnings',
  'home.licensesSold': 'Licenses sold',
  'home.clips': 'Clips',
  'home.yourClips': 'Your clips',
  'home.yourClipsHint': 'Track the status of your captured clips here. Tap a “Ready” card to open the staking screen.',
  'home.dasError': 'DAS error',
  'home.noWallet': 'No wallet',
  'home.noWalletHint': 'The auth provider is initializing, or you are not signed in. Check the Settings screen.',
  'home.noClipsYet': 'No clips yet',
  'home.noClipsHint': 'Start capturing with the center camera button — finished clips appear here.',

  // ── Clip card ──
  'clip.uploading': 'Uploading',
  'clip.uploaded': 'Uploaded',
  'clip.processing': 'Preparing…',
  'clip.ready': 'Ready',
  'clip.qualityReward': 'Quality {score} · ${low}–${high}',
  'clip.stakeCta': 'Sell',
  'clip.statusStaked': 'On sale',
  'clip.statLic': 'Lic',
  'clip.statEarned': 'Earned',
  'clip.errorEyebrow': 'Processing error',
  'clip.errorDefault': 'Server processing failed. Tap for details.',
  'clip.tryAgain': 'Try again',
  'clip.viewDetailA11y': 'View clip details',
  'clip.viewErrorA11y': 'View clip error details',

  // ── Listing sheet (= former Stake sheet) ──
  'stake.title': 'Confirm listing',
  'stake.clipEyebrow': 'Video',
  'stake.blurPreview': 'Blur check',
  'stake.blurPreviewHint': 'Play it back and check that faces and text are blurred.',
  'stake.qualityScore': 'Quality score',
  'stake.qualityScoreHint': 'An automatic rating.',
  'stake.rewardRange': 'Estimated payout',
  'stake.rewardRangeHint': 'A guide for when it sells; the actual price is set separately.',
  'stake.confirmHeading': 'Two quick checks before listing',
  'stake.attestTitle': 'Check what’s in the video',
  'stake.attestBody': 'No one other than me — no children, and no private places like bathrooms — appears in this video.',
  'stake.irrevocableTitle': 'About irreversibility',
  'stake.consentBody': 'I agree to sell this video as training data for AI. Once it sells, it cannot be taken back from the company that bought it.',
  'stake.cta': 'List for sale',
  'stake.confirmTitle': 'List this video?',
  'stake.confirmBody': 'Once listed, this video can be sold to AI companies. After it sells, it cannot be taken back from the company that bought it.',
  'stake.confirmExecute': 'List',
  'stake.previewPreparing': 'Preparing preview…',
  'stake.previewNotReady': 'Preview not ready',
  'stake.totalScore': 'Total score',
  'stake.layer1': 'Layer 1 · Metadata',
  'stake.layer2': 'Layer 2 · Frame analysis',
  'stake.layer3': 'Layer 3 · VLM scoring',

  // ── Clip detail sheet ──
  'detail.qualityScore': 'Quality score',
  'detail.breakdown': 'Breakdown',
  'detail.onChain': 'On-chain',
  'detail.signatureHash': 'Signature hash',
  'detail.error': 'Error',
  'detail.scoringInProgress': 'Scoring still in progress.',
  'detail.noBreakdown': 'No score breakdown available.',
  'detail.rootAsset': 'Root asset',
  'detail.delegate': 'Delegate',
  'detail.licensesSold': 'Sold',
  'detail.revenue': 'Income',
  'detail.stakeThisClip': 'List this video',
  'detail.scoreHint': 'An automatic rating',
  'detail.sales': 'Sales',
  'detail.showDetails': 'Details',
  'detail.deleteThis': 'Delete this video',

  // ── Capture flow: guards / UI ──
  'capture.preparing': 'Preparing…',
  'capture.permissionTitle': 'Permission required',
  'capture.permissionBody': 'Please allow camera access in iOS Settings.',
  'capture.unsupportedTitle': 'Unsupported device',
  'capture.unsupportedBody': 'No supported capture configuration is available on this device.',
  'capture.switchingConfig': 'Switching config… (→ {config})',
  'capture.previewStarting': 'Starting preview…',
  'capture.emergencyStop': 'Emergency stop',
  'capture.recStartFailed': 'Failed to start recording',
  'capture.recStopFailed': 'Failed to stop recording',
  'capture.recordStartA11y': 'Start recording',
  'capture.recordStopA11y': 'Stop recording',
  'capture.stopConfirmTitle': 'Stop recording?',
  'capture.stopConfirmStop': 'Stop',
  'capture.stopConfirmContinue': 'Keep going',
  'capture.uploadDone': 'Upload complete',

  // ── Onboarding ──
  'onb.slide1.eyebrow': 'Easy, at home',
  'onb.slide1.headline': 'Just do your chores.',
  'onb.slide1.body': 'Wear the camera and just do your usual chores. No complicated steps.',
  'onb.slide2.eyebrow': 'Privacy',
  'onb.slide2.headline': 'Faces blurred automatically.',
  'onb.slide2.body': 'Faces are blurred on your device before anything is sent. The original footage never leaves your phone.',
  'onb.slide3.eyebrow': 'A little income',
  'onb.slide3.headline': 'When it sells, you earn.',
  'onb.slide3.body': 'When your video is used to train AI, you receive a reward.',
  'onb.skip': 'Skip',
  'onb.continue': 'Continue',
  'onb.tosEyebrow': 'Step 2 of 2 · Terms of use',
  'onb.tosHeadline': 'Before you begin.',
  'onb.tosLede': 'Using RootLens means you agree to the Terms of Service and Privacy Policy for recording, storing, and selling videos. Here are the key points.',
  'onb.bullet1': 'Videos you record may be sold to companies as training data for AI and robots.',
  'onb.bullet2': 'You can delete a video anytime before it sells. Once it has sold, it cannot be taken back from the company that bought it.',
  'onb.bullet3': 'Record only yourself. Do not film family members, visitors, or children.',
  'onb.bullet4': 'Do not record in bathrooms, bedrooms, or toilets, or anywhere private things — faces, names, documents — would appear.',
  'onb.tosConsent': 'I have read and agree to the Terms of Service and Privacy Policy',

  // ── Login ──
  'login.heroLineA': 'Capture chores.',
  'login.heroBPrefix': 'Earn from ',
  'login.heroBAccent': 'AI labs.',
  'login.heroBSuffix': '',
  'login.lede': 'Record household tasks while wearing the phone. The clip is signed, blurred, and minted on Solana as a Root NFT you own.',
  'login.debugWallet': 'Debug wallet · auto-generated',
  'login.providerNote': 'Privy embedded wallet is coming in a future update. For now a debug wallet is created locally on your device.',
  'login.signInFailed': 'Sign-in failed',
  'login.signIn': 'Sign in',
  'login.tos': 'By continuing, you agree to the Terms of Service and Privacy Policy.',

  // ── Tab bar ──
  'tab.home': 'Home',
  'tab.settings': 'Settings',
  'tab.captureA11y': 'Start capture mode',

  // ── My Videos (= former Collection / Portfolio。 plain language) ──
  'portfolio.title': 'My Videos',
  'portfolio.greetingMorning': 'Good morning',
  'portfolio.greetingDay': 'Good afternoon',
  'portfolio.greetingEvening': 'Good evening',
  'portfolio.greetingNight': 'Working late?',
  'portfolio.greetingSub': 'Your time at home, slowly becoming income',
  'portfolio.modeTimeA11y': 'Show capture time',
  'portfolio.modeMoneyA11y': 'Show income',
  'portfolio.totalCaptureTime': 'Total capture time',
  'portfolio.dailyCapture': 'Daily capture time',
  'portfolio.totalRevenue': 'Total income',
  'portfolio.soldHours': 'Hours of sold videos',
  'portfolio.sold': 'Sold',
  'portfolio.cumulativeRevenue': 'Income over time',
  'portfolio.noEarningsYet': 'No income yet',
  'portfolio.incomeEmptyHint': 'Once your listed videos sell, your income grows here',
  'portfolio.noCaptureYet': 'No captures yet',
  'portfolio.sectionAwaiting': 'Preparing',
  'portfolio.sectionApproval': 'Ready to list',
  'portfolio.sectionOnSale': 'On sale',
  'portfolio.sectionAwaitingHint': 'Hang tight while these get ready',
  'portfolio.sectionApprovalHint': 'Review and list them for sale',
  'portfolio.sectionOnSaleHint': 'These are on sale now',
  'portfolio.emptyTitle': 'No videos yet',
  'portfolio.emptyHint': 'Start capturing with the center camera button — your videos appear here.',
};

const dictionaries: Record<Locale, Record<string, string>> = { ja, en };

/**
 * 翻訳テキストを取得する。
 * @param key    翻訳キー (例: 'settings.title')
 * @param params プレースホルダー置換 (例: { count: 3 } → '{count}' を置換)
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] ?? dictionaries.ja;
  let text = dict[key] ?? dictionaries.ja[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** 現在の locale を購読する hook (= 言語切替で再描画)。 */
export function useLocale(): Locale {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);
  useEffect(() => addLocaleListener(setLocaleState), []);
  return locale;
}

/**
 * locale を購読しつつ翻訳関数 `t` を返す hook。
 * 言語切替時に呼び出し component が再描画される。
 *   const t = useT();
 *   <Text>{t('settings.title')}</Text>
 */
export function useT(): typeof t {
  useLocale();
  return t;
}
