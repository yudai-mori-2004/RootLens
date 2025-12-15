"use strict";
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Arweave Upload (via Irys)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToArweave = uploadToArweave;
const umi_uploader_irys_1 = require("@metaplex-foundation/umi-uploader-irys");
const umi_1 = require("@metaplex-foundation/umi");
const solana_1 = require("./solana");
/**
 * 証明データをArweaveにアップロード（最小限設計）
 *
 * @param data - 証明データ
 * @returns Arweave URI (https://gateway.irys.xyz/...)
 */
async function uploadToArweave(data) {
    const umi = (0, solana_1.getUmi)();
    // Irys Uploaderを使用
    umi.use((0, umi_uploader_irys_1.irysUploader)({
        address: process.env.IRYS_ADDRESS || 'https://devnet.irys.xyz',
    }));
    // Arweaveメタデータを構築（最小限の4フィールド + 画像URL）
    const proofMetadata = {
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
    // ⚠️ umi-uploader-irysの実装では、uploadメソッドのoptions.tagsは無視され、
    // file.tagsのみが使用されるため、ファイル作成時にタグを埋め込む必要がある。
    const file = (0, umi_1.createGenericFileFromJson)(proofMetadata, 'metadata.json', {
        contentType: 'application/json',
        tags: [
            { name: 'original_hash', value: data.originalHash },
            { name: 'App-Name', value: 'RootLens' },
        ]
    });
    // uploadメソッド自体のoptionsにはtagsを渡しても無視される
    const [metadataUri] = await umi.uploader.upload([file]);
    console.log(`   ✓ Uploaded with tags: original_hash=${data.originalHash}`);
    return metadataUri;
}
