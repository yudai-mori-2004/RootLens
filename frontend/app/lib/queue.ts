// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// 1. URLに family=0 を埋め込む
const redisUrl = new URL(process.env.REDIS_URL);
redisUrl.searchParams.set('family', '0'); // Railway IPv6対応
const finalRedisUrl = redisUrl.toString();

// 2. IORedisインスタンス作成
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null,
  tls: finalRedisUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 3) return null; // 3回失敗したら諦める
    return Math.min(times * 50, 2000);
  },
});

export const mintQueue = new Queue('rootlens-mint-queue', {
  connection, 
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