'use client';

import { useEffect, useState, use } from 'react';
import { createClient } from '@supabase/supabase-js';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { createManifestSummary, C2PASummaryData, getSourceTypeLabel } from '@/app/lib/c2pa-parser';
import ProvenanceModal from '@/app/components/ProvenanceModal';
import TechnicalSpecsModal from '@/app/components/TechnicalSpecsModal';
import PurchaseModal from '@/app/components/PurchaseModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { searchArweaveTransactionsByHash } from '@/app/lib/irys-verification';
import {
  getIrysGatewayUrl,
  fetchArweaveMetadata,
  checkSolanaAssetExists,
} from '@/app/lib/verification-helpers';
import {
  CheckCircle,
  XCircle,
  Download,
  ExternalLink,
  Shield,
  Clock,
  User,
  FileText,
  AlertTriangle,
  Sparkles,
  Eye,
  ClipboardList,
  RefreshCw,
  Database,
  Wallet,
  Camera,
  Lock,
  Check,
  Info,
  Cpu,
  Package
} from 'lucide-react';

import Header from '@/app/components/Header';
import { Link } from '@/lib/navigation';
import Image from 'next/image';
import { toast } from 'sonner';
import LoadingState from '@/app/components/LoadingState';
import { useTranslations } from 'next-intl';

// クライアントサイドでのSupabase接続
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ProofData {
  mediaProofId: string;
  originalHash: string;
  rootSigner: string;
  claimGenerator?: string;
  sourceType?: string;
  createdAt: string;
  arweaveTxId: string;
  cnftMintAddress: string;
  title?: string;
  description?: string;
  priceLamports: number;
  ownerWallet: string;
  isValid: boolean;
  c2paData: C2PASummaryData | null;
  isPublic: boolean;
  verificationDetails?: VerificationDetails;
  isBurned?: boolean;
  lastOwnerBeforeBurn?: string;
}

interface VerificationDetails {
  arweaveToCnft: boolean;
  cnftToArweave: boolean;
  noDuplicates: boolean;
  isRootLensWallet: boolean;
  cnftUri?: string;
  expectedUri?: string;
}

interface VerificationStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
  explanation?: string;
}

