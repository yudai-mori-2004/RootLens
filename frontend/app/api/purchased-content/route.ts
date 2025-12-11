import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// サービスロールキーを使用して検索（RLSがあるので本来はAnonキーでもJWTがあれば良いが、
// ここでは確実にデータを取得するためにService Role Keyを使用し、コード内でフィルタリングする）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/purchased-content
 * ユーザーが購入したコンテンツのリストを取得するAPI
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const walletAddress = searchParams.get('walletAddress');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // purchasesテーブルから購入履歴を取得
    // media_proofsの情報も結合して取得
    const { data: purchases, error } = await supabase
      .from('purchases')
      .select(`
        id,
        download_token,
        created_at,
        media_proofs!inner (
          id,
          title,
          original_hash,
          cnft_mint_address,
          description
        )
      `)
      .eq('buyer_wallet', walletAddress)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase query error:', error);
      throw new Error('購入履歴の取得に失敗しました。');
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json([]);
    }

    // レスポンスの整形
    const publicBucketUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL;

    // サムネイル取得を含むレスポンス生成
    const formattedContent = await Promise.all(purchases.map(async (purchase: any) => {
      const proof = purchase.media_proofs;
      let thumbnailUrl: string | undefined;

      // サムネイルURLの取得
      try {
        if (publicBucketUrl) {
          const manifestUrl = `${publicBucketUrl}/media/${proof.original_hash}/manifest.json`;
          const manifestResponse = await fetch(manifestUrl);
          if (manifestResponse.ok) {
            const manifestData = await manifestResponse.json();
            thumbnailUrl = manifestData.thumbnailUrl;
          }
        }
      } catch (e) {
        // console.warn(`Failed to fetch manifest for ${proof.original_hash}:`, e);
      }

      return {
        purchaseId: purchase.id,
        mediaProofId: proof.id,
        originalHash: proof.original_hash,
        title: proof.title || '無題のコンテンツ',
        cnftMintAddress: proof.cnft_mint_address,
        downloadToken: purchase.download_token,
        purchasedAt: purchase.created_at,
        thumbnailUrl: thumbnailUrl,
      };
    }));

    return NextResponse.json(formattedContent);

  } catch (error) {
    console.error('Purchased content API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
