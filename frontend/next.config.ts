import type { NextConfig } from "next";

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

export default nextConfig;