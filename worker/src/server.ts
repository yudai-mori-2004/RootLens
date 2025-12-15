// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Worker - Health Check & Metrics Server
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { MintJobData } from '../../shared/types';

const app = express();
app.use(express.json()); // JSON body parser

const PORT = process.env.PORT || 8080;

// Upstash Redis接続
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.error('❌ REDIS_URL environment variable is not set.');
  process.exit(1);
}

const config: any = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 30000,
};

// Upstash Redis (rediss://) の場合、TLSを有効化
if (redisUrl.startsWith('rediss://')) {
  config.tls = {
    rejectUnauthorized: true,
  };
}

const connection = new IORedis(redisUrl, config);

// Queue参照
const queue = new Queue('rootlens-mint-queue', { connection });

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    worker: 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// メトリクス（キューの状態）
app.get('/metrics', async (req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    res.json({
      queue: 'rootlens-mint-queue',
      counts: {
        waiting,
        active,
        completed,
        failed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// ジョブ投入エンドポイント（Vercelから呼ばれる）
app.post('/api/upload', async (req, res) => {
  try {
    const jobData: MintJobData = req.body;

    console.log('📤 Received upload request from Vercel');
    console.log(`   User: ${jobData.userWallet}`);
    console.log(`   Hash: ${jobData.originalHash}`);

    // ジョブをキューに追加
    const job = await queue.add('mint-nft', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    console.log(`✅ Job ${job.id} added to queue`);

    res.json({
      success: true,
      jobId: job.id,
      message: '処理を開始しました。完了までお待ちください。',
    });
  } catch (error) {
    console.error('❌ Upload API error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ジョブステータス確認エンドポイント
app.get('/api/job-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    const state = await job.getState();
    const progress = job.progress;

    res.json({
      success: true,
      jobId: job.id,
      state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
    });
  } catch (error) {
    console.error('❌ Job status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ルートパス
app.get('/', (req, res) => {
  res.json({
    service: 'RootLens Mint Worker',
    version: '4.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      metrics: '/metrics',
      upload: 'POST /api/upload',
      jobStatus: 'GET /api/job-status/:jobId',
    },
  });
});

export function startServer() {
  app.listen(PORT, () => {
    console.log(`🌐 Health & Metrics server listening on port ${PORT}`);
  });
}
