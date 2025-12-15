// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Direct Serial Processing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';
import { startServer } from './server';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// URL文字列から認証情報を抽出
const urlObj = new URL(redisUrl.replace('redis://', 'http://'));

// ■ 共通の接続オプションを作成（これをBullMQに渡す）
const redisOptions = {
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: urlObj.username || 'default', // Railway対応
  password: urlObj.password,
  family: 0, // IPv6対応
  maxRetriesPerRequest: null,
  tls: redisUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
};

console.log('--- Redis Connection Setup ---');

// ■ 診断用：単独で接続してテストする（BullMQとは無関係）
const diagnosticConnection = new IORedis(redisOptions);

diagnosticConnection.on('connect', () => console.log('✅ Diagnostic Redis: TCP Connection established'));
diagnosticConnection.on('ready', () => console.log('✅ Diagnostic Redis: Ready & Authenticated'));
diagnosticConnection.on('error', (err) => console.error('❌ Diagnostic Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Redis Authentication...');
    const pong = await diagnosticConnection.ping();
    console.log(`✅ Authentication Test Passed: ${pong}`);
    // テスト終わったらこの接続は閉じてOKだが、ログ用に開けておく
    // await diagnosticConnection.quit(); 
  } catch (error) {
    console.error('🚨 Authentication Failed Details:', error);
  }
})();


console.log('🚀 RootLens Worker starting...');

// Worker作成
const worker = new Worker<MintJobData, MintJobResult>(
  'rootlens-mint-queue',
  async (job: Job<MintJobData>) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Processing job ${job.id}`);
    console.log(`   User: ${job.data.userWallet}`);
    console.log(`   Hash: ${job.data.originalHash}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // ★ ここから下は「完全に1人ずつ」実行される ★
      const result = await processMint(job.data, (progress) => {
        job.updateProgress(progress);
      });

      console.log(`\n✅ Job ${job.id} completed successfully!`);
      console.log(`   Arweave TX: ${result.arweaveTxId}`);
      console.log(`   cNFT: ${result.cnftMintAddress}\n`);

      return result;
    } catch (error) {
      console.error(`\n❌ Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisOptions,
    concurrency: 1,
  }
);

// イベントハンドラ
worker.on('ready', () => {
  console.log('✅ Worker is ready and waiting for jobs...');
});
worker.on('error', (err) => {
  console.error('⚠️  Worker error:', err);
});

// サーバー起動と終了処理
startServer();

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  await diagnosticConnection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));