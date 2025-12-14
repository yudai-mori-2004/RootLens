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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      );
    }

    // まず総数を取得
    const { count: totalCount, error: countError } = await supabase
      .from('purchases')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_wallet', walletAddress);

    if (countError) {
      console.error('Supabase count error:', countError);
      throw new Error('購入履歴数の取得に失敗しました。');
    }

    if (!totalCount || totalCount === 0) {
      return NextResponse.json({ items: [], total: 0, page, limit, totalPages: 0 });
    }

    // purchasesテーブルから購入履歴を取得（ページネーション適用）
    // media_proofsの情報も結合して取得
    const offset = (page - 1) * limit;
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Supabase query error:', error);
      throw new Error('購入履歴の取得に失敗しました。');
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({ items: [], total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) });
    }

    // サムネイルURLはoriginal_hashから構築（R2パスは固定: media/{hash}/thumbnail.jpg）
    const publicBucketUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL;

    const formattedContent = purchases.map((purchase: any) => {
      const proof = purchase.media_proofs;

      return {
        purchaseId: purchase.id,
        mediaProofId: proof.id,
        originalHash: proof.original_hash,
        title: proof.title || '無題のコンテンツ',
        cnftMintAddress: proof.cnft_mint_address,
        downloadToken: purchase.download_token,
        purchasedAt: purchase.created_at,
        thumbnailUrl: publicBucketUrl ? `${publicBucketUrl}/media/${proof.original_hash}/thumbnail.jpg` : undefined,
      };
    });

    return NextResponse.json({
      items: formattedContent,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    });

  } catch (error) {
    console.error('Purchased content API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
