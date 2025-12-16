import { getRequestConfig } from 'next-intl/server';

// 対応言語
export const locales = ['en', 'ja'] as const;
export type Locale = typeof locales[number];

export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocaleを取得してバリデーション
  let locale = await requestLocale;

  // サポートされていないlocaleの場合はデフォルトを使用
  if (!locale || !locales.includes(locale as Locale)) {
    locale = 'en';
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default
  };
});
