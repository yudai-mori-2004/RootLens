import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const HELIUS_RPC_URL = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`; // Devnet

/**
 * POST /api/creator-content/toggle-public
 * コンテンツのis_publicフラグを切り替えるAPI
 */
export async function POST(req: NextRequest) {
  try {
    const { mediaProofId, walletAddress, isPublic } = await req.json();

    if (!mediaProofId || !walletAddress || typeof isPublic !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // 1. Heliusでウォレットが本当にこのcNFTを所有しているか確認
    const heliusResponse = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'creator-content-toggle-public',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000, // 大きめの数で、該当cNFTが含まれているか確認
      },
    });

    const ownedAssets = heliusResponse.data.result.items;
    if (!ownedAssets || ownedAssets.length === 0) {
      return NextResponse.json({ error: 'Wallet does not own any cNFTs' }, { status: 403 });
    }

    // mediaProofIdからcnft_mint_addressを取得
    const { data: proofData, error: proofError } = await supabase
      .from('media_proofs')
      .select('cnft_mint_address')
      .eq('id', mediaProofId)
      .single();

    if (proofError || !proofData) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const cnftMintAddress = proofData.cnft_mint_address;

    // 所有しているcNFTの中に、このコンテンツのcNFTが含まれているか確認
    const ownsTargetCnft = ownedAssets.some((asset: any) => asset.id === cnftMintAddress);

    if (!ownsTargetCnft) {
      return NextResponse.json({ error: 'Wallet does not own this specific cNFT' }, { status: 403 });
    }

    // 2. 所有確認が取れたので、Supabaseのis_publicフラグを更新
    const { data, error: updateError } = await supabase
      .from('media_proofs')
      .update({ is_public: isPublic })
      .eq('id', mediaProofId)
      .eq('owner_wallet', walletAddress) // 二重チェック（Heliusでの所有とSupabase上の記録も一致しているか）
      .single();

    if (updateError) {
      console.error('Supabase update error:', updateError);
      throw new Error('公開設定の更新に失敗しました。');
    }

    return NextResponse.json({ success: true, isPublic: data?.is_public });

  } catch (error) {
    console.error('Toggle public API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}