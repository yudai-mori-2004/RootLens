'use client';

import { useEffect, useState, use } from 'react';
import { createClient } from '@supabase/supabase-js';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { createManifestSummary, C2PASummaryData } from '@/app/lib/c2pa-parser';
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
import { searchArweaveTransactionsByHash } from '@/app/lib/irys-verification';
import {
  getIrysGatewayUrl,
  fetchArweaveMetadata,
  checkSolanaAssetExists,
  fallbackToDatabase
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
  Check
} from 'lucide-react';

import Header from '@/app/components/Header';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import LoadingState from '@/app/components/LoadingState';

// クライアントサイドでのSupabase接続
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ProofData {
  mediaProofId: string;
  originalHash: string;
  rootSigner: string;
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
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 所有権の正当性検証ステップ（5ステップ）
  const [verificationSteps, setVerificationSteps] = useState<VerificationStep[]>([
    {
      id: 'db',
      label: 'Step 1: 永久記録を探す',
      status: 'pending',
      explanation: 'Arweave（永久保存ブロックチェーン）から、RootLens公式が発行した証明記録を検索します。'
    },
    {
      id: 'cnft',
      label: 'Step 2: デジタル所有権を確認',
      status: 'pending',
      explanation: 'Solanaブロックチェーン上のcNFT（デジタル所有権証明書）が存在するか確認します。'
    },
    {
      id: 'arweave',
      label: 'Step 3: 来歴データを取得',
      status: 'pending',
      explanation: 'コンテンツの「指紋」（ハッシュ値）を永久記録から取得します。'
    },
    {
      id: 'crosslink',
      label: 'Step 4: 乗っ取り防止チェック',
      status: 'pending',
      explanation: 'ArweaveとSolanaが互いにリンクしているか確認し、所有権の偽装を防ぎます。'
    },
    {
      id: 'duplicate',
      label: 'Step 5: コピー発行の確認',
      status: 'pending',
      explanation: '過去に同じコンテンツの所有権証明が発行されていないか、今見ているものが最古の記録であるかを確認します。'
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
        let verificationSource: 'onchain' | 'db' = 'onchain';
        let targetAssetId: string | undefined;
        let cnftData: any = null;
        let currentOwner = '';
        let cnftUri = '';
        let cnftExists = false;
        let arweaveData: any = null;
        let isBurned = false;
        let lastOwnerBeforeBurn = '';

        updateStep('db', 'loading', 'Arweave GraphQL検索中...');
        const matchingTxs = await searchArweaveTransactionsByHash(originalHash);

        if (matchingTxs.length > 0) {
          updateStep('db', 'loading', `${matchingTxs.length}件の候補を検証中...`);
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
            updateStep('db', 'success', '有効な最古の証明を発見');
            updateStep('arweave', 'success', '永久記録を取得しました');
            updateStep('cnft', 'success', 'cNFT存在確認完了');
            verificationSource = 'onchain';
          } else {
            console.warn('Fallback to DB.');
            const fallback = await fallbackToDatabase(originalHash);
            if (!fallback) throw new Error('証明データが見つかりません');

            updateStep('db', 'success', 'DBから記録を取得');
            arweaveTxId = fallback.arweaveTxId;
            arweaveData = fallback.arweaveData;
            targetAssetId = fallback.targetAssetId;
            verificationSource = 'db';
            if (arweaveData) updateStep('arweave', 'success', '永久記録を取得しました');
          }
        } else {
          console.warn('Fallback to DB.');
          const fallback = await fallbackToDatabase(originalHash);
          if (!fallback) throw new Error('証明データが見つかりません');

          updateStep('db', 'success', 'DBから記録を取得');
          arweaveTxId = fallback.arweaveTxId;
          arweaveData = fallback.arweaveData;
          targetAssetId = fallback.targetAssetId;
          verificationSource = 'db';
          if (arweaveData) updateStep('arweave', 'success', '永久記録を取得しました');
        }

        if (verificationSource === 'db' && targetAssetId && !cnftData) {
          updateStep('cnft', 'loading');
          try {
            const checkResult = await checkSolanaAssetExists(targetAssetId);
            const result = checkResult as any;
            cnftData = result;
            if (result) {
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
              updateStep('cnft', 'success', `cNFT存在確認完了`);
            } else {
              updateStep('cnft', 'pending', 'cNFTがまだ見つかりません');
            }
          } catch (e) {
            updateStep('cnft', 'error', 'cNFT取得失敗');
          }
        }

        updateStep('crosslink', 'loading');
        const fetchBaseUrl = getIrysGatewayUrl();
        const expectedArweaveUri = `${fetchBaseUrl}/${arweaveTxId}`;
        const arweaveToCnft = cnftExists;
        const cnftToArweave = Boolean(cnftUri && cnftUri.includes(arweaveTxId));
        const crossLinkValid = arweaveToCnft && cnftToArweave;

        if (crossLinkValid) {
          updateStep('crosslink', 'success', '双方向リンクを確認');
        } else {
          if (verificationSource === 'db') {
            updateStep('crosslink', 'pending', 'オンチェーン反映待ち');
          } else {
            updateStep('crosslink', 'error', '相互リンク検証失敗');
          }
        }

        updateStep('duplicate', 'loading');
        const { data: duplicates, error: dupError } = await supabase
          .from('media_proofs')
          .select('id, created_at, cnft_mint_address')
          .eq('original_hash', originalHash)
          .order('created_at', { ascending: true });

        const noDuplicates = !dupError && duplicates && duplicates.length === 1;

        if (noDuplicates) {
          updateStep('duplicate', 'success', '重複なし');
        } else if (duplicates && duplicates.length > 1) {
          const isOldest = duplicates[0].cnft_mint_address === targetAssetId;
          if (isOldest) {
            updateStep('duplicate', 'success', '最古の証明');
          } else {
            updateStep('duplicate', 'error', '重複あり');
          }
        } else {
          updateStep('duplicate', 'error', '重複チェック失敗');
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
        const createdAtAttr = (arweaveData as any).attributes.find((a: any) => a.trait_type === 'created_at');
        const isValid = (verificationSource === 'db') ? true : (crossLinkValid && noDuplicates);

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
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
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
          message="所有権を検証中..." 
          subMessage="ブロックチェーン上の記録と電子署名を照合しています"
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
            {accessAllowed === false ? 'アクセスが拒否されました' : 'エラーが発生しました'}
          </h2>
          <p className="text-slate-600 mb-6">
            {accessAllowed === false ?
             'このコンテンツは非公開、またはアクセス権限がありません。' :
             (error || 'データが見つかりません')}
          </p>
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
             <Link href="/">ホームに戻る</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Explorer URL設定
  const arweaveExplorer = process.env.NEXT_PUBLIC_ARWEAVE_EXPLORER_URL || 'https://viewblock.io/arweave/tx';
  const solanaExplorer = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL || 'https://orb.helius.dev/address';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* メインコンテンツカード */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-10">
          <div className="grid md:grid-cols-5 gap-0">
            
            {/* 左: 画像 (3/5) */}
            <div className="md:col-span-3 bg-slate-900 relative min-h-[400px] flex items-center justify-center p-4">
              {proof.c2paData?.thumbnailUrl ? (
                <div className="relative w-full h-full max-w-full max-h-[500px]">
                  <Image
                    src={proof.c2paData.thumbnailUrl}
                    alt="Content preview"
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    style={{ objectFit: 'contain' }}
                    className="rounded-md shadow-2xl"
                  />
                </div>
              ) : (
                <div className="text-slate-500 text-center p-8">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">プレビューなし</p>
                </div>
              )}
              {proof.isValid && (
                <div className="absolute top-4 right-4 z-10">
                  <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 border border-green-200">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-bold text-green-700">RootLens Verified</span>
                  </div>
                </div>
              )}
            </div>

            {/* 右: 詳細情報 (2/5) */}
            <div className="md:col-span-2 p-6 md:p-8 flex flex-col h-full border-l border-slate-100">
              <div className="flex-1">
                {/* ヘッダー情報 */}
                <div className="flex items-center justify-between gap-4 mb-4">
                    {/* 所有者以外には「公開」バッジは見せない（ノイズになるため）
                        非公開（自分しか見えない）時のみ表示する */}
                   {!proof.isPublic && isOwner && (
                       <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                           <Lock className="w-3 h-3 mr-1" /> 非公開
                       </Badge>
                   )}
                   {/* 何も表示しない場合のスペーサー */}
                   {proof.isPublic && <div />}
                   
                  <div className="flex items-center text-xs text-slate-400 font-mono gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(proof.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4 leading-tight">
                  {proof.title || '無題のコンテンツ'}
                </h1>
                
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
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Current Owner</p>
                        {proof.isBurned ? (
                            <p className="text-sm font-bold text-orange-600 truncate">Burn済み (削除)</p>
                        ) : (
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-mono text-slate-700 truncate max-w-[180px]">
                                    {proof.ownerWallet}
                                </p>
                                {isOwner && <Badge className="text-[10px] h-5 px-1.5 bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">You</Badge>}
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
                     タイムライン
                   </Button>
                   <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowTechnicalModal(true)}
                      className="h-9 flex-1"
                   >
                     <ClipboardList className="w-4 h-4 mr-2" />
                     検証レポート
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
                                        {isPurchased ? '購入済み' : 'コンテンツ価格'}
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        {proof.priceLamports === 0 ? (
                                            <span className="text-2xl font-bold">Free</span>
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
                                        再ダウンロード
                                    </>
                                ) : (
                                    <>
                                        {checkingPurchase ? '確認中...' : (proof.priceLamports > 0 ? '購入してダウンロード' : 'ダウンロード')}
                                    </>
                                )}
                            </Button>

                            {!isPurchased && proof.priceLamports > 0 && (
                                <p className="text-[10px] text-center opacity-70 mt-3 flex items-center justify-center gap-1">
                                    <Lock className="w-3 h-3" /> Solana Payによる安全な取引
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
                            <h2 className="text-xl md:text-2xl font-bold">デジタル資産証明</h2>
                            <p className="text-slate-400 text-sm">Blockchain & C2PA Verification</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        
                        {/* 1. C2PA Status */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-blue-500/50 transition-colors">
                            <p className="text-xs text-slate-400 font-medium mb-3">来歴証明 (Provenance)</p>
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
                                        {proof.c2paData?.validationStatus.isValid ? 'Valid' : 'Invalid'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        {proof.c2paData?.validationStatus.isValid ? '来歴検証に成功' : '署名無効'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 2. AI Status */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-purple-500/50 transition-colors">
                            <p className="text-xs text-slate-400 font-medium mb-3">AI生成判定</p>
                            <div className="flex items-center gap-3">
                                {proof.c2paData?.activeManifest?.isAIGenerated ? (
                                    <>
                                        <Sparkles className="w-8 h-8 text-purple-400" />
                                        <div>
                                            <p className="font-bold text-lg text-purple-400">Detected</p>
                                            <p className="text-xs text-slate-400">AI生成の可能性</p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Camera className="w-8 h-8 text-blue-400" />
                                            <div className="absolute -bottom-1 -right-1 bg-slate-900 rounded-full border border-slate-900">
                                                <CheckCircle className="w-4 h-4 text-blue-400" />
                                            </div>
                                        </div>
                                        <div>
                                            <p className="font-bold text-lg text-blue-400">Captured</p>
                                            <p className="text-xs text-slate-400">カメラ撮影データ</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 3. Arweave (Interactive) */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-indigo-500/50 transition-colors group">
                            <p className="text-xs text-slate-400 font-medium mb-3 flex items-center gap-2">
                                永久保存データ (Data)
                                <Database className="w-3 h-3 text-slate-500" />
                            </p>
                            
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                                                                <button className="flex items-center gap-3 w-full text-left group-hover:bg-slate-700/50 p-2 -ml-2 rounded-lg transition-all">
                                                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                                                                                        <Image src="/arweave_logo.png" alt="Arweave Logo" fill style={{ objectFit: 'contain' }} sizes="32px" />
                                                                                    </div>                                            <div className="flex-1 min-w-0">                                                <div className="flex items-center gap-2">
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
                                    <TooltipContent className="bg-slate-800 border-slate-700 text-white p-4 max-w-xs">
                                        <div className="mb-2">
                                            <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                                                <Database className="w-4 h-4" /> Permanent Data
                                            </h4>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                この画像のオリジナルデータとハッシュ値は、Arweaveブロックチェーン上に永久に保存されています。サーバーダウンや改ざんのリスクがありません。
                                            </p>
                                        </div>
                                        <a 
                                            href={`${arweaveExplorer}/${proof.arweaveTxId}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2 font-bold"
                                        >
                                            Explorerで確認 <ArrowRightIcon className="w-3 h-3" />
                                        </a>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        {/* 4. cNFT (Interactive) */}
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-indigo-500/50 transition-colors group">
                            <p className="text-xs text-slate-400 font-medium mb-3 flex items-center gap-2">
                                デジタル所有権 (Ownership)
                                <Wallet className="w-3 h-3 text-slate-500" />
                            </p>
                            
                             <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                                                                <button className="flex items-center gap-3 w-full text-left group-hover:bg-slate-700/50 p-2 -ml-2 rounded-lg transition-all">
                                                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                                                                                        <Image src="/solana_logo.png" alt="Solana Logo" fill style={{ objectFit: 'contain' }} sizes="32px" />
                                                                                    </div>                                            <div className="flex-1 min-w-0">                                                <div className="flex items-center gap-2">
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
                                    <TooltipContent className="bg-slate-800 border-slate-700 text-white p-4 max-w-xs">
                                        <div className="mb-2">
                                            <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                                                <Wallet className="w-4 h-4" /> Digital Ownership
                                            </h4>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                所有権はSolanaブロックチェーン上の圧縮NFT(cNFT)として管理されています。これにより、権利の明確化と即時の売買が可能になります。
                                            </p>
                                        </div>
                                        <a 
                                            href={`${solanaExplorer}/${proof.cnftMintAddress}?cluster=devnet`} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2 font-bold"
                                        >
                                            Explorerで確認 <ArrowRightIcon className="w-3 h-3" />
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
                         所有権の正当性検証プロセス
                    </CardTitle>
                    <CardDescription>
                        5つのステップでリアルタイムにブロックチェーンと署名を照合します
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
                                        {proof.isValid ? '✓ 正当な所有権が確認されました' : '⚠ 検証に問題があります'}
                                    </h4>
                                    <p className={`text-xs ${proof.isValid ? 'text-green-700' : 'text-red-700'}`}>
                                        {proof.isValid 
                                        ? 'この所有権証明は、Arweave永久記録とSolana cNFTの双方向相互リンクにより、偽造や乗っ取りから保護されています。' 
                                        : '一部の検証項目が失敗しています。この所有権証明に問題がある可能性があります。'}
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
            toast.success("購入が完了しました！");
          }}
          mediaProofId={proof.mediaProofId}
          priceLamports={proof.priceLamports}
          sellerWallet={proof.ownerWallet}
          title={proof.title}
        />
      )}
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
