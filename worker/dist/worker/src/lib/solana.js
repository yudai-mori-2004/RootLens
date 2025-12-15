"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Solana / cNFT Address Prediction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUmi = getUmi;
exports.predictNextAssetId = predictNextAssetId;
const umi_bundle_defaults_1 = require("@metaplex-foundation/umi-bundle-defaults");
const umi_1 = require("@metaplex-foundation/umi");
const mpl_bubblegum_1 = require("@metaplex-foundation/mpl-bubblegum");
const umi_2 = require("@metaplex-foundation/umi");
let umiInstance = null;
/**
 * Umiインスタンスを取得（シングルトン）
 */
function getUmi() {
    if (!umiInstance) {
        // 秘密鍵をパース
        const privateKeyStr = process.env.SOLANA_PRIVATE_KEY;
        let privateKeyArray;
        try {
            // JSON配列形式 or Base58形式に対応
            privateKeyArray = JSON.parse(privateKeyStr);
        }
        catch {
            // Base58デコード（@solana/web3.jsを使わない軽量実装）
            throw new Error('Base58 decoding not implemented. Please use JSON array format for SOLANA_PRIVATE_KEY');
        }
        const privateKeyUint8 = new Uint8Array(privateKeyArray);
        // Umi初期化 (commitment level: confirmed)
        // ⚠️ 重要: TreeConfigの取得で最新値を確実に取得するため、confirmed指定
        const umi = (0, umi_bundle_defaults_1.createUmi)(process.env.SOLANA_RPC_URL, 'confirmed');
        // Keypairを作成
        const keypair = umi.eddsa.createKeypairFromSecretKey(privateKeyUint8);
        const signer = (0, umi_1.createSignerFromKeypair)(umi, keypair);
        // Identityとして設定
        umi.use((0, umi_1.keypairIdentity)(signer));
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
async function predictNextAssetId() {
    const umi = getUmi();
    const merkleTree = (0, umi_2.publicKey)(process.env.MERKLE_TREE_ADDRESS);
    // 1. TreeConfigからnum_mintedを取得
    const treeConfig = await (0, mpl_bubblegum_1.fetchTreeConfigFromSeeds)(umi, { merkleTree });
    const nextLeafIndex = Number(treeConfig.numMinted);
    console.log(`   TreeConfig.numMinted: ${treeConfig.numMinted}`);
    console.log(`   Next leaf index: ${nextLeafIndex}`);
    // 2. Asset IDを事前計算
    const [predictedAssetIdPda] = await (0, mpl_bubblegum_1.findLeafAssetIdPda)(umi, {
        merkleTree,
        leafIndex: BigInt(nextLeafIndex), // BigIntに変換
    });
    return {
        predictedAssetId: predictedAssetIdPda.toString(),
        nextLeafIndex,
    };
}
