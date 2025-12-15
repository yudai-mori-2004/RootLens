// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Config Object Strategy)
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

// URLをパースして設定値を抽出
const urlObj = new URL(redisUrlRaw);

// ■ Railway用のホスト名調整
// redis.railway.internal (FQDN) は不安定なため、短縮名 "redis" があればそちらを優先
// または環境変数でホストが指定されていればそれを使う
let redisHost = urlObj.hostname;
if (redisHost.includes('railway.internal')) {
  redisHost = 'redis';
}

// ■ 純粋な設定オブジェクトを作成 (これをBullMQに渡す)
// インスタンスを渡すと duplicate() の挙動に依存するため、設定値を直接渡すのが最も安全
const redisConfig: RedisOptions = {
  host: redisHost,
  port: parseInt(urlObj.port || '6379'),
  password: urlObj.password,
  username: undefined, // ★重要: defaultユーザー問題を避けるため明示的にundefinedにする
  db: parseInt(urlObj.pathname.split('/')[1]) || 0,
  family: 0, // IPv6/IPv4デュアルスタック対応 (Railway必須)
  maxRetriesPerRequest: null, // BullMQ必須
  tls: redisUrlRaw.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
};

console.log('--- Redis Connection Setup ---');
console.log(`📡 Connecting to: ${redisConfig.host}:${redisConfig.port}`);
console.log(`🔑 Auth: Password=${redisConfig.password ? 'YES (****)' : 'NO'}, User=${redisConfig.username || 'NONE'}`);

// --- 接続診断 ---
// 設定オブジェクトを使ってテスト接続
const diagnosticConnection = new IORedis(redisConfig);

diagnosticConnection.on('error', (err) => console.error('❌ Diagnostic Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Diagnostic Connection...');
    await diagnosticConnection.ping();
    console.log('✅ Diagnostic Connection: PONG (Auth OK)');
    
    // 診断終了後は閉じる
    await diagnosticConnection.quit();
  } catch (error) {
    console.error('🚨 Redis Diagnosis Failed:', error);
    process.exit(1);
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
    // ★重要★ 設定オブジェクトを直接渡す
    // BullMQはこれを使って内部で new IORedis(config) を行うため、
    // duplicate() に起因する設定欠落が起きない
    connection: redisConfig,
    concurrency: 1,
  }
);

// イベントハンドラ
worker.on('ready', () => console.log('✅ Worker is ready and waiting for jobs...'));
worker.on('error', (err) => console.error('⚠️  Worker error:', err));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} failed:`, err.message));

startServer();

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));