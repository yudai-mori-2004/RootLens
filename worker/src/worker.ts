// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Worker (Railway Short-Name Fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Worker, Job } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { processMint } from './processor';
import type { MintJobData, MintJobResult } from '../../shared/types';
import { startServer } from './server';

const redisUrlRaw = process.env.REDIS_URL;

if (!redisUrlRaw) {
  console.error('❌ Redis configuration is missing. Set REDIS_URL.');
  process.exit(1);
}

// URLをパース
const urlObj = new URL(redisUrlRaw);

// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// 【修正の核心】Railway推奨の「短縮ホスト名」を使用する
// redis.railway.internal (FQDN) はNode.jsのIPv6解決で不安定になるため
// 内部DNS名である "redis" を強制的に使用します。
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

const isRailwayInternal = urlObj.hostname.includes('railway.internal');
const useTLS = redisUrlRaw.includes('rlwy.net');

const redisConfig: RedisOptions = {
  // 1. ホスト名の強制書き換え
  // Railway内部なら "redis"、外部(Public)なら元のまま
  host: isRailwayInternal ? 'redis' : urlObj.hostname,
  
  port: parseInt(urlObj.port || '6379'),
  
  // 2. usernameを削除 (Legacy AUTHへのフォールバック)
  // 'default' を明示するとduplicate時に問題が起きることがあるため削除
  // username: urlObj.username || 'default', 
  
  password: urlObj.password,
  
  // 3. IPv6対応
  family: 0, 
  
  maxRetriesPerRequest: null,
  tls: useTLS ? { rejectUnauthorized: false } : undefined,
};

console.log('--- Redis Connection Setup ---');
console.log(`📡 Connecting to: ${redisConfig.host}:${redisConfig.port}`);
console.log(`🔑 Auth: Password=${redisConfig.password ? 'YES (****)' : 'NO'}`);
console.log(`🌍 Family: ${redisConfig.family}`);

// --- 接続診断 ---
const diagnosticConnection = new IORedis(redisConfig);

diagnosticConnection.on('connect', () => console.log('✅ Diagnostic Redis: TCP Connection established'));
diagnosticConnection.on('ready', () => console.log('✅ Diagnostic Redis: Ready & Authenticated'));
diagnosticConnection.on('error', (err) => console.error('❌ Diagnostic Redis Error:', err.message));

(async () => {
  try {
    console.log('🔍 Testing Redis Authentication...');
    const pong = await diagnosticConnection.ping();
    console.log(`✅ Authentication Test Passed: ${pong}`);
    await diagnosticConnection.quit();
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
    // 設定オブジェクトを渡す（BullMQがこれを使って接続を作成）
    connection: redisConfig,
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
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));