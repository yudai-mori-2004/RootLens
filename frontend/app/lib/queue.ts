// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import { RedisOptions } from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

const urlObj = new URL(process.env.REDIS_URL);
const isRailwayInternal = urlObj.hostname.includes('railway.internal');
const useTLS = process.env.REDIS_URL.includes('rlwy.net');

const redisConfig: RedisOptions = {
  // Railway内部なら短縮名 "redis" を使用
  host: isRailwayInternal ? 'redis' : urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  // usernameは省略
  password: urlObj.password,
  family: 0,
  maxRetriesPerRequest: null,
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  },
};

export const mintQueue = new Queue('rootlens-mint-queue', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});