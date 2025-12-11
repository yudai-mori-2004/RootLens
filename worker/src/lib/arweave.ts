// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Arweave Upload (via Irys)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { getUmi } from './solana';
import type { ArweaveProofMetadata } from '../../../shared/types';

/**
 * 証明データをArweaveにアップロード（最小限設計）
 *
 * @param data - 証明データ
 * @returns Arweave URI (https://gateway.irys.xyz/...)
 */
export async function uploadToArweave(data: {
  originalHash: string;
  rootSigner: string;
  rootCertChain: string;
  predictedAssetId: string;
  thumbnailPublicUrl?: string;
}): Promise<string> {
  const umi = getUmi();

  // Irys Uploaderを使用
  umi.use(
    irysUploader({
      address: process.env.IRYS_ADDRESS || 'https://devnet.irys.xyz',
    })
  );

  // Arweaveメタデータを構築（最小限の4フィールド + 画像URL）
  const proofMetadata: ArweaveProofMetadata = {
    name: `RootLens Proof #${data.originalHash.slice(0, 8)}`,
    symbol: 'RLENS',
    description: 'Media authenticity proof verified by RootLens',
    target_asset_id: data.predictedAssetId,
    attributes: [
      { trait_type: 'original_hash', value: data.originalHash },
      { trait_type: 'root_signer', value: data.rootSigner },
      { trait_type: 'root_cert_chain', value: data.rootCertChain },
      { trait_type: 'created_at', value: new Date().toISOString() },
    ],
  };

  // サムネイル公開URLがある場合、imageフィールドに追加
  if (data.thumbnailPublicUrl) {
    proofMetadata.image = data.thumbnailPublicUrl;
  }

  console.log('   Uploading metadata:', JSON.stringify(proofMetadata, null, 2));

  // Arweaveにアップロード（RootLensサーバーのウォレットで署名される）
  const metadataUri = await umi.uploader.uploadJson(proofMetadata);

  return metadataUri;
}
