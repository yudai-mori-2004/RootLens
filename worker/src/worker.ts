// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (The Final Combination)
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

// 1. URLをパース
const urlObj = new URL(redisUrlRaw);

// 2. ホスト名をRailway内部DNS用 "redis" に書き換え (DNS安定化)
const isRailwayInternal = urlObj.hostname.includes('railway.internal');
if (isRailwayInternal) {
  urlObj.hostname = 'redis';
}

// 3. ユーザー名を "default" に強制 (Redis 6+ ACL対応)
if (!urlObj.username) {
  urlObj.username = 'default';
}

// 4. クエリパラメータに family=0 を追加 (IPv6対応)
urlObj.searchParams.set('family', '0');

// 5. 文字列として再構築 (duplicate時の設定維持のため)
const finalRedisUrl = urlObj.toString();

console.log('--- Redis Connection Setup ---');
// パスワードを隠してログ出力
console.log(`📡 Connecting to: ${finalRedisUrl.replace(/:[^:@]*@/, ':****@')}`);

// 6. メイン接続の作成
const connection = new IORedis(finalRedisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrlRaw.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

// --- 徹底的な診断ブロック ---
connection.on('error', (err) => console.error('❌ Main Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Main Connection...');
    await connection.ping();
    console.log('✅ Main Connection: PONG');

    console.log('🔍 Testing Duplication (BullMQ Simulation)...');
    // BullMQが内部で行うのと同じ "duplicate" をテスト
    const dupConnection = connection.duplicate();
    
    // 複製接続のエラーも捕捉
    dupConnection.on('error', (err) => console.error('❌ Duplicate Redis Error:', err.message));
    
    await dupConnection.connect();
    const dupPong = await dupConnection.ping();
    console.log(`✅ Duplicate Connection: ${dupPong} (Auth inherited successfully)`);
    await dupConnection.quit();

  } catch (error) {
    console.error('🚨 Redis Diagnosis Failed:', error);
    process.exit(1); // 接続できないなら即死させる
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
    // URL文字列で初期化したインスタンスを渡す
    // これにより duplicate() されても URL (redis://default:pass@redis...) が維持される
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