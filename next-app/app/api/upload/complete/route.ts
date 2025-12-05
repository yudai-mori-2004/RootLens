import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import { generateR2Key, getFileExtension } from '@/app/lib/r2';
import { generateAccessToken, bytesToHex, getMediaType, generateVerificationUrl } from '@/app/lib/utils';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/upload/complete
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { upload_id } = body;

        if (!upload_id) {
            return NextResponse.json(
                { error: 'Missing upload_id' },
                { status: 400 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 1. アップロードセッション取得
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        const { data: session, error: sessionError } = await supabaseAdmin
            .from('upload_sessions')
            .select('*')
            .eq('upload_id', upload_id)
            .single();

        if (sessionError || !session) {
            return NextResponse.json(
                { error: 'Upload session not found' },
                { status: 404 }
            );
        }

        // セッション期限切れチェック
        if (new Date(session.expires_at) < new Date()) {
            return NextResponse.json(
                { error: 'Upload session expired' },
                { status: 410 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 2. R2にファイルがアップロードされているか確認
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // TODO: 実際にR2にファイルが存在するか確認する
        // （現時点では省略、クライアントがPresigned URLでアップロードしたと信頼）

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 3. C2PA署名処理（後で実装、現在はスキップ）
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // TODO: Step 1.5で実装
        // - R2からファイルをダウンロード
        // - C2PA署名を付与（Ingredient参照）
        // - プライバシーフィルタリング
        // - QR透かし生成
        // - サイドカー抽出
        // - R2に保存

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 4. media_proofsテーブルにレコード作成
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // session.original_hashはSupabaseから返されるBYTEAで、
        // PostgreSQLが \x で始まるhex形式（\x + 64文字のhex）で返す
        if (typeof session.original_hash !== 'string' || !session.original_hash.startsWith('\\x')) {
            throw new Error(`Invalid original_hash format: ${typeof session.original_hash}`);
        }

        const contentIdHex = session.original_hash.substring(2);

        // 検証: SHA-256ハッシュは必ず64文字（32バイト）
        if (contentIdHex.length !== 64) {
            throw new Error(`Invalid hash length: expected 64, got ${contentIdHex.length}`);
        }
        const extension = getFileExtension(session.mime_type);
        const mediaType = getMediaType(session.mime_type);
        const accessToken = generateAccessToken();

        // content_idもバイト配列に変換
        const contentIdBytes = Buffer.from(contentIdHex, 'hex');

        const { data: mediaProof, error: mediaProofError } = await supabaseAdmin
            .from('media_proofs')
            .insert({
                content_id: contentIdBytes,
                solana_tx_id: session.solana_tx_id,
                owner_wallet: session.owner_wallet,
                access_token: accessToken,
                media_type: mediaType,
                file_format: session.mime_type,
                file_size: session.file_size,
                original_file_path: generateR2Key(contentIdHex, 'original', extension),
                sidecar_file_path: generateR2Key(contentIdHex, 'sidecar', 'c2pa'),
                qr_watermarked_file_path: null, // 将来実装
                privacy_settings: session.privacy_settings,
            })
            .select()
            .single();

        if (mediaProofError) {
            console.error('Failed to create media_proof:', mediaProofError);

            // セッションをfailedにマーク
            await supabaseAdmin
                .from('upload_sessions')
                .update({ status: 'failed', error_message: mediaProofError.message })
                .eq('upload_id', upload_id);

            return NextResponse.json(
                { error: 'Failed to create media proof record' },
                { status: 500 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 5. アップロードセッションを完了にマーク
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        await supabaseAdmin
            .from('upload_sessions')
            .update({ status: 'completed' })
            .eq('upload_id', upload_id);

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 6. レスポンス
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        return NextResponse.json({
            content_id: contentIdHex,
            access_token: accessToken,
            verification_url: generateVerificationUrl(contentIdHex),
            files: {
                original: generateR2Key(contentIdHex, 'original', extension),
                sidecar: generateR2Key(contentIdHex, 'sidecar', 'c2pa'),
                qr_watermarked: null, // 将来実装
            },
        });

    } catch (error) {
        console.error('Error in /api/upload/complete:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
