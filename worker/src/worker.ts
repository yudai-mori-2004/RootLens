// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (The URL String Solution)
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

// 1. URLオブジェクトを作成
const urlObj = new URL(redisUrlRaw);

// 2. ホスト名をRailway内部DNS用 "redis" に書き換え
if (urlObj.hostname.includes('railway.internal')) {
  urlObj.hostname = 'redis';
}

// 3. ユーザー名を空文字にする (これが成功の鍵)
// これにより redis://:password@host... という形式になり、
// ioredisはこれを「レガシー認証（パスワードのみ）」として正しく処理します
urlObj.username = '';

// 4. IPv6対応
urlObj.searchParams.set('family', '0');

// 5. 最終的なURL文字列を生成
const finalRedisUrl = urlObj.toString();

console.log('--- Redis Connection Setup ---');
// パスワード部分を隠してログ出力
console.log(`📡 Connecting to: ${finalRedisUrl.replace(/:[^:@]*@/, ':****@')}`);

// 6. 文字列を使ってインスタンス作成
// オプションは最小限（URLにある情報が最優先されるため）
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null, // BullMQ必須
  // Public接続の場合のみTLS有効化
  tls: redisUrlRaw.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

// --- 接続診断 ---
connection.on('connect', () => console.log('✅ Redis: TCP Connection established'));
connection.on('ready', () => console.log('✅ Redis: Ready & Authenticated'));
connection.on('error', (err) => console.error('❌ Redis Error:', err.message));

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
    // URL文字列から生成されたインスタンスを渡す
    // 文字列由来のインスタンスは duplicate() されても設定が堅牢に維持される
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