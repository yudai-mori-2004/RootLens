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


  'settings.capture.resolution': '解像度',
  'settings.capture.res1440': '1440p',
  'settings.capture.autoFocus': 'オートフォーカス',
  'settings.capture.recordingRate': '書き出しレート',
  'settings.capture.syncRate': 'レートを同期(映像・深度・点群)',
  'settings.capture.depthRate': '深度レート',
  'settings.capture.pointCloudRate': '点群レート',
  'settings.capture.imuRate': 'IMUレート',
  'settings.capture.streamImu': 'IMU(加速度・ジャイロ)',
  'settings.capture.streamDepth': '深度(LiDAR)',
  'settings.capture.streamPointCloud': '特徴点群',
  'settings.capture.streamMesh': '3Dメッシュ',
  'settings.capture.flow': '開始・終了の操作',
  'settings.capture.flowGesture': 'ジェスチャー',
  'settings.capture.flowVoice': '音声コマンド',
  'settings.capture.cycleEnabled': '自動サイクル撮影',
  'settings.capture.cycleRecord': '連続撮影時間',
  'settings.capture.cyclePause': '休止時間',
  'settings.capture.minutesUnit': '分',

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
  'settings.signIn': 'ログイン',
  'settings.signingOut': 'サインアウト中…',
  'settings.signOutDebugMessage': 'デバッグアカウントの鍵を削除して再生成します。アップロード済みの動画は新しいアカウントからは見えなくなります。',
  'settings.signOutMessage': 'サインアウトします。',

  // ── Clip card ──
  'clip.uploading': 'アップロード中',
  'clip.errorEyebrow': 'アップロード失敗',

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
  'capture.tts.adjustUp': 'カメラを少し上へ向けてください。手と手元の作業を写すための調整です。',
  'capture.tts.adjustDown': 'カメラを少し下へ向けてください。手と手元の作業を写すための調整です。',
  'capture.tts.stoppingConfirm': '撮影を終了します。',
  'capture.tts.stopHint': '終了するときは、両手でグッドサインを作って、キープしてください。',
  'capture.tts.handLost': '両手をカメラに映してください。',
  // 自動終了の理由 (= 熱 / 空き容量 / 長時間の安全弁)。 終了フロー冒頭で 1 回だけ読む。
  'capture.tts.autoStopHot': '本体が熱くなったため、撮影を終了します。',
  'capture.tts.autoStopDisk': '空き容量が少なくなったため、撮影を終了します。',
  'capture.tts.autoStopLong': '撮影が長くなったので、ここでいったん終了します。',
  'capture.tts.autoStopBattery': '電池が少なくなったため、撮影を終了します。',
  'capture.tts.autoStopBackground': 'アプリが中断されたため、撮影を終了しました。',
  'capture.tts.lowDisk': '本体の空き容量が少なめです。長い撮影は途中で終わることがあります。',
  'capture.tts.lowBattery': '電池が少なめです。長い撮影は途中で終わることがあります。',
  // 自動サイクル: 区切りの停止と再開の案内。
  'capture.tts.cyclePause': '撮影をひと区切りします。{minutes}分ほどで自動で再開します。',
  'capture.tts.cycleResume': '撮影を再開します。',
  // 音声コマンドフロー: キャリブレーション確定後の開始待ち案内。
  'capture.tts.voiceArmed': '「撮影スタート」と言うと、撮影を始めます。',
  'capture.tts.confirmedAim': '位置が合いました。',
  'capture.tts.doneVoice': '撮影終了です。「撮影スタート」と言うと、次の撮影を始めます。',
  'capture.hud.cyclePausing': '一時停止中',

  // ── アップロード同意ポップ (= マイビデオのカードタップ) ──
  'upload.consentTitle': 'アップロード前の確認',
  'upload.consentCheckLocation': 'この場所での撮影の許可を得ています。',
  'upload.consentCheckNoThirdParty': '撮影に同意していない人を意図して撮影していません(偶発的な映り込みは提供前にぼかされます)。',
  'upload.consentCheckTermsPrefix': '',
  'upload.consentCheckTermsLink': '利用規約',
  'upload.consentCheckTermsSuffix': 'に同意します。',
  'upload.consentAndUpload': '同意してアップロード',
  'upload.consentSending': '送信しています…',
  'upload.consentError': '送信できませんでした。通信環境を確認して、もう一度お試しください。',
  'upload.loginRequiredTitle': 'ログインが必要です',
  'upload.loginRequiredMessage':
    'アップロードと同意の記録には、運営発行アカウントへのログインが必要です。撮影済みの動画は端末に保存されたままなので、ログイン後にアップロードできます。',
  'upload.loginRequiredCta': 'ログインする',
  'history.duration': '長さ',
  'history.config': '撮影モード',
  'history.size': '容量',
  'history.device': '撮影した端末',
  'history.videoNotFound': 'この動画はサーバから見つかりませんでした。 削除されているか、まだ処理中の可能性があります。',
  'history.videoUnauthorized': 'この動画を読み込めませんでした。もう一度ログインしてお試しください。',
  'history.videoNetwork': '動画を読み込めませんでした。電波の良いところでもう一度お試しください。',
  'history.videoServer': '動画を読み込めませんでした。しばらく経ってからもう一度お試しください。',
  'upload.deleteTitle': 'この動画を削除しますか？',
  'upload.deleteMessage': '削除した動画は元に戻せません。',
  'upload.deleteConfirm': '削除する',


  // ── Onboarding ──

  // ── Login ──
  'login.heroLineA': 'Real human work is',
  'login.heroBPrefix': '',
  'login.heroBAccent': 'training data.',
  'login.heroBSuffix': '',
  'login.lede': '運営が発行したアカウントでログインします。アカウントはアップロードと同意の記録に使われます。撮影だけならログインは不要です。',
  'login.accountEyebrow': 'アカウント',
  'login.debugAccount': 'デバッグアカウント · 自動生成',
  'login.providerNote': '端末の中に鍵を作って、あなたの動画の持ち主であることを証明します。',
  'login.idLabel': 'ログインID',
  'login.passwordLabel': 'パスワード',
  'login.credNote': 'IDとパスワードは運営から発行されます。発行されたQRコードを読み込むと自動で入力されます。',
  'login.signInFailed': 'サインイン失敗',
  'login.signIn': 'サインイン',
  'login.tos': '続行することで利用規約とプライバシーポリシーに同意したものとみなされます。',

  // ── Tab bar ──
  'tab.home': 'マイビデオ',
  'tab.settings': '設定',
  'tab.captureA11y': '撮影モードを開始',

  // ── マイビデオ (= 旧 Collection / ポートフォリオ。 主婦向けに平易語) ──
  // 温かい挨拶 (= 作業感。 web くさい固定タイトルの代わりに、 時間帯であいさつ)
  'portfolio.mission': 'ロボットが世界を学び、くらしを支えるパートナーになる。その未来を実現するために、あなたの毎日の作業風景が必要です。',
  'portfolio.totalTime': '総撮影時間',
  'portfolio.uploadedLabel': '履歴',
  'portfolio.dailyLabel': '毎日の記録',
  'portfolio.pendingNotice': 'データの確認と同意が必要です。',
  'portfolio.recordInvite': '右の丸いボタンから、きょうの作業を撮ってみましょう。',
  'portfolio.serverLoading': 'サーバから読み込んでいます…',
  'portfolio.serverEmpty': 'アップロード済みの動画はまだありません。',
  'portfolio.serverErrorNetwork': '通信できませんでした。電波の良いところで再試行してください。',
  'portfolio.serverErrorAuth': '読み込みには、もう一度ログインが必要です。',
  'portfolio.serverErrorServer': 'サーバから読み込めませんでした。しばらくして再試行してください。',
  'portfolio.retry': '再試行',
  'portfolio.signedOutNote': 'ログインすると、アカウントの履歴と合計時間が表示されます。',
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


  'settings.capture.resolution': 'Resolution',
  'settings.capture.res1440': '1440p',
  'settings.capture.autoFocus': 'Auto focus',
  'settings.capture.recordingRate': 'Recording rate',
  'settings.capture.syncRate': 'Sync rate (RGB, depth, point cloud)',
  'settings.capture.depthRate': 'Depth rate',
  'settings.capture.pointCloudRate': 'Point cloud rate',
  'settings.capture.imuRate': 'IMU rate',
  'settings.capture.streamImu': 'IMU (gyroscope & accelerometer)',
  'settings.capture.streamDepth': 'Depth (LiDAR)',
  'settings.capture.streamPointCloud': 'Feature point cloud',
  'settings.capture.streamMesh': '3D mesh',
  'settings.capture.flow': 'Start / stop control',
  'settings.capture.flowGesture': 'Gestures',
  'settings.capture.flowVoice': 'Voice commands',
  'settings.capture.cycleEnabled': 'Auto cycle recording',
  'settings.capture.cycleRecord': 'Recording length',
  'settings.capture.cyclePause': 'Pause length',
  'settings.capture.minutesUnit': 'min',

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
  'settings.signIn': 'Sign in',
  'settings.signingOut': 'Signing out…',
  'settings.signOutDebugMessage': 'Deletes and regenerates the debug account key. Uploaded videos will no longer be visible from the new account.',
  'settings.signOutMessage': 'You will be signed out.',

  // ── Clip card ──
  'clip.uploading': 'Uploading',
  'clip.errorEyebrow': 'Upload failed',

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
  'capture.tts.adjustUp': 'Tilt the camera up a little. This keeps your hands and your work in view.',
  'capture.tts.adjustDown': 'Tilt the camera down a little. This keeps your hands and your work in view.',
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
  'capture.tts.cyclePause': 'Pausing recording. It will resume automatically in about {minutes} minutes.',
  'capture.tts.cycleResume': 'Resuming recording.',
  'capture.tts.voiceArmed': 'Say the start command to begin recording. Hold both palms up to align the camera.',
  'capture.tts.confirmedAim': 'Position confirmed.',
  'capture.tts.doneVoice': 'Recording finished. Say the start command to begin the next one.',
  'capture.hud.cyclePausing': 'Paused',

  // ── Upload consent pop (= tap a card in My Videos) ──
  'upload.consentTitle': 'Before you upload',
  'upload.consentCheckLocation': 'I have permission to record at this location.',
  'upload.consentCheckNoThirdParty': 'No one who has not consented is filmed intentionally (incidental captures are blurred before delivery).',
  'upload.consentCheckTermsPrefix': 'I agree to the ',
  'upload.consentCheckTermsLink': 'Terms of Use',
  'upload.consentCheckTermsSuffix': '.',
  'upload.consentAndUpload': 'Agree and upload',
  'upload.consentSending': 'Sending…',
  'upload.consentError': 'Could not send. Check your connection and try again.',
  'upload.loginRequiredTitle': 'Sign-in required',
  'upload.loginRequiredMessage':
    'Uploading and recording consent require signing in to an issued account. Your videos stay on this device and can be uploaded after you sign in.',
  'upload.loginRequiredCta': 'Sign in',
  'history.duration': 'Length',
  'history.config': 'Capture mode',
  'history.size': 'Size',
  'history.device': 'Device',
  'history.videoNotFound': 'This video isn\'t available on the server. It may have been deleted or is still being processed.',
  'history.videoUnauthorized': 'Could not load the video. Please sign in again and try.',
  'history.videoNetwork': 'Could not load the video. Please try again with a better connection.',
  'history.videoServer': 'Could not load the video. Please try again in a moment.',
  'upload.deleteTitle': 'Delete this video?',
  'upload.deleteMessage': 'This cannot be undone.',
  'upload.deleteConfirm': 'Delete',


  // ── Onboarding ──

  // ── Login ──
  'login.heroLineA': 'Real human work is',
  'login.heroBPrefix': '',
  'login.heroBAccent': 'training data.',
  'login.heroBSuffix': '',
  'login.lede': 'Sign in with an account issued by the operator. The account is used for uploads and consent records. Recording itself does not require signing in.',
  'login.accountEyebrow': 'Account',
  'login.debugAccount': 'Debug account · auto-generated',
  'login.providerNote': 'A key is created on your device to prove your videos belong to you.',
  'login.idLabel': 'Login ID',
  'login.passwordLabel': 'Password',
  'login.credNote': 'Your ID and password are issued by the operator. Scanning your QR code fills them in automatically.',
  'login.signInFailed': 'Sign-in failed',
  'login.signIn': 'Sign in',
  'login.tos': 'By continuing, you agree to the Terms of Service and Privacy Policy.',

  // ── Tab bar ──
  'tab.home': 'My videos',
  'tab.settings': 'Settings',
  'tab.captureA11y': 'Start capture mode',

  // ── My Videos (= former Collection / Portfolio。 plain language) ──
  'portfolio.mission': 'Robots will learn the world and become partners in daily life. To make that future real, we need the scenes of your everyday work.',
  'portfolio.totalTime': 'Total capture time',
  'portfolio.uploadedLabel': 'History',
  'portfolio.dailyLabel': 'Daily record',
  'portfolio.pendingNotice': 'These videos need your review and consent.',
  'portfolio.recordInvite': 'Tap the round button on the right and capture today’s work.',
  'portfolio.serverLoading': 'Loading from server…',
  'portfolio.serverEmpty': 'No uploaded videos yet.',
  'portfolio.serverErrorNetwork': 'Could not connect. Try again with a better signal.',
  'portfolio.serverErrorAuth': 'Please sign in again to load.',
  'portfolio.serverErrorServer': 'Could not load from the server. Try again shortly.',
  'portfolio.retry': 'Retry',
  'portfolio.signedOutNote': 'Sign in to see this account’s history and total time.',
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
