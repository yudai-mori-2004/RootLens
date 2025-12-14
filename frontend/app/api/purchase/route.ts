// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Purchase API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey } from '@solana/web3.js';
import { PurchaseRequest, PurchaseResponse } from '@/../../shared/types/purchase';
import { randomBytes } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/purchase
 *
 * SolanaPayトランザクション完了後に呼び出される購入記録エンドポイント
 */
export async function POST(req: NextRequest) {
  try {
    const body: PurchaseRequest = await req.json();
    const { mediaProofId, buyerWallet, txSignature } = body;

    // バリデーション
    if (!mediaProofId || !buyerWallet || !txSignature) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' } as PurchaseResponse,
        { status: 400 }
      );
    }

    // 1. media_proofsから情報を取得
    const { data: mediaProof, error: proofError } = await supabase
      .from('media_proofs')
      .select('id, cnft_mint_address, owner_wallet, price_lamports, original_hash, file_extension')
      .eq('id', mediaProofId)
      .single();

    if (proofError || !mediaProof) {
      return NextResponse.json(
        { success: false, error: 'Media proof not found' } as PurchaseResponse,
        { status: 404 }
      );
    }

    // 2. 無料コンテンツの場合はダミーシグネチャをチェック
    const isFreeContent = mediaProof.price_lamports === 0;
    const isFreeTransaction = txSignature.startsWith('free_');

    if (isFreeContent && !isFreeTransaction) {
      return NextResponse.json(
        { success: false, error: 'Invalid transaction signature for free content' } as PurchaseResponse,
        { status: 400 }
      );
    }

    if (!isFreeContent && isFreeTransaction) {
      return NextResponse.json(
        { success: false, error: 'Cannot use free transaction signature for paid content' } as PurchaseResponse,
        { status: 400 }
      );
    }

    // 3. トランザクション検証（有料の場合のみ）
    if (mediaProof.price_lamports > 0) {
      // Note: クライアント側と同じRPC URLを使用
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        'confirmed'
      );

      let txInfo;
      try {
        txInfo = await connection.getTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
        });
      } catch (err) {
        console.error('Transaction verification failed:', err);
        return NextResponse.json(
          { success: false, error: 'Transaction not found or invalid' } as PurchaseResponse,
          { status: 400 }
        );
      }

      if (!txInfo) {
        return NextResponse.json(
          { success: false, error: 'Transaction not found' } as PurchaseResponse,
          { status: 400 }
        );
      }

      // 3. トランザクション内容の検証
      const buyerPubkey = new PublicKey(buyerWallet);
      const sellerPubkey = new PublicKey(mediaProof.owner_wallet);

      // 3-1. トランザクションが成功しているか確認
      if (txInfo.meta?.err) {
        return NextResponse.json(
          { success: false, error: 'Transaction failed on chain' } as PurchaseResponse,
          { status: 400 }
        );
      }

      // 3-2. 署名者確認（最初の署名者がbuyerであるべき）
      const signers = txInfo.transaction.message.staticAccountKeys || [];
      if (!signers[0].equals(buyerPubkey)) {
        return NextResponse.json(
          { success: false, error: 'Transaction signer does not match buyer wallet' } as PurchaseResponse,
          { status: 400 }
        );
      }

      // 3-3. トランザクションの残高変更を検証（より確実な方法）
      const accountKeys = txInfo.transaction.message.staticAccountKeys;
      const preBalances = txInfo.meta?.preBalances || [];
      const postBalances = txInfo.meta?.postBalances || [];

      // buyer と seller のインデックスを探す
      let buyerIndex = -1;
      let sellerIndex = -1;

      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys[i].equals(buyerPubkey)) {
          buyerIndex = i;
        }
        if (accountKeys[i].equals(sellerPubkey)) {
          sellerIndex = i;
        }
      }

      if (buyerIndex === -1 || sellerIndex === -1) {
        return NextResponse.json(
          { success: false, error: 'Buyer or seller not found in transaction accounts' } as PurchaseResponse,
          { status: 400 }
        );
      }

      // 残高変更を計算
      const buyerBalanceChange = postBalances[buyerIndex] - preBalances[buyerIndex];
      const sellerBalanceChange = postBalances[sellerIndex] - preBalances[sellerIndex];

      console.log('Balance changes:', {
        buyer: buyerBalanceChange,
        seller: sellerBalanceChange,
        expectedPrice: mediaProof.price_lamports,
        buyerWallet,
        sellerWallet: mediaProof.owner_wallet,
        isSelfTransfer: buyerWallet === mediaProof.owner_wallet,
      });

      // 自分から自分への送金かチェック
      const isSelfTransfer = buyerWallet.toLowerCase() === mediaProof.owner_wallet.toLowerCase();

      if (isSelfTransfer) {
        // 自分から自分への送金の場合：
        // 残高変更は手数料分のマイナスのみ（-5000 lamports程度）
        // 手数料が妥当な範囲（0.01 SOL = 10,000,000 lamports以下）であればOK
        const fee = Math.abs(buyerBalanceChange);
        if (fee > 10_000_000) {
          return NextResponse.json(
            {
              success: false,
              error: `Transaction fee too high (${fee} lamports) for self-transfer`
            } as PurchaseResponse,
            { status: 400 }
          );
        }
        console.log(`Self-transfer detected, fee: ${fee} lamports`);
      } else {
        // 通常の送金の場合：sellerの増加額が価格と一致することを確認
        if (sellerBalanceChange < mediaProof.price_lamports) {
          return NextResponse.json(
            {
              success: false,
              error: `Transfer amount (${sellerBalanceChange} lamports) is less than price (${mediaProof.price_lamports} lamports)`
            } as PurchaseResponse,
            { status: 400 }
          );
        }
      }
    } // 有料の場合の検証ここまで

    // 4. 既に購入記録が存在しないか確認（重複防止）
    const { data: existingPurchase } = await supabase
      .from('purchases')
      .select('id')
      .eq('solana_tx_signature', txSignature)
      .single();

    if (existingPurchase) {
      return NextResponse.json(
        { success: false, error: 'Transaction already recorded' } as PurchaseResponse,
        { status: 409 }
      );
    }

    // 5. ダウンロードトークン生成（UUID v4）
    const downloadToken = randomBytes(32).toString('hex');

    // 6. 有効期限設定（24時間後）
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // 7. purchasesテーブルに記録
    const { data: purchase, error: insertError } = await supabase
      .from('purchases')
      .insert({
        media_proof_id: mediaProofId,
        buyer_wallet: buyerWallet,
        solana_tx_signature: txSignature,
        amount_lamports: mediaProof.price_lamports,
        seller_wallet: mediaProof.owner_wallet,
        download_token: downloadToken,
        download_expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !purchase) {
      console.error('Failed to insert purchase:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to record purchase' } as PurchaseResponse,
        { status: 500 }
      );
    }

    console.log(`Purchase recorded: ${purchase.id}, token: ${downloadToken}`);

    return NextResponse.json({
      success: true,
      purchaseId: purchase.id,
      downloadToken,
    } as PurchaseResponse);

  } catch (error) {
    console.error('Purchase API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' } as PurchaseResponse,
      { status: 500 }
    );
  }
}
