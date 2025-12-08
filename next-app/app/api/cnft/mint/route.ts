/**
 * cNFT mint API
 * Arweave (Irys経由) にメタデータをアップロード → cNFTをmint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mintV1, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  percentAmount,
} from '@metaplex-foundation/umi';
import * as fs from 'fs';

interface MintRequest {
  metadata: {
    original_hash: string;
    c2pa_hash: string;
    root_signer: string;
    license_type: string;
    created_at: string;
  };
  tree_address: string;
  owner_wallet: string;
  title?: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: MintRequest = await request.json();
    const { metadata, tree_address, owner_wallet, title, description } = body;

    console.log('🌳 cNFT mint開始...');
    console.log('Owner:', owner_wallet);
    console.log('Tree:', tree_address);

    // 1. UMIインスタンス作成（Irys統合）
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const umi = createUmi(rpcUrl)
      .use(mplBubblegum())
      .use(irysUploader()); // ← Irysプラグイン追加

    // 2. ウォレット読み込み（サーバーサイドでmint）
    const keypairPath = process.env.WALLET_KEYPAIR_PATH || './wallet-keypair.json';
    const keypairFile = fs.readFileSync(keypairPath, 'utf-8');
    const keypairArray = JSON.parse(keypairFile);
    const secretKey = new Uint8Array(keypairArray);
    const walletKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);

    umi.use(keypairIdentity(walletKeypair));

    console.log('✅ ウォレット読み込み完了');

    // 3. メタデータJSON構築
    const contentId = metadata.original_hash.substring(0, 16);
    const metadataJson = {
      name: title || `RootLens Proof #${contentId.substring(0, 8)}`,
      symbol: 'RLENS',
      description: description || 'Media authenticity proof verified by RootLens',
      attributes: [
        { trait_type: 'original_hash', value: metadata.original_hash },
        { trait_type: 'c2pa_hash', value: metadata.c2pa_hash },
        { trait_type: 'root_signer', value: metadata.root_signer },
        { trait_type: 'license_type', value: metadata.license_type },
        { trait_type: 'created_at', value: metadata.created_at },
      ],
      // ← imageフィールドなし（R2へのリンクを含めない）
    };

    console.log('📝 メタデータJSON:', metadataJson);

    // 4. Arweaveにメタデータをアップロード（Irys経由）
    console.log('☁️  Arweaveにアップロード中（Irys経由）...');
    const metadataUri = await umi.uploader.uploadJson(metadataJson);
    console.log('✅ Arweaveアップロード完了:', metadataUri);

    // 5. cNFT mint
    const leafOwner = publicKey(owner_wallet);
    const merkleTree = publicKey(tree_address);

    console.log('🔨 cNFT mint中...');

    const result = await mintV1(umi, {
      leafOwner,
      leafDelegate: leafOwner,
      merkleTree,
      metadata: {
        name: metadataJson.name,
        symbol: metadataJson.symbol,
        uri: metadataUri,
        sellerFeeBasisPoints: percentAmount(0), // ロイヤリティなし
        collection: null,
        creators: [
          {
            address: leafOwner,
            verified: false,
            share: 100,
          },
        ],
      },
    }).sendAndConfirm(umi);

    console.log('✅ cNFT mint成功！');
    console.log('Signature:', result.signature);

    // 6. Asset IDを計算（簡易版: 実際はleaf indexから計算）
    // TODO: 正確なAsset ID計算ロジック
    const assetId = `asset_${contentId}`;

    return NextResponse.json({
      success: true,
      asset_id: assetId,
      signature: Buffer.from(result.signature).toString('base64'),
      metadata_uri: metadataUri,
      content_id: contentId,
    });

  } catch (error) {
    console.error('❌ cNFT mint エラー:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error,
      },
      { status: 500 }
    );
  }
}
