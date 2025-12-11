import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Supabaseクライアント（サービスロールキーを使用）
// ※ Heliusで所有者確認後、Supabaseのレコードと突き合わせるため
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const HELIUS_RPC_URL = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`; // Devnet

/**
 * GET /api/creator-content
 * ユーザーが所有するcNFTに紐づくコンテンツのリストを取得するAPI
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

    // 1. Heliusでウォレットが所有する全てのcNFTを取得
    const heliusResponse = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'creator-content',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: walletAddress,
        page: 1, // ページネーションを考慮（ここでは最初のページのみ）
        limit: 1000, // 最大1000個まで取得
      },
    });

    const ownedAssets = heliusResponse.data.result.items;

    if (!ownedAssets || ownedAssets.length === 0) {
      return NextResponse.json([]); // 所有するcNFTがない
    }

    // 所有するcNFTのミントアドレスリストを作成
    const ownedCnftMintAddresses = ownedAssets.map((asset: any) => asset.id);

    // 2. Supabaseで、Heliusから取得したcNFTのミントアドレスに紐づくコンテンツを検索
    // Heliusが所有権を保証しているため、Supabase上のowner_walletによるフィルタリングは行わない（古い可能性があるため）
    const { data: creatorContents, error: supabaseError } = await supabase
      .from('media_proofs')
      .select('id, original_hash, cnft_mint_address, title, owner_wallet, is_public')
      .in('cnft_mint_address', ownedCnftMintAddresses);

    if (supabaseError) {
      console.error('Supabase query error:', supabaseError);
      throw new Error('コンテンツ情報の取得に失敗しました。');
    }

    if (!creatorContents || creatorContents.length === 0) {
      return NextResponse.json([]);
    }

    // 各コンテンツのManifest JSONをR2から取得してサムネイルURLを抽出
    const publicBucketUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL;

    const finalContents = await Promise.all(creatorContents.map(async (content: any) => {
      // Supabaseの所有者情報が古い場合、現在の所有者（閲覧者）に更新する
      // Heliusで所有していることは確認済みなので、ここで同期を行う
      if (content.owner_wallet !== walletAddress) {
        console.log(`Updating owner for proof ${content.id}: ${content.owner_wallet} -> ${walletAddress}`);
        const { error: updateError } = await supabase
          .from('media_proofs')
          .update({ owner_wallet: walletAddress })
          .eq('id', content.id);
        
        if (updateError) {
          console.error('Failed to update owner_wallet:', updateError);
        }
      }

      let thumbnailUrl: string | undefined;

      try {
        if (publicBucketUrl) {
          const manifestUrl = `${publicBucketUrl}/media/${content.original_hash}/manifest.json`;
          const manifestResponse = await fetch(manifestUrl);
          if (manifestResponse.ok) {
            const manifestData = await manifestResponse.json();
            thumbnailUrl = manifestData.thumbnailUrl;
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch manifest for ${content.original_hash}:`, e);
      }

      return {
        mediaProofId: content.id,
        originalHash: content.original_hash,
        cnftMintAddress: content.cnft_mint_address,
        title: content.title || '無題のコンテンツ',
        thumbnailUrl: thumbnailUrl,
        isPublic: content.is_public, // is_public カラムを追加
      };
    }));

    return NextResponse.json(finalContents);

  } catch (error) {
    console.error('Creator content API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
