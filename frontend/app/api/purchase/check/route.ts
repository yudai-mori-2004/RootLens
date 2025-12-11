
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// サービスロールキーを使用して、RLSをバイパスして検索できるようにする
// （ただし、セキュリティのためにwalletAddressの一致確認は必須）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mediaProofId = searchParams.get('mediaProofId');
    const walletAddress = searchParams.get('walletAddress');

    if (!mediaProofId || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // 購入履歴を確認
    const { data: purchase, error } = await supabase
      .from('purchases')
      .select('download_token, download_expires_at')
      .eq('media_proof_id', mediaProofId)
      .eq('buyer_wallet', walletAddress)
      // 最新の購入履歴を優先
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !purchase) {
      // 購入履歴なし
      return NextResponse.json({ purchased: false });
    }

    // 有効期限チェック（オプション：期限切れなら再購入が必要とするか、あるいは無期限にするか）
    // ここでは「一度買えば何度でもダウンロード可能」とするため、
    // もし期限切れでも新しいトークンを発行するロジックを入れても良いが、
    // シンプルに「購入履歴あり」として返す。
    // 必要であればここでトークンの再発行処理を行うことも可能。

    return NextResponse.json({
      purchased: true,
      downloadToken: purchase.download_token
    });

  } catch (error) {
    console.error('Check purchase status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
