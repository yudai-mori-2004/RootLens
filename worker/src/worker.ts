// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Direct Serial Processing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';

// Redis接続
const redisUrl = process.env.REDIS_URL;

console.log('--- Redis Config Debug ---');
console.log('REDIS_URL:', redisUrl ? 'Set (Hidden)' : 'Unset');
if (redisUrl) {
  const urlObj = new URL(redisUrl.replace('redis://', 'http://'));
  console.log('Host:', urlObj.hostname);
  console.log('Port:', urlObj.port);
  console.log('Username:', urlObj.username);
  console.log('Password:', urlObj.password ? `***${urlObj.password.slice(-4)}` : 'MISSING');
  console.log('Has @ symbol?', redisUrl.includes('@'));
  console.log('Is Railway Public?', redisUrl.includes('rlwy.net'));
  console.log('TLS Enabled?', redisUrl.includes('rlwy.net') ? 'YES' : 'NO');
}
console.log('--------------------------');

if (!redisUrl) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// Railway Public URLはTLS必須、内部URLはTLS不要
const useTLS = redisUrl.includes('rlwy.net');
console.log(`🔧 Connecting to Redis with TLS: ${useTLS ? 'ENABLED' : 'DISABLED'}`);

// URL文字列から認証情報を抽出
const urlObj = new URL(redisUrl.replace('redis://', 'http://'));

const connection = new IORedis({
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  username: urlObj.username || 'default',
  password: urlObj.password,
  maxRetriesPerRequest: null,
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
});

console.log('🚀 RootLens Worker started...');
console.log(`📡 Connecting to Redis via URL...`);

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
