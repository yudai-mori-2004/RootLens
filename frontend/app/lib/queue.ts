// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver5 - BullMQ Queue Configuration (Upstash Redis)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis接続設定
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

console.log('🔗 Connecting to Redis...');

// Upstash Redis用の接続設定
const createRedisConnection = () => {
  // REDIS_URL形式: rediss://default:password@host:port
  const redisUrl = process.env.REDIS_URL!;

  const config: any = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 30000,
  };

  // Upstash Redis (rediss://) の場合、TLSを有効化
  if (redisUrl.startsWith('rediss://')) {
    config.tls = {
      rejectUnauthorized: true, // Upstashは正規の証明書を使用
    };
  }

  console.log('📡 Redis URL detected:', redisUrl.startsWith('rediss://') ? 'Upstash (TLS)' : 'Standard');

  return new IORedis(redisUrl, config);
};


// Mintジョブ用のキュー
export const mintQueue = new Queue('rootlens-mint-queue', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,                    // 最大3回リトライ
    backoff: {
      type: 'exponential',          // 指数バックオフ
      delay: 2000,                  // 初回2秒待ち
    },
    removeOnComplete: {
      age: 24 * 3600,               // 完了後24時間で削除
      count: 1000,                  // 最大1000件保持
    },
    removeOnFail: {
      age: 7 * 24 * 3600,           // 失敗後7日間保持（調査用）
    },
  },
});
