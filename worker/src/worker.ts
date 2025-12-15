// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (ReadyCheck Fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import { RedisOptions } from 'ioredis'; // インスタンスではなく型定義のみ
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';
import { startServer } from './server';

const redisUrlRaw = process.env.REDIS_URL;
if (!redisUrlRaw) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// URL解析
const urlObj = new URL(redisUrlRaw);

// ■ Railway環境向け 最適化設定
const redisConfig: RedisOptions = {
  // 1. DNS安定化: Railway内部なら短縮名 'redis'
  host: urlObj.hostname.includes('railway.internal') ? 'redis' : urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  
  // 2. 認証方式: Usernameを消してパスワードのみにする (Legacy Auth)
  username: undefined, 
  password: urlObj.password,
  
  // 3. IPv6対応
  family: 0, 
  
  // 4. DB番号
  db: parseInt(urlObj.pathname.split('/')[1]) || 0,
  
  // 5. BullMQ必須設定
  maxRetriesPerRequest: null,
  
  // ★★★ 6. 決定打: INFOコマンドによるNOAUTHエラーを防ぐ ★★★
  enableReadyCheck: false,
  
  // TLS (Public接続用)
  tls: redisUrlRaw.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
};

console.log('--- Redis Config Summary ---');
console.log(`📡 Host: ${redisConfig.host}`);
console.log(`🔑 Auth: ${redisConfig.password ? 'YES (****)' : 'NO'}`);
console.log(`🛡️ ReadyCheck: Disabled`);
console.log('----------------------------');

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
    // 設定オブジェクトを直接渡す (BullMQがこれを使って接続を作成する)
    connection: redisConfig,
    concurrency: 1,
  }
);

// イベントハンドラ
worker.on('ready', () => console.log('✅ Worker is ready and waiting for jobs...'));
worker.on('error', (err) => console.error('⚠️  Worker connection error:', err.message));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} failed:`, err.message));

startServer();

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received, closing worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));