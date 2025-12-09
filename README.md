# RootLens Ver4 - セットアップガイド

Arweave統合・相互リンク設計・BullMQ直列処理基盤対応版

---

## 🚀 クイックスタート

### 1. 環境変数の設定

```bash
cp .env.example .env
```

`.env`ファイルを編集して以下を設定：

#### 必須項目

| 変数名 | 取得方法 |
|--------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabaseプロジェクト設定から取得 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseプロジェクト設定から取得 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseプロジェクト設定から取得（⚠️ 秘密にする） |
| `R2_ACCOUNT_ID` | Cloudflareダッシュボードから取得 |
| `R2_ACCESS_KEY_ID` | R2 APIトークンを作成 |
| `R2_SECRET_ACCESS_KEY` | R2 APIトークンを作成 |
| `SOLANA_PRIVATE_KEY` | 手順3参照 |
| `MERKLE_TREE_ADDRESS` | 手順4参照 |

### 2. Supabaseのセットアップ

```bash
# Supabase SQL Editorで実行
cat supabase-schema-v4.sql
```

1. Supabaseダッシュボードを開く
2. SQL Editor → New Query
3. `supabase-schema-v4.sql`の内容をコピー＆ペースト
4. 実行

### 3. Solana Walletの準備

```bash
# 新規ウォレット作成（または既存のものを使用）
solana-keygen new --outfile wallet-keypair.json

# 秘密鍵をJSON配列形式で取得
cat wallet-keypair.json
# → [1,2,3,...] の形式をコピーして.envのSOLANA_PRIVATE_KEYに設定

# 公開鍵を取得
solana-keygen pubkey wallet-keypair.json
# → Base58形式をコピーして.envのNEXT_PUBLIC_ROOTLENS_SERVER_PUBLIC_KEYに設定
```

**Devnet SOLを取得:**
```bash
solana airdrop 2 <YOUR_PUBLIC_KEY> --url devnet
```

### 4. Merkle Treeの作成

```bash
cd frontend
npm install
npm run create-tree
```

出力されたMerkle Treeアドレスを`.env`の`MERKLE_TREE_ADDRESS`に設定

### 5. Docker起動

```bash
# ルートディレクトリで
docker-compose up -d

# ログ確認
docker-compose logs -f
```

### 6. 動作確認

- Frontend: http://localhost:3000
- Redis: localhost:6379

---

## 📁 ディレクトリ構成

```
RootLens/
├── frontend/           # Next.js (API + UI)
├── worker/            # BullMQ Worker (直列処理)
├── shared/            # 共有型定義
├── docker-compose.yml
├── supabase-schema-v4.sql
└── .env.example
```

---

## 🔄 アップロードフロー（Ver4）

### クライアント側（frontend）

1. C2PA検証（WASM）
2. ハッシュ計算（originalHash, c2paHash）
3. R2にPresigned URLでアップロード
4. `/api/upload` にPOST → ジョブIDを取得
5. `/api/job-status/[jobId]` でポーリング

### サーバー側（worker）

1. 次のcNFTアドレス予測（TreeConfig.numMinted参照）
2. Arweaveアップロード（target_asset_id設定）
3. cNFT mint
4. データベース保存

**重要:** Workerはconcurrency: 1で完全直列処理

---

## 🛠️ 開発コマンド

```bash
# Docker環境起動
docker-compose up -d

# ログ監視
docker-compose logs -f worker    # Worker
docker-compose logs -f frontend  # Frontend

# 再ビルド
docker-compose up -d --build

# 停止
docker-compose down

# データ削除（Redis含む）
docker-compose down -v
```

---

## ✅ トラブルシューティング

### Workerが起動しない

```bash
# Workerのログを確認
docker-compose logs worker

# よくあるエラー:
# - SOLANA_PRIVATE_KEY形式が間違っている（JSON配列形式にする）
# - MERKLE_TREE_ADDRESSが未設定
# - Redisに接続できない（REDIS_HOST=redis）
```

### Frontendが起動しない

```bash
# node_modulesを再インストール
cd frontend
rm -rf node_modules package-lock.json
npm install
cd ..
docker-compose up -d --build
```

### Redisに接続できない

```bash
# Redisが起動しているか確認
docker-compose ps

# Redisのヘルスチェック
docker-compose exec redis redis-cli ping
# → PONG が返ればOK
```

---

## 🔐 セキュリティ注意事項

1. `.env`ファイルは**絶対にGitにコミットしない**
2. `SUPABASE_SERVICE_ROLE_KEY`は本番環境のみで使用
3. `SOLANA_PRIVATE_KEY`は秘密にする（本番ではHSM推奨）
4. R2のAPIキーは定期的にローテーション

---

## 📚 次のステップ

- [ ] 相互リンク検証ロジックの実装（証明書ページ）
- [ ] フロントエンドのアップロードUI更新
- [ ] エラーハンドリング強化
- [ ] テストコード作成

---

## 🐛 既知の問題

- Base58形式の秘密鍵デコードは未実装（JSON配列形式を使用してください）
- 証明書ページの相互リンク検証は未実装

---

## 📞 サポート

問題が発生した場合は、以下のログを添えて報告してください：

```bash
docker-compose logs worker > worker.log
docker-compose logs frontend > frontend.log
docker-compose logs redis > redis.log
```
