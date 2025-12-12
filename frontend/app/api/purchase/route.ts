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

    // 2. トランザクション検証（Solana RPC）
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

    // 3-3. SystemProgram.transfer命令の検証
    const instructions = txInfo.transaction.message.instructions;
    let transferFound = false;
    let transferAmount = 0;

    for (const instruction of instructions) {
      // SystemProgram.transferはprogram idが'11111111111111111111111111111111'
      const programId = txInfo.transaction.message.staticAccountKeys[instruction.programIdIndex];

      if (programId.toBase58() === '11111111111111111111111111111111') {
        // SystemProgram命令を検出
        // transfer命令のdata形式: [2, 0, 0, 0] + lamports (u64, little endian)
        const data = instruction.data;

        if (data.length >= 12 && data[0] === 2) {
          // transfer命令
          // accounts[0] = from, accounts[1] = to
          const fromIndex = instruction.accounts[0];
          const toIndex = instruction.accounts[1];

          const from = txInfo.transaction.message.staticAccountKeys[fromIndex];
          const to = txInfo.transaction.message.staticAccountKeys[toIndex];

          // 送信元と送信先を確認
          if (from.equals(buyerPubkey) && to.equals(sellerPubkey)) {
            // 金額を抽出（little endian u64）
            const amount = Number(
              BigInt(data[4]) |
              (BigInt(data[5]) << 8n) |
              (BigInt(data[6]) << 16n) |
              (BigInt(data[7]) << 24n) |
              (BigInt(data[8]) << 32n) |
              (BigInt(data[9]) << 40n) |
              (BigInt(data[10]) << 48n) |
              (BigInt(data[11]) << 56n)
            );

            transferAmount = amount;
            transferFound = true;
            break;
          }
        }
      }
    }

    if (!transferFound) {
      return NextResponse.json(
        { success: false, error: 'Valid transfer instruction not found in transaction' } as PurchaseResponse,
        { status: 400 }
      );
    }

    // 3-4. 金額の確認
    if (transferAmount !== mediaProof.price_lamports) {
      return NextResponse.json(
        {
          success: false,
          error: `Transfer amount (${transferAmount} lamports) does not match price (${mediaProof.price_lamports} lamports)`
        } as PurchaseResponse,
        { status: 400 }
      );
    }

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
        buyer_email: null, // MVPではメール不要
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
