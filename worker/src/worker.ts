// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Config Object Fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';
import { startServer } from './server';

const redisUrlRaw = process.env.REDIS_URL;

if (!redisUrlRaw) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// 1. URLをパースして設定オブジェクトを作成
const urlObj = new URL(redisUrlRaw);

// BullMQに渡すための「純粋な設定オブジェクト」を作成
// これにより、BullMQが作成する全ての接続（Main, Blocking, Subscriber）で
// 確実にこの設定が使われます。duplicate()の挙動に依存しません。
const redisConfig: RedisOptions = {
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: urlObj.username || 'default',
  password: urlObj.password,
  family: 0, // Railway IPv6対応
  maxRetriesPerRequest: null, // BullMQの必須要件
  // TLS設定: Public URLの場合のみ有効化
  tls: redisUrlRaw.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
};

console.log('--- Redis Connection Setup ---');
// パスワードを隠してログ出力
console.log(`📡 Connecting to: ${urlObj.hostname}:${urlObj.port}`);
console.log(`🔑 Auth: User=${redisConfig.username}, Pass=${redisConfig.password ? '****' : 'NONE'}`);

// --- 接続診断（設定オブジェクトが正しいか確認） ---
const diagnosticConnection = new IORedis(redisConfig);

diagnosticConnection.on('connect', () => console.log('✅ Diagnostic Redis: TCP Connection established'));
diagnosticConnection.on('ready', () => console.log('✅ Diagnostic Redis: Ready & Authenticated'));
diagnosticConnection.on('error', (err) => console.error('❌ Diagnostic Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Redis Authentication...');
    const pong = await diagnosticConnection.ping();
    console.log(`✅ Authentication Test Passed: ${pong}`);
    // 診断用接続は閉じる（リソース節約）
    await diagnosticConnection.quit();
  } catch (error) {
    console.error('🚨 Authentication Failed Details:', error);
  }
})();
// ----------------

console.log('🚀 RootLens Worker starting...');

// Worker作成
const worker = new Worker<MintJobData, MintJobResult>(
  'rootlens-mint-queue',
  async (job: Job<MintJobData>) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Processing job ${job.id}`);
    
    try {
      const result = await processMint(job.data, (progress) => {
        job.updateProgress(progress);
      });
      console.log(`✅ Job ${job.id} completed!`);
      return result;
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    // ★重要★ インスタンスではなく「設定オブジェクト」を渡す
    // BullMQはこれを使って必要な数だけ接続を新規作成します
    connection: redisConfig,
    concurrency: 1,
  }
);

// イベントハンドラ
worker.on('ready', () => console.log('✅ Worker is ready and waiting for jobs...'));
worker.on('error', (err) => console.error('⚠️  Worker error:', err));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} failed:`, err.message));

// サーバー起動
startServer();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));