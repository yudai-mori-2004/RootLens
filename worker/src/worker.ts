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

console.log('--- Redis Connection Setup ---');

// 手動パースをやめ、IORedisに任せる構成に変更
// family: 0 は Railway の IPv6 対応に必須
const connection = new IORedis(redisUrl, {
  family: 0, 
  maxRetriesPerRequest: null,
  // TLSはURLに "rlwy.net" (Railway Public) が含まれる場合のみ有効化
  tls: redisUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

// --- 接続診断ブロック (起動時に実行) ---
connection.on('connect', () => console.log('✅ Redis: TCP Connection established'));
connection.on('ready', () => console.log('✅ Redis: Ready & Authenticated'));
connection.on('error', (err) => console.error('❌ Redis Error:', err.message));

// 強制的に認証確認を行う
(async () => {
  try {
    console.log('🔍 Testing Redis Authentication...');
    // パスワードが設定されているか長さだけで確認（ログに生パスワードは出さない）
    const passLen = connection.options.password?.toString().length || 0;
    console.log(`🔑 Configured Password Length: ${passLen}`);
    
    // PINGを送って AUTH が通っているか確認
    const pong = await connection.ping();
    console.log(`✅ Authentication Test Passed: ${pong}`);
  } catch (error) {
    console.error('🚨 Authentication Failed Details:', error);
    // ここでエラーが出るなら、BullMQ以前に接続設定の問題
  }
})();
// --------------------------------------

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
    // 作成した接続インスタンスをそのまま渡す（最も確実な方法）
    connection: connection,
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
startServer();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  await connection.quit(); // Redis接続も閉じる
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));