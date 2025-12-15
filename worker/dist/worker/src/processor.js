"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Mint Processor (Core Logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMint = processMint;
const solana_1 = require("./lib/solana");
const arweave_1 = require("./lib/arweave");
const cnft_1 = require("./lib/cnft");
const database_1 = require("./lib/database");
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
async function processMint(data, onProgress) {
    try {
        // === 1. 次のcNFTアドレスを予測（mint直前に再取得） ===
        onProgress(15);
        console.log('🔮 Step 1: Predicting next cNFT Asset ID (just before mint)...');
        // ⚠️ 重要: この予測とmintの間に他の処理が入らないようにする
        const { predictedAssetId, nextLeafIndex } = await (0, solana_1.predictNextAssetId)();
        console.log(`   Predicted Asset ID: ${predictedAssetId}`);
        console.log(`   Leaf Index: ${nextLeafIndex}`);
        // === 2. Arweaveにアップロード ===
        onProgress(35);
        console.log('📤 Step 2: Uploading to Arweave...');
        const arweaveUri = await (0, arweave_1.uploadToArweave)({
            originalHash: data.originalHash,
            rootSigner: data.rootSigner,
            rootCertChain: data.rootCertChain,
            predictedAssetId,
            thumbnailPublicUrl: data.thumbnailPublicUrl,
        });
        console.log(`   Arweave URI: ${arweaveUri}`);
        // === 3. cNFTをMint ===
        onProgress(65);
        console.log('🎨 Step 3: Minting cNFT...');
        const { signature, actualAssetId } = await (0, cnft_1.mintCNFT)({
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
        }
        else {
            console.log('✅ Asset ID prediction was correct!');
        }
        // === 5. データベースに保存 ===
        onProgress(85);
        console.log('💾 Step 5: Saving to database...');
        // ファイル拡張子を抽出（例: "media/abc123.../original.jpg" → "jpg"）
        const fileExtension = data.mediaFilePath.split('.').pop() || 'bin';
        const savedProof = await (0, database_1.saveToDatabase)({
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
    }
    catch (error) {
        console.error('❌ Mint processing error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
