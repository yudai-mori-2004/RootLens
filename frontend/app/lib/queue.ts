// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis接続設定
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
  // 開発環境ではリトライを無効化してすぐにエラーを検知
  retryStrategy: (times: number) => {
    if (times > 3) {
      return null; // 3回失敗したら諦める
    }
    return Math.min(times * 50, 2000);
  },
});

// Mintジョブ用のキュー
export const mintQueue = new Queue('rootlens-mint-queue', {
  connection,
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

// 接続エラーハンドリング
connection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

connection.on('connect', () => {
  console.log('✅ Redis connected (Frontend)');
});
