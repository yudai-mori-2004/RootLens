// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - cNFT Mint Logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { mintV1 } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey as toPublicKey, none } from '@metaplex-foundation/umi';
import { getUmi } from './solana';
import { findLeafAssetIdPda } from '@metaplex-foundation/mpl-bubblegum';

/**
 * cNFTをMint
 *
 * @param data - Mintデータ
 * @returns signature, actualAssetId
 */
export async function mintCNFT(data: {
  leafOwner: string;
  metadataUri: string;
  originalHash: string;
}): Promise<{
  signature: string;
  actualAssetId: string;
}> {
  const umi = getUmi();
  const merkleTree = toPublicKey(process.env.MERKLE_TREE_ADDRESS!);
  const leafOwnerPubkey = toPublicKey(data.leafOwner);

  // cNFTをMint
  // ⚠️ 重要: confirmedで確定を待つ
  const result = await mintV1(umi, {
    leafOwner: leafOwnerPubkey,
    merkleTree,
    metadata: {
      name: `RootLens Proof #${data.originalHash.slice(0, 8)}`,
      symbol: 'RLENS',
      uri: data.metadataUri,
      sellerFeeBasisPoints: 0,
      collection: none(),
      creators: [],
    },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  // Signatureを取得
  const signature = Buffer.from(result.signature).toString('base64');

  // Mint後のTreeConfigを再取得してleaf indexを確認
  const { fetchTreeConfigFromSeeds } = await import(
    '@metaplex-foundation/mpl-bubblegum'
  );
  const treeConfigAfterMint = await fetchTreeConfigFromSeeds(umi, { merkleTree });
  const mintedLeafIndex = Number(treeConfigAfterMint.numMinted) - 1; // Mint後なので-1

  console.log(`   Minted leaf index: ${mintedLeafIndex}`);
  console.log(`   TreeConfig.numMinted after mint: ${treeConfigAfterMint.numMinted}`);

  // 実際のAsset IDを計算
  const [actualAssetIdPda] = await findLeafAssetIdPda(umi, {
    merkleTree,
    leafIndex: BigInt(mintedLeafIndex), // BigIntに変換
  });

  return {
    signature,
    actualAssetId: actualAssetIdPda.toString(),
  };
}
