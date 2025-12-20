// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Mint Processor (Core Logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { MintJobData, MintJobResult } from '../../shared/types';
import { predictNextAssetId, getUmi } from './lib/solana';
import { uploadToArweave } from './lib/arweave';
import { mintCNFT } from './lib/cnft';
import { saveToDatabase } from './lib/database';
import { searchArweaveTransactionsByHash, checkSolanaAssetExists } from './lib/verification';
import { downloadFromR2 } from './lib/r2';
import { verifyC2PAOnServer, validateC2PAResult } from './lib/c2pa-verification';

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

    // === 1. R2からファイルをダウンロード ===
    onProgress(10);
    console.log('📥 Step 1: Downloading file from R2 for verification...');

    const fileBuffer = await downloadFromR2(data.mediaFilePath);
    console.log(`✅ File downloaded: ${fileBuffer.length} bytes`);

    // === 2. サーバー側でC2PA検証 ===
    onProgress(15);
    console.log('🔐 Step 2: Server-side C2PA verification...');
    console.log('   ⚠️  Ignoring client-provided values - re-verifying from scratch');

    const c2paSummary = await verifyC2PAOnServer(fileBuffer);

    // 検証結果の妥当性チェック
    const validation = validateC2PAResult(c2paSummary);
    if (!validation.valid) {
      console.error(`❌ C2PA validation failed: ${validation.reason}`);
      return {
        success: false,
        error: validation.reason,
      };
    }

    // 検証済みデータを使用（フロントエンドからの値は破棄）
    const verifiedRootSigner = c2paSummary.originalIssuer || 'Unknown';
    const verifiedClaimGenerator = c2paSummary.originalClaimGenerator || 'Unknown';
    const verifiedSourceType = c2paSummary.sourceType || 'unknown';
    const verifiedDataHash = c2paSummary.activeManifest?.dataHash;

    console.log('✅ Server-side C2PA verification passed');
    console.log(`   Verified Root Signer: ${verifiedRootSigner}`);
    console.log(`   Verified Claim Generator: ${verifiedClaimGenerator}`);
    console.log(`   Verified Source Type: ${verifiedSourceType}`);
    console.log(`   Verified Data Hash: ${verifiedDataHash}`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🛑 テスト用: ここで処理を停止（検証結果のみ確認）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('');
    console.log('═'.repeat(60));
    console.log('🔍 C2PA VERIFICATION RESULT');
    console.log('═'.repeat(60));
    console.log(`Client provided Root Signer:      ${data.rootSigner}`);
    console.log(`Server verified Root Signer:      ${verifiedRootSigner}`);
    console.log(`Match: ${data.rootSigner === verifiedRootSigner ? '✅' : '❌'}`);
    console.log('');
    console.log(`Client provided Claim Generator:  ${data.claimGenerator}`);
    console.log(`Server verified Claim Generator:  ${verifiedClaimGenerator}`);
    console.log(`Match: ${data.claimGenerator === verifiedClaimGenerator ? '✅' : '❌'}`);
    console.log('');
    console.log(`Client provided Source Type:      ${data.sourceType}`);
    console.log(`Server verified Source Type:      ${verifiedSourceType}`);
    console.log(`Match: ${data.sourceType === verifiedSourceType ? '✅' : '❌'}`);
    console.log('═'.repeat(60));
    console.log('');
    console.log('🛑 Stopping here for testing - NOT proceeding to mint');

    return {
      success: false,
      error: '【テスト中】C2PA検証は成功しましたが、Mintは実行していません。上記のログを確認してください。',
    };

    // === 3. 次のcNFTアドレスを予測（mint直前に再取得） ===
    onProgress(25);
    console.log('🔮 Step 1: Predicting next cNFT Asset ID (just before mint)...');

    // ⚠️ 重要: この予測とmintの間に他の処理が入らないようにする
    const { predictedAssetId, nextLeafIndex } = await predictNextAssetId();
    console.log(`   Predicted Asset ID: ${predictedAssetId}`);
    console.log(`   Leaf Index: ${nextLeafIndex}`);

    // === 4. Arweaveにアップロード（検証済みデータを使用） ===
    onProgress(45);
    console.log('📤 Step 4: Uploading to Arweave with verified data...');

    const arweaveUri = await uploadToArweave({
      originalHash: data.originalHash,
      rootSigner: verifiedRootSigner,          // ← サーバー検証済み
      claimGenerator: verifiedClaimGenerator,  // ← サーバー検証済み
      sourceType: verifiedSourceType,          // ← サーバー検証済み
      predictedAssetId,
      thumbnailPublicUrl: data.thumbnailPublicUrl,
    });
    console.log(`   Arweave URI: ${arweaveUri}`);

    // === 5. cNFTをMint ===
    onProgress(65);
    console.log('🎨 Step 5: Minting cNFT...');

    const { signature, actualAssetId } = await mintCNFT({
      leafOwner: data.userWallet,
      metadataUri: arweaveUri,
      originalHash: data.originalHash,
    });
    console.log(`   Signature: ${signature}`);
    console.log(`   Asset ID: ${actualAssetId}`);

    // === 6. 予測が正しかったか確認 ===
    if (actualAssetId !== predictedAssetId) {
      console.warn(`⚠️  Asset ID mismatch! Predicted: ${predictedAssetId}, Actual: ${actualAssetId}`);
      console.warn('   This is not critical. Using actual Asset ID.');
    } else {
      console.log('✅ Asset ID prediction was correct!');
    }

    // === 7. データベースに保存 ===
    onProgress(85);
    console.log('💾 Step 7: Saving to database...');

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
