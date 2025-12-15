// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Worker - Health Check & Metrics Server
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const app = express();
const PORT = process.env.PORT || 3001;

// Redis接続（メトリクス取得用）
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

// Queue参照（メトリクス取得用）
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

// ルートパス
app.get('/', (req, res) => {
  res.json({
    service: 'RootLens Mint Worker',
    version: '4.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      metrics: '/metrics',
    },
  });
});

export function startServer() {
  app.listen(PORT, () => {
    console.log(`🌐 Health & Metrics server listening on port ${PORT}`);
  });
}
