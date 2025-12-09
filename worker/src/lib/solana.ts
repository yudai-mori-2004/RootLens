// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Solana / cNFT Address Prediction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, createSignerFromKeypair, generateSigner } from '@metaplex-foundation/umi';
import {
  fetchTreeConfigFromSeeds,
  findLeafAssetIdPda,
} from '@metaplex-foundation/mpl-bubblegum';
import { publicKey as toPublicKey } from '@metaplex-foundation/umi';

let umiInstance: ReturnType<typeof createUmi> | null = null;

/**
 * Umiインスタンスを取得（シングルトン）
 */
export function getUmi() {
  if (!umiInstance) {
    // 秘密鍵をパース
    const privateKeyStr = process.env.SOLANA_PRIVATE_KEY!;
    let privateKeyArray: number[];

    try {
      // JSON配列形式 or Base58形式に対応
      privateKeyArray = JSON.parse(privateKeyStr);
    } catch {
      // Base58デコード（@solana/web3.jsを使わない軽量実装）
      throw new Error(
        'Base58 decoding not implemented. Please use JSON array format for SOLANA_PRIVATE_KEY'
      );
    }

    const privateKeyUint8 = new Uint8Array(privateKeyArray);

    // Umi初期化 (commitment level: confirmed)
    // ⚠️ 重要: TreeConfigの取得で最新値を確実に取得するため、confirmed指定
    const umi = createUmi(process.env.SOLANA_RPC_URL!, 'confirmed');

    // Keypairを作成
    const keypair = umi.eddsa.createKeypairFromSecretKey(privateKeyUint8);
    const signer = createSignerFromKeypair(umi, keypair);

    // Identityとして設定
    umi.use(keypairIdentity(signer));

    umiInstance = umi;
  }

  return umiInstance;
}

/**
 * 次のcNFT Asset IDを予測
 *
 * 手順：
 * 1. TreeConfigからnum_mintedを取得
 * 2. 次のleaf indexはnum_minted（0-indexed）
 * 3. PDA計算でAsset IDを事前生成
 */
export async function predictNextAssetId(): Promise<{
  predictedAssetId: string;
  nextLeafIndex: number;
}> {
  const umi = getUmi();
  const merkleTree = toPublicKey(process.env.MERKLE_TREE_ADDRESS!);

  // 1. TreeConfigからnum_mintedを取得
  const treeConfig = await fetchTreeConfigFromSeeds(umi, { merkleTree });
  const nextLeafIndex = Number(treeConfig.numMinted);

  console.log(`   TreeConfig.numMinted: ${treeConfig.numMinted}`);
  console.log(`   Next leaf index: ${nextLeafIndex}`);

  // 2. Asset IDを事前計算
  const [predictedAssetIdPda] = await findLeafAssetIdPda(umi, {
    merkleTree,
    leafIndex: BigInt(nextLeafIndex), // BigIntに変換
  });

  return {
    predictedAssetId: predictedAssetIdPda.toString(),
    nextLeafIndex,
  };
}
