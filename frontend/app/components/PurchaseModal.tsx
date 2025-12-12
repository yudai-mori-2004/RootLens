'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Wallet, Check, AlertCircle } from 'lucide-react';
import bs58 from 'bs58';

interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (downloadToken: string) => void;
  mediaProofId: string;
  priceLamports: number;
  sellerWallet: string;
  title?: string;
}

export default function PurchaseModal({
  isOpen,
  onClose,
  onSuccess,
  mediaProofId,
  priceLamports,
  sellerWallet,
  title,
}: PurchaseModalProps) {
  const { user, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const solanaWallet = wallets[0];
  const buyerWallet = solanaWallet?.address;

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'confirm' | 'payment' | 'success'>('confirm');
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const handlePurchase = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!buyerWallet) {
      toast.error('ウォレットが接続されていません');
      return;
    }

    setLoading(true);

    try {
      // Solanaウォレットの存在確認
      if (!solanaWallet) {
        throw new Error('Solanaウォレットが見つかりません');
      }

      // 1. トランザクション作成
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        'confirmed'
      );

      const buyerPubkey = new PublicKey(buyerWallet);
      const sellerPubkey = new PublicKey(sellerWallet);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyerPubkey,
          toPubkey: sellerPubkey,
          lamports: priceLamports,
        })
      );

      // 最新のblockhashを取得
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = buyerPubkey;

      setStep('payment');

      // 2. トランザクションをシリアライズ
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // 3. useSignAndSendTransactionフックで署名・送信
      const txResult = await signAndSendTransaction({
        transaction: serializedTransaction,
        wallet: solanaWallet,
      });
      
      // 結果からシグネチャを抽出
      let txSignature: string | undefined;
      
      if (typeof txResult === 'string') {
        txSignature = txResult;
      } else if (typeof txResult === 'object' && txResult !== null) {
        // @ts-ignore - 戻り値の型定義が不完全な場合の対策
        const sig = txResult.signature || txResult.transactionHash;
        
        if (typeof sig === 'string') {
          txSignature = sig;
        } else if (sig && typeof sig === 'object' && 'data' in sig && Array.isArray(sig.data)) {
          // Buffer形式のオブジェクト { type: 'Buffer', data: [...] } の場合
          txSignature = bs58.encode(new Uint8Array(sig.data));
        } else if (sig instanceof Uint8Array) {
          // Uint8Arrayの場合
          txSignature = bs58.encode(sig);
        }
      }

      if (!txSignature || typeof txSignature !== 'string') {
        throw new Error(`トランザクションシグネチャが無効です: ${JSON.stringify(txResult)}`);
      }

      // 3. トランザクション確認を待つ
      await connection.confirmTransaction({
        signature: txSignature,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');

      setLastSignature(txSignature);

      // 5. 購入記録API呼び出し
      const response = await fetch('/api/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaProofId,
          buyerWallet,
          txSignature,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '購入記録に失敗しました');
      }

      setDownloadToken(result.downloadToken);
      setStep('success');
      toast.success('購入が完了しました！');
      
      if (onSuccess) {
        onSuccess(result.downloadToken);
      }

    } catch (error: any) {
      console.error('=== Purchase Error ===', error);
      toast.error(error.message || '購入処理に失敗しました');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('confirm');
    setDownloadToken(null);
    onClose();
  };

  const downloadUrl = downloadToken
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/download/${downloadToken}`
    : null;

  // トランザクションエクスプローラーのURLを生成 (Devnetデフォルト)
  const getExplorerUrl = (signature: string) => {
    const baseUrl = 'https://solscan.io/tx';
    return `${baseUrl}/${signature}?cluster=devnet`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? '購入完了' : title || 'コンテンツを購入'}
          </DialogTitle>
        </DialogHeader>

        {/* 購入確認ステップ */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-600 mb-1">価格</p>
              <p className="text-3xl font-bold text-gray-900">
                {(priceLamports / LAMPORTS_PER_SOL).toFixed(3)}
                <span className="text-lg ml-2 text-gray-600">SOL</span>
              </p>
              <p className="text-xs text-gray-500 mt-2 break-all">
                送金先: {sellerWallet}
              </p>
            </div>

            {!authenticated && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">
                  購入にはウォレット接続が必要です
                </p>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-800">
                  <p className="font-medium mb-1">購入後のダウンロード</p>
                  <p>購入完了後、このページまたはダッシュボードからダウンロードできます（24時間有効）</p>
                </div>
              </div>
            </div>

            <Button
              onClick={handlePurchase}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  処理中...
                </>
              ) : authenticated ? (
                <>
                  <Wallet className="w-4 h-4 mr-2" />
                  購入する
                </>
              ) : (
                <>
                  <Wallet className="w-4 h-4 mr-2" />
                  ウォレット接続して購入
                </>
              )}
            </Button>
          </div>
        )}

        {/* 決済処理中 */}
        {step === 'payment' && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
            <p className="text-gray-600">トランザクションを送信中...</p>
          </div>
        )}

        {/* 成功ステップ */}
        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-6 space-y-3">
              <div className="rounded-full bg-green-100 p-3">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-lg font-semibold text-gray-900">購入完了！</p>
              <p className="text-sm text-gray-600 text-center">
                ダウンロードリンクを<br />
                <span className="font-medium">{email}</span><br />
                に送信しました
              </p>
              {lastSignature && (
                <a
                  href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                >
                  トランザクションを確認 <Loader2 className="w-3 h-3" />
                </a>
              )}
            </div>

            {downloadUrl && (
              <Button
                asChild
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                  今すぐダウンロード
                </a>
              </Button>
            )}

            <Button
              onClick={handleClose}
              variant="outline"
              className="w-full"
            >
              閉じる
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
