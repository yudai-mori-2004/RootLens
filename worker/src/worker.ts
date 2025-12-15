// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Final Fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';
import { startServer } from './server';

const redisUrlRaw = process.env.REDIS_URL;

if (!redisUrlRaw) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// 1. URLオブジェクトを使って安全にパラメータを追加
// (単なる文字列結合だと、既にクエリがある場合に壊れるため new URL を使う)
const redisUrl = new URL(redisUrlRaw);
redisUrl.searchParams.set('family', '0'); // ★Railway IPv6対応の特効薬

const finalRedisUrl = redisUrl.toString();

console.log('--- Redis Connection Setup ---');
// パスワードなどの機密情報は隠してログ出力
console.log(`📡 Connecting to: ${finalRedisUrl.replace(/:[^:@]*@/, ':****@')}`);

// 2. ioredisに「URL文字列」をそのまま渡す
// オプションオブジェクトで設定せず、URLパラメータに全てを語らせるのが一番安全で確実です
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null,
  // TLSが必要な場合のみオプション追加（URLにrlwy.netが含まれる＝Public接続の場合）
  tls: finalRedisUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

// --- 接続診断 ---
connection.on('connect', () => console.log('✅ Redis: TCP Connection established'));
connection.on('ready', () => console.log('✅ Redis: Ready & Authenticated'));
connection.on('error', (err) => console.error('❌ Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Redis Authentication...');
    const pong = await connection.ping();
    console.log(`✅ Authentication Test Passed: ${pong}`);
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
    // 作成したコネクションインスタンスを渡す
    // ioredisはURL文字列から生成されたインスタンスの場合、duplicate()時もそのURL設定を引き継ぐ
    connection: connection,
    concurrency: 1, // 完全に1つずつ順序処理
  }
);

// イベントハンドラ
worker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed!`);
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

// サーバー起動
startServer();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));