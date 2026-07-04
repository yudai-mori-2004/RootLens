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
  'settings.section.capture': '撮影',
  'settings.section.data': 'データ',
  'settings.section.support': 'サポート',
  'settings.section.appInfo': 'アプリ情報',
  'settings.section.developer': 'デベロッパー',
  'settings.section.language': '言語',

  'settings.accountId': 'アカウント ID',
  'settings.unauthenticated': '未認証',
  'settings.authProvider': '認証プロバイダ',


  'settings.recalibrate': 'キャリブレーション再校正',

  'settings.storageUsage': 'ストレージ使用量',
  'settings.calculating': '計算中…',
  'settings.clearCache': 'キャッシュをクリア',
  'settings.clearCacheTitle': 'キャッシュをクリア',
  'settings.clearCacheMessage': '撮影中の一時ファイルを削除します。 アップロード待ちのクリップは消えません。',

  'settings.terms': '利用規約',
  'settings.privacy': 'プライバシーポリシー',
  'settings.contact': 'お問い合わせ',

  'settings.version': 'バージョン',
  'settings.githubRepo': 'GitHub リポジトリ',

  'settings.languageLabel': '表示言語',
  'settings.languageDesc': 'アプリ全体の表示言語と音声案内',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  'settings.signOut': 'サインアウト',
  'settings.signingOut': 'サインアウト中…',
  'settings.signOutDebugMessage': 'デバッグアカウントの鍵を削除して再生成します。 アップロード済みの動画は新しいアカウントからは見えなくなります。',
  'settings.signOutMessage': 'サインアウトします。',

  // ── Clip card ──
  'clip.recorded': 'アップロード待ち',
  'clip.uploading': 'アップロード中',
  'clip.errorEyebrow': 'アップロード失敗',
  'clip.errorDefault': 'サーバ処理が失敗しました。 タップで詳細を確認。',
  'clip.tryAgain': 'もう一度試す',

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

  // ── アップロード確認ポップ (= マイビデオのカードタップ) ──
  'upload.confirmTitle': 'アップロード前の確認',
  'upload.confirmHint': 'うつってはいけないものがないか、 確認してからアップロードしてください。',
  'upload.action': 'アップロードする',

  // ── Onboarding ──
  'onb.slide1.eyebrow': 'おうちで、 かんたん',
  'onb.slide1.headline': '家事をするだけ。',
  'onb.slide1.body': 'カメラを身につけて、 いつもの家事をするだけ。 むずかしい操作はいりません。',
  'onb.slide2.eyebrow': 'プライバシー',
  'onb.slide2.headline': '送る前に、 自分で確認。',
  'onb.slide2.body': '撮った動画は、 アップロードする前にかならず自分で見て確認できます。 見られたくないものが映っていたら、 送らずに削除できます。',
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
  'login.lede': '端末を装着したまま家事を記録。 動画は撮影した端末の署名つきで保存され、 あなたが確認してからアップロードされます。',
  'login.debugAccount': 'デバッグアカウント · 自動生成',
  'login.providerNote': '端末の中に鍵を作って、 あなたの動画の持ち主であることを証明します。',
  'login.signInFailed': 'サインイン失敗',
  'login.signIn': 'サインイン',
  'login.tos': '続行することで利用規約とプライバシーポリシーに同意したものとみなされます。',

  // ── Tab bar ──
  'tab.home': 'マイビデオ',
  'tab.settings': '設定',
  'tab.captureA11y': '撮影モードを開始',

  // ── マイビデオ (= 旧 Collection / ポートフォリオ。 主婦向けに平易語) ──
  // 温かい挨拶 (= 家事感。 web くさい固定タイトルの代わりに、 時間帯であいさつ)
  'portfolio.greetingMorning': 'おはようございます',
  'portfolio.greetingDay': 'こんにちは',
  'portfolio.greetingEvening': 'こんばんは',
  'portfolio.greetingNight': 'おつかれさまです',
  'portfolio.greetingSub': 'おうちの時間が、 少しずつ収入になります',
  'portfolio.emptyTitle': 'アップロード待ちの動画はありません',
  'portfolio.emptyHint': '右の丸いボタンから撮影すると、 ここに並びます。 アップロードが終わった動画は、 ここから消えます。',
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
  'settings.section.capture': 'Capture',
  'settings.section.data': 'Data',
  'settings.section.support': 'Support',
  'settings.section.appInfo': 'About',
  'settings.section.developer': 'Developer',
  'settings.section.language': 'Language',

  'settings.accountId': 'Account ID',
  'settings.unauthenticated': 'Not signed in',
  'settings.authProvider': 'Auth provider',


  'settings.recalibrate': 'Recalibrate',

  'settings.storageUsage': 'Storage used',
  'settings.calculating': 'Calculating…',
  'settings.clearCache': 'Clear cache',
  'settings.clearCacheTitle': 'Clear cache',
  'settings.clearCacheMessage': 'Deletes temporary capture files. Clips waiting to upload are kept.',

  'settings.terms': 'Terms of Service',
  'settings.privacy': 'Privacy Policy',
  'settings.contact': 'Contact',

  'settings.version': 'Version',
  'settings.githubRepo': 'GitHub repository',

  'settings.languageLabel': 'Display language',
  'settings.languageDesc': 'App display language and voice guidance',
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

  // ── Capture flow: status pill ──
  'capture.state.announcing': 'CALIBRATE  ·  Get ready…',
  'capture.state.nextTaskAnnouncing': 'CAPTURE DONE  ·  Nice work…',
  'capture.state.awaitingPalm': 'CALIBRATE  ·  Look at your palms for 3s',
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
  'capture.tts.intro': 'Let’s align your headset. Put it on, relax, open both palms, and look at them. Hold still for about three seconds.',
  'capture.tts.confirmed': 'Your position is confirmed. We will now begin recording.',
  'capture.tts.done': 'Recording complete. Nice work.',
  'capture.tts.continue': 'To record again, just look at your palms again.',
  'capture.tts.adjustUp': 'Your hands are near the top of the frame. Tilt the headset up a little and look at your palms again.',
  'capture.tts.adjustDown': 'Your hands are near the bottom of the frame. Tilt the headset down a little and look at your palms again.',
  'capture.tts.adjustLeft': 'Your hands are toward the left of the frame. Turn the headset left a little and look at your palms again.',
  'capture.tts.adjustRight': 'Your hands are toward the right of the frame. Turn the headset right a little and look at your palms again.',
  'capture.tts.stoppingConfirm': 'Keep holding your thumbs up to finish recording.',
  'capture.tts.handLost': 'Please keep both hands in view of the camera.',

  // ── Upload confirmation pop (= tap a card in My Videos) ──
  'upload.confirmTitle': 'Check before upload',
  'upload.confirmHint': 'Please check that nothing private is visible, then upload.',
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
  'portfolio.greetingMorning': 'Good morning',
  'portfolio.greetingDay': 'Good afternoon',
  'portfolio.greetingEvening': 'Good evening',
  'portfolio.greetingNight': 'Working late?',
  'portfolio.greetingSub': 'Your time at home, slowly becoming income',
  'portfolio.emptyTitle': 'No videos waiting to upload',
  'portfolio.emptyHint': 'Tap the round button on the right to record. Videos appear here, and leave the list once uploaded.',
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
