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
  'clip.processing': 'サーバで処理中…',
  'clip.ready': '準備完了',
  'clip.qualityReward': '品質 {score} · ${low}〜${high}',
  'clip.stakeCta': 'ステーク',
  'clip.statusStaked': 'ステーク済',
  'clip.statLic': 'ライセンス',
  'clip.statEarned': '収益',
  'clip.errorEyebrow': '処理エラー',
  'clip.errorDefault': 'サーバ処理が失敗しました。 タップで詳細を確認。',
  'clip.tryAgain': 'もう一度試す',
  'clip.viewDetailA11y': 'クリップの詳細を見る',
  'clip.viewErrorA11y': 'クリップのエラー詳細を見る',

  // ── Stake sheet ──
  'stake.title': 'ステーキング',
  'stake.clipEyebrow': 'クリップ',
  'stake.blurPreview': 'ぼかし済みプレビュー',
  'stake.blurPreviewHint': '再生して、 顔と文字が全フレームで適切にぼかされているか確認してください',
  'stake.qualityScore': '品質スコア',
  'stake.qualityScoreHint': 'サーバ側パイプラインによる評価結果',
  'stake.rewardRange': '想定報酬レンジ',
  'stake.rewardRangeHint': 'ライセンス販売時の参考値、 実販売価格は別途決定',
  'stake.irrevocableTitle': '撤回できない点について',
  'stake.consentBody': 'このクリップについて License NFT が 1 つでも発行された後は、 撤回はできません。 ステーキングを解除しても既発行のライセンスは永続します。 上記を理解しました。',
  'stake.cta': 'ステーキングする',
  'stake.confirmTitle': '本当にステーキングしますか？',
  'stake.confirmBody': 'ステーキング後、 このクリップは AI 企業に対するライセンス販売の対象となります。 License NFT 発行後は撤回できません。',
  'stake.confirmExecute': '実行する',
  'stake.previewPreparing': 'プレビュー動画を準備中…',
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
  'detail.licensesSold': 'ライセンス販売数',
  'detail.revenue': '収益',
  'detail.stakeThisClip': 'このクリップをステークする',

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

  // ── Capture flow: 状態ピル (= 画面上部中央) ──
  'capture.state.announcing': 'CALIBRATE  ·  案内中…',
  'capture.state.nextTaskAnnouncing': '撮影完了  ·  案内中…',
  'capture.state.awaitingPalm': 'CALIBRATE  ·  両手の手のひらを見つめて 3 秒',
  'capture.state.palmHolding': 'CALIBRATE  ·  検出中…',
  'capture.state.calibratePrefix': 'CALIBRATE',
  'capture.state.calibrated': 'CALIBRATED  ·  まもなく開始',
  'capture.state.starting': 'STARTING',
  'capture.state.recording': 'RECORDING  ·  グッドサインで終了',
  'capture.state.stopping': 'STOPPING  ·  グッドサイン検出',
  'capture.state.stoppingConfirm': 'STOPPING  ·  立て続けると終了',
  'capture.state.finalizing': 'FINALIZING',

  // ── Capture flow: ヘッドセット向き案内 (= ピル内) ──
  'capture.guide.up': 'ヘッドセットをもう少し上に向けてください',
  'capture.guide.down': 'ヘッドセットをもう少し下に向けてください',
  'capture.guide.left': 'ヘッドセットをもう少し左に向けてください',
  'capture.guide.right': 'ヘッドセットをもう少し右に向けてください',

  // ── Capture flow: 音声ガイド (TTS、 機内アナウンス調) ──
  // ⚠ ja TTS 読み間違い回避: 「方」(かた)・「開いて」(あいて) は使わない。
  'capture.tts.intro': 'ヘッドセットの装着角度を合わせます。 ヘッドセットを装着し、 自然な姿勢で、 両手のひらを広げて、 ご自身の手のひらをご覧ください。 そのまま 3 秒ほど、 そっと止めてお待ちください。',
  'capture.tts.confirmed': '位置が確定いたしました。 これより撮影を開始いたします。',
  'capture.tts.done': '撮影が完了いたしました。 お疲れさまでした。',
  'capture.tts.continue': '引き続き撮影される場合は、 もう一度、 ご自身の手のひらをご覧ください。',
  'capture.tts.adjustUp': '手が画面の上に寄っています。 ヘッドセットを少し上へ向け直し、 もう一度手のひらをご覧ください。',
  'capture.tts.adjustDown': '手が画面の下に寄っています。 ヘッドセットを少し下へ向け直し、 もう一度手のひらをご覧ください。',
  'capture.tts.adjustLeft': '手が画面の左に寄っています。 ヘッドセットを少し左へ向け直し、 もう一度手のひらをご覧ください。',
  'capture.tts.adjustRight': '手が画面の右に寄っています。 ヘッドセットを少し右へ向け直し、 もう一度手のひらをご覧ください。',
  'capture.tts.stoppingConfirm': 'そのまま親指を立て続けると、 撮影を終了します',
  'capture.tts.handLost': '両手がカメラに映るようにしてください',

  // ── Onboarding ──
  'onb.slide1.eyebrow': '撮影',
  'onb.slide1.headline': '家事を、 そのまま記録。',
  'onb.slide1.body': 'カメラを頭やネックストラップに装着して、 普段の家事をそのまま記録。 ジェスチャーで開始 / 終了。',
  'onb.slide2.eyebrow': 'プライバシー',
  'onb.slide2.headline': '顔は端末上でぼかし。',
  'onb.slide2.body': 'Apple Vision で映像内の顔を端末上でぼかしてから署名 + アップロード。 元映像はサーバに送りません。',
  'onb.slide3.eyebrow': '収益',
  'onb.slide3.headline': 'クリップを NFT として所有。',
  'onb.slide3.body': '署名済クリップは Solana 上の Root NFT になります。 AI 企業がライセンス購入すると USDC で収益発生。',
  'onb.skip': 'スキップ',
  'onb.continue': '次へ',
  'onb.tosEyebrow': 'ステップ 2 / 2 · 利用規約',
  'onb.tosHeadline': '使い始める前に。',
  'onb.tosLede': 'RootLens を使うと、 撮影 / アップロード / NFT 化 / ライセンス販売の各処理に同意したことになります。 概要を確認のうえ、 全文へのリンクから本文をチェックしてください。',
  'onb.bullet1': '撮影クリップは端末上で顔ぼかし + C2PA 署名され、 暗号化ストレージに保存されます。',
  'onb.bullet2': 'ステーキング後、 ライセンスを購入した AI 企業に映像が引き渡されます。 撤回はできません。',
  'onb.bullet3': 'ライセンス売上の 95% が撮影者、 5% が運営に分配されます。',
  'onb.bullet4': '本人が映る場合のみ撮影してください。 第三者の顔は端末側ぼかしで対応しますが、 居住者の同意は撮影者の責任で取得してください。',
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
  'clip.processing': 'Processing on server…',
  'clip.ready': 'Ready',
  'clip.qualityReward': 'Quality {score} · ${low}–${high}',
  'clip.stakeCta': 'Stake',
  'clip.statusStaked': 'Staked',
  'clip.statLic': 'Lic',
  'clip.statEarned': 'Earned',
  'clip.errorEyebrow': 'Processing error',
  'clip.errorDefault': 'Server processing failed. Tap for details.',
  'clip.tryAgain': 'Try again',
  'clip.viewDetailA11y': 'View clip details',
  'clip.viewErrorA11y': 'View clip error details',

  // ── Stake sheet ──
  'stake.title': 'Staking',
  'stake.clipEyebrow': 'Clip',
  'stake.blurPreview': 'Blurred preview',
  'stake.blurPreviewHint': 'Play it back and confirm that faces and text are properly blurred in every frame.',
  'stake.qualityScore': 'Quality score',
  'stake.qualityScoreHint': 'Evaluated by the server-side pipeline',
  'stake.rewardRange': 'Estimated reward range',
  'stake.rewardRangeHint': 'A reference for license sales; the actual sale price is set separately.',
  'stake.irrevocableTitle': 'About irrevocability',
  'stake.consentBody': 'Once even a single License NFT has been issued for this clip, it cannot be revoked. Existing licenses persist even if you unstake. I understand the above.',
  'stake.cta': 'Stake',
  'stake.confirmTitle': 'Stake this clip?',
  'stake.confirmBody': 'After staking, this clip becomes available for license sales to AI companies. It cannot be revoked once a License NFT is issued.',
  'stake.confirmExecute': 'Confirm',
  'stake.previewPreparing': 'Preparing preview video…',
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
  'detail.licensesSold': 'Licenses sold',
  'detail.revenue': 'Revenue',
  'detail.stakeThisClip': 'Stake this clip',

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

  // ── Capture flow: status pill ──
  'capture.state.announcing': 'CALIBRATE  ·  Guiding…',
  'capture.state.nextTaskAnnouncing': 'CAPTURE DONE  ·  Guiding…',
  'capture.state.awaitingPalm': 'CALIBRATE  ·  Gaze at both palms for 3s',
  'capture.state.palmHolding': 'CALIBRATE  ·  Detecting…',
  'capture.state.calibratePrefix': 'CALIBRATE',
  'capture.state.calibrated': 'CALIBRATED  ·  Starting soon',
  'capture.state.starting': 'STARTING',
  'capture.state.recording': 'RECORDING  ·  Thumbs-up to finish',
  'capture.state.stopping': 'STOPPING  ·  Thumbs-up detected',
  'capture.state.stoppingConfirm': 'STOPPING  ·  Hold to finish',
  'capture.state.finalizing': 'FINALIZING',

  // ── Capture flow: headset guidance ──
  'capture.guide.up': 'Tilt the headset a little upward',
  'capture.guide.down': 'Tilt the headset a little downward',
  'capture.guide.left': 'Turn the headset a little to the left',
  'capture.guide.right': 'Turn the headset a little to the right',

  // ── Capture flow: voice guidance (TTS, airline-announcement tone) ──
  'capture.tts.intro': 'Let’s align your headset. Put it on, relax, open both palms, and look at your own hands. Hold still for about three seconds.',
  'capture.tts.confirmed': 'Your position is confirmed. We will now begin recording.',
  'capture.tts.done': 'Recording complete. Nicely done.',
  'capture.tts.continue': 'To record again, simply look at your own palms once more.',
  'capture.tts.adjustUp': 'Your hands are near the top of the frame. Tilt the headset up a little and look at your palms again.',
  'capture.tts.adjustDown': 'Your hands are near the bottom of the frame. Tilt the headset down a little and look at your palms again.',
  'capture.tts.adjustLeft': 'Your hands are toward the left of the frame. Turn the headset left a little and look at your palms again.',
  'capture.tts.adjustRight': 'Your hands are toward the right of the frame. Turn the headset right a little and look at your palms again.',
  'capture.tts.stoppingConfirm': 'Keep holding your thumbs up to finish recording.',
  'capture.tts.handLost': 'Please keep both hands in view of the camera.',

  // ── Onboarding ──
  'onb.slide1.eyebrow': 'Capture',
  'onb.slide1.headline': 'Record household chores.',
  'onb.slide1.body': 'Wear the camera on your head or a neck strap and record everyday chores. Start and stop with a gesture.',
  'onb.slide2.eyebrow': 'Privacy',
  'onb.slide2.headline': 'Faces blurred on device.',
  'onb.slide2.body': 'Faces are blurred on-device with Apple Vision before signing and upload. The original footage never leaves your device.',
  'onb.slide3.eyebrow': 'Earn',
  'onb.slide3.headline': 'Own each clip as an NFT.',
  'onb.slide3.body': 'Signed clips become Root NFTs on Solana. When AI companies buy a license, you earn USDC.',
  'onb.skip': 'Skip',
  'onb.continue': 'Continue',
  'onb.tosEyebrow': 'Step 2 of 2 · Terms of use',
  'onb.tosHeadline': 'Before you begin.',
  'onb.tosLede': 'Using RootLens means you agree to capture, upload, NFT minting, and license sales. Review the summary below, then read the full text via the links.',
  'onb.bullet1': 'Captured clips are face-blurred and C2PA-signed on device, then stored in encrypted storage.',
  'onb.bullet2': 'After staking, footage is handed to the AI companies who buy a license. This cannot be revoked.',
  'onb.bullet3': '95% of license revenue goes to the creator, 5% to operations.',
  'onb.bullet4': 'Only record when you yourself are in frame. Third-party faces are blurred on device, but obtaining residents’ consent is the creator’s responsibility.',
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
