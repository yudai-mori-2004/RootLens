// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Arweave Upload (via Irys)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { createGenericFileFromJson } from '@metaplex-foundation/umi';
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
  claimGenerator: string;
  sourceType: string;
  predictedAssetId: string;
  thumbnailPublicUrl?: string;
}): Promise<string> {
  const umi = getUmi();

  // Irys Uploaderを使用
  umi.use(
    irysUploader({
      address: process.env.ARWEAVE_GATEWAY || 'https://devnet.irys.xyz',
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
      { trait_type: 'claim_generator', value: data.claimGenerator },
      { trait_type: 'source_type', value: data.sourceType },
      { trait_type: 'created_at', value: new Date().toISOString() },
    ],
  };

  // サムネイル公開URLがある場合、imageフィールドに追加
  if (data.thumbnailPublicUrl) {
    proofMetadata.image = data.thumbnailPublicUrl;
  }

  console.log('   Uploading metadata:', JSON.stringify(proofMetadata, null, 2));

  // Arweaveにアップロード（RootLensサーバーのウォレットで署名される）
  // ⚠️ umi-uploader-irysの実装では、uploadメソッドのoptions.tagsは無視され、
  // file.tagsのみが使用されるため、ファイル作成時にタグを埋め込む必要がある。
  const file = createGenericFileFromJson(proofMetadata, 'metadata.json', {
    contentType: 'application/json',
    tags: [
      { name: 'original_hash', value: data.originalHash },
      { name: 'source_type', value: data.sourceType },
      { name: 'App-Name', value: 'RootLens' },
    ]
  });

  // uploadメソッド自体のoptionsにはtagsを渡しても無視される
  const [metadataUri] = await umi.uploader.upload([file]);

  console.log(`   ✓ Uploaded with tags: original_hash=${data.originalHash}, source_type=${data.sourceType}`);

  return metadataUri;
}
