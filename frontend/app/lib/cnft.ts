/**
 * cNFT (Compressed NFT) 関連のユーティリティ関数
 * Metaplex BubbleGum を使用
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree, mintV1, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createGenericFile, generateSigner, percentAmount, publicKey } from '@metaplex-foundation/umi';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';

/**
 * cNFT メタデータ構造
 */
export interface CNFTMetadata {
  original_hash: string;   // SHA-256 hex
  c2pa_hash: string;       // SHA-256 hex
  root_signer: string;     // CA名
  license_type: string;    // ライセンス種別
  created_at: string;      // ISO 8601
}

/**
 * cNFT mint パラメータ
 */
export interface MintCNFTParams {
  metadata: CNFTMetadata;
  treeAddress: string;
  ownerPublicKey: string;
  thumbnailUrl?: string;
}

/**
 * UMIインスタンスを作成
 */
export function createUmiInstance(rpcUrl: string) {
  const umi = createUmi(rpcUrl)
    .use(mplBubblegum())
    .use(dasApi());

  return umi;
}

/**
 * cNFT メタデータをJSON形式に変換
 */
export function buildCNFTMetadataJson(
  metadata: CNFTMetadata,
  contentId: string,
  thumbnailUrl?: string
) {
  return {
    name: `RootScan Proof #${contentId.substring(0, 8)}`,
    symbol: 'RSCAN',
    description: 'Media authenticity proof by RootScan',
    image: thumbnailUrl || `https://rootscan.io/api/thumbnail/${contentId}`,
    attributes: [
      {
        trait_type: 'original_hash',
        value: metadata.original_hash,
      },
      {
        trait_type: 'c2pa_hash',
        value: metadata.c2pa_hash,
      },
      {
        trait_type: 'root_signer',
        value: metadata.root_signer,
      },
      {
        trait_type: 'license_type',
        value: metadata.license_type,
      },
      {
        trait_type: 'created_at',
        value: metadata.created_at,
      },
    ],
    properties: {
      category: 'image',
      files: [
        {
          uri: `https://rootscan.io/api/media/${contentId}`,
          type: 'image/jpeg',
        },
      ],
    },
  };
}

/**
 * cNFTをmintする（クライアントサイド用）
 *
 * 注意: この関数は参考実装です。
 * 実際のmintはクライアントサイドで @metaplex-foundation/umi を使用して行います。
 */
export async function mintCNFT(params: MintCNFTParams) {
  const { metadata, treeAddress, ownerPublicKey, thumbnailUrl } = params;

  // UMIインスタンスを作成
  const umi = createUmiInstance(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!);

  // Content IDを生成（original_hashの最初の8文字）
  const contentId = metadata.original_hash.substring(0, 16);

  // メタデータJSONを構築
  const metadataJson = buildCNFTMetadataJson(metadata, contentId, thumbnailUrl);

  // ここでは概念的な実装のみ
  // 実際のmintはクライアントサイドで行う必要があります

  return {
    success: true,
    contentId,
    metadataJson,
  };
}

/**
 * Helius DAS APIを使用してcNFTデータを読み取る
 */
export async function getCNFTByHash(originalHash: string): Promise<any | null> {
  const heliusUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;

  if (!heliusUrl) {
    throw new Error('HELIUS_RPC_URL is not configured');
  }

  try {
    // Helius DAS API を使用して検索
    // 注意: original_hash から mintAddress を特定する方法が必要
    // これはDBにキャッシュされたデータを使用するか、
    // 別の検索方法を実装する必要があります

    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rootscan-query',
        method: 'searchAssets',
        params: {
          // 検索条件を指定
          // ※ original_hash から検索する方法は要検討
        },
      }),
    });

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('Failed to fetch cNFT data:', error);
    return null;
  }
}

/**
 * mintアドレスからcNFTデータを取得
 */
export async function getCNFTByMintAddress(mintAddress: string): Promise<any | null> {
  const heliusUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;

  if (!heliusUrl) {
    throw new Error('HELIUS_RPC_URL is not configured');
  }

  try {
    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rootscan-query',
        method: 'getAsset',
        params: {
          id: mintAddress,
        },
      }),
    });

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('Failed to fetch cNFT data:', error);
    return null;
  }
}

/**
 * cNFTデータから属性を抽出
 */
export function extractCNFTMetadata(cnftData: any): CNFTMetadata | null {
  try {
    const attributes = cnftData.content?.metadata?.attributes || [];

    const metadata: Partial<CNFTMetadata> = {};

    attributes.forEach((attr: any) => {
      if (attr.trait_type === 'original_hash') {
        metadata.original_hash = attr.value;
      } else if (attr.trait_type === 'c2pa_hash') {
        metadata.c2pa_hash = attr.value;
      } else if (attr.trait_type === 'root_signer') {
        metadata.root_signer = attr.value;
      } else if (attr.trait_type === 'license_type') {
        metadata.license_type = attr.value;
      } else if (attr.trait_type === 'created_at') {
        metadata.created_at = attr.value;
      }
    });

    // 必須フィールドがすべて揃っているか確認
    if (
      metadata.original_hash &&
      metadata.c2pa_hash &&
      metadata.root_signer &&
      metadata.license_type &&
      metadata.created_at
    ) {
      return metadata as CNFTMetadata;
    }

    return null;
  } catch (error) {
    console.error('Failed to extract cNFT metadata:', error);
    return null;
  }
}
