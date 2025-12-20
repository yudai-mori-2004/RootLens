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


// シングルトンパターンでQueueインスタンスを管理（Next.jsホットリロード対策）
// グローバル変数を使用してインスタンスを永続化
declare global {
  var __mintQueue: Queue | undefined;
  var __redisConnection: IORedis | undefined;
}

function getQueue() {
  if (!global.__mintQueue) {
    console.log('🆕 Creating new Queue instance...');
    global.__redisConnection = createRedisConnection();
    global.__mintQueue = new Queue('rootlens-mint-queue', {
      connection: global.__redisConnection,
      defaultJobOptions: {
        attempts: 3,                    // 最大3回リトライ
        backoff: {
          type: 'exponential',          // 指数バックオフ
          delay: 2000,                  // 初回2秒待ち
        },
        removeOnComplete: {
          age: 3600,                    // 完了後1時間で削除（Workerと統一）
          count: 100,                   // 最大100件保持（Workerと統一）
        },
        removeOnFail: {
          age: 86400,                   // 失敗後24時間保持（Workerと統一）
        },
      },
    });
  } else {
    console.log('♻️  Reusing existing Queue instance');
  }
  return global.__mintQueue;
}

// Mintジョブ用のキュー
export const mintQueue = getQueue();
