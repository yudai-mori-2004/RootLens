import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig: NextConfig = {
  turbopack: {},
  transpilePackages: ['../shared'],
  experimental: {
    externalDir: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-494b37dbfc9645299042fcf51236d1fc.r2.dev',
        port: '',
        pathname: '/media/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);