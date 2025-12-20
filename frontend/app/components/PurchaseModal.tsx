'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Wallet, Check, AlertCircle, ShoppingBag, Download, ArrowRight, ExternalLink } from 'lucide-react';
import bs58 from 'bs58';
import LoadingState from '@/app/components/LoadingState';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('components.purchaseModal');
  const tCommon = useTranslations('common');
  const { user, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const solanaWallet = wallets[0];
  const buyerWallet = solanaWallet?.address;

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'confirm' | 'payment' | 'success'>('confirm');
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const isFree = priceLamports === 0;

  const handlePurchase = async () => {
    if (!isFree) {
      if (!authenticated) {
        login();
        return;
      }

      if (!buyerWallet) {
        toast.error(t('connectWallet'));
        return;
      }
    }

    setLoading(true);

    try {
      let txSignature: string;

      if (isFree) {
        setStep('payment');
        txSignature = `free_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        setLastSignature(null);
      } else {
        setStep('payment');
        if (!solanaWallet) {
          throw new Error(t('connectWallet'));
        }

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

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = buyerPubkey;

        const serializedTransaction = transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });

        const txResult = await signAndSendTransaction({
          transaction: serializedTransaction,
          wallet: solanaWallet,
        });

        let extractedSignature: string | undefined;

        if (typeof txResult === 'string') {
          extractedSignature = txResult;
        } else if (typeof txResult === 'object' && txResult !== null) {
        const sig: unknown = (txResult as { signature?: unknown; transactionHash?: unknown }).signature || (txResult as { signature?: unknown; transactionHash?: unknown }).transactionHash;

          if (typeof sig === 'string') {
            extractedSignature = sig;
          } else if (sig && typeof sig === 'object' && 'data' in sig && Array.isArray(sig.data)) {
            extractedSignature = bs58.encode(new Uint8Array(sig.data));
          } else if (sig instanceof Uint8Array) {
            extractedSignature = bs58.encode(sig);
          }
        }

        if (!extractedSignature || typeof extractedSignature !== 'string') {
          throw new Error(`Transaction Signature Invalid: ${JSON.stringify(txResult)}`);
        }

        await connection.confirmTransaction({
          signature: extractedSignature,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed');

        txSignature = extractedSignature;
        setLastSignature(txSignature);
      }

      const response = await fetch('/api/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaProofId,
          buyerWallet: buyerWallet || 'anonymous',
          txSignature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `${tCommon('error')} (${response.status})`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || tCommon('error'));
      }

      setDownloadToken(result.downloadToken);
      setStep('success');
      toast.success(t('complete'));

      if (isFree) {
        // 無料コンテンツは即座にダウンロード開始
        const freeDownloadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/download/${result.downloadToken}`;
        try {
          const infoResponse = await fetch(freeDownloadUrl);
          if (infoResponse.ok) {
            const { presignedUrl, originalHash, fileExtension } = await infoResponse.json();
            const imageResponse = await fetch(presignedUrl);
            if (imageResponse.ok) {
              const blob = await imageResponse.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${originalHash}.${fileExtension}`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
          }
        } catch (err) {
          console.error('Free download error:', err);
        }
      }

      if (onSuccess) {
        onSuccess(result.downloadToken);
      }

    } catch (error: unknown) {
      console.error('=== Purchase Error ===', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
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

  const handleDownload = async () => {
    if (!downloadUrl) return;

    try {
      // 1. ダウンロード情報を取得
      const infoResponse = await fetch(downloadUrl);
      if (!infoResponse.ok) {
        throw new Error('ダウンロード情報の取得に失敗しました');
      }

      const { presignedUrl, originalHash, fileExtension } = await infoResponse.json();

      // 2. 実際の画像バイナリを取得
      const imageResponse = await fetch(presignedUrl);
      if (!imageResponse.ok) {
        throw new Error('画像のダウンロードに失敗しました');
      }

      const blob = await imageResponse.blob();

      // 3. ダウンロード実行
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${originalHash}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('ダウンロードが完了しました');
    } catch (error) {
      console.error('Download error:', error);
      toast.error(error instanceof Error ? error.message : 'ダウンロードに失敗しました');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white shadow-2xl rounded-xl border border-slate-100">
        
        {/* Custom Header */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl border shrink-0 bg-blue-600 border-blue-700">
              {step === 'success' ? (
                 <Check className="w-6 h-6 text-white" />
              ) : isFree ? (
                 <Download className="w-6 h-6 text-white" />
              ) : (
                 <ShoppingBag className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">
                {step === 'success' ? t('complete') : isFree ? t('download') : t('title')}
              </DialogTitle>
              {step === 'confirm' && (
                <p className="text-sm text-slate-500 mt-0.5">
                    {title || (isFree ? t('freeDesc') : t('desc'))}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
            {step === 'confirm' && (
            <div className="space-y-6">
                {/* Price Display */}
                <div className="relative rounded-2xl p-6 text-center border overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                    <p className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                        {isFree ? t('downloadPrice') : t('purchasePrice')}
                    </p>
                    <div className="flex items-baseline justify-center gap-1">
                         {isFree ? (
                             <span className="text-4xl font-extrabold text-white">Free</span>
                         ) : (
                             <>
                                <span className="text-4xl font-extrabold text-white">
                                    {(priceLamports / LAMPORTS_PER_SOL).toFixed(3)}
                                </span>
                                <span className="text-lg font-bold text-blue-200">SOL</span>
                             </>
                         )}
                    </div>
                </div>

                {/* Warnings */}
                {!isFree && !authenticated && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-3 items-start">
                    <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-800 font-medium">
                        {t('connectWallet')}
                    </p>
                </div>
                )}
                
                {/* Action Button */}
                <Button
                    onClick={handlePurchase}
                    disabled={loading}
                    className="w-full h-12 text-base font-bold shadow-md hover:shadow-lg transition-all rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            {t('processing')}
                        </>
                    ) : isFree ? (
                        <>
                            <Download className="w-5 h-5 mr-2" />
                            {t('downloadNow')}
                        </>
                    ) : authenticated ? (
                        <>
                            {t('buyAndDownload')}
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </>
                    ) : (
                        <>
                            <Wallet className="w-5 h-5 mr-2" />
                            {t('connect')}
                        </>
                    )}
                </Button>
                
                <p className="text-center text-xs text-slate-400">
                    {isFree 
                        ? 'ダウンロードファイルにはC2PA署名が含まれています' 
                        : t('secure')
                    }
                </p>
            </div>
            )}

            {step === 'payment' && (
                <div className="py-8">
                    <LoadingState 
                        fullScreen={false} 
                        message={isFree ? t('preparing') : t('transmitting')}
                        subMessage={isFree ? t('serverMsg') : t('txMsg')}
                        className="bg-transparent p-0"
                    />
                </div>
            )}

            {step === 'success' && (
                <div className="space-y-6">
                    <div className="rounded-xl p-6 text-center border bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                         <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm bg-blue-500">
                             <Check className="w-8 h-8 text-white" />
                         </div>
                         <h3 className="text-lg font-bold mb-1 text-white">
                             {isFree ? t('ready') : t('complete')}
                         </h3>
                         <p className="text-sm text-blue-100">
                             {t.rich('autoMsg', { br: () => <br/> })}
                         </p>
                    </div>

                    {lastSignature && (
                         <div className="flex justify-center">
                            <a
                            href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
                            >
                                Transaction: {lastSignature.slice(0, 6)}...{lastSignature.slice(-6)}
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    )}

                    {downloadUrl && (
                        <Button
                            onClick={handleDownload}
                            className="w-full h-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700 shadow-md rounded-xl"
                        >
                            <Download className="w-5 h-5 mr-2" />
                            {t('saveFile')}
                        </Button>
                    )}
                    
                    <Button
                        onClick={handleClose}
                        variant="ghost"
                        className="w-full text-slate-500 hover:text-slate-700"
                    >
                        {tCommon('close')}
                    </Button>
                </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}