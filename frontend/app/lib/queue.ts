// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis接続設定 - REDIS_URLのみを使用
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// ★★★ RailwayのIPv6対応: family=0 を含むURL文字列を作成 ★★★
const redisUrlWithFamily = `${process.env.REDIS_URL}?family=0`;

// Mintジョブ用のキュー
export const mintQueue = new Queue('rootlens-mint-queue', {
  connection: redisUrlWithFamily,
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
