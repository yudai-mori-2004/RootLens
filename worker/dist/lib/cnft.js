"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - cNFT Mint Logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mintCNFT = mintCNFT;
const mpl_bubblegum_1 = require("@metaplex-foundation/mpl-bubblegum");
const umi_1 = require("@metaplex-foundation/umi");
const solana_1 = require("./solana");
const mpl_bubblegum_2 = require("@metaplex-foundation/mpl-bubblegum");
/**
 * cNFTをMint
 *
 * @param data - Mintデータ
 * @returns signature, actualAssetId
 */
async function mintCNFT(data) {
    const umi = (0, solana_1.getUmi)();
    const merkleTree = (0, umi_1.publicKey)(process.env.MERKLE_TREE_ADDRESS);
    const leafOwnerPubkey = (0, umi_1.publicKey)(data.leafOwner);
    // cNFTをMint
    // ⚠️ 重要: confirmedで確定を待つ
    const result = await (0, mpl_bubblegum_1.mintV1)(umi, {
        leafOwner: leafOwnerPubkey,
        merkleTree,
        metadata: {
            name: `RootLens Proof #${data.originalHash.slice(0, 8)}`,
            symbol: 'RLENS',
            uri: data.metadataUri,
            sellerFeeBasisPoints: 0,
            collection: (0, umi_1.none)(),
            creators: [],
        },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    // Signatureを取得
    const signature = Buffer.from(result.signature).toString('base64');
    // Mint後のTreeConfigを再取得してleaf indexを確認
    const { fetchTreeConfigFromSeeds } = await Promise.resolve().then(() => __importStar(require('@metaplex-foundation/mpl-bubblegum')));
    const treeConfigAfterMint = await fetchTreeConfigFromSeeds(umi, { merkleTree });
    const mintedLeafIndex = Number(treeConfigAfterMint.numMinted) - 1; // Mint後なので-1
    console.log(`   Minted leaf index: ${mintedLeafIndex}`);
    console.log(`   TreeConfig.numMinted after mint: ${treeConfigAfterMint.numMinted}`);
    // 実際のAsset IDを計算
    const [actualAssetIdPda] = await (0, mpl_bubblegum_2.findLeafAssetIdPda)(umi, {
        merkleTree,
        leafIndex: BigInt(mintedLeafIndex), // BigIntに変換
    });
    return {
        signature,
        actualAssetId: actualAssetIdPda.toString(),
    };
}
