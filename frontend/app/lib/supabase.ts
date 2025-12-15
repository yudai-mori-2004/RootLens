import { createClient } from '@supabase/supabase-js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Supabaseクライアント初期化
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// クライアントサイド用（制限付き）
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// サーバーサイド用（全権限）
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 型定義
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface MediaProof {
    id: string;
    content_id: Uint8Array;
    solana_tx_id: string;
    owner_wallet: string;
    owner_display_name: string | null;
    owner_organization: string | null;
    access_token: string;
    is_active: boolean;
    media_type: 'image' | 'video';
    file_format: string;
    file_size: number;
    original_file_path: string;
    sidecar_file_path: string;
    qr_watermarked_file_path: string | null;
    privacy_settings: Record<string, unknown>;
    price_cents: number;
    currency: string;
    created_at: string;
    updated_at: string;
}

export interface UploadSession {
    id: string;
    upload_id: string;
    original_hash: Uint8Array;
    solana_tx_id: string;
    owner_wallet: string;
    file_size: number;
    mime_type: string;
    privacy_settings: Record<string, any>;
    status: 'pending' | 'uploaded' | 'completed' | 'failed';
    error_message: string | null;
    r2_key: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
}
