import createMiddleware from 'next-intl/middleware';
import { locales } from './i18n';

export default createMiddleware({
  locales,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const config = {
  // すべてのリクエストにマッチ、ただしAPIと静的ファイルを除外
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)']
};
