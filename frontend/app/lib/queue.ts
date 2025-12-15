// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import { RedisOptions } from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// URLをパースして設定オブジェクトを作成
const urlObj = new URL(process.env.REDIS_URL);

const redisConfig: RedisOptions = {
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: urlObj.username || 'default',
  password: urlObj.password,
  family: 0, // Railway IPv6対応
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_URL.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  },
};

// Mintジョブ用のキュー
export const mintQueue = new Queue('rootlens-mint-queue', {
  // 設定オブジェクトを直接渡す
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