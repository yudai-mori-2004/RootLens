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
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.close': '閉じる',
  'common.back': '戻る',


  // ── Settings ──
  'settings.title': '設定',
  'settings.subtitle': 'アカウントとアプリの設定',
  'settings.section.account': 'アカウント',
  'settings.section.app': 'アプリ',
  'settings.section.capture': '撮影',
  'settings.section.support': 'サポート',
  'settings.section.developer': 'デベロッパー',

  'settings.accountId': 'アカウントID',
  'settings.unauthenticated': '未認証',


  'settings.recalibrate': 'カメラの位置合わせをやり直す',
  'settings.capture.resolution': '解像度',
  'settings.capture.res1440': '1440p(最大画角)',
  'settings.capture.autoFocus': 'オートフォーカス',
  'settings.capture.recordingRate': '書き出しレート',
  'settings.capture.syncRate': 'レートを同期(映像・深度・点群)',
  'settings.capture.depthRate': '深度レート',
  'settings.capture.pointCloudRate': '点群レート',
  'settings.capture.imuRate': 'IMUレート',
  'settings.capture.streamRgb': 'RGBカメラ',
  'settings.capture.alwaysOn': '常時オン(署名対象)',
  'settings.capture.streamImu': 'IMU(加速度・ジャイロ)',
  'settings.capture.streamDepth': '深度(LiDAR)',
  'settings.capture.streamPointCloud': '特徴点群',
  'settings.capture.streamMesh': '3Dメッシュ',

  'settings.storageUsage': 'ストレージ使用量',
  'settings.calculating': '計算中…',
  'settings.clearCache': 'キャッシュをクリア',
  'settings.clearCacheTitle': 'キャッシュをクリア',
  'settings.clearCacheMessage': '撮影中の一時ファイルを削除します。アップロード待ちのクリップは消えません。',

  'settings.terms': '利用規約',
  'settings.privacy': 'プライバシーポリシー',
  'settings.contact': 'お問い合わせ',

  'settings.version': 'バージョン',

  'settings.languageLabel': '表示言語',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  'settings.signOut': 'サインアウト',
  'settings.signingOut': 'サインアウト中…',
  'settings.signOutDebugMessage': 'デバッグアカウントの鍵を削除して再生成します。アップロード済みの動画は新しいアカウントからは見えなくなります。',
  'settings.signOutMessage': 'サインアウトします。',

  // ── Clip card ──
  'clip.recorded': 'アップロード待ち',
  'clip.uploading': 'アップロード中',
  'clip.errorEyebrow': 'アップロード失敗',
  'clip.errorDefault': 'サーバ処理が失敗しました。タップで詳細を確認。',
  'clip.tryAgain': 'もう一度試す',

  // ── Capture flow: ガード / UI ──
  'capture.preparing': '準備中…',
  'capture.permissionTitle': '権限が必要です',
  'capture.permissionBody': 'iOS設定でカメラを許可してください。',
  'capture.unsupportedTitle': '非対応端末',
  'capture.unsupportedBody': 'この端末では対応する撮影構成がありません。',
  'capture.switchingConfig': '構成切替中…(→ {config})',
  'capture.previewStarting': 'プレビュー起動待ち…',
  'capture.emergencyStop': '緊急停止',
  'capture.recStartFailed': '録画開始失敗',
  'capture.recStopFailed': '録画停止失敗',

  // ── Capture flow: 画面下の指示字幕 (= 今やることを平易な 1 文で) ──
  'capture.recordingLabel': '録画中',
  'capture.hud.detecting': 'そのまま、動かないでください。',
  'capture.hud.countdown': 'まもなく撮影がはじまります。',
  'capture.hud.recordingHint': '終わるときは、両手で親指を立ててキープしてください。',
  'capture.hud.saving': '保存しています…',

  // ── Capture flow: 音声ガイド (TTS、 機内アナウンス調) ──
  // ⚠ ja TTS 読み間違い回避: 「方」(かた)・「開いて」(あいて)・「画角」 は使わない。
  'capture.tts.intro': 'スマホをヘッドセットに取り付けて、頭に装着してください。',
  'capture.tts.palmPrompt': '準備ができたら、手をパーにして目線を指先に向けてください。',
  'capture.tts.confirmed': '位置が合いました。これより撮影を開始します。',
  'capture.tts.done': '撮影終了です。次の準備ができたら、手をパーにして目線を指先に向けてください。',
  'capture.tts.adjustUp': 'カメラを少し上へ向けてください。動画の真ん中に手を写すための調整です。',
  'capture.tts.adjustDown': 'カメラを少し下へ向けてください。動画の真ん中に手を写すための調整です。',
  'capture.tts.stoppingConfirm': '撮影を終了します。',
  'capture.tts.stopHint': '終了するときは、両手で親指を立てて、そのままキープしてください。',
  'capture.tts.handLost': '両手をカメラに映してください。',
  // 自動終了の理由 (= 熱 / 空き容量 / 長時間の安全弁)。 終了フロー冒頭で 1 回だけ読む。
  'capture.tts.autoStopHot': '本体が熱くなったため、撮影を終了します。',
  'capture.tts.autoStopDisk': '空き容量が少なくなったため、撮影を終了します。',
  'capture.tts.autoStopLong': '撮影が長くなったので、ここでいったん終了します。',
  'capture.tts.autoStopBattery': '電池が少なくなったため、撮影を終了します。',
  'capture.tts.autoStopBackground': 'アプリが中断されたため、撮影を終了しました。',
  'capture.tts.lowDisk': '本体の空き容量が少なめです。長い撮影は途中で終わることがあります。',
  'capture.tts.lowBattery': '電池が少なめです。長い撮影は途中で終わることがあります。',

  // ── アップロード同意ポップ (= マイビデオのカードタップ) ──
  'upload.consentTitle': 'アップロード前の確認',
  'upload.consentCheckAge': '私は18歳以上で、この場所で撮影する権利があります。',
  'upload.consentCheckNoThirdParty': 'この動画に、撮影者本人以外(子どもを含む)は映っていません。',
  'upload.consentCheckTerms': 'テスター利用規約(全文)に同意します。',
  'upload.consentAndUpload': '同意してアップロード',
  'upload.consentReadFull': '利用規約の全文を読む',
  'upload.consentSending': '送信しています…',
  'upload.consentError': '送信できませんでした。通信環境を確認して、もう一度お試しください。',
  'history.duration': '長さ',
  'history.config': '撮影モード',
  'history.size': '容量',
  'history.device': '撮影した端末',
  'history.videoUnavailable': '動画を読み込めませんでした。電波の良いところでもう一度お試しください。',
  'upload.deleteTitle': 'この動画を削除しますか？',
  'upload.deleteMessage': '削除した動画は元に戻せません。',
  'upload.deleteConfirm': '削除する',


  // ── Onboarding ──
  'onb.slide1.eyebrow': 'おうちで、かんたん',
  'onb.slide1.headline': '家事をするだけ。',
  'onb.slide1.body': 'カメラを身につけて、いつもの家事をするだけ。むずかしい操作はいりません。',
  'onb.slide2.eyebrow': 'プライバシー',
  'onb.slide2.headline': '送る前に、自分で確認。',
  'onb.slide2.body': '撮った動画は、アップロードする前にかならず自分で見て確認できます。見られたくないものが映っていたら、送らずに削除できます。',
  'onb.slide3.eyebrow': 'おこづかいに',
  'onb.slide3.headline': '売れたら、収入に。',
  'onb.slide3.body': '撮った動画がAIの学習に使われると、報酬が入ります。',
  'onb.skip': 'スキップ',
  'onb.continue': '次へ',
  'onb.tosEyebrow': 'ステップ2 / 2 · 利用規約',
  'onb.tosHeadline': '使い始める前に。',
  'onb.tosLede': 'RootLensを使うと、動画の撮影・保存・販売について、利用規約とプライバシーポリシーに同意したことになります。特に大切な点をまとめました。',
  'onb.bullet1': '撮った動画は、AIやロボットの学習用データとして企業に販売されることがあります。',
  'onb.bullet2': '売れる前ならいつでも削除できます。ただし一度売れた後は、買った企業の手元からは取り消せません。',
  'onb.bullet3': '撮影は、ご自身だけが映るようにしてください。ご家族や来客、お子さんは映さないでください。',
  'onb.bullet4': '浴室・寝室・トイレや、人の顔・名前・書類など、人に見られたくないものが映る場所では撮影しないでください。',
  'onb.tosConsent': '利用規約 と プライバシーポリシー を読み、同意します',

  // ── Login ──
  'login.heroLineA': '家事を、撮る。',
  'login.heroBPrefix': '',
  'login.heroBAccent': 'AI',
  'login.heroBSuffix': ' から稼ぐ。',
  'login.lede': '端末を装着したまま家事を記録。動画は撮影した端末の署名つきで保存され、あなたが確認してからアップロードされます。',
  'login.accountEyebrow': 'アカウント',
  'login.debugAccount': 'デバッグアカウント · 自動生成',
  'login.providerNote': '端末の中に鍵を作って、あなたの動画の持ち主であることを証明します。',
  'login.signInFailed': 'サインイン失敗',
  'login.signIn': 'サインイン',
  'login.tos': '続行することで利用規約とプライバシーポリシーに同意したものとみなされます。',

  // ── Tab bar ──
  'tab.home': 'マイビデオ',
  'tab.settings': '設定',
  'tab.captureA11y': '撮影モードを開始',

  // ── マイビデオ (= 旧 Collection / ポートフォリオ。 主婦向けに平易語) ──
  // 温かい挨拶 (= 家事感。 web くさい固定タイトルの代わりに、 時間帯であいさつ)
  'portfolio.mission': 'ロボットが世界を学び、くらしを支えるパートナーになる。その未来を実現するために、あなたの毎日の作業風景が必要です。',
  'portfolio.totalTime': '総撮影時間',
  'portfolio.uploadedLabel': '履歴',
  'portfolio.dailyLabel': '毎日の記録',
  'portfolio.pendingNotice': 'データの確認と同意が必要です。',
  'portfolio.recordInvite': '右の丸いボタンから、きょうの家事を撮ってみましょう。',
} as const;

