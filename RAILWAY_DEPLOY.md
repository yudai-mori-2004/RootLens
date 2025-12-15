# RootLens Worker - Railway デプロイガイド

このガイドでは、RootLens Mint Worker を Railway にデプロイする手順を説明します。

## 📋 前提条件

- Railway アカウント（https://railway.app）
- GitHub アカウント（リポジトリ連携用）
- 環境変数の準備（後述）

---

## 🚀 デプロイ手順

### Step 1: Railway アカウント作成

1. https://railway.app にアクセス
2. "Start a New Project" をクリック
3. GitHub アカウントで連携

### Step 2: Redis サービスを追加

1. Railway Dashboard で "New Project" をクリック
2. "Add Service" → "Database" → "Redis" を選択
3. Redis がデプロイされるまで待つ（約30秒）
4. Redis の接続情報をメモ：
   - `REDIS_HOST`: Redis のホスト名（Railway が自動設定）
   - `REDIS_PORT`: Redis のポート（通常は6379）

### Step 3: Worker サービスを追加

#### 方法A: GitHub リポジトリから（推奨）

1. "Add Service" → "GitHub Repo" を選択
2. リポジトリを選択: `RootLens`
3. Root Directory を設定: `worker`
4. Deploy をクリック

#### 方法B: Railway CLI から

```bash
# Railway CLI インストール
npm i -g @railway/cli

# ログイン
railway login

# プロジェクトにリンク
cd /Users/forest/WebCreations/RootLens/worker
railway link

# デプロイ
railway up
```

### Step 4: 環境変数を設定

Railway Dashboard で Worker サービスを選択し、"Variables" タブで以下を設定：

```bash
# Redis（Railway の Redis サービスから参照）
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}

# Solana（Mainnet または Devnet）
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=[1,2,3,...] # JSON配列形式

# Metaplex
MERKLE_TREE_ADDRESS=<あなたのMerkle Treeアドレス>

# Helius
HELIUS_API_KEY=<あなたのHelius APIキー>

# Irys (Mainnet)
IRYS_ADDRESS=https://node1.irys.xyz

# Supabase
NEXT_PUBLIC_SUPABASE_URL=<あなたのSupabase URL>
SUPABASE_SERVICE_ROLE_KEY=<あなたのSupabase Service Roleキー>

# ポート（Railwayが自動設定）
PORT=${{PORT}}
```

**重要：**
- `SOLANA_PRIVATE_KEY` は JSON配列形式で設定（例: `[123,45,67,...]`）
- Mainnet にデプロイする場合は `SOLANA_RPC_URL` と `IRYS_ADDRESS` を Mainnet に変更

### Step 5: デプロイ確認

1. Railway Dashboard で "Deployments" タブを確認
2. ログを確認：
   ```
   🚀 RootLens Worker started...
   📡 Connecting to Redis at xxx:6379
   ✅ Worker is ready and waiting for jobs...
   🌐 Health & Metrics server listening on port 3001
   ```

3. ヘルスチェック確認：
   - Railway が自動的に公開 URL を生成（例: `https://rootlens-worker-production.up.railway.app`）
   - `https://<your-url>/health` にアクセス
   - 以下のレスポンスが返れば成功：
     ```json
     {
       "status": "ok",
       "worker": "running",
       "timestamp": "2025-01-15T12:00:00.000Z",
       "uptime": 123.456
     }
     ```

4. メトリクス確認：
   - `https://<your-url>/metrics` にアクセス
   - キューの状態が表示される：
     ```json
     {
       "queue": "rootlens-mint-queue",
       "counts": {
         "waiting": 0,
         "active": 0,
         "completed": 5,
         "failed": 0
       },
       "timestamp": "2025-01-15T12:00:00.000Z"
     }
     ```

---

## 🔗 Vercel フロントエンドとの連携

### Vercel 環境変数を更新

Vercel Dashboard で以下の環境変数を Railway の値に更新：

```bash
# Redis（Railway から取得）
REDIS_HOST=<Railway Redis ホスト>
REDIS_PORT=6379

# その他の環境変数は Worker と同じ
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
MERKLE_TREE_ADDRESS=<同じ値>
HELIUS_API_KEY=<同じ値>
# ...
```

**重要：** Vercel と Worker が**同じ Redis インスタンス**を参照する必要があります。

### 接続テスト

1. Vercel にデプロイされたフロントエンドにアクセス
2. `/upload` ページでファイルをアップロード
3. Railway の Worker ログを確認：
   ```
   📦 Processing job 1
      User: <ウォレットアドレス>
      Hash: abc123...
   ```

4. ジョブが完了すれば成功：
   ```
   ✅ Job 1 completed successfully!
      Arweave TX: xyz...
      cNFT: 7xKp...
   ```

---

## 📊 監視とデバッグ

### ログの確認

Railway Dashboard で "Logs" タブを確認：
- リアルタイムログストリーミング
- エラーの検索
- ログのダウンロード

### メトリクスの確認

1. Worker の公開 URL にアクセス：`https://<your-url>/metrics`
2. キューの状態を定期的に確認
3. `failed` カウントが増えている場合は要調査

### よくある問題

#### 1. Worker が起動しない

**原因：** Redis 接続エラー

**解決：**
- `REDIS_HOST` と `REDIS_PORT` が正しく設定されているか確認
- Redis サービスが起動しているか確認

#### 2. ジョブが処理されない

**原因：** Vercel と Worker が異なる Redis を参照している

**解決：**
- Vercel の環境変数を Railway Redis に更新
- 両方のサービスを再デプロイ

#### 3. Solana トランザクションエラー

**原因：** `SOLANA_PRIVATE_KEY` の形式エラー

**解決：**
- JSON配列形式（`[1,2,3,...]`）で設定されているか確認
- 鍵の長さが64バイトか確認

---

## 💰 コストの目安

Railway の料金体系：
- **Hobby Plan（無料）**: $5相当のクレジット/月
  - Worker: 約 $3-5/月
  - Redis: 約 $1-2/月
- **Developer Plan（$5/月）**: $5クレジット + 使用量に応じた従量課金

**推奨：**
- 最初は Hobby Plan で開始
- トラフィックが増えたら Developer Plan に移行

---

## 🔒 セキュリティ

### 秘密鍵の管理

- `SOLANA_PRIVATE_KEY` は Railway の環境変数で管理（暗号化済み）
- GitHub にコミットしない
- ローカルの `.env` ファイルも `.gitignore` に追加

### Redis のアクセス制限

- Railway の Redis はデフォルトでプライベートネットワーク内のみアクセス可能
- 外部からの直接アクセスは不可

---

## 📚 参考リンク

- [Railway Documentation](https://docs.railway.app)
- [BullMQ Documentation](https://docs.bullmq.io)
- [RootLens 仕様書](./SPECS.md)

---

## 🆘 トラブルシューティング

問題が発生した場合：

1. Railway のログを確認
2. ヘルスチェック (`/health`) が応答するか確認
3. メトリクス (`/metrics`) でキューの状態を確認
4. Vercel のログを確認（ジョブ投入側）

それでも解決しない場合は、RootLens の Issue を作成してください。
