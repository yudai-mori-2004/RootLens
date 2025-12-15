// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// URL文字列から認証情報を抽出
const urlObj = new URL(process.env.REDIS_URL.replace('redis://', 'http://'));
const useTLS = process.env.REDIS_URL.includes('rlwy.net');

// ■ 接続オプションオブジェクトを作成
const connectionOptions = {
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: urlObj.username || 'default',
  password: urlObj.password,
  family: 0, // Railway IPv6対応
  maxRetriesPerRequest: null,
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
};

// Mintジョブ用のキュー
export const mintQueue = new Queue('rootlens-mint-queue', {
  connection: connectionOptions, // インスタンスを渡す

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