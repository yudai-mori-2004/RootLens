import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  transpilePackages: ['../shared'], 
  experimental: {
    externalDir: true, 
  },
};

export default nextConfig;