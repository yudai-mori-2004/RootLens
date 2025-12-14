import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 管理者権限でSupabaseクライアントを作成
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { originalHash } = await req.json();

    if (!originalHash) {
      return NextResponse.json({ error: 'Missing originalHash' }, { status: 400 });
    }

    // 1. DBからAsset ID (cNFT Mint Address) を取得
    const { data: proofData, error: dbError } = await supabaseAdmin
      .from('media_proofs')
      .select('cnft_mint_address')
      .eq('original_hash', originalHash)
      .single();

    if (dbError || !proofData?.cnft_mint_address) {
      return NextResponse.json({ error: 'Proof not found' }, { status: 404 });
    }

    // 2. Solana RPCを叩いて真の所有者を確認 (DAS API getAsset)
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'server-sync-owner',
        method: 'getAsset',
        params: {
          id: proofData.cnft_mint_address
        }
      })
    });

    const { result } = await response.json();
    
    if (!result || !result.ownership || !result.ownership.owner) {
      return NextResponse.json({ error: 'Failed to fetch asset info from chain' }, { status: 502 });
    }

    const chainOwner = result.ownership.owner;

    // 3. チェーン上の正しい所有者でDBを更新
    const { error: updateError } = await supabaseAdmin
      .from('media_proofs')
      .update({ owner_wallet: chainOwner })
      .eq('original_hash', originalHash);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, syncedOwner: chainOwner });

  } catch (error) {
    console.error('Owner sync error:', error);
    return NextResponse.json({ error: 'Failed to sync owner' }, { status: 500 });
  }
}
