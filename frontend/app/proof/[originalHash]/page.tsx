'use client';

import { useEffect, useState, use } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createManifestSummary, C2PASummaryData } from '@/app/lib/c2pa-parser';
import ProvenanceTimeline from '@/app/components/ProvenanceTimeline';

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl text-gray-600">証明書を読み込み中...</div>
      </div>
    );
  }

  if (error || !proof) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl text-red-600">エラー: {error || 'データが見つかりません'}</div>
      </div>
    );
  }

  // Explorer URL設定
  const arweaveExplorer = process.env.NEXT_PUBLIC_ARWEAVE_EXPLORER_URL || 'https://viewblock.io/arweave/tx';
  const solanaExplorer = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL || 'https://orb.helius.dev/address';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-blue-900 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1">RootLens Proof</h1>
              <p className="text-blue-200 text-sm font-mono">#{proof.originalHash.slice(0, 8)}</p>
            </div>
            <div className="flex gap-2">
              {proof.c2paData?.activeManifest?.isAIGenerated && (
                 <div className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-full font-bold">
                   <span className="mr-2">🤖</span> AI生成
                 </div>
              )}
              {proof.isValid ? (
                <div className="flex items-center bg-green-500 text-white px-4 py-2 rounded-full font-bold">
                  <span className="mr-2">✓</span> 検証済み
                </div>
              ) : (
                <div className="flex items-center bg-red-500 text-white px-4 py-2 rounded-full font-bold">
                  <span className="mr-2">!</span> 検証失敗
                </div>
              )}
            </div>
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="p-8">
          {/* サムネイルとタイトル */}
          <div className="flex flex-col md:flex-row gap-8 mb-8">
            {proof.c2paData?.thumbnailUrl ? (
                <div className="w-full md:w-1/3 flex-shrink-0">
                    <img 
                        src={proof.c2paData.thumbnailUrl} 
                        alt="Content Thumbnail" 
                        className="w-full h-auto rounded-lg shadow-md border border-gray-200"
                    />
                </div>
            ) : (
                <div className="w-full md:w-1/3 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center h-48 md:h-auto text-gray-400">
                    No Thumbnail
                </div>
            )}
            
            <div className="flex-1">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  {proof.title || '無題のドキュメント'}
                </h2>
                {proof.description && (
                  <p className="text-gray-600 mb-4">{proof.description}</p>
                )}
                
                {proof.c2paData?.activeManifest && (
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <p className="text-sm text-blue-800 font-bold mb-1">C2PA署名情報</p>
                        <p className="text-sm text-gray-700">
                            このコンテンツは <strong>{proof.c2paData.activeManifest.claimGenerator.name}</strong> によって生成され、
                            <strong>{proof.c2paData.activeManifest.signatureInfo.issuer || 'Unknown'}</strong> によって署名されました。
                        </p>
                    </div>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 左カラム: 統合タイムライン */}
            <div>
              {proof.c2paData ? (
                <ProvenanceTimeline
                  c2paSummary={proof.c2paData}
                  rootSigner={proof.rootSigner}
                />
              ) : (
                <div className="text-gray-500 text-sm">
                  来歴情報を読み込めませんでした
                </div>
              )}
            </div>

            {/* 右カラム: ブロックチェーン情報 */}
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                ブロックチェーン証明
              </h3>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm text-gray-500">Arweave Transaction</dt>
                  <dd className="font-mono text-xs text-blue-600 break-all mt-1">
                    <a 
                      href={`${arweaveExplorer}/${proof.arweaveTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {proof.arweaveTxId}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">cNFT Asset ID</dt>
                  <dd className="font-mono text-xs text-blue-600 break-all mt-1">
                    <a
                      href={`${solanaExplorer}/${proof.cnftMintAddress}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {proof.cnftMintAddress}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">現在の所有者</dt>
                  <dd className="font-mono text-xs text-gray-900 break-all mt-1">
                    {proof.ownerWallet}
                  </dd>
                </div>
              </dl>

              {/* 購入アクション（プレースホルダー） */}
              <div className="mt-8 bg-gray-50 rounded-xl p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">元データをダウンロード</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {proof.priceLamports > 0 
                        ? `${proof.priceLamports / 1e9} SOL` 
                        : '無料'}
                    </p>
                  </div>
                </div>
                <button 
                  className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={true} // まだ実装していないため
                >
                  {proof.priceLamports > 0 ? '購入してダウンロード' : 'ダウンロード'}
                </button>
                <p className="text-xs text-gray-500 mt-3 text-center">
                  ※ このファイルはC2PA署名とブロックチェーンにより真正性が保証されています
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}