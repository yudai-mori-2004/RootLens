// 多言語化 (i18n) 基盤
// 対応言語: ja (デフォルト), en

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
  currentLocale = locale;
  AsyncStorage.setItem(LOCALE_KEY, locale);
  listeners.forEach(fn => fn(locale));
}

export async function initLocale() {
  const saved = await AsyncStorage.getItem(LOCALE_KEY);
  if (saved === 'ja' || saved === 'en') {
    currentLocale = saved;
  }
}

// 翻訳辞書の型
type TranslationDict = Record<string, string>;

const ja: TranslationDict = {
  // ── ホーム画面 ──
  'home.emptyTitle': '本物を、証明しよう',
  'home.emptyDescription': 'あなたが撮影した本物のコンテンツに\n改ざん不可能な証明を付けて、SNSでシェアできます',
  'home.ctaCamera': '撮影する',
  'home.ctaGallery': '選ぶ',
  'home.draft': '下書き',

  // ── タブ ──
  'tab.home': 'ホーム',
  'tab.gallery': 'ギャラリー',

  // ── カメラ ──
  'camera.permissionMessage': 'カメラ・マイク・端末コンテンツへの\nアクセスを許可してください',
  'camera.permissionButton': '許可する',
  'camera.photo': '写真',
  'camera.video': '動画',
  'camera.signing': '証明付与中...',
  'camera.signError': '本物証明の付与に失敗しました。コンテンツは保存されませんでした。',
  'camera.signErrorTitle': '証明エラー',

  // ── ギャラリー ──
  'gallery.permissionMessage': '端末のコンテンツにアクセスする許可が必要です',
  'gallery.permissionButton': '許可する',
  'gallery.selectTitle': 'コンテンツを選択',
  'gallery.selectedCount': '{count}件選択中',
  'gallery.shareButton': '本物証明をシェア',

  // ── 編集画面 ──
  'edit.share': 'シェア({count})',
  'edit.undo': '戻す',
  'edit.redo': 'やり直す',
  'edit.trim': 'トリム',
  'edit.crop': '切り抜き',
  'edit.mask': 'マスク',
  'edit.resize': 'サイズ',
  'edit.save': '保存',
  'edit.saveSuccess': '証明付きコンテンツをギャラリーに保存しました',
  'edit.saveSuccessTitle': '保存完了',
  'edit.savePermissionError': 'ギャラリーへのアクセス許可が必要です',
  'edit.signError': '本物証明の付与に失敗しました。登録を中止します。',
  'edit.signErrorTitle': '本物証明エラー',

  // ── 編集ツール共通 ──
  'editTool.cancel': 'キャンセル',
  'editTool.apply': '適用',

  // ── クロップ ──
  'crop.free': 'フリー',

  // ── マスク ──
  'mask.hint': 'ドラッグで黒塗り',
  'mask.undo': '取り消し',

  // ── リサイズ ──
  'resize.currentSize': '現在の解像度: {width} x {height} px',

  // ── トリム ──
  'trim.title': 'トリミング',
  'trim.selected': '選択: {time}',
  'trim.total': '全体: {time}',

  // ── 登録準備 ──
  'registration.title': '公開準備',
  'registration.summaryTitle': '{count}枚のコンテンツに\n本物証明が付いています',
  'registration.summaryText': '公開すると、改ざん不可能な記録として\n誰でも検証できる状態になります',
  'registration.button': '公開する',

  // ── 公開画面 ──
  'publishing.loading': '公開中...',
  'publishing.step.reading': 'データを読み込み中',
  'publishing.step.extracting': '撮影情報を抽出中',
  'publishing.step.recording': 'ブロックチェーンに記録中',
  'publishing.step.creating': '公開ページを作成中',
  'publishing.errorTitle': '公開に失敗しました',
  'publishing.retry': 'リトライ',
  'publishing.back': '戻る',
  'publishing.doneTitle': '公開完了',
  'publishing.done': '完了',
  'publishing.share': 'SNSでシェア',
  'publishing.copyLink': 'リンクをコピー',
  'publishing.copied': 'コピーしました',

  // ── プレビュー ──
  'preview.title': 'プレビュー',
  'preview.publishedPage': '公開ページ',
  'preview.share': 'SNSでシェア',
  'preview.copyLink': 'リンクをコピー',

  // ── 3点メニュー ──
  'menu.delete': 'コンテンツを削除',
  'menu.deleteConfirm': 'この公開ページを削除しますか？',
  'menu.deleteConfirmMessage': '削除すると公開リンクが無効になります。ブロックチェーン上の記録は残ります。',
  'menu.cancel': 'キャンセル',
  'menu.deleted': '削除しました',

  // ── 設定 ──
  'settings.title': '設定',
  'settings.placeholder': '設定（準備中）',

  // ── ログイン ──
  'login.button': 'はじめる',
  'login.note': 'アカウント作成は無料です',
  'settings.logout': 'ログアウト',
  'settings.account': 'アカウント',

  // ── カメラ設定 ──
  'camera.grid': 'グリッド',
  'camera.timer': 'タイマー',
  'camera.timerOff': 'オフ',
  'camera.timer3': '3秒',
  'camera.timer10': '10秒',
  'camera.flashAuto': '自動',

  // ── 設定画面 ──
  'settings.camera': 'カメラ',
  'settings.grid': 'グリッド表示',
  'settings.gridDesc': '撮影時の三分割ガイド',
  'settings.mirror': 'フロントカメラを反転',
  'settings.mirrorDesc': '自撮り時に左右を反転',
  'settings.shutterSound': 'シャッター音',
  'settings.about': 'このアプリについて',
  'settings.version': 'バージョン',
  'settings.profile': 'プロフィール',
  'settings.displayName': '表示名',
  'settings.displayNamePlaceholder': 'あなたの名前',
  'settings.address': 'アドレス（ID）',
  'settings.addressPlaceholder': '帰属先アドレス',
  'settings.bio': '自己紹介',
  'settings.bioPlaceholder': 'SNSリンクや自己紹介',
  'settings.showDeviceName': '端末名を公開ページに表示',
  'settings.deviceLabel': '端末',
  'settings.addressExplorer': 'ソース',
  'settings.profileSave': '保存する',
  'settings.profileSaved': '保存しました',

  // ── 設定: 言語 ──
  'settings.language': '言語',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  // ── 設定: 端末セキュリティ ──
  'settings.security': 'セキュリティ',
  'settings.teeStatus': 'TEE署名',
  'settings.teeReady': '有効',
  'settings.teeNotReady': '無効',
  'settings.certExpiry': '証明書有効期限',
  'settings.certExpired': '期限切れ',

  // ── プロフィール ──
  'profile.posts': '公開',

  // ── App (スプラッシュ) ──
  'app.checking': '確認中...',
  'app.provisioning': 'デバイス証明書を取得中...',
  'app.provisionError': '証明書の取得に失敗しました',
  'app.retry': '再試行',

  // ── 共通 ──
  'common.error': 'エラー',
  'common.loading': '読み込み中...',
  'common.processing': '処理中...',
  'common.saveFailed': '保存に失敗しました: {message}',

  // ── SNSシェア ──
  'share.shareTo': 'Share to',
  'share.copyLink': 'リンクをコピー',
  'share.copied': 'コピーしました',
  'share.instagram': 'Instagram シェア',
  'share.twitter': 'X シェア',
  'share.post': '投稿',
  'share.story': 'ストーリー',
  'share.reel': 'リール',
  'share.showWatermark': 'ウォーターマークを表示',
  'share.image': '画像',
  'share.link': 'リンク',
  'share.saveImage': '画像を保存',
  'share.saved': '保存しました',
  'share.openInstagram': '投稿',
  'share.postToX': 'ポスト',
  'share.defaultCta': 'This photo is real. Verify it →',
  'share.instagramUsername': 'Instagramユーザーネーム',
  'share.instagramUsernamePlaceholder': '@username',
  'share.textCopied': 'テキストをコピーしました',
  'share.menuDelete': '削除する',
  'share.action': 'シェア',
  'share.composing': '合成中...',
  'share.menuCancel': 'キャンセル',
};

