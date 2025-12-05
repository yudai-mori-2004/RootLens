import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import { generatePresignedUploadUrl, generateR2Key, getFileExtension } from '@/app/lib/r2';
import { generateUploadId, hexToBytes, bytesToHex, getMediaType } from '@/app/lib/utils';
import { Connection, PublicKey } from '@solana/web3.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/upload/prepare
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            original_hash,      // hex string
            solana_tx_id,      // string
            owner_wallet,      // string (Solana address)
            file_size,         // number
            mime_type,         // string
            privacy_settings = {}  // object
        } = body;

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 1. バリデーション
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        if (!original_hash || !solana_tx_id || !owner_wallet || !file_size || !mime_type) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // ファイルサイズ制限
        const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
        const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
        const mediaType = getMediaType(mime_type);
        const maxSize = mediaType === 'image' ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;

        if (file_size > maxSize) {
            return NextResponse.json(
                { error: `File size exceeds limit (max: ${maxSize / 1024 / 1024}MB)` },
                { status: 400 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 2. Solanaトランザクション確認
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        const connection = new Connection(
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        );

        try {
            const tx = await connection.getTransaction(solana_tx_id, {
                maxSupportedTransactionVersion: 0,
            });

            if (!tx) {
                return NextResponse.json(
                    { error: 'Solana transaction not found' },
                    { status: 400 }
                );
            }

            // トランザクションが成功しているか確認
            if (tx.meta?.err) {
                return NextResponse.json(
                    { error: 'Solana transaction failed' },
                    { status: 400 }
                );
            }

            // TODO: トランザクション内容の検証
            // - original_hash が含まれているか
            // - owner_wallet が署名者か
            // （現時点では省略、Step 1.5で追加予定）

        } catch (error) {
            console.error('Failed to verify Solana transaction:', error);
            return NextResponse.json(
                { error: 'Failed to verify Solana transaction' },
                { status: 400 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 3. アップロードセッション作成
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        const uploadId = generateUploadId();
        const contentIdHex = original_hash; // hex文字列
        const extension = getFileExtension(mime_type);
        const r2Key = generateR2Key(contentIdHex, 'original', extension);

        // PostgreSQLのBYTEA型には \x プレフィックス付きhex文字列を直接渡す
        const contentIdBytea = `\\x${contentIdHex}`;

        const { data: session, error: sessionError } = await supabaseAdmin
            .from('upload_sessions')
            .insert({
                upload_id: uploadId,
                original_hash: contentIdBytea,
                solana_tx_id,
                owner_wallet,
                file_size,
                mime_type,
                privacy_settings,
                r2_key: r2Key,
                status: 'pending',
            })
            .select()
            .single();

        if (sessionError) {
            console.error('Failed to create upload session:', sessionError);
            return NextResponse.json(
                { error: 'Failed to create upload session' },
                { status: 500 }
            );
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 4. Presigned URL生成（R2直接アップロード用）
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        const presignedUrl = await generatePresignedUploadUrl(r2Key, mime_type);

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 5. レスポンス
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        return NextResponse.json({
            upload_id: uploadId,
            presigned_url: presignedUrl,
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1時間後
        });

    } catch (error) {
        console.error('Error in /api/upload/prepare:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
