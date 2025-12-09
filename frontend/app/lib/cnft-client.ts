/**
 * クライアントサイドでcNFTをmintするためのヘルパー関数
 * Privy wallet と UMI を連携させる
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mintV1, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  createNoopSigner,
  signerIdentity,
  Signer,
  PublicKey as UmiPublicKey,
} from '@metaplex-foundation/umi';
import { CNFTMetadata } from './cnft';

/**
 * Privy wallet を UMI Signer に変換
 */
export function createUmiSignerFromPrivy(
  walletAddress: string,
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>
): Signer {
  const pubkey = publicKey(walletAddress);

  const signer: Signer = {
    publicKey: pubkey,
    secretKey: new Uint8Array(), // Privyは秘密鍵を直接持たない
    signMessage: async (message: Uint8Array) => {
      throw new Error('Message signing not implemented');
    },
    signTransaction: async (transaction: any) => {
      // トランザクションをシリアライズして署名
      const serialized = transaction.serialize();
      const signed = await signTransaction(serialized);
      return signed;
    },
    signAllTransactions: async (transactions: any[]) => {
      const results = [];
      for (const tx of transactions) {
        const serialized = tx.serialize();
        const signed = await signTransaction(serialized);
        results.push(signed);
      }
      return results;
    },
  };

  return signer;
}

/**
 * cNFTをmintする（クライアントサイド）
 */
export async function mintCNFTFromBrowser(params: {
  metadata: CNFTMetadata;
  treeAddress: string;
  ownerAddress: string;
  title?: string;
  description?: string;
  rpcUrl: string;
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
}) {
  const {
    metadata,
    treeAddress,
    ownerAddress,
    title,
    description,
    rpcUrl,
    signTransaction,
  } = params;

  console.log('🌳 cNFT mint開始...');
  console.log('Tree:', treeAddress);
  console.log('Owner:', ownerAddress);

  // 1. UMIインスタンス作成
  const umi = createUmi(rpcUrl).use(mplBubblegum());

  // 2. Privyウォレットをsignerとして設定
  // 注意: Privyの場合、signTransactionを使う必要があるため、
  // 標準のkeypairIdentityは使えない
  // ここではダミーのsignerを作成し、後でトランザクションを手動で署名する

  const leafOwner = publicKey(ownerAddress);
  const merkleTree = publicKey(treeAddress);

  // 3. メタデータJSON構築
  const contentId = metadata.original_hash.substring(0, 16);
  const metadataUri = await uploadMetadataToArweave({
    name: title || `RootScan Proof #${contentId}`,
    symbol: 'RSCAN',
    description: description || 'Media authenticity proof by RootScan',
    image: `https://rootscan.io/api/thumbnail/${contentId}`,
    attributes: [
      { trait_type: 'original_hash', value: metadata.original_hash },
      { trait_type: 'c2pa_hash', value: metadata.c2pa_hash },
      { trait_type: 'root_signer', value: metadata.root_signer },
      { trait_type: 'license_type', value: metadata.license_type },
      { trait_type: 'created_at', value: metadata.created_at },
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
  });

  console.log('📝 メタデータURI:', metadataUri);

  // 4. cNFT mint
  const leafDelegate = leafOwner; // 通常は同じ

  try {
    const mintResult = await mintV1(umi, {
      leafOwner,
      leafDelegate,
      merkleTree,
      metadata: {
        name: title || `RootScan Proof #${contentId}`,
        symbol: 'RSCAN',
        uri: metadataUri,
        sellerFeeBasisPoints: 0, // ロイヤリティなし
        collection: null,
        creators: [
          {
            address: leafOwner,
            verified: false,
            share: 100,
          },
        ],
      },
    }).sendAndConfirm(umi);

    console.log('✅ cNFT mint成功！');
    console.log('Signature:', mintResult.signature);

    return {
      success: true,
      signature: mintResult.signature,
      contentId,
      metadataUri,
    };
  } catch (error) {
    console.error('❌ cNFT mint失敗:', error);
    throw error;
  }
}

/**
 * メタデータをArweaveにアップロード（簡易版）
 *
 * TODO: 本番では Arweave/IPFS/Shadow Drive などの分散ストレージを使用
 * 現在はダミーURLを返す
 */
async function uploadMetadataToArweave(metadata: any): Promise<string> {
  // TODO: 実際のアップロード処理を実装
  // - Arweave (bundlr)
  // - IPFS (nft.storage)
  // - Shadow Drive

  console.warn('⚠️  メタデータアップロードは未実装です（ダミーURIを使用）');

  // ダミーURI（開発用）
  const base64Metadata = btoa(JSON.stringify(metadata));
  return `data:application/json;base64,${base64Metadata}`;
}

/**
 * cNFTデータを取得（Helius DAS API使用）
 */
export async function getCNFTData(assetId: string, heliusUrl: string) {
  try {
    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rootscan',
        method: 'getAsset',
        params: { id: assetId },
      }),
    });

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('cNFTデータ取得エラー:', error);
    return null;
  }
}
