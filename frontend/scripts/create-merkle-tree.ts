/**
 * Merkle Tree作成スクリプト
 * cNFTをmintするための初期セットアップ
 *
 * 使い方:
 * 1. devnetウォレットの秘密鍵を準備（JSON配列形式）
 * 2. npx tsx scripts/create-merkle-tree.ts
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import {
  generateSigner,
  keypairIdentity,
  createSignerFromKeypair,
  percentAmount
} from '@metaplex-foundation/umi';
import * as fs from 'fs';
import * as path from 'path';

// 設定
const RPC_URL = 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.WALLET_KEYPAIR_PATH || './wallet-keypair.json';

// Tree設定（MVP用: 小規模）
const MAX_DEPTH = 20;          // 最大 2^14 = 16,384 cNFT
const MAX_BUFFER_SIZE = 64;    // 同時mint数
const CANOPY_DEPTH = 11;       // 検証コスト削減用キャッシュ

async function main() {
  console.log('🌳 Merkle Tree作成スクリプト開始\n');

  // 1. UMIインスタンス作成
  console.log('📡 RPCに接続中...');
  const umi = createUmi(RPC_URL).use(mplBubblegum());

  // 2. ウォレット読み込み
  console.log(`🔑 ウォレット読み込み: ${KEYPAIR_PATH}`);

  let walletKeypair;
  try {
    const keypairFile = fs.readFileSync(KEYPAIR_PATH, 'utf-8');
    const keypairArray = JSON.parse(keypairFile);

    // Uint8Array に変換
    const secretKey = new Uint8Array(keypairArray);

    // UMI用のkeypairを作成
    walletKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  } catch (error) {
    console.error('❌ ウォレットファイルの読み込みに失敗しました');
    console.error('以下のコマンドでdevnetウォレットを作成してください:');
    console.error('  solana-keygen new --outfile wallet-keypair.json --no-bip39-passphrase');
    console.error('  solana airdrop 2 $(solana-keygen pubkey wallet-keypair.json) --url devnet');
    process.exit(1);
  }

  umi.use(keypairIdentity(walletKeypair));

  const walletPubkey = walletKeypair.publicKey;
  console.log(`✅ ウォレットアドレス: ${walletPubkey}`);

  // 3. 残高確認
  console.log('\n💰 残高確認中...');
  const balance = await umi.rpc.getBalance(walletPubkey);
  const solBalance = Number(balance.basisPoints) / 1e9;
  console.log(`   残高: ${solBalance} SOL`);

  if (solBalance < 0.1) {
    console.warn('⚠️  残高が少ないです。以下のコマンドでdevnet SOLを取得してください:');
    console.warn(`   solana airdrop 2 ${walletPubkey} --url devnet`);

    // 続行確認
    console.log('\n続行しますか？ (Ctrl+C で中止)');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 4. Merkle Tree Signer生成
  console.log('\n🌲 Merkle Tree作成中...');
  const merkleTree = generateSigner(umi);

  console.log(`   Tree Address: ${merkleTree.publicKey}`);
  console.log(`   Max Depth: ${MAX_DEPTH}`);
  console.log(`   Max Buffer Size: ${MAX_BUFFER_SIZE}`);
  console.log(`   Canopy Depth: ${CANOPY_DEPTH}`);
  console.log(`   最大mint可能数: ${2 ** MAX_DEPTH} cNFT`);

  // 5. Tree作成トランザクション実行
  try {
    const builder = await createTree(umi, {
      merkleTree,
      maxDepth: MAX_DEPTH,
      maxBufferSize: MAX_BUFFER_SIZE,
      canopyDepth: CANOPY_DEPTH,
    });

    console.log('\n🚀 トランザクション送信中...');
    const signature = await builder.sendAndConfirm(umi);

    console.log('\n✅ Merkle Tree作成成功！');
    console.log(`   Signature: ${signature.signature}`);
    console.log(`   Tree Address: ${merkleTree.publicKey}`);

    // 6. .env.localに書き込む
    const envPath = path.join(__dirname, '../../.env.local');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    // MERKLE_TREE_ADDRESSを更新
    const treeAddress = merkleTree.publicKey.toString();
    if (envContent.includes('MERKLE_TREE_ADDRESS=')) {
      envContent = envContent.replace(
        /MERKLE_TREE_ADDRESS=.*/,
        `MERKLE_TREE_ADDRESS=${treeAddress}`
      );
    } else {
      envContent += `\nMERKLE_TREE_ADDRESS=${treeAddress}\n`;
    }

    fs.writeFileSync(envPath, envContent);

    console.log('\n📝 .env.localを更新しました');
    console.log(`   MERKLE_TREE_ADDRESS=${treeAddress}`);

    console.log('\n🎉 セットアップ完了！');
    console.log('   次は cNFT mint機能を実装してください。');

  } catch (error) {
    console.error('\n❌ エラーが発生しました:');
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
