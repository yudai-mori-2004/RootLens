/**
 * アップロード完了API (Ver3)
 * R2アップロード完了後、Supabaseに記録
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface CompleteRequest {
  original_hash: string;
  c2pa_hash: string;
  root_signer: string;
  license_type: string;
  cnft_mint_address: string;
  cnft_tree_address: string;
  owner_wallet: string;
  media_type: string;
  file_format: string;
  file_size: number;
  price_lamports?: number;
  title?: string;
  description?: string;
  metadata_uri: string; // Arweave URI
}

export async function POST(request: NextRequest) {
    try {
        const body: CompleteRequest = await request.json();

        console.log('💾 DB登録開始...');
        console.log('Original Hash:', body.original_hash);

        // 1. Supabaseクライアント作成
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!, // サーバーサイドなのでSERVICE_ROLE使用
        );

        // 2. R2パスを構築
        const mediaFilePath = `media/${body.original_hash}/original.${getExtension(body.file_format)}`;
        const c2paFilePath = `media/${body.original_hash}/metadata.c2pa`;

        // 3. media_proofsテーブルに挿入
        const { data, error } = await supabase
            .from('media_proofs')
            .insert({
                original_hash: body.original_hash,
                c2pa_hash: body.c2pa_hash,
                root_signer: body.root_signer,
                license_type: body.license_type,
                cnft_mint_address: body.cnft_mint_address,
                cnft_tree_address: body.cnft_tree_address,
                owner_wallet: body.owner_wallet,
                media_file_path: mediaFilePath,
                c2pa_file_path: c2paFilePath,
                media_type: body.media_type,
                file_format: body.file_format,
                file_size: body.file_size,
                price_lamports: body.price_lamports || 0,
                title: body.title,
                description: body.description,
                last_chain_sync: new Date().toISOString(),
            })
            .select()
            .single();

        if (error) {
            console.error('❌ DB登録エラー:', error);
            throw error;
        }

        console.log('✅ DB登録完了:', data.id);

        // 4. 証明書ページURLを生成
        const proofUrl = `${process.env.NEXT_PUBLIC_APP_URL}/proof/${body.original_hash}`;

        return NextResponse.json({
            success: true,
            media_proof_id: data.id,
            proof_url: proofUrl,
            original_hash: body.original_hash,
        });

    } catch (error) {
        console.error('❌ アップロード完了処理エラー:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

/**
 * Content-Typeから拡張子を推測
 */
function getExtension(contentType: string): string {
    const mapping: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
    };

    return mapping[contentType] || 'bin';
}
