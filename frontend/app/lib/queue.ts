// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Frontend Queue Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import { RedisOptions } from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

const urlObj = new URL(process.env.REDIS_URL);

// Workerと同じ設定
const redisConfig: RedisOptions = {
  host: urlObj.hostname.includes('railway.internal') ? 'redis' : urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: undefined, 
  password: urlObj.password,
  family: 0,
  db: parseInt(urlObj.pathname.split('/')[1]) || 0,
  maxRetriesPerRequest: null,
  
  // ★ INFOコマンド無効化
  enableReadyCheck: false,
  
  tls: process.env.REDIS_URL.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times: number) => {
    if (times > 5) return null;
    return Math.min(times * 50, 2000);
  },
};

export const mintQueue = new Queue('rootlens-mint-queue', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});