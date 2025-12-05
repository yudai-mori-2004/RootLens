-- RootScan MVP Database Schema
-- このファイルをSupabase SQL Editorで実行してください

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- media_proofs テーブル
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS media_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Solana連携
    content_id BYTEA NOT NULL UNIQUE,
    solana_tx_id TEXT NOT NULL,

    -- 所有者情報
    owner_wallet TEXT NOT NULL,
    owner_display_name TEXT,
    owner_organization TEXT,

    -- アクセス制御
    access_token TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,

    -- ファイル情報
    media_type TEXT NOT NULL,               -- 'image' | 'video'
    file_format TEXT NOT NULL,              -- 'image/jpeg', 'video/mp4' 等
    file_size BIGINT NOT NULL,

    -- R2パス
    original_file_path TEXT NOT NULL,       -- R2のキー (例: media/{content_id}/original.jpg)
    sidecar_file_path TEXT NOT NULL,        -- サイドカーファイル
    qr_watermarked_file_path TEXT,          -- QR透かし付きファイル (将来実装)

    -- プライバシー設定（JSON）
    privacy_settings JSONB DEFAULT '{}',

    -- 価格設定（Step 2で有効化、現在は0固定）
    price_cents INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'usd',

    -- タイムスタンプ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_media_proofs_content_id ON media_proofs(content_id);
CREATE INDEX IF NOT EXISTS idx_media_proofs_owner_wallet ON media_proofs(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_media_proofs_access_token ON media_proofs(access_token);
CREATE INDEX IF NOT EXISTS idx_media_proofs_created_at ON media_proofs(created_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- upload_sessions テーブル（2段階アップロードの管理用）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- アップロード準備時に生成
    upload_id TEXT NOT NULL UNIQUE,
    original_hash BYTEA NOT NULL,
    solana_tx_id TEXT NOT NULL,
    owner_wallet TEXT NOT NULL,

    -- ファイル情報
    file_size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,

    -- プライバシー設定
    privacy_settings JSONB DEFAULT '{}',

    -- ステータス管理
    status TEXT DEFAULT 'pending',          -- 'pending' | 'uploaded' | 'completed' | 'failed'
    error_message TEXT,

    -- R2アップロード用
    r2_key TEXT NOT NULL,                   -- R2に保存するキー

    -- タイムスタンプ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'  -- 1時間で期限切れ
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_upload_sessions_upload_id ON upload_sessions(upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);

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

CREATE TRIGGER update_media_proofs_updated_at BEFORE UPDATE ON media_proofs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_upload_sessions_updated_at BEFORE UPDATE ON upload_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Row Level Security (RLS) - 将来の認証機能用
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 現在はRLSを無効化（パブリックアクセス）
ALTER TABLE media_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;

-- とりあえず全員読み取り可能
CREATE POLICY "Public read access" ON media_proofs
    FOR SELECT USING (true);

CREATE POLICY "Public read access" ON upload_sessions
    FOR SELECT USING (true);

-- サーバーサイド（SERVICE_ROLE）は全権限
CREATE POLICY "Service role all access" ON media_proofs
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role all access" ON upload_sessions
    FOR ALL USING (true) WITH CHECK (true);
