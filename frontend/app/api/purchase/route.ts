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
    const { mediaProofId, buyerWallet, buyerEmail, txSignature } = body;

    // バリデーション
    if (!mediaProofId || !buyerWallet || !buyerEmail || !txSignature) {
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

    // 2. トランザクション検証（Solana RPC）
    const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

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
    // - buyer_walletがトランザクションの署名者であること
    // - seller_walletへ送金されていること
    // - 金額が正しいこと
    const signers = txInfo.transaction.message.staticAccountKeys || [];
    const buyerPubkey = new PublicKey(buyerWallet);
    const sellerPubkey = new PublicKey(mediaProof.owner_wallet);

    // 署名者確認（最初の署名者がbuyerであるべき）
    if (!signers[0].equals(buyerPubkey)) {
      return NextResponse.json(
        { success: false, error: 'Transaction signer does not match buyer wallet' } as PurchaseResponse,
        { status: 400 }
      );
    }

    // TODO: より厳密な送金先・金額の検証ロジック
    // （現状はトランザクション存在確認のみ）

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
        buyer_email: buyerEmail,
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

    // 8. メール送信（Resend）※後で実装
    // TODO: Resendを使ってダウンロードリンクをメール送信
    // const downloadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/download/${downloadToken}`;
    // await sendDownloadEmail(buyerEmail, downloadUrl);

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
