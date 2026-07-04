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
  'capture.hud.detecting': 'そのまま、動かずにお待ちください。',
  'capture.hud.aimReadout': '傾き {current}°(目標 {target}°)',
  'capture.hud.recordingHint': '終わりたいときは、両手でチョキを作って、カメラに向けたままキープしてください。',
  'capture.hud.saving': '保存しています…',

  // ── Capture flow: 音声ガイド (TTS、 機内アナウンス調) ──
  // ⚠ ja TTS 読み間違い回避: 「方」(かた)・「開いて」(あいて) は使わない。
  'capture.tts.intro': 'これから撮影の準備をします。スマホをヘッドセットに取り付けて、頭に装着してください。',
  'capture.tts.posture': '装着できたら、まっすぐ立って正面を見てください。あごを軽く引いて、そのまま動かずにお待ちください。',
  'capture.tts.aimExplore': 'スマホをゆっくり傾けて、音と振動があったところで止めてください。',
  'capture.tts.aimOk': 'ちょうどいい向きになりました。撮影を始めるときは、両手でチョキを作って、カメラに向けたまま少しキープしてください。',
  'capture.tts.done': '撮影が完了いたしました。お疲れさまでした。',
  'capture.tts.continue': '引き続き撮影される場合は、そのままお待ちください。カメラの向きを確認します。',
  'capture.tts.redoSuggest': '手が画面の下に外れがちです。きりの良いところで一度撮影を終えて、かけ直してください。',
  'capture.tts.handLost': '両手がカメラに映るようにしてください',

  // ── アップロード同意ポップ (= マイビデオのカードタップ) ──
  'upload.consentTitle': 'アップロード前の確認',
  'upload.consentIntro': '以下は要約です。「同意して進む」を押すと、テスター利用規約(全文)に同意したことになります。',
  'upload.consentBullet1': 'この動画(音声を含む)はAI・ロボットの学習データとして利用され、日本国外を含む外部の企業に提供・販売されることがあります。',
  'upload.consentBullet2': '提供前に顔などにぼかし処理を行いますが、完全な匿名化は保証されません。',
  'upload.consentBullet3': '学習に使用される前のデータは削除できます。学習に使用された後は、以後の学習から除外できますが、過去の学習結果は取り消せません。',
  'upload.consentCheckAll': '私は18歳以上で、この場所で撮影する権利があります。この動画に撮影者本人以外(子どもを含む)は映っていません。テスター利用規約の全文を読み、上記すべてに同意します。',
  'upload.consentReadFull': '利用規約の全文を読む',
  'upload.consentProceed': '同意して進む',
  'upload.consentSending': '同意を記録しています…',
  'upload.consentError': '同意を記録できませんでした。通信環境を確認して、もう一度お試しください。',
  'upload.consentedNote': '同意を記録しました',
  'upload.confirmTitle': '動画の最終確認',
  'history.duration': '長さ',
  'history.config': '撮影モード',
  'history.size': '容量',
  'history.device': '撮影した端末',
  'history.videoUnavailable': '動画を読み込めませんでした。電波の良いところでもう一度お試しください。',
  'upload.deleteTitle': 'この動画を削除しますか？',
  'upload.deleteMessage': '削除した動画は元に戻せません。',
  'upload.deleteConfirm': '削除する',
  'upload.confirmHint': '内容を確認してからアップロードしてください。映ってはいけないものがある場合は、アップロードせずに削除してください。',
  'upload.action': 'アップロードする',

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
  'capture.hud.detecting': 'Hold still, please.',
  'capture.hud.aimReadout': 'Tilt {current}° (target {target}°)',
  'capture.hud.recordingHint': 'To finish, make a peace sign with both hands and hold them toward the camera.',
  'capture.hud.saving': 'Saving…',

  // ── Capture flow: voice guidance (TTS, airline-announcement tone) ──
  'capture.tts.intro': 'Let’s get ready to record. Attach the phone to the headset and put it on.',
  'capture.tts.posture': 'Once it’s on, stand up straight and face forward. Tuck your chin slightly and hold still.',
  'capture.tts.aimExplore': 'Slowly tilt the phone, and stop where you feel the beep and vibration.',
  'capture.tts.aimOk': 'The camera is aimed just right. To start recording, make a peace sign with both hands and hold them toward the camera for a moment.',
  'capture.tts.done': 'Recording complete. Nice work.',
  'capture.tts.continue': 'To keep recording, please hold on while we check the camera angle.',
  'capture.tts.redoSuggest': 'Your hands keep slipping below the frame. At a good stopping point, please end this recording and re-seat the headset.',
  'capture.tts.handLost': 'Please keep both hands in view of the camera.',

  // ── Upload consent pop (= tap a card in My Videos) ──
  'upload.consentTitle': 'Before you upload',
  'upload.consentIntro': 'This is a summary. Tapping "Agree and continue" means you agree to the full Tester Terms.',
  'upload.consentBullet1': 'This video (including audio) will be used as training data for AI and robots, and may be provided or sold to external companies, including outside Japan.',
  'upload.consentBullet2': 'Faces are blurred before the data is provided, but full anonymization is not guaranteed.',
  'upload.consentBullet3': 'Data can be deleted before it is used for training. Once used, it can be excluded from future training, but past results cannot be undone.',
  'upload.consentCheckAll': 'I am 18 or older and have the right to record in this location. No one other than me (including children) appears in this video. I have read the full Tester Terms and agree to all of the above.',
  'upload.consentReadFull': 'Read the full terms',
  'upload.consentProceed': 'Agree and continue',
  'upload.consentSending': 'Recording your consent…',
  'upload.consentError': 'Could not record your consent. Check your connection and try again.',
  'upload.consentedNote': 'Consent recorded',
  'upload.confirmTitle': 'Final check',
  'history.duration': 'Length',
  'history.config': 'Capture mode',
  'history.size': 'Size',
  'history.device': 'Device',
  'history.videoUnavailable': 'Could not load the video. Please try again with a better connection.',
  'upload.deleteTitle': 'Delete this video?',
  'upload.deleteMessage': 'This cannot be undone.',
  'upload.deleteConfirm': 'Delete',
  'upload.confirmHint': 'Review the video before uploading. If anything should not be visible, delete it instead.',
  'upload.action': 'Upload',

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
