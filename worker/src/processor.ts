// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Mint Processor (Core Logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { MintJobData, MintJobResult } from '../../shared/types';
import { predictNextAssetId } from './lib/solana';
import { uploadToArweave } from './lib/arweave';
import { mintCNFT } from './lib/cnft';
import { saveToDatabase } from './lib/database';

/**
 * Mint処理のメインロジック
 *
 * 処理フロー：
 * 1. 既存チェック（冪等性担保）
 * 2. 次のcNFTアドレス予測
 * 3. Arweaveアップロード
 * 4. cNFT mint
 * 5. データベース保存
 */
export async function processMint(
  data: MintJobData,
  onProgress: (progress: number) => void
): Promise<MintJobResult> {
  try {
    // === 1. 既存チェック（冪等性担保） ===
    onProgress(5);
    console.log('🔍 Step 1: Checking for existing proof...');

    // const existingProof = await checkExistingProof(data.originalHash);
    // if (existingProof) {
    //   console.log('ℹ️  Proof already exists, returning existing data');
    //   return {
    //     success: true,
    //     arweaveTxId: existingProof.arweaveTxId,
    //     cnftMintAddress: existingProof.cnftMintAddress,
    //   };
    // }

    // === 2. 次のcNFTアドレスを予測（mint直前に再取得） ===
    onProgress(15);
    console.log('🔮 Step 2: Predicting next cNFT Asset ID (just before mint)...');

    // ⚠️ 重要: この予測とmintの間に他の処理が入らないようにする
    const { predictedAssetId, nextLeafIndex } = await predictNextAssetId();
    console.log(`   Predicted Asset ID: ${predictedAssetId}`);
    console.log(`   Leaf Index: ${nextLeafIndex}`);

    // === 3. Arweaveにアップロード ===
    onProgress(35);
    console.log('📤 Step 3: Uploading to Arweave...');

    const arweaveUri = await uploadToArweave({
      originalHash: data.originalHash,
      rootSigner: data.rootSigner,
      rootCertChain: data.rootCertChain,
      predictedAssetId,
      thumbnailPublicUrl: data.thumbnailPublicUrl,
    });
    console.log(`   Arweave URI: ${arweaveUri}`);

    // === 4. cNFTをMint ===
    onProgress(65);
    console.log('🎨 Step 4: Minting cNFT...');

    const { signature, actualAssetId } = await mintCNFT({
      leafOwner: data.userWallet,
      metadataUri: arweaveUri,
      originalHash: data.originalHash,
    });
    console.log(`   Signature: ${signature}`);
    console.log(`   Asset ID: ${actualAssetId}`);

    // === 5. 予測が正しかったか確認 ===
    if (actualAssetId !== predictedAssetId) {
      console.warn(`⚠️  Asset ID mismatch! Predicted: ${predictedAssetId}, Actual: ${actualAssetId}`);
      console.warn('   This is not critical. Using actual Asset ID.');
    } else {
      console.log('✅ Asset ID prediction was correct!');
    }

    // === 6. データベースに保存 ===
    onProgress(85);
    console.log('💾 Step 6: Saving to database...');

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

    // === 7. CLIP特徴量抽出（Lens機能） ===
    // Skipped: Feature extraction is now handled by lens-worker during upload.
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

/**
 * 既存の証明データをチェック（冪等性担保）
 */
async function checkExistingProof(
  originalHash: string
): Promise<{ arweaveTxId: string; cnftMintAddress: string } | null> {
  try {
    const { createClient } = await import('@supabase/supabase-js');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('media_proofs')
      .select('arweave_tx_id, cnft_mint_address')
      .eq('original_hash', originalHash)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw error;
    }

    // If cNFT is not minted yet, treat as not existing (proceed to mint)
    if (!data.cnft_mint_address) {
      return null;
    }

    return {
      arweaveTxId: data.arweave_tx_id,
      cnftMintAddress: data.cnft_mint_address,
    };
  } catch (error) {
    console.error('Error checking existing proof:', error);
    return null;
  }
}


