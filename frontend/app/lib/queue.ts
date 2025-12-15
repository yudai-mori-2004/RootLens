// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Queue Configuration (Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis接続設定 - REDIS_URLのみを使用
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// Railway Public URLはTLS必須
const useTLS = process.env.REDIS_URL.includes('rlwy.net');

// URL文字列から認証情報を抽出
const urlObj = new URL(process.env.REDIS_URL.replace('redis://', 'http://'));

// 新しいRedis接続を作成する関数（BullMQのduplicate()問題を回避）
const createRedisConnection = () => {
  const config: any = {
    host: urlObj.hostname,
    port: parseInt(urlObj.port || '6379'),
    password: urlObj.password ? decodeURIComponent(urlObj.password) : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false, // INFOコマンドによるNOAUTHエラーを回避
    connectTimeout: 30000, // 30秒のタイムアウト
    retryStrategy: (times: number) => {
      if (times > 3) {
        return null; // 3回失敗したら諦める
      }
      return Math.min(times * 1000, 3000);
    },
  };

  // TLS設定（Railway Public URLの場合）
  if (useTLS) {
    config.tls = {
      rejectUnauthorized: false,
      // Vercel環境でのTLS互換性を向上
      minVersion: 'TLSv1.2',
    };
  }

  console.log('🔗 Redis connection config:', {
    host: config.host,
    port: config.port,
    useTLS,
    hasPassword: !!config.password,
  });

  return new IORedis(config);
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
