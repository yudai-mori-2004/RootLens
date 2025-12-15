// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Final URL String Fix)
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

// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// 【修正の核心】手動パースをやめ、URL文字列を直接加工する
// これにより、ioredisは複製(duplicate)時もこのURLを使い回すため
// パスワードや設定が脱落することがなくなる
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

// 1. URLオブジェクト化してパラメータを安全に追加
const redisUrl = new URL(redisUrlRaw);
redisUrl.searchParams.set('family', '0'); // Railway IPv6必須設定

// 2. 文字列に戻す (例: redis://:pass@host:6379?family=0)
// この文字列の中に全ての認証情報が含まれている
const finalRedisUrl = redisUrl.toString();

console.log('--- Redis Connection Setup ---');
// ログにはパスワードを隠して表示
console.log(`📡 Connecting to: ${finalRedisUrl.replace(/:[^:@]*@/, ':****@')}`);

// 3. IORedisインスタンスを作成（設定オブジェクトではなく、URL文字列を渡す！）
// TLSが必要な場合(Public接続)のみ、第2引数で補足する
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null, // BullMQ必須
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
    // ★重要★ URL文字列から作ったインスタンスを渡す
    // ioredisはURL由来のインスタンスを複製する際、URL情報を完全に維持する
    connection: connection,
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
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));