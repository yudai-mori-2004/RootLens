// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver5 - BullMQ Worker (Upstash Redis)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';

// Redis接続設定
const redisUrl = process.env.REDIS_URL;

console.log('--- Redis Config Debug ---');
console.log('REDIS_URL:', redisUrl ? 'Set (Hidden)' : 'Unset');

if (!redisUrl) {
  console.error('❌ REDIS_URL environment variable is not set.');
  process.exit(1);
}

console.log('Redis Type:', redisUrl.startsWith('rediss://') ? 'Upstash (TLS)' : 'Standard');
console.log('--------------------------');

// Upstash Redis用の接続設定
const createRedisConnection = () => {
  const config: any = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    showFriendlyErrorStack: true,
    connectTimeout: 30000,
  };

  // Upstash Redis (rediss://) の場合、TLSを有効化
  if (redisUrl.startsWith('rediss://')) {
    config.tls = {
      rejectUnauthorized: true, // Upstashは正規の証明書を使用
    };
  }

  console.log('📝 Creating Redis connection...');

  return new IORedis(redisUrl, config);
};

console.log('🚀 RootLens Worker started...');
console.log(`📡 Connecting to Redis via URL...`);

// Worker作成（新しいIORedisインスタンスを渡す）
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
    connection: createRedisConnection(), // ★ 新しいインスタンスを渡す（duplicate()問題を回避）
    concurrency: 1,  // ★★★ 最重要: 完全に1つずつ処理する設定 ★★★
    settings: {
      stalledInterval: 30000,  // 固まったジョブ検出を30秒ごとに（Redisコマンド削減）
      lockDuration: 30000,     // ジョブロック時間
      maxStalledCount: 1,      // 固まったと判定する最大回数
    },
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
