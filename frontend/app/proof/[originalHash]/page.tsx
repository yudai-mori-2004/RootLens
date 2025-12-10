'use client';

import { useEffect, useState, use } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createManifestSummary, C2PASummaryData } from '@/app/lib/c2pa-parser';
import ProvenanceTimeline from '@/app/components/ProvenanceTimeline';
import ProvenanceModal from '@/app/components/ProvenanceModal';
import TechnicalSpecsModal from '@/app/components/TechnicalSpecsModal';
import { Button } from '@/components/ui/button';
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
  Info
} from 'lucide-react';

// クライアントサイドでのSupabase接続
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ProofData {
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
}

export default function ProofPage({ params }: { params: Promise<{ originalHash: string }> }) {
  const { originalHash } = use(params);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // モーダル状態
  const [showProvenanceModal, setShowProvenanceModal] = useState(false);
  const [showTechnicalModal, setShowTechnicalModal] = useState(false);

  useEffect(() => {
    async function fetchProof() {
      try {
        setLoading(true);
        setError(null);

        // 1. Supabaseから基本情報を取得
        const { data: dbData, error: dbError } = await supabase
          .from('media_proofs')
          .select('*')
          .eq('original_hash', originalHash)
          .single();

        if (dbError) {
          throw new Error('証明データが見つかりません');
        }

        // 2. Arweaveから詳細データを取得
        const gateway = process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY || 'https://gateway.irys.xyz';
        const arweaveResponse = await fetch(`${gateway}/${dbData.arweave_tx_id}`);
        if (!arweaveResponse.ok) {
          throw new Error('Arweaveデータの取得に失敗しました');
        }
        const arweaveData = await arweaveResponse.json();

        // 3. R2からManifest JSONを取得
        let c2paData: C2PASummaryData | null = null;
        try {
          const manifestResponse = await fetch(`/api/proof/${originalHash}/manifest`);
          if (manifestResponse.ok) {
            c2paData = await manifestResponse.json();
          }
        } catch (e) {
          console.warn('Manifest取得失敗:', e);
        }

        // 4. データ整形
        const rootSignerAttr = arweaveData.attributes.find((a: any) => a.trait_type === 'root_signer');
        const createdAtAttr = arweaveData.attributes.find((a: any) => a.trait_type === 'created_at');

        // 簡易的な相互リンク検証（本来はcNFT側のURIも確認すべき）
        const isValid = arweaveData.target_asset_id === dbData.cnft_mint_address;

        setProof({
          originalHash: dbData.original_hash,
          rootSigner: rootSignerAttr?.value || 'Unknown',
          createdAt: createdAtAttr?.value || dbData.created_at,
          arweaveTxId: dbData.arweave_tx_id,
          cnftMintAddress: dbData.cnft_mint_address,
          title: dbData.title,
          description: dbData.description,
          priceLamports: dbData.price_lamports,
          ownerWallet: dbData.owner_wallet,
          isValid,
          c2paData,
        });

      } catch (err) {
        console.error('証明書取得エラー:', err);
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
      } finally {
        setLoading(false);
      }
    }

    if (originalHash) {
      fetchProof();
    }
  }, [originalHash]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-lg text-gray-600 font-medium">証明書を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !proof) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">エラーが発生しました</h2>
          <p className="text-gray-600">{error || 'データが見つかりません'}</p>
          <Button
            onClick={() => window.location.href = '/'}
            className="mt-6 bg-indigo-600 hover:bg-indigo-700"
          >
            ホームに戻る
          </Button>
        </div>
      </div>
    );
  }

  // Explorer URL設定
  const arweaveExplorer = process.env.NEXT_PUBLIC_ARWEAVE_EXPLORER_URL || 'https://viewblock.io/arweave/tx';
  const solanaExplorer = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL || 'https://orb.helius.dev/address';

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-indigo-50/30 to-gray-50">
        {/* ヘッダーバー */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src="/icon_white.png" alt="RootLens" className="w-8 h-8" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900">RootLens Proof</h1>
                  <p className="text-xs text-gray-500 font-mono">#{proof.originalHash.slice(0, 16)}...</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {proof.c2paData?.activeManifest?.isAIGenerated && (
                  <div className="flex items-center bg-purple-100 text-purple-800 px-3 py-1.5 rounded-full text-sm font-medium">
                    <Sparkles className="w-4 h-4 mr-1.5" />
                    AI生成
                  </div>
                )}
                {proof.isValid ? (
                  <div className="flex items-center bg-green-100 text-green-800 px-3 py-1.5 rounded-full text-sm font-medium">
                    <CheckCircle className="w-4 h-4 mr-1.5" />
                    検証済み
                  </div>
                ) : (
                  <div className="flex items-center bg-red-100 text-red-800 px-3 py-1.5 rounded-full text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 mr-1.5" />
                    検証失敗
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* サムネイル＆検証ステータス */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
            <div className="grid md:grid-cols-2 gap-0">
              {/* 左: サムネイル */}
              <div className="relative bg-gray-900 aspect-video md:aspect-auto flex items-center justify-center">
                {proof.c2paData?.thumbnailUrl ? (
                  <img
                    src={proof.c2paData.thumbnailUrl}
                    alt="Content preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-gray-500 text-center p-8">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">プレビューなし</p>
                  </div>
                )}
                {/* 検証バッジ（オーバーレイ） */}
                {proof.isValid && (
                  <div className="absolute top-4 right-4">
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-400 rounded-full blur-xl opacity-30 group-hover:opacity-50 transition-opacity" />
                      <div className="relative rounded-full bg-white p-2 shadow-xl">
                        <CheckCircle className="w-8 h-8 text-green-500" strokeWidth={2.5} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 右: メタ情報 */}
              <div className="p-8 flex flex-col justify-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-3">
                  {proof.title || '無題のコンテンツ'}
                </h2>
                {proof.description && (
                  <p className="text-gray-600 mb-6 leading-relaxed">{proof.description}</p>
                )}

                {/* C2PA情報カード */}
                {proof.c2paData?.activeManifest && (
                  <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-5 mb-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-indigo-100 p-2 mt-0.5">
                        <Shield className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-indigo-900 mb-1 text-sm">C2PA署名情報</p>
                        <p className="text-sm text-indigo-800 leading-relaxed">
                          <strong>{proof.c2paData.activeManifest.claimGeneratorInfo.name}</strong> で作成され、
                          <strong className="ml-1">{proof.c2paData.activeManifest.signatureInfo.issuer || 'Unknown'}</strong> により署名されました。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* アクションボタン */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => setShowProvenanceModal(true)}
                    variant="outline"
                    className="flex-1 min-w-[140px]"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    タイムライン
                  </Button>
                  <Button
                    onClick={() => setShowTechnicalModal(true)}
                    variant="outline"
                    className="flex-1 min-w-[140px]"
                  >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    技術仕様
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* ブロックチェーン証明 */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="rounded-full bg-indigo-100 p-2">
                  <Shield className="w-6 h-6 text-indigo-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">ブロックチェーン証明</h3>
              </div>

              <div className="space-y-6">
                {/* Arweave */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Arweave Transaction</p>
                      <p className="text-sm text-gray-700 font-medium">永久保存データ</p>
                    </div>
                    <a
                      href={`${arweaveExplorer}/${proof.arweaveTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>
                  </div>
                  <p className="font-mono text-xs text-gray-600 break-all bg-white p-3 rounded border border-gray-200">
                    {proof.arweaveTxId}
                  </p>
                </div>

                {/* Solana cNFT */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Solana cNFT</p>
                      <p className="text-sm text-gray-700 font-medium">所有権証明</p>
                    </div>
                    <a
                      href={`${solanaExplorer}/${proof.cnftMintAddress}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>
                  </div>
                  <p className="font-mono text-xs text-gray-600 break-all bg-white p-3 rounded border border-gray-200">
                    {proof.cnftMintAddress}
                  </p>
                </div>

                {/* 所有者 */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-gray-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">現在の所有者</p>
                      <p className="font-mono text-xs text-gray-800 break-all bg-white p-3 rounded border border-gray-200 mt-2">
                        {proof.ownerWallet}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 作成日時 */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-gray-500 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">証明作成日時</p>
                      <p className="text-sm text-gray-800 font-medium mt-2">
                        {new Date(proof.createdAt).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ダウンロード */}
            <div className="bg-white rounded-2xl shadow-lg p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="rounded-full bg-green-100 p-2">
                  <Download className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">元データ</h3>
              </div>

              <div className="space-y-4">
                {/* 価格表示 */}
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-6 text-center border-2 border-indigo-200">
                  <p className="text-sm text-gray-600 mb-2">価格</p>
                  <p className="text-4xl font-bold text-gray-900">
                    {proof.priceLamports > 0 ? (
                      <>
                        {(proof.priceLamports / 1e9).toFixed(3)}
                        <span className="text-lg ml-2 text-gray-600">SOL</span>
                      </>
                    ) : (
                      <span className="text-green-600">無料</span>
                    )}
                  </p>
                </div>

                {/* ダウンロードボタン */}
                <Button
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-6 text-lg font-bold shadow-lg"
                  disabled={true}
                >
                  <Download className="w-5 h-5 mr-2" />
                  {proof.priceLamports > 0 ? '購入してダウンロード' : 'ダウンロード'}
                </Button>

                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-800 leading-relaxed">
                      このファイルはC2PA署名とブロックチェーンにより真正性が保証されています
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* モーダル群 */}
      {proof.c2paData && (
        <>
          {/* タイムラインモーダル */}
          <ProvenanceModal
            isOpen={showProvenanceModal}
            onClose={() => setShowProvenanceModal(false)}
            c2paSummary={proof.c2paData}
            rootSigner={proof.rootSigner}
          />

          {/* 技術仕様モーダル */}
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
          />
        </>
      )}
    </>
  );
}