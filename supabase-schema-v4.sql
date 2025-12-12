-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RootLens Ver4 Database Schema
-- Arweave統合・相互リンク設計・直列処理基盤対応版
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- このファイルをSupabase SQL Editorで実行してください

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- users テーブル（Privy連携）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Privy連携
    privy_user_id TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,                              -- SMS認証用

    -- プロフィール
    display_name TEXT,
    bio TEXT,

    -- タイムスタンプ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_privy ON users(privy_user_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- media_proofs テーブル（Ver4: Arweave連携追加）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS media_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Arweave連携（証明データの参照元）
    arweave_tx_id TEXT UNIQUE,      -- ArweaveトランザクションID (初期登録時はNULL許容)

    -- cNFT連携（所有権管理）
    cnft_mint_address TEXT UNIQUE,  -- cNFTのAsset ID (初期登録時はNULL許容)
    owner_wallet TEXT,              -- 現在の所有者ウォレット (初期登録時はNULL許容)

    -- R2パス導出用（最小限のキャッシュ）
    original_hash TEXT NOT NULL UNIQUE,      -- パス導出用: media/{original_hash}/...
    file_extension TEXT NOT NULL,            -- 'jpg', 'png', 'mp4' 等（Presigned URL生成に必要）

    -- RootLens独自データ（ビジネスロジック）
    price_lamports BIGINT DEFAULT 0,         -- 0 = 無料
    title TEXT,                              -- 表示用タイトル
    description TEXT,                        -- 説明文

    -- 状態管理
    is_public BOOLEAN DEFAULT FALSE,        -- 証明書ページを公開中か否か

    -- タイムスタンプ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_media_proofs_owner ON media_proofs(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_media_proofs_cnft ON media_proofs(cnft_mint_address);
CREATE INDEX IF NOT EXISTS idx_media_proofs_arweave ON media_proofs(arweave_tx_id);
CREATE INDEX IF NOT EXISTS idx_media_proofs_original_hash ON media_proofs(original_hash);
CREATE INDEX IF NOT EXISTS idx_media_proofs_created_at ON media_proofs(created_at DESC);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- purchases テーブル
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 購入対象
    media_proof_id UUID NOT NULL REFERENCES media_proofs(id),

    -- 購入者情報（Privy認証済み）
    buyer_wallet TEXT NOT NULL,
    buyer_email TEXT NOT NULL,

    -- 決済情報
    solana_tx_signature TEXT NOT NULL,       -- SolanaPay トランザクション署名
    amount_lamports BIGINT NOT NULL,
    seller_wallet TEXT NOT NULL,             -- 支払い先（cNFT所有者）

    -- ダウンロード
    download_token TEXT NOT NULL UNIQUE,     -- Presigned URL生成用トークン
    download_expires_at TIMESTAMPTZ NOT NULL,-- URL有効期限
    download_count INTEGER DEFAULT 0,

    -- タイムスタンプ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer_email ON purchases(buyer_email);
CREATE INDEX IF NOT EXISTS idx_purchases_download_token ON purchases(download_token);
CREATE INDEX IF NOT EXISTS idx_purchases_media ON purchases(media_proof_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- feature_vectors テーブル（Lens機能用・後日実装）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- pgvector拡張を有効化（まだの場合）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS feature_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    media_proof_id UUID NOT NULL REFERENCES media_proofs(id),

    -- ベクトル（pgvector）
    embedding vector(768),                   -- 次元数はモデルによる

    -- メタデータ
    model_name TEXT NOT NULL,                -- 使用したモデル名

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ベクトル検索用インデックス
-- データ数が少ない場合（数千件以下）はインデックス不要（IVFFlatは検索漏れの原因になるため削除）
-- CREATE INDEX IF NOT EXISTS idx_feature_vectors_embedding ON feature_vectors
--    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- updated_at 自動更新トリガー
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_proofs_updated_at BEFORE UPDATE ON media_proofs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Row Level Security (RLS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- RLSを有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_vectors ENABLE ROW LEVEL SECURITY;

-- 全員読み取り可能（証明書ページは公開）
CREATE POLICY "Public read access" ON media_proofs
    FOR SELECT USING (true);

CREATE POLICY "Public read access" ON feature_vectors
    FOR SELECT USING (true);

-- 購入履歴は購入者本人のみ閲覧可能
CREATE POLICY "Buyer can view own purchases" ON purchases
    FOR SELECT USING (buyer_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- サービスロールは全権限
CREATE POLICY "Service role all access on users" ON users
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role all access on media_proofs" ON media_proofs
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role all access on purchases" ON purchases
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role all access on feature_vectors" ON feature_vectors
    FOR ALL USING (true) WITH CHECK (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Lens機能: ベクトル類似度検索関数
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION search_similar_images(
  query_embedding vector(768),
  match_count int DEFAULT 20
)
RETURNS TABLE (
  media_proof_id uuid,
  similarity float,
  arweave_tx_id text,
  cnft_mint_address text,
  original_hash text,
  file_extension text,
  title text,
  description text,
  price_lamports bigint,
  owner_wallet text,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mp.id AS media_proof_id,
    1 - (fv.embedding <=> query_embedding) AS similarity,
    mp.arweave_tx_id,
    mp.cnft_mint_address,
    mp.original_hash,
    mp.file_extension,
    mp.title,
    mp.description,
    mp.price_lamports,
    mp.owner_wallet,
    mp.created_at
  FROM feature_vectors fv
  JOIN media_proofs mp ON fv.media_proof_id = mp.id
  WHERE mp.is_public = true
  ORDER BY fv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
