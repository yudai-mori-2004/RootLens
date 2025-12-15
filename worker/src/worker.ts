// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Direct Serial Processing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';

// Redis接続
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

console.log('🚀 RootLens Worker started...');
console.log(`📡 Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);

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
    connection,
    concurrency: 1,  // ★★★ 最重要: 完全に1つずつ処理する設定 ★★★
  }
);

// イベントハンドラ
worker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed!`, result);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('⚠️  Worker error:', err);
});

worker.on('ready', () => {
  console.log('✅ Worker is ready and waiting for jobs...');
});

// HTTPサーバー起動（ヘルスチェック & メトリクス）
import { startServer } from './server';
startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});
