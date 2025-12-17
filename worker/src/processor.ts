// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Mint Processor (Core Logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { MintJobData, MintJobResult } from '../../shared/types';
import { predictNextAssetId, getUmi } from './lib/solana';
import { uploadToArweave } from './lib/arweave';
import { mintCNFT } from './lib/cnft';
import { saveToDatabase } from './lib/database';
import { searchArweaveTransactionsByHash, checkSolanaAssetExists } from './lib/verification';

/**
 * Mint処理のメインロジック
 *
 * 処理フロー：
 * 1. 次のcNFTアドレス予測
 * 2. Arweaveアップロード
 * 3. cNFT mint
 * 4. 予測が正しかったか確認
 * 5. データベース保存
 */
export async function processMint(
  data: MintJobData,
  onProgress: (progress: number) => void
): Promise<MintJobResult> {
  try {
    // === 0. 重複チェック（オンチェーン検証） ===
    onProgress(5);
    console.log('🔍 Step 0: Checking for duplicate proof (On-Chain)...');

    // サーバーウォレットアドレスを取得
    const umi = getUmi();
    const serverWalletAddress = umi.identity.publicKey.toString();
    console.log(`   Current Server Wallet: ${serverWalletAddress}`);

    // Arweave検索
    const arweaveTransactions = await searchArweaveTransactionsByHash(data.originalHash);
    
    // 自身のウォレットで発行された、かつSolana上に存在する証明を探す
    let duplicateFound = false;
    for (const tx of arweaveTransactions) {
      if (tx.ownerAddress === serverWalletAddress) {
        console.log(`   Checking Solana asset existence for: ${tx.targetAssetId}...`);
        const exists = await checkSolanaAssetExists(tx.targetAssetId);
        if (exists) {
          console.error(`❌ Active duplicate proof found! (Asset: ${tx.targetAssetId})`);
          duplicateFound = true;
          break;
        } else {
          console.warn(`   ⚠️ Found Arweave TX but Solana asset missing (Burned or Invalid): ${tx.targetAssetId}`);
        }
      } else {
        console.log(`   ℹ️ Found proof from another issuer (Ignored): ${tx.ownerAddress}`);
      }
    }

    if (duplicateFound) {
      console.error('❌ Duplicate proof detected! Aborting mint process.');
      return {
        success: false,
        error: 'このファイルは既に証明が発行されています（同一発行元）。',
      };
    }

    console.log('✅ No active duplicate found from this issuer - proceeding with mint');

    // === 1. 次のcNFTアドレスを予測（mint直前に再取得） ===
    onProgress(15);
    console.log('🔮 Step 1: Predicting next cNFT Asset ID (just before mint)...');

    // ⚠️ 重要: この予測とmintの間に他の処理が入らないようにする
    const { predictedAssetId, nextLeafIndex } = await predictNextAssetId();
    console.log(`   Predicted Asset ID: ${predictedAssetId}`);
    console.log(`   Leaf Index: ${nextLeafIndex}`);

    // === 2. Arweaveにアップロード ===
    onProgress(35);
    console.log('📤 Step 2: Uploading to Arweave...');

    const arweaveUri = await uploadToArweave({
      originalHash: data.originalHash,
      rootSigner: data.rootSigner,
      claimGenerator: data.claimGenerator,
      sourceType: data.sourceType,
      predictedAssetId,
      thumbnailPublicUrl: data.thumbnailPublicUrl,
    });
    console.log(`   Arweave URI: ${arweaveUri}`);

    // === 3. cNFTをMint ===
    onProgress(65);
    console.log('🎨 Step 3: Minting cNFT...');

    const { signature, actualAssetId } = await mintCNFT({
      leafOwner: data.userWallet,
      metadataUri: arweaveUri,
      originalHash: data.originalHash,
    });
    console.log(`   Signature: ${signature}`);
    console.log(`   Asset ID: ${actualAssetId}`);

    // === 4. 予測が正しかったか確認 ===
    if (actualAssetId !== predictedAssetId) {
      console.warn(`⚠️  Asset ID mismatch! Predicted: ${predictedAssetId}, Actual: ${actualAssetId}`);
      console.warn('   This is not critical. Using actual Asset ID.');
    } else {
      console.log('✅ Asset ID prediction was correct!');
    }

    // === 5. データベースに保存 ===
    onProgress(85);
    console.log('💾 Step 5: Saving to database...');

    // ファイル拡張子を抽出（例: "media/abc123.../original.jpg" → "jpg"）
    const fileExtension = data.mediaFilePath.split('.').pop() || 'bin';

    const savedProof = await saveToDatabase({
      arweaveTxId: arweaveUri.replace('https://gateway.irys.xyz/', ''),
      cnftMintAddress: actualAssetId,
      ownerWallet: data.userWallet,
      originalHash: data.originalHash,
      fileExtension: fileExtension,
      priceLamports: data.price,
      title: data.title,
      description: data.description,
    });

    onProgress(100);
    console.log('✅ All steps completed successfully!');

    return {
      success: true,
      arweaveTxId: arweaveUri.replace('https://gateway.irys.xyz/', ''),
      cnftMintAddress: actualAssetId,
    };
  } catch (error) {
    console.error('❌ Mint processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
