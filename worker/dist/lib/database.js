"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Database Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveToDatabase = saveToDatabase;
const supabase_js_1 = require("@supabase/supabase-js");
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
/**
 * 証明データをデータベースに保存（最小限設計）
 *
 * 設計思想: すべての証明データはArweaveに保存。
 * Supabaseはビジネスロジック専用（価格、タイトル、状態管理のみ）
 *
 * original_hashの保存理由:
 * - manifest.jsonパス導出: media/{original_hash}/manifest.json
 * - 重複チェック・検索に使用
 */
async function saveToDatabase(data) {
    const { data: upsertedData, error } = await supabase
        .from('media_proofs')
        .upsert({
        original_hash: data.originalHash, // Conflict target
        arweave_tx_id: data.arweaveTxId,
        cnft_mint_address: data.cnftMintAddress,
        owner_wallet: data.ownerWallet,
        file_extension: data.fileExtension,
        price_lamports: data.priceLamports,
        title: data.title,
        description: data.description,
        is_public: true,
    }, { onConflict: 'original_hash' })
        .select('id')
        .single();
    if (error) {
        throw new Error(`Database save failed: ${error.message}`);
    }
    console.log('   Successfully saved to database (upsert)');
    return { id: upsertedData.id };
}
