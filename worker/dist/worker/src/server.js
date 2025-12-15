"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Worker - Health Check & Metrics Server
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Redis接続（メトリクス取得用）
const connection = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
});
// Queue参照（メトリクス取得用）
const queue = new bullmq_1.Queue('rootlens-mint-queue', { connection });
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
    }
    catch (error) {
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
function startServer() {
    app.listen(PORT, () => {
        console.log(`🌐 Health & Metrics server listening on port ${PORT}`);
    });
}
