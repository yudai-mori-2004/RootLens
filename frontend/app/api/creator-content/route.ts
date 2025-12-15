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

    // 1. Heliusでウォレットが所有する全てのcNFTを取得
    const heliusResponse = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'creator-content',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000,
      },
    });

    interface HeliusAsset {
      id: string;
      content?: {
        json_uri?: string;
      };
      ownership?: {
        owner: string;
      };
      compression?: {
        compressed: boolean;
        tree: string;
        leaf_id: number;
        seq: number;
        asset_hash: string;
        creator_hash: string;
        leaf_delegate: string;
        merkle_tree: string;
      };
    }

    const ownedAssets: HeliusAsset[] = heliusResponse.data.result.items;

    if (!ownedAssets || ownedAssets.length === 0) {
      return NextResponse.json([]);
    }

    const ownedCnftMintAddresses = ownedAssets.map((asset: HeliusAsset) => asset.id);

    // 2. Supabaseで、Heliusから取得したcNFTのミントアドレスに紐づくコンテンツを検索
    // Heliusが所有権を保証しているため、Supabase上のowner_walletによるフィルタリングは行わない（古い可能性があるため）

    // まず総数を取得
    const { count: totalCount, error: countError } = await supabase
      .from('media_proofs')
      .select('id', { count: 'exact', head: true })
      .in('cnft_mint_address', ownedCnftMintAddresses);

    if (countError) {
      console.error('Supabase count error:', countError);
      throw new Error('コンテンツ数の取得に失敗しました。');
    }

    if (!totalCount || totalCount === 0) {
      return NextResponse.json({ items: [], total: 0, page, limit });
    }

    // ページネーションを適用してデータを取得
    const offset = (page - 1) * limit;
    const { data: creatorContents, error: supabaseError } = await supabase
      .from('media_proofs')
      .select('id, original_hash, cnft_mint_address, title, description, price_lamports, owner_wallet, is_public')
      .in('cnft_mint_address', ownedCnftMintAddresses)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (supabaseError) {
      console.error('Supabase query error:', supabaseError);
      throw new Error('コンテンツ情報の取得に失敗しました。');
    }

    if (!creatorContents || creatorContents.length === 0) {
      return NextResponse.json({ items: [], total: totalCount, page, limit });
    }

    // owner_walletの更新が必要なコンテンツを抽出してバッチ更新
    const outdatedOwners = creatorContents.filter((content: any) => content.owner_wallet !== walletAddress);
    if (outdatedOwners.length > 0) {
      console.log(`Batch updating ${outdatedOwners.length} owner_wallet records`);
      const { error: batchUpdateError } = await supabase
        .from('media_proofs')
        .update({ owner_wallet: walletAddress })
        .in('id', outdatedOwners.map((c: any) => c.id));

      if (batchUpdateError) {
        console.error('Failed to batch update owner_wallet:', batchUpdateError);
      }
    }

    // サムネイルURLはoriginal_hashから構築（R2パスは固定: media/{hash}/thumbnail.jpg）
    const publicBucketUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL;

    const finalContents = await Promise.all(creatorContents.map(async (content: SupabaseCreatorContent) => {
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
            const manifestData: { thumbnailUrl?: string } = await manifestResponse.json();
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
        description: content.description,
        priceLamports: content.price_lamports,
        thumbnailUrl: thumbnailUrl,
        isPublic: content.is_public, // is_public カラムを追加
      };
    }));

    return NextResponse.json({
      items: finalContents,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    });

  } catch (error) {
    console.error('Creator content API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