const en: TranslationDict = {
  // ── Home ──
  'home.emptyTitle': 'Prove it\'s real',
  'home.emptyDescription': 'Add tamper-proof authenticity\nto your photos and share them on social media',
  'home.ctaCamera': 'Take a photo',
  'home.ctaGallery': 'Choose',
  'home.draft': 'Draft',

  // ── Tabs ──
  'tab.home': 'Home',
  'tab.gallery': 'Gallery',

  // ── Camera ──
  'camera.permissionMessage': 'Please allow access to\ncamera, microphone, and media library',
  'camera.permissionButton': 'Allow',
  'camera.photo': 'Photo',
  'camera.video': 'Video',
  'camera.signing': 'Certifying...',
  'camera.signError': 'Failed to certify authenticity. Content was not saved.',
  'camera.signErrorTitle': 'Certification Error',

  // ── Gallery ──
  'gallery.permissionMessage': 'Permission to access media library is required',
  'gallery.permissionButton': 'Allow',
  'gallery.selectTitle': 'Select content',
  'gallery.selectedCount': '{count} selected',
  'gallery.shareButton': 'Share with proof',

  // ── Edit ──
  'edit.share': 'Share({count})',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'edit.trim': 'Trim',
  'edit.crop': 'Crop',
  'edit.mask': 'Mask',
  'edit.resize': 'Resize',
  'edit.save': 'Save',
  'edit.saveSuccess': 'Certified content saved to gallery',
  'edit.saveSuccessTitle': 'Saved',
  'edit.savePermissionError': 'Gallery access permission is required',
  'edit.signError': 'Failed to certify. Registration cancelled.',
  'edit.signErrorTitle': 'Certification Error',

  // ── Edit tools ──
  'editTool.cancel': 'Cancel',
  'editTool.apply': 'Apply',

  // ── Crop ──
  'crop.free': 'Free',

  // ── Mask ──
  'mask.hint': 'Drag to redact',
  'mask.undo': 'Undo',

  // ── Resize ──
  'resize.currentSize': 'Current: {width} x {height} px',

  // ── Trim ──
  'trim.title': 'Trim',
  'trim.selected': 'Selected: {time}',
  'trim.total': 'Total: {time}',

  // ── Registration ──
  'registration.title': 'Ready to publish',
  'registration.summaryTitle': '{count} items certified\nas authentic',
  'registration.summaryText': 'Publishing creates a tamper-proof record\nthat anyone can verify',
  'registration.button': 'Publish',

  // ── Publishing ──
  'publishing.loading': 'Publishing...',
  'publishing.step.reading': 'Reading data',
  'publishing.step.extracting': 'Extracting capture proof',
  'publishing.step.recording': 'Recording on blockchain',
  'publishing.step.creating': 'Creating public page',
  'publishing.errorTitle': 'Publishing failed',
  'publishing.retry': 'Retry',
  'publishing.back': 'Back',
  'publishing.doneTitle': 'Published',
  'publishing.done': 'Done',
  'publishing.share': 'Share on social',
  'publishing.copyLink': 'Copy link',
  'publishing.copied': 'Copied',

  // ── Preview ──
  'preview.title': 'Preview',
  'preview.publishedPage': 'Published page',
  'preview.share': 'Share on social',
  'preview.copyLink': 'Copy link',

  // ── 3-dot menu ──
  'menu.delete': 'Delete content',
  'menu.deleteConfirm': 'Delete this page?',
  'menu.deleteConfirmMessage': 'The public link will become invalid. The blockchain record will remain.',
  'menu.cancel': 'Cancel',
  'menu.deleted': 'Deleted',

  // ── Settings ──
  'settings.title': 'Settings',
  'settings.placeholder': 'Settings (coming soon)',

  // ── Login ──
  'login.button': 'Get started',
  'login.note': 'Free to create an account',
  'settings.logout': 'Log out',
  'settings.account': 'Account',

  // ── Camera settings ──
  'camera.grid': 'Grid',
  'camera.timer': 'Timer',
  'camera.timerOff': 'Off',
  'camera.timer3': '3s',
  'camera.timer10': '10s',
  'camera.flashAuto': 'Auto',

  // ── Settings ──
  'settings.camera': 'Camera',
  'settings.grid': 'Grid overlay',
  'settings.gridDesc': 'Rule of thirds guide',
  'settings.mirror': 'Mirror front camera',
  'settings.mirrorDesc': 'Flip selfie horizontally',
  'settings.shutterSound': 'Shutter sound',
  'settings.about': 'About',
  'settings.version': 'Version',
  'settings.profile': 'Profile',
  'settings.displayName': 'Display name',
  'settings.displayNamePlaceholder': 'Your name',
  'settings.address': 'Address (ID)',
  'settings.addressPlaceholder': 'Attribution address',
  'settings.bio': 'Bio',
  'settings.bioPlaceholder': 'SNS links or introduction',
  'settings.showDeviceName': 'Show device name on public page',
  'settings.deviceLabel': 'Device',
  'settings.addressExplorer': 'Source',
  'settings.profileSave': 'Save',
  'settings.profileSaved': 'Saved',

  // ── Settings: language ──
  'settings.language': 'Language',
  'settings.languageJa': '日本語',
  'settings.languageEn': 'English',

  // ── Settings: device security ──
  'settings.security': 'Security',
  'settings.teeStatus': 'TEE signing',
  'settings.teeReady': 'Active',
  'settings.teeNotReady': 'Inactive',
  'settings.certExpiry': 'Certificate expiry',
  'settings.certExpired': 'Expired',

  // ── Profile ──
  'profile.posts': 'Published',

  // ── App (splash) ──
  'app.checking': 'Checking...',
  'app.provisioning': 'Obtaining device certificate...',
  'app.provisionError': 'Failed to obtain certificate',
  'app.retry': 'Retry',

  // ── Common ──
  'common.error': 'Error',
  'common.loading': 'Loading...',
  'common.processing': 'Processing...',
  'common.saveFailed': 'Save failed: {message}',

  // ── SNS Share ──
  'share.shareTo': 'Share to',
  'share.copyLink': 'Copy link',
  'share.copied': 'Copied',
  'share.instagram': 'Instagram Share',
  'share.twitter': 'X Share',
  'share.post': 'Post',
  'share.story': 'Story',
  'share.reel': 'Reel',
  'share.showWatermark': 'Show watermark',
  'share.image': 'Image',
  'share.link': 'Link',
  'share.saveImage': 'Save image',
  'share.saved': 'Saved',
  'share.openInstagram': 'Post',
  'share.postToX': 'Post',
  'share.defaultCta': 'This photo is real. Verify it →',
  'share.instagramUsername': 'Instagram username',
  'share.instagramUsernamePlaceholder': '@username',
  'share.textCopied': 'Text copied',
  'share.menuDelete': 'Delete',
  'share.action': 'Share',
  'share.composing': 'Composing...',
  'share.menuCancel': 'Cancel',
};

const dictionaries: Record<Locale, TranslationDict> = { ja, en };

/**
 * 翻訳テキストを取得
 * @param key - 翻訳キー (e.g. 'home.emptyTitle')
 * @param params - プレースホルダー置換 (e.g. { count: 3 })
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] ?? dictionaries.ja;
  let text = dict[key] ?? dictionaries.ja[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}
