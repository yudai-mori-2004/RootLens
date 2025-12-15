// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// 1. URL解析と再構築 (Workerと同じロジック)
const urlObj = new URL(process.env.REDIS_URL);

// Hostname修正
if (urlObj.hostname.includes('railway.internal')) {
  urlObj.hostname = 'redis';
}
// Username強制
if (!urlObj.username) {
  urlObj.username = 'default';
}
// IPv6対応
urlObj.searchParams.set('family', '0');

const finalRedisUrl = urlObj.toString();

// 2. 接続作成
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_URL.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
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