// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Download API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generatePresignedDownloadUrl, generateR2Key } from '@/app/lib/r2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/download/[token]
 *
 * ダウンロードトークンを検証し、Presigned URLへリダイレクト
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'Download token is required' },
        { status: 400 }
      );
    }

    // 1. purchasesテーブルからトークン検証
    interface MediaProofFromPurchase {
      original_hash: string;
      file_extension: string;
    }

    interface PurchaseRecord {
      id: string;
      media_proof_id: string;
      download_token: string;
      download_expires_at: string;
      download_count: number;
      media_proofs: MediaProofFromPurchase;
    }

    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select(`
        id,
        media_proof_id,
        download_token,
        download_expires_at,
        download_count,
        media_proofs!inner(original_hash, file_extension)
      `)
      .eq('download_token', token)
      .single<PurchaseRecord>();

    if (purchaseError || !purchase) {
      return NextResponse.json(
        { error: 'Invalid or expired download token' },
        { status: 404 }
      );
    }

    // 2. 有効期限チェック
    const now = new Date();
    const expiresAt = new Date(purchase.download_expires_at);

    if (now > expiresAt) {
      return NextResponse.json(
        { error: 'Download link has expired' },
        { status: 410 }
      );
    }

    // 3. ダウンロード回数の制限チェック（オプション）
    // 例: 最大10回までダウンロード可能
    const MAX_DOWNLOADS = 10;
    if (purchase.download_count >= MAX_DOWNLOADS) {
      return NextResponse.json(
        { error: 'Download limit reached' },
        { status: 429 }
      );
    }

    // 4. ダウンロード回数をインクリメント
    const { error: updateError } = await supabase
      .from('purchases')
      .update({ download_count: purchase.download_count + 1 })
      .eq('id', purchase.id);

    if (updateError) {
      console.error('Failed to update download count:', updateError);
    }

    // 5. R2 Presigned URL生成（Private Bucket）
    const mediaProof = purchase.media_proofs;
    const originalHash = mediaProof.original_hash;
    const fileExtension = mediaProof.file_extension;

    // generateR2Key を使って正しいキーを生成
    const r2Key = generateR2Key(originalHash, 'original', fileExtension);

    const presignedUrl = await generatePresignedDownloadUrl(
      r2Key,
      3600 // 1時間有効
    );

    // 6. リダイレクト
    return NextResponse.redirect(presignedUrl);

  } catch (error) {
    console.error('Download API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
