// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import { RedisOptions } from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

const urlObj = new URL(process.env.REDIS_URL);
let redisHost = urlObj.hostname;
if (redisHost.includes('railway.internal')) {
  redisHost = 'redis';
}

// 純粋な設定オブジェクト
const redisConfig: RedisOptions = {
  host: redisHost,
  port: parseInt(urlObj.port || '6379'),
  password: urlObj.password,
  username: undefined, // Usernameを除外
  db: parseInt(urlObj.pathname.split('/')[1]) || 0,
  family: 0,
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_URL.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  },
};

export const mintQueue = new Queue('rootlens-mint-queue', {
  // 設定オブジェクトを渡す
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