export default function AssetPage({ params }: { params: Promise<{ originalHash: string }> }) {
  const { originalHash } = use(params);
  const t = useTranslations('asset');
  
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 所有権の正当性検証ステップ（5ステップ）
  const [verificationSteps, setVerificationSteps] = useState<VerificationStep[]>([
    {
      id: 'db',
      label: t('verificationSteps.db.label'),
      status: 'pending',
      explanation: t('verificationSteps.db.explanation')
    },
    {
      id: 'cnft',
      label: t('verificationSteps.cnft.label'),
      status: 'pending',
      explanation: t('verificationSteps.cnft.explanation')
    },
    {
      id: 'arweave',
      label: t('verificationSteps.arweave.label'),
      status: 'pending',
      explanation: t('verificationSteps.arweave.explanation')
    },
    {
      id: 'crosslink',
      label: t('verificationSteps.crosslink.label'),
      status: 'pending',
      explanation: t('verificationSteps.crosslink.explanation')
    },
    {
      id: 'duplicate',
      label: t('verificationSteps.duplicate.label'),
      status: 'pending',
      explanation: t('verificationSteps.duplicate.explanation')
    },
  ]);

  // Privy Hooks
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets[0];
  const userWalletAddress = solanaWallet?.address;

  // 購入状態
  const [isPurchased, setIsPurchased] = useState(false);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [checkingPurchase, setCheckingPurchase] = useState(false);
  const [purchaseCheckTrigger, setPurchaseCheckTrigger] = useState(0); // 購入チェックを再実行するためのトリガー
  const [isOwner, setIsOwner] = useState(false); // 所有者判定を追加
  const [accessAllowed, setAccessAllowed] = useState(false); // アクセス可否の状態（初期値はfalse＝拒否）
  const [checkingAccess, setCheckingAccess] = useState(true); // アクセス権限チェック中かどうか

  // モーダル状態
  const [showProvenanceModal, setShowProvenanceModal] = useState(false);
  const [showTechnicalModal, setShowTechnicalModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showArweaveDialog, setShowArweaveDialog] = useState(false);
  const [showCnftDialog, setShowCnftDialog] = useState(false);
  const [showAiInfoDialog, setShowAiInfoDialog] = useState(false);

  // ヘルパー: 検証ステップを更新
  const updateStep = (stepId: string, status: VerificationStep['status'], message?: string) => {
    setVerificationSteps(prev =>
      prev.map(step =>
        step.id === stepId ? { ...step, status, message } : step
      )
    );
  };

  // 購入状態の確認
  useEffect(() => {
    async function checkPurchaseStatus() {
       if (!authenticated || !userWalletAddress || !proof) return;

       setCheckingPurchase(true);
       try {
         const { data } = await supabase
           .from('purchases')
           .select('id, download_token')
           .eq('media_proof_id', proof.mediaProofId)
           .eq('buyer_wallet', userWalletAddress)
           .order('created_at', { ascending: false })
           .limit(1)
           .maybeSingle();

         if (data) {
            setIsPurchased(true);
            if (data.download_token) {
              setDownloadToken(data.download_token);
            }
         }
       } catch (e) {
         console.error("Purchase check failed", e);
       } finally {
         setCheckingPurchase(false);
       }
    }

    if (proof) {
        checkPurchaseStatus();
    }
  }, [proof, authenticated, userWalletAddress, purchaseCheckTrigger]);

  // アクセス権確認
  useEffect(() => {
    async function checkAccessStatus() {
      if (!proof) return;

      setCheckingAccess(true);
      const currentIsOwner = authenticated && userWalletAddress === proof.ownerWallet;
      setIsOwner(currentIsOwner);

      if (proof.isPublic) {
        setAccessAllowed(true);
      } else {
        if (currentIsOwner || isPurchased) {
          setAccessAllowed(true);
        } else {
          setAccessAllowed(false);
        }
      }
      setCheckingAccess(false);
    }
    checkAccessStatus();
  }, [proof, authenticated, userWalletAddress, isPurchased]);

  // 証明データ取得
  useEffect(() => {
    async function fetchProof() {
      try {
        setLoading(true);
        setError(null);

        let arweaveTxId: string = '';
        let targetAssetId: string | undefined;
        let cnftData: any = null;
        let currentOwner = '';
        let cnftUri = '';
        let cnftExists = false;
        let arweaveData: any = null;
        let isBurned = false;
        let lastOwnerBeforeBurn = '';

        updateStep('db', 'loading', t('verificationSteps.db.loading'));
        const matchingTxs = await searchArweaveTransactionsByHash(originalHash);

        if (matchingTxs.length > 0) {
          updateStep('db', 'loading', t('verificationSteps.db.loadingCount', { count: matchingTxs.length }));
          let foundValidProof = false;

          for (const tx of matchingTxs) {
            try {
              const arData = await fetchArweaveMetadata(tx.txId);
              if (!arData) continue;

              if (tx.targetAssetId) {
                const checkResult = await checkSolanaAssetExists(tx.targetAssetId);
                const result = checkResult as any;
                if (result) {
                  arweaveTxId = tx.txId;
                  targetAssetId = tx.targetAssetId;
                  arweaveData = arData;
                  cnftData = result;
                  isBurned = result.burnt === true;

                  if (result.ownership) {
                    if (isBurned) {
                      lastOwnerBeforeBurn = result.ownership.owner;
                      currentOwner = '';
                    } else {
                      currentOwner = result.ownership.owner;
                    }
                  }
                  if (result.content?.json_uri) cnftUri = result.content.json_uri;
                  cnftExists = true;
                  foundValidProof = true;
                  break;
                }
              }
            } catch (e) {
              console.warn(`Error checking candidate ${tx.txId}:`, e);
            }
          }

          if (foundValidProof) {
            updateStep('db', 'success', t('verificationSteps.db.success'));
            updateStep('arweave', 'success', t('verificationSteps.arweave.success'));
            updateStep('cnft', 'success', t('verificationSteps.cnft.success'));
          } else {
            // Arweaveは見つかったが、Solana上の資産とリンクしていない場合
            // DBフォールバックを削除したため、ここでエラーとする
            throw new Error(t('status.notFound'));
          }
        } else {
          // Arweaveに記録がない場合
          // DBフォールバックを削除したため、ここでエラーとする
          throw new Error(t('status.notFound'));
        }

        updateStep('crosslink', 'loading');
        const fetchBaseUrl = getIrysGatewayUrl();
        const expectedArweaveUri = `${fetchBaseUrl}/${arweaveTxId}`;
        const arweaveToCnft = cnftExists;
        const cnftToArweave = Boolean(cnftUri && cnftUri.includes(arweaveTxId));
        const crossLinkValid = arweaveToCnft && cnftToArweave;

        if (crossLinkValid) {
          updateStep('crosslink', 'success', t('verificationSteps.crosslink.success'));
        } else {
           updateStep('crosslink', 'error', t('verificationSteps.crosslink.error'));
        }

        updateStep('duplicate', 'loading');
        const { data: duplicates, error: dupError } = await supabase
          .from('media_proofs')
          .select('id, created_at, cnft_mint_address')
          .eq('original_hash', originalHash)
          .order('created_at', { ascending: true });

        const noDuplicates = !dupError && duplicates && duplicates.length === 1;

        if (noDuplicates) {
          updateStep('duplicate', 'success', t('verificationSteps.duplicate.success'));
        } else if (duplicates && duplicates.length > 1) {
          const isOldest = duplicates[0].cnft_mint_address === targetAssetId;
          if (isOldest) {
            updateStep('duplicate', 'success', t('verificationSteps.duplicate.successOldest'));
          } else {
            updateStep('duplicate', 'error', t('verificationSteps.duplicate.error'));
          }
        } else {
          updateStep('duplicate', 'error', t('verificationSteps.duplicate.errorCheck'));
        }

        let c2paData: C2PASummaryData | null = null;
        let isPublic = true;
        const { data: publicCheck } = await supabase
            .from('media_proofs')
            .select('is_public')
            .eq('original_hash', originalHash)
            .single();
        if (publicCheck) {
            isPublic = publicCheck.is_public;
        }

        if (isPublic || userWalletAddress === currentOwner) {
          try {
            const publicBucketUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL;
            const manifestUrl = `${publicBucketUrl}/media/${originalHash}/manifest.json`;
            const manifestResponse = await fetch(manifestUrl);
            if (manifestResponse.ok) {
              c2paData = await manifestResponse.json();
            }
          } catch (e) {
            console.warn('Manifest取得失敗:', e);
          }
        }

        const rootSignerAttr = (arweaveData as any).attributes.find((a: any) => a.trait_type === 'root_signer');
        const claimGeneratorAttr = (arweaveData as any).attributes.find((a: any) => a.trait_type === 'claim_generator');
        const sourceTypeAttr = (arweaveData as any).attributes.find((a: any) => a.trait_type === 'source_type');
        const createdAtAttr = (arweaveData as any).attributes.find((a: any) => a.trait_type === 'created_at');
        
        // 検証ソースがDBの場合はtrueにするロジックを削除し、厳密にオンチェーン検証のみとする
        const isValid = crossLinkValid && noDuplicates;

        interface DbProofInfo {
          id: string;
          title: string | null;
          description: string | null;
          price_lamports: number;
        }
        let dbInfo: DbProofInfo = { id: '', title: null, description: null, price_lamports: 0 };
        try {
          const { data } = await supabase
            .from('media_proofs')
            .select('id, title, description, price_lamports')
            .eq('original_hash', originalHash)
            .single<DbProofInfo>();
          if (data) {
            dbInfo = data;
          }
        } catch (e) {
          console.warn('DB情報取得失敗:', e);
        }

        setProof({
          mediaProofId: dbInfo.id || arweaveTxId,
          originalHash: originalHash,
          rootSigner: rootSignerAttr?.value || 'Unknown',
          claimGenerator: claimGeneratorAttr?.value,
          sourceType: sourceTypeAttr?.value,
          createdAt: createdAtAttr?.value || new Date().toISOString(),
          arweaveTxId: arweaveTxId,
          cnftMintAddress: targetAssetId || '',
          title: dbInfo.title ?? undefined,
          description: dbInfo.description ?? undefined,
          priceLamports: dbInfo.price_lamports,
          ownerWallet: currentOwner,
          isValid: Boolean(isValid),
          c2paData,
          isPublic,
          isBurned,
          lastOwnerBeforeBurn,
          verificationDetails: {
            arweaveToCnft,
            cnftToArweave,
            noDuplicates,
            isRootLensWallet: true,
            cnftUri,
            expectedUri: expectedArweaveUri,
          },
        });

      } catch (err) {
        setError(err instanceof Error ? err.message : t('status.error'));
      } finally {
        setLoading(false);
      }
    }

    if (originalHash) {
      fetchProof();
    }
  }, [originalHash, userWalletAddress]);

  if (loading || checkingAccess) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <Header />
        <LoadingState 
          message={t('status.loading')}
          subMessage={t('status.subLoading')}
          steps={verificationSteps.map(s => ({ label: s.label, status: s.status }))}
        />
      </div>
    );
  }

  if (error || !proof || !accessAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-200">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {accessAllowed === false ? t('status.accessDenied') : t('status.error')}
          </h2>
          <p className="text-slate-600 mb-6">
            {accessAllowed === false ?
             t('status.privateOrNoAccess') :
             (error || t('status.notFound'))}
          </p>
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
             <Link href="/">{t('common.backToHome')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Explorer URL設定
  const arweaveExplorer = process.env.NEXT_PUBLIC_ARWEAVE_EXPLORER_URL || 'https://viewblock.io/arweave/';
  const solanaExplorer = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL || 'https://orb.helius.dev/address';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* メインコンテンツカード */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-10">
          <div className="flex flex-col md:grid md:grid-cols-5 gap-0">
            
            {/* 左: 画像 (3/5) */}
            <div className="md:col-span-3 bg-slate-900 relative w-full aspect-video md:aspect-auto md:h-auto md:min-h-[400px] flex items-center justify-center p-0 md:p-4">
              {proof.c2paData?.thumbnailUrl ? (
                <div className="relative w-full h-full">
                  <Image
                    src={proof.c2paData.thumbnailUrl}
                    alt="Content preview"
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 60vw, 50vw"
                    style={{ objectFit: 'contain' }}
                    className="md:rounded-md shadow-2xl"
                    priority
                  />
                </div>
              ) : (
                <div className="text-slate-500 text-center p-8">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">{t('details.preview')}</p>
                </div>
              )}
              {proof.isValid && (() => {
                  const { isHardware } = getSourceTypeLabel(proof.sourceType);
                  return (
                      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10">
                          {isHardware ? (
                              <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 border border-blue-200">
                                <Cpu className="w-4 h-4 text-blue-600" />
                                <span className="text-xs font-bold text-blue-700">{t('proof.hardwareBadge')}</span>
                              </div>
                          ) : (
                              <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 border border-green-200">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span className="text-xs font-bold text-green-700">{t('details.verified')}</span>
                              </div>
                          )}
                      </div>
                  );
              })()}
            </div>

            {/* 右: 詳細情報 (2/5) */}
            <div className="md:col-span-2 p-6 md:p-8 flex flex-col h-full border-t md:border-t-0 md:border-l border-slate-100 min-w-0">
              <div className="flex-1 min-w-0">
                {/* ヘッダー情報 */}
                <div className="flex items-center justify-between gap-4 mb-4">
                    {/* 所有者以外には「公開」バッジは見せない（ノイズになるため）
                        非公開（自分しか見えない）時のみ表示する */}
                   {!proof.isPublic && isOwner && (
                       <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 shrink-0">
                           <Lock className="w-3 h-3 mr-1" /> {t('details.private')}
                       </Badge>
                   )}
                   {/* 何も表示しない場合のスペーサー */}
                   {proof.isPublic && <div />}
                   
                  <div className="flex items-center text-xs text-slate-400 font-mono gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {new Date(proof.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4 leading-tight break-words">
                  {proof.title || t('details.untitled')}
                </h1>

                {/* デバイス情報と署名者情報のチップ */}
                {proof.claimGenerator && proof.rootSigner && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {/* Device/SDK チップ */}
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full shadow-md border border-slate-200">
                      <Package className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-900 truncate max-w-[200px]">
                        {(() => {
                          const rawGenerator = proof.claimGenerator || '';
                          return rawGenerator.split(' 8')[0].trim();
                        })()}
                      </span>
                    </div>

                    {/* 署名者チップ */}
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full shadow-md border border-slate-200">
                      <Shield className="w-3.5 h-3.5 text-green-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-900">{proof.rootSigner}</span>
                    </div>
                  </div>
                )}

                {proof.description && (
                  <p className="text-slate-600 text-sm leading-relaxed mb-6">
                    {proof.description}
                  </p>
                )}

                {/* 現在の所有者情報（ここに配置） */}
                <div className="flex items-center gap-3 mb-6 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                        <User className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{t('details.currentOwner')}</p>
                        {proof.isBurned ? (
                            <p className="text-sm font-bold text-orange-600 truncate">{t('details.burned')}</p>
                        ) : (
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-mono text-slate-700 truncate max-w-[180px]">
                                    {proof.ownerWallet}
                                </p>
                                {isOwner && <Badge className="text-[10px] h-5 px-1.5 bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">{t('details.you')}</Badge>}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-6">
                   <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowProvenanceModal(true)}
                      className="h-9 flex-1"
                   >
                     <Eye className="w-4 h-4 mr-2" />
                     {t('details.timeline')}
                   </Button>
                   <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowTechnicalModal(true)}
                      className="h-9 flex-1"
                   >
                     <ClipboardList className="w-4 h-4 mr-2" />
                     {t('details.report')}
                   </Button>
                </div>

                {/* 購入 / ダウンロードセクション (モダンデザイン) */}
                <div className="mt-auto">
                    <div className={`rounded-xl p-5 shadow-lg relative overflow-hidden group ${
                        isPurchased 
                        ? 'bg-slate-900 text-white' 
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                    }`}>
                        {/* 背景装飾 */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-all" />
                        
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-xs font-medium opacity-80 mb-0.5">
                                        {isPurchased ? t('details.purchaseTitle') : t('details.priceTitle')}
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        {proof.priceLamports === 0 ? (
                                            <span className="text-2xl font-bold">{t('details.free')}</span>
                                        ) : (
                                            <>
                                                <span className="text-2xl font-bold">
                                                    {(proof.priceLamports / 1_000_000_000).toFixed(2)}
                                                </span>
                                                <span className="text-sm opacity-80">SOL</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {isPurchased ? (
                                     <div className="bg-white/20 p-2 rounded-full">
                                         <Check className="w-6 h-6" />
                                     </div>
                                ) : (
                                    <div className="bg-white/20 p-2 rounded-full">
                                        <Download className="w-6 h-6" />
                                    </div>
                                )}
                            </div>

                            <Button 
                                className={`w-full font-bold h-12 text-base transition-all ${
                                    isPurchased 
                                    ? 'bg-white text-slate-900 hover:bg-slate-100' 
                                    : 'bg-white text-blue-600 hover:bg-blue-50 shadow-md'
                                }`}
                                onClick={() => {
                                    if(downloadToken) {
                                        window.open(`/api/download/${downloadToken}`, '_blank');
                                    } else {
                                        setShowPurchaseModal(true);
                                    }
                                }}
                                disabled={!isPurchased && checkingPurchase}
                            >
                                {isPurchased ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        {t('details.redownload')}
                                    </>
                                ) : (
                                    <>
                                        {checkingPurchase ? t('details.checking') : (proof.priceLamports > 0 ? t('details.purchase') : t('details.download'))}
                                    </>
                                )}
                            </Button>

                            {!isPurchased && proof.priceLamports > 0 && (
                                <p className="text-[10px] text-center opacity-70 mt-3 flex items-center justify-center gap-1">
                                    <Lock className="w-3 h-3" /> {t('details.solanaPay')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 🌟 デジタル資産証明 (目玉機能・横幅最大) 🌟 */}
        <section className="mb-10">
            <div className="bg-slate-900 text-white rounded-2xl p-6 md:p-8 shadow-xl relative overflow-hidden">
                {/* 背景エフェクト */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <Shield className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl md:text-2xl font-bold">{t('proof.title')}</h2>
                            <p className="text-slate-400 text-sm">{t('proof.subtitle')}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        
                        {/* 1. C2PA Status */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-blue-500/50 transition-colors">
                            <p className="text-xs text-slate-400 font-medium mb-3">{t('proof.provenance')}</p>
                            <div className="flex items-center gap-3">
                                <div className="relative w-8 h-8 shrink-0">
                                    <Image src="/c2pa_logo.jpg" alt="C2PA Logo" fill style={{ objectFit: 'contain' }} sizes="32px" className="rounded-full" />
                                    {proof.c2paData?.validationStatus.isValid ? (
                                        <CheckCircle className="w-4 h-4 text-green-500 absolute -bottom-1 -right-1 bg-slate-800 rounded-full" />
                                    ) : (
                                        <XCircle className="w-4 h-4 text-red-500 absolute -bottom-1 -right-1 bg-slate-800 rounded-full" />
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-lg text-white">
                                        {proof.c2paData?.validationStatus.isValid ? t('proof.valid') : t('proof.invalid')}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        {proof.c2paData?.validationStatus.isValid ? t('proof.validDesc') : t('proof.invalidDesc')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 2. AI Status & Device Info (Interactive) */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-purple-500/50 transition-colors group">
                            <p className="text-xs text-slate-400 font-medium mb-3 flex items-center gap-2">
                                {t('proof.ai')}
                                {/* モバイル用情報アイコン (Hardwareの場合のみ) */}
                                {!proof.c2paData?.activeManifest?.isAIGenerated && (
                                    <button
                                        className="md:hidden ml-auto p-1 hover:bg-slate-700/50 rounded-full transition-colors"
                                        aria-label="詳細を表示"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setShowAiInfoDialog(true);
                                        }}
                                    >
                                        <Info className="w-3 h-3 text-blue-400" />
                                    </button>
                                )}
                            </p>
                            
                            {proof.c2paData?.activeManifest?.isAIGenerated ? (
                                <div className="flex items-center gap-3">
                                    <Sparkles className="w-8 h-8 text-purple-400" />
                                    <div>
                                        <p className="font-bold text-lg text-purple-400">{t('proof.aiDetected')}</p>
                                        <p className="text-xs text-slate-400">{t('proof.aiDesc')}</p>
                                    </div>
                                </div>
                            ) : (
                                (() => {
                                    const { label, isHardware } = getSourceTypeLabel(proof.sourceType);
                                    const rawGenerator = proof.claimGenerator || '';
                                    const cleanGenerator = rawGenerator.split(' 8')[0].trim();
                                    
                                    // Hardware Signed の場合の表示
                                    return (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                                                                        <button className="flex items-center gap-3 w-full text-left group-hover:bg-slate-700/50 p-2 -ml-2 rounded-lg transition-all">
                                                                                                            <div className="relative shrink-0">
                                                                                                                {isHardware ? (
                                                                                                                    <Cpu className="w-8 h-8 text-blue-400" />
                                                                                                                ) : (
                                                                                                                    <Camera className="w-8 h-8 text-blue-400" />
                                                                                                                )}
                                                                                                                <div className="absolute -bottom-1 -right-1 bg-slate-900 rounded-full border border-slate-900">
                                                                                                                    <CheckCircle className="w-4 h-4 text-blue-400" />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                            <div className="min-w-0 flex-1">
                                                                                                                <div className="flex items-center gap-2">
                                                                                                                    <p className="font-bold text-lg text-blue-400 group-hover:underline decoration-blue-500 decoration-2 underline-offset-4">
                                                                                                                        {isHardware ? t('proof.hardwareSealed') : t('proof.captured')}
                                                                                                                    </p>
                                                                                                                </div>
                                                                                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                                                                                    <p className="text-xs text-slate-400 truncate">
                                                                                                                        {isHardware ? t('proof.aiNotDetected') : label}
                                                                                                                    </p>
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        </button>
                                                                                                    </TooltipTrigger>
                                                                                                    <TooltipContent className="bg-slate-900 border-slate-700 text-white p-4 max-w-xs">
                                                                                                        <div className="space-y-3">
                                                                                                            <div>
                                                                                                                <h4 className="font-bold text-sm mb-1 text-blue-400 flex items-center gap-2">
                                                                                                                    <Cpu className="w-4 h-4" /> {t('proof.deviceAuthenticated')}
                                                                                                                </h4>
                                                                                                                <p className="text-xs text-slate-300 leading-relaxed">
                                                                                                                    {t('proof.deviceDesc')}
                                                                                                                </p>
                                                                                                            </div>
                                                                                                            
                                                                                                            {proof.claimGenerator && (
                                                                                                                <div className="bg-slate-800 rounded p-2 border border-slate-700">
                                                                                                                    <div className="mb-2">
                                                                                                                        <p className="text-[10px] uppercase text-slate-500 font-bold">{t('proof.deviceSdk')}</p>
                                                                                                                        <p className="text-xs text-white font-mono break-words">{cleanGenerator}</p>
                                                                                                                    </div>
                                                                                                                    <div>
                                                                                                                        <p className="text-[10px] uppercase text-slate-500 font-bold">{t('proof.signer')}</p>
                                                                                                                        <p className="text-xs text-white flex items-center gap-1">
                                                                                                                            <Shield className="w-3 h-3 text-green-500" />
                                                                                                                            {proof.rootSigner}
                                                                                                                        </p>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    </TooltipContent>                                            </Tooltip>
                                        </TooltipProvider>
                                    );
                                })()
                            )}
                        </div>

                        {/* 3. Arweave (Interactive) */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-indigo-500/50 transition-colors group">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-slate-400 font-medium flex items-center gap-2">
                                    {t('proof.data')}
                                    <Database className="w-3 h-3 text-slate-500" />
                                </p>
                                {/* モバイル用情報アイコン */}
                                <button
                                    onClick={() => setShowArweaveDialog(true)}
                                    className="md:hidden p-1 hover:bg-slate-700/50 rounded-full transition-colors"
                                    aria-label="詳細を表示"
                                >
                                    <Info className="w-4 h-4 text-indigo-400" />
                                </button>
                            </div>

                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button className="flex items-center gap-3 w-full text-left group-hover:bg-slate-700/50 p-2 -ml-2 rounded-lg transition-all">
                                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                                                <Image src="/arweave_logo.png" alt="Arweave Logo" fill style={{ objectFit: 'contain' }} sizes="32px" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-lg text-white group-hover:underline decoration-indigo-500 decoration-2 underline-offset-4">
                                                        Arweave
                                                    </p>
                                                    <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </div>
                                                <p className="text-xs text-slate-400 truncate font-mono">
                                                    {proof.arweaveTxId.slice(0, 8)}...{proof.arweaveTxId.slice(-6)}
                                                </p>
                                            </div>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-800 border-slate-700 text-white p-4 max-w-xs hidden md:block">
                                        <div className="mb-2">
                                            <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                                                <Database className="w-4 h-4" /> Permanent Data
                                            </h4>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                {t('proof.dataDesc')}
                                            </p>
                                        </div>
                                        <a
                                            href={`${arweaveExplorer}/${proof.arweaveTxId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2 font-bold"
                                        >
                                            {t('proof.explorer')} <ArrowRightIcon className="w-3 h-3" />
                                        </a>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        {/* 4. cNFT (Interactive) */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-indigo-500/50 transition-colors group">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-slate-400 font-medium flex items-center gap-2">
                                    {t('proof.ownership')}
                                    <Wallet className="w-3 h-3 text-slate-500" />
                                </p>
                                {/* モバイル用情報アイコン */}
                                <button
                                    onClick={() => setShowCnftDialog(true)}
                                    className="md:hidden p-1 hover:bg-slate-700/50 rounded-full transition-colors"
                                    aria-label="詳細を表示"
                                >
                                    <Info className="w-4 h-4 text-purple-400" />
                                </button>
                            </div>

                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button className="flex items-center gap-3 w-full text-left group-hover:bg-slate-700/50 p-2 -ml-2 rounded-lg transition-all">
                                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                                                <Image src="/solana_logo.png" alt="Solana Logo" fill style={{ objectFit: 'contain' }} sizes="32px" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-lg text-white group-hover:underline decoration-purple-500 decoration-2 underline-offset-4">
                                                        cNFT
                                                    </p>
                                                    <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </div>
                                                <p className="text-xs text-slate-400 truncate font-mono">
                                                    {proof.cnftMintAddress.slice(0, 8)}...{proof.cnftMintAddress.slice(-6)}
                                                </p>
                                            </div>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-800 border-slate-700 text-white p-4 max-w-xs hidden md:block">
                                        <div className="mb-2">
                                            <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                                                <Wallet className="w-4 h-4" /> Digital Ownership
                                            </h4>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                {t('proof.ownershipDesc')}
                                            </p>
                                        </div>
                                        <a
                                            href={`${solanaExplorer}/${proof.cnftMintAddress}?cluster=devnet`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2 font-bold"
                                        >
                                            {t('proof.explorer')} <ArrowRightIcon className="w-3 h-3" />
                                        </a>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                    </div>
                </div>
            </div>
        </section>

        {/* 検証タイムライン (全幅) */}
        <section>
            <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                         <Shield className="w-5 h-5 text-blue-600" />
                         {t('card.title')}
                    </CardTitle>
                    <CardDescription>
                        {t('card.desc')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                      {verificationSteps.map((step) => (
                          <div
                              key={step.id}
                              className={`p-3 rounded-lg border flex items-start gap-3 transition-all ${
                                  // 成功時は白背景（bg-white）に戻し、枠線だけ薄くする
                                  step.status === 'success'
                                      ? 'bg-white border-slate-100'
                                      : step.status === 'error'
                                      ? 'bg-red-50 border-red-200'
                                      : step.status === 'loading'
                                      ? 'bg-blue-50 border-blue-200 shadow-sm' 
                                      : 'bg-white border-slate-100 opacity-50' // pendingは薄く
                              }`}
                          >
                              <div className="mt-0.5 shrink-0">
                                  {step.status === 'success' && (
                                      // アイコンも「塗りつぶし」ではなく「線画」にするとより軽くなります
                                      <Check className="w-5 h-5 text-green-500" />
                                  )}
                                  {step.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
                                  {step.status === 'loading' && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
                                  {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-slate-300" />}
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-center mb-0.5">
                                      <h4 className={`text-sm font-medium ${
                                          step.status === 'loading' ? 'text-blue-700' : 'text-slate-700'
                                      }`}>
                                          {step.label}
                                      </h4>
                                  </div>
                                  {/* 説明文は成功したら隠す、あるいは薄くして1行にするなど */}
                                  <p className="text-xs text-slate-500 leading-tight">
                                      {step.explanation}
                                  </p>
                              </div>
                          </div>
                      ))}
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100">
                            <div className={`flex items-center gap-4 p-4 rounded-xl ${
                                proof.isValid 
                                ? 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100' 
                                : 'bg-red-50 border border-red-100'
                            }`}>
                                {proof.isValid ? (
                                    <div className="p-2 bg-green-100 rounded-full">
                                        <CheckCircle className="w-6 h-6 text-green-600" />
                                    </div>
                                ) : (
                                    <div className="p-2 bg-red-100 rounded-full">
                                        <AlertTriangle className="w-6 h-6 text-red-600" />
                                    </div>
                                )}
                                <div>
                                    <h4 className={`font-bold ${proof.isValid ? 'text-green-900' : 'text-red-900'}`}>
                                        {proof.isValid ? t('card.validTitle') : t('card.invalidTitle')}
                                    </h4>
                                    <p className={`text-xs ${proof.isValid ? 'text-green-700' : 'text-red-700'}`}>
                                        {proof.isValid 
                                        ? t('card.validDesc')
                                        : t('card.invalidDesc')}
                                    </p>
                                </div>
                            </div>
                    </div>
                </CardContent>
            </Card>
        </section>

      </main>

      {/* モーダル群 */}
      {proof.c2paData && (
        <>
          <ProvenanceModal
            isOpen={showProvenanceModal}
            onClose={() => setShowProvenanceModal(false)}
            c2paSummary={proof.c2paData}
            rootSigner={proof.rootSigner}
          />

          <TechnicalSpecsModal
            isOpen={showTechnicalModal}
            onClose={() => setShowTechnicalModal(false)}
            c2paSummary={proof.c2paData}
            rootSigner={proof.rootSigner}
            arweaveTxId={proof.arweaveTxId}
            cnftMintAddress={proof.cnftMintAddress}
            ownerWallet={proof.ownerWallet}
            createdAt={proof.createdAt}
            originalHash={proof.originalHash}
            verificationDetails={proof.verificationDetails}
            isBurned={proof.isBurned}
            lastOwnerBeforeBurn={proof.lastOwnerBeforeBurn}
          />
        </>
      )}

      {proof && (
        <PurchaseModal
          isOpen={showPurchaseModal}
          onClose={() => {
            setShowPurchaseModal(false);
          }}
          onSuccess={(token) => {
            setIsPurchased(true);
            setDownloadToken(token);
            setShowPurchaseModal(false);
            // 購入チェックを再実行
            setPurchaseCheckTrigger(prev => prev + 1);
            toast.success(t('common.success'));
          }}
          mediaProofId={proof.mediaProofId}
          priceLamports={proof.priceLamports}
          sellerWallet={proof.ownerWallet}
          title={proof.title}
        />
      )}

      {/* モバイル用 Arweave ダイアログ */}
      <Dialog open={showArweaveDialog} onOpenChange={setShowArweaveDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Database className="w-5 h-5 text-indigo-400" />
              Permanent Data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                <Image src="/arweave_logo.png" alt="Arweave Logo" fill style={{ objectFit: 'contain' }} sizes="48px" />
              </div>
              <div>
                <p className="font-bold text-lg">Arweave</p>
                <p className="text-xs text-slate-400 font-mono break-all">
                  {proof?.arweaveTxId}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {t('proof.dataDesc')}
            </p>
            <Button
              asChild
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <a
                href={`${arweaveExplorer}/${proof?.arweaveTxId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                {t('proof.explorer')}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* モバイル用 cNFT ダイアログ */}
      <Dialog open={showCnftDialog} onOpenChange={setShowCnftDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Wallet className="w-5 h-5 text-purple-400" />
              Digital Ownership
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                <Image src="/solana_logo.png" alt="Solana Logo" fill style={{ objectFit: 'contain' }} sizes="48px" />
              </div>
              <div>
                <p className="font-bold text-lg">cNFT</p>
                <p className="text-xs text-slate-400 font-mono break-all">
                  {proof?.cnftMintAddress}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {t('proof.ownershipDesc')}
            </p>
            <Button
              asChild
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              <a
                href={`${solanaExplorer}/${proof?.cnftMintAddress}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                {t('proof.explorer')}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* モバイル用 AI/Device Info ダイアログ */}
      <Dialog open={showAiInfoDialog} onOpenChange={setShowAiInfoDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Cpu className="w-5 h-5 text-blue-400" />
              {t('proof.deviceAuthenticated')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
             <p className="text-sm text-slate-300 leading-relaxed">
                {t('proof.deviceDesc')}
             </p>
             
             {proof?.claimGenerator && (
                <div className="bg-slate-800 rounded p-3 border border-slate-700 space-y-3">
                    <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">{t('proof.deviceSdk')}</p>
                        <p className="text-sm text-white font-mono break-words">
                            {(() => {
                                const rawGenerator = proof.claimGenerator || '';
                                return rawGenerator.split(' 8')[0].trim();
                            })()}
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">{t('proof.signer')}</p>
                        <p className="text-sm text-white flex items-center gap-1.5">
                            <Shield className="w-4 h-4 text-green-500" />
                            {proof.rootSigner}
                        </p>
                    </div>
                </div>
             )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 簡易アイコンコンポーネント
function ArrowRightIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
        </svg>
    )
}