export type TranslationKey = keyof typeof ja;

const en: Record<TranslationKey, string> = {
  // ── Common ──
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.back': 'Back',

  // ── App (startup / device certificate gate) ──

  // ── Settings ──
  'settings.title': 'Settings',
  'settings.subtitle': 'Account & app settings',
  'settings.section.account': 'Account',
  'settings.section.app': 'App',
  'settings.section.capture': 'Capture',
  'settings.section.support': 'Support',
  'settings.section.developer': 'Developer',

  'settings.accountId': 'Account ID',
  'settings.unauthenticated': 'Not signed in',


  'settings.recalibrate': 'Redo camera alignment',
  'settings.capture.resolution': 'Resolution',
  'settings.capture.res1440': '1440p (max FOV)',
  'settings.capture.autoFocus': 'Auto focus',
  'settings.capture.recordingRate': 'Recording rate',
  'settings.capture.syncRate': 'Sync rate (RGB, depth, point cloud)',
  'settings.capture.depthRate': 'Depth rate',
  'settings.capture.pointCloudRate': 'Point cloud rate',
  'settings.capture.imuRate': 'IMU rate',
  'settings.capture.streamRgb': 'RGB camera',
  'settings.capture.alwaysOn': 'Always on (signed)',
  'settings.capture.streamImu': 'IMU (gyroscope & accelerometer)',
  'settings.capture.streamDepth': 'Depth (LiDAR)',
  'settings.capture.streamPointCloud': 'Feature point cloud',
  'settings.capture.streamMesh': '3D mesh',

  'settings.storageUsage': 'Storage used',
  'settings.calculating': 'Calculating…',
  'settings.clearCache': 'Clear cache',
  'settings.clearCacheTitle': 'Clear cache',
  'settings.clearCacheMessage': 'Deletes temporary capture files. Clips waiting to upload are kept.',

  'settings.terms': 'Terms of Service',
  'settings.privacy': 'Privacy Policy',
  'settings.contact': 'Contact',

  'settings.version': 'Version',

  'settings.languageLabel': 'Display language',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  'settings.signOut': 'Sign out',
  'settings.signingOut': 'Signing out…',
  'settings.signOutDebugMessage': 'Deletes and regenerates the debug account key. Uploaded videos will no longer be visible from the new account.',
  'settings.signOutMessage': 'You will be signed out.',

  // ── Clip card ──
  'clip.recorded': 'Waiting to upload',
  'clip.uploading': 'Uploading',
  'clip.errorEyebrow': 'Upload failed',
  'clip.errorDefault': 'Server processing failed. Tap for details.',
  'clip.tryAgain': 'Try again',

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

  // ── Capture flow: bottom instruction caption ──
  'capture.recordingLabel': 'Recording',
  'capture.hud.detecting': 'Hold still.',
  'capture.hud.countdown': 'Recording starts in a moment.',
  'capture.hud.recordingHint': 'To finish, hold a thumbs-up with both hands.',
  'capture.hud.saving': 'Saving…',

  // ── Capture flow: voice guidance (TTS, airline-announcement tone) ──
  'capture.tts.intro': 'Attach the phone to the headset and put it on.',
  'capture.tts.palmPrompt': 'When you are ready, open your hands and look at your fingertips.',
  'capture.tts.confirmed': 'Position confirmed. Recording will now begin.',
  'capture.tts.done': 'Recording finished. When you are ready for the next one, open your hands and look at your fingertips.',
  'capture.tts.adjustUp': 'Tilt the camera up a little. This centers your hands in the video.',
  'capture.tts.adjustDown': 'Tilt the camera down a little. This centers your hands in the video.',
  'capture.tts.stoppingConfirm': 'Ending the recording.',
  'capture.tts.stopHint': 'To finish, hold a thumbs-up with both hands and keep it steady.',
  'capture.tts.handLost': 'Show both hands to the camera.',
  'capture.tts.autoStopHot': 'The phone is getting hot, so recording will stop now.',
  'capture.tts.autoStopDisk': 'Storage is running low, so recording will stop now.',
  'capture.tts.autoStopLong': 'This has been a long recording, so it will stop here.',
  'capture.tts.autoStopBattery': 'The battery is running low, so recording will stop now.',
  'capture.tts.autoStopBackground': 'The app was interrupted, so recording has stopped.',
  'capture.tts.lowDisk': 'Free storage is limited. A long recording may stop early.',
  'capture.tts.lowBattery': 'The battery is low. A long recording may stop early.',

  // ── Upload consent pop (= tap a card in My Videos) ──
  'upload.consentTitle': 'Before you upload',
  'upload.consentCheckAge': 'I am 18 or older and have the right to record in this location.',
  'upload.consentCheckNoThirdParty': 'No one other than me (including children) appears in this video.',
  'upload.consentCheckTerms': 'I agree to the full Tester Terms.',
  'upload.consentAndUpload': 'Agree and upload',
  'upload.consentReadFull': 'Read the full terms',
  'upload.consentSending': 'Sending…',
  'upload.consentError': 'Could not send. Check your connection and try again.',
  'history.duration': 'Length',
  'history.config': 'Capture mode',
  'history.size': 'Size',
  'history.device': 'Device',
  'history.videoUnavailable': 'Could not load the video. Please try again with a better connection.',
  'upload.deleteTitle': 'Delete this video?',
  'upload.deleteMessage': 'This cannot be undone.',
  'upload.deleteConfirm': 'Delete',


  // ── Onboarding ──
  'onb.slide1.eyebrow': 'Easy, at home',
  'onb.slide1.headline': 'Just do your chores.',
  'onb.slide1.body': 'Wear the camera and just do your usual chores. No complicated steps.',
  'onb.slide2.eyebrow': 'Privacy',
  'onb.slide2.headline': 'You check before it leaves.',
  'onb.slide2.body': 'You can always review a video before uploading. If something private is visible, just delete it instead of sending it.',
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
  'login.lede': 'Record household tasks while wearing the phone. Each video is saved with your device’s signature, and nothing uploads until you review it.',
  'login.accountEyebrow': 'Account',
  'login.debugAccount': 'Debug account · auto-generated',
  'login.providerNote': 'A key is created on your device to prove your videos belong to you.',
  'login.signInFailed': 'Sign-in failed',
  'login.signIn': 'Sign in',
  'login.tos': 'By continuing, you agree to the Terms of Service and Privacy Policy.',

  // ── Tab bar ──
  'tab.home': 'My videos',
  'tab.settings': 'Settings',
  'tab.captureA11y': 'Start capture mode',

  // ── My Videos (= former Collection / Portfolio。 plain language) ──
  'portfolio.mission': 'Robots will learn the world and become partners in daily life. To make that future real, we need the scenes of your everyday housework.',
  'portfolio.totalTime': 'Total capture time',
  'portfolio.uploadedLabel': 'History',
  'portfolio.dailyLabel': 'Daily record',
  'portfolio.pendingNotice': 'These videos need your review and consent.',
  'portfolio.recordInvite': 'Tap the round button on the right and capture today’s chores.',
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
