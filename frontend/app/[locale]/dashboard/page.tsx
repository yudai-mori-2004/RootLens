'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Package, EyeOff, Eye, XCircle, ShoppingBag, Download, ArrowRight, Plus, PenTool, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/lib/navigation'; // Changed from 'next/link'
import Header from '@/app/components/Header';
import { Badge } from '@/components/ui/badge';
import LoadingState from '@/app/components/LoadingState';
import EditAssetModal from '@/app/components/EditAssetModal';
import AssetThumbnail from '@/app/components/AssetThumbnail';
import { useTranslations } from 'next-intl';

interface CreatorContent {
  mediaProofId: string;
  originalHash: string;
  cnftMintAddress: string;
  title: string;
  description: string;
  priceLamports: number;
  isPublic: boolean;
  thumbnailUrl?: string;
}

interface PurchasedContent {
  purchaseId: string;
  mediaProofId: string;
  originalHash: string;
  title: string;
  cnftMintAddress: string;
  downloadToken: string;
  purchasedAt: string;
  thumbnailUrl?: string;
}

export default function DashboardPage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets[0];
  const userWalletAddress = solanaWallet?.address;

  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatorContents, setCreatorContents] = useState<CreatorContent[]>([]);
  const [purchasedContents, setPurchasedContents] = useState<PurchasedContent[]>([]);

  // ページネーション用の状態
  const [ownedPage, setOwnedPage] = useState(1);
  const [ownedTotal, setOwnedTotal] = useState(0);
  const [ownedTotalPages, setOwnedTotalPages] = useState(0);
  const [purchasedPage, setPurchasedPage] = useState(1);
  const [purchasedTotal, setPurchasedTotal] = useState(0);
  const [purchasedTotalPages, setPurchasedTotalPages] = useState(0);
  const itemsPerPage = 20;

  // 編集モーダル用の状態
  const [editingContent, setEditingContent] = useState<CreatorContent | null>(null);

  // 認証チェックとコンテンツのフェッチ
  const fetchContents = useCallback(async () => {
    if (!authenticated || !userWalletAddress) {
        if (authenticated && !userWalletAddress) {
            setError(t('walletError'));
        }
        return;
    }

    try {
      setLoading(true);
      setError(null);

      // 並行して両方のデータを取得（ページネーションパラメータ付き）
      const [creatorRes, purchasedRes] = await Promise.all([
          fetch(`/api/creator-content?walletAddress=${userWalletAddress}&page=${ownedPage}&limit=${itemsPerPage}`),
          fetch(`/api/purchased-content?walletAddress=${userWalletAddress}&page=${purchasedPage}&limit=${itemsPerPage}`)
      ]);

      if (!creatorRes.ok) throw new Error(t('error'));
      if (!purchasedRes.ok) throw new Error(t('error'));

      const creatorData = await creatorRes.json();
      const purchasedData = await purchasedRes.json();

      setCreatorContents(creatorData.items || []);
      setOwnedTotal(creatorData.total || 0);
      setOwnedTotalPages(creatorData.totalPages || 0);

      setPurchasedContents(purchasedData.items || []);
      setPurchasedTotal(purchasedData.total || 0);
      setPurchasedTotalPages(purchasedData.totalPages || 0);

    } catch (err) {
      console.error('コンテンツ取得エラー:', err);
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [authenticated, userWalletAddress, ownedPage, purchasedPage, itemsPerPage, t]);

  useEffect(() => {
    if (authenticated && userWalletAddress) {
        fetchContents();
    } else {
        setLoading(false);
    }
  }, [authenticated, userWalletAddress, ownedPage, purchasedPage, fetchContents]);

  const handleTogglePublic = async (mediaProofId: string, currentIsPublic: boolean) => {
    if (!userWalletAddress) {
      setError(t('walletError'));
      return;
    }
    try {
      const response = await fetch('/api/creator-content/toggle-public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaProofId,
          walletAddress: userWalletAddress,
          isPublic: !currentIsPublic,
        }),
      });

      if (!response.ok) {
        throw new Error('公開設定の切り替えに失敗しました。');
      }

      const result = await response.json();
      if (result.success) {
        setCreatorContents((prevContents) =>
          prevContents.map((content) =>
            content.mediaProofId === mediaProofId
              ? { ...content, isPublic: !currentIsPublic }
              : content
          )
        );
      } else {
        throw new Error(result.error || '公開設定の切り替えに失敗しました。');
      }
    } catch (err) {
      console.error('公開設定切り替えエラー:', err);
      alert(err instanceof Error ? err.message : '公開設定の切り替え中にエラーが発生しました。');
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <Card className="w-full max-w-md text-center p-8">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Shield className="w-8 h-8 text-indigo-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('connectTitle')}</h2>
            <p className="text-gray-600 mb-8">
              {t('connectDesc')}
            </p>
            <Button onClick={login} className="w-full bg-indigo-600 hover:bg-indigo-700">
              {t('connectButton')}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <LoadingState 
          message={t('loading')}
          subMessage={t('loadingDesc')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-500 mt-1">{t('subtitle')}</p>
          </div>
          <Button asChild className="bg-indigo-600 hover:bg-indigo-700 shadow-sm">
            <Link href="/upload" className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {t('create')}
            </Link>
          </Button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        <Tabs defaultValue="owned" className="space-y-8">
          <TabsList className="bg-slate-100 p-1 rounded-xl border border-slate-200 w-full max-w-md mx-auto md:mx-0">
            <TabsTrigger
              value="owned"
              className="flex-1 rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm transition-all text-slate-500 hover:text-slate-700"
            >
              {t('ownedTab')} ({ownedTotal})
            </TabsTrigger>
            <TabsTrigger
              value="purchased"
              className="flex-1 rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm transition-all text-slate-500 hover:text-slate-700"
            >
              {t('purchasedTab')} ({purchasedTotal})
            </TabsTrigger>
          </TabsList>

          {/* 所有するコンテンツタブ */}
          <TabsContent value="owned" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {creatorContents.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                  <Package className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{t('noAssetsTitle')}</h3>
                <p className="text-slate-500 mb-8 max-w-sm mx-auto text-sm leading-relaxed whitespace-pre-line">
                  {t('noAssetsDesc')}
                </p>
                <Button asChild variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-8">
                  <Link href="/upload">
                    {t('startCreate')}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {creatorContents.map((content) => (
                  <Card key={content.mediaProofId} className="overflow-hidden hover:shadow-md transition-all duration-300 border-slate-200 group bg-white rounded-xl p-0 gap-0">
                    <div className="relative aspect-video bg-slate-100 overflow-hidden border-b border-slate-100">
                      <AssetThumbnail
                        src={content.thumbnailUrl}
                        alt={content.title || t('untitled')}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute top-2 right-2">
                        <Badge 
                          variant={content.isPublic ? "default" : "secondary"}
                          className={`backdrop-blur-md shadow-sm border-0 ${content.isPublic ? 'bg-green-500/90 hover:bg-green-600' : 'bg-slate-500/90 hover:bg-slate-600 text-white'}`}
                        >
                          {content.isPublic ? t('public') : t('private')}
                        </Badge>
                      </div>
                    </div>
                    
                    <CardHeader className="p-3 pb-2 space-y-1 relative">
                      <div className="flex justify-between items-start">
                        <CardTitle className="truncate text-sm font-bold text-slate-900 pr-6">
                          {content.title || t('untitled')}
                        </CardTitle>
                        <button 
                          onClick={() => setEditingContent(content)}
                          className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-full hover:bg-indigo-50 absolute top-2 right-2"
                        >
                          <PenTool className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {content.description && (
                        <CardDescription className="text-xs text-slate-500 line-clamp-3 leading-tight break-all">
                          {content.description}
                        </CardDescription>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-100 gap-2">
                        <div className="flex items-center gap-1 min-w-0 flex-1 truncate">
                          <Shield className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{content.cnftMintAddress.slice(0, 4)}...{content.cnftMintAddress.slice(-4)}</span>
                        </div>
                        <span className="font-bold text-indigo-600 flex-shrink-0 text-[10px]">
                          {content.priceLamports === 0 ? t('free') : `${(content.priceLamports / 1e9).toFixed(2)} SOL`}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-3 pt-0">
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" asChild className="w-full text-xs h-8 border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50">
                          <Link href={`/asset/${content.originalHash}`}>
                            {t('details')}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`w-full text-[11px] h-8 border px-1 ${content.isPublic ? 'text-slate-500 hover:text-slate-700 bg-slate-50 border-slate-200' : 'text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 border-green-200'}`}
                          onClick={() => handleTogglePublic(content.mediaProofId, content.isPublic)}
                        >
                          {content.isPublic ? (
                            <>
                              <EyeOff className="w-3 h-3 mr-0.5" /> <span className="hidden sm:inline">{t('private')}</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3 mr-0.5" /> <span className="hidden sm:inline">{t('public')}</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* ページネーション */}
            {ownedTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOwnedPage(p => Math.max(1, p - 1))}
                  disabled={ownedPage === 1}
                  className="border-slate-200"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="flex items-center gap-1">
                  {(() => {
                    const maxButtons = 7;
                    const pages = [];
                    let startPage = Math.max(1, ownedPage - Math.floor(maxButtons / 2));
                    const endPage = Math.min(ownedTotalPages, startPage + maxButtons - 1);

                    if (endPage - startPage < maxButtons - 1) {
                      startPage = Math.max(1, endPage - maxButtons + 1);
                    }

                    for (let i = startPage; i <= endPage; i++) {
                      pages.push(
                        <Button
                          key={i}
                          variant={i === ownedPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setOwnedPage(i)}
                          className={i === ownedPage ? "bg-indigo-600 hover:bg-indigo-700" : "border-slate-200"}
                        >
                          {i}
                        </Button>
                      );
                    }
                    return pages;
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOwnedPage(p => Math.min(ownedTotalPages, p + 1))}
                  disabled={ownedPage === ownedTotalPages}
                  className="border-slate-200"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </TabsContent>

          {/* 購入したコンテンツタブ */}
          <TabsContent value="purchased" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {purchasedContents.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                  <ShoppingBag className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{t('noPurchasesTitle')}</h3>
                <p className="text-slate-500 mb-8 max-w-sm mx-auto text-sm leading-relaxed whitespace-pre-line">
                  {t('noPurchasesDesc')}
                </p>
                <Button asChild variant="outline" className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-full px-8">
                  <Link href="/lens">
                    {t('findContent')}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {purchasedContents.map((content) => (
                  <Card key={content.purchaseId} className="overflow-hidden hover:shadow-md transition-all duration-300 border-slate-200 group bg-white rounded-xl p-0 gap-0">
                    <div className="relative aspect-video bg-slate-100 overflow-hidden border-b border-slate-100">
                      <AssetThumbnail
                        src={content.thumbnailUrl}
                        alt={content.title || t('untitled')}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
                    </div>
                    
                    <CardHeader className="p-3 pb-2 space-y-1">
                      <CardTitle className="truncate text-sm font-bold text-slate-900">
                        {content.title || t('untitled')}
                      </CardTitle>
                      {/* 購入済みアイテムには説明と価格は表示しない */}
                      <CardDescription className="text-xs text-slate-500 mt-1">
                        {t('purchaseDate', { date: new Date(content.purchasedAt).toLocaleDateString() })}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="p-3 pt-0">
                      <div className="flex flex-col gap-2">
                        <Button size="sm" className="w-full h-8 text-xs bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all" onClick={() => window.open(`/api/download/${content.downloadToken}`, '_blank')}>
                          <Download className="w-3 h-3 mr-1.5" />
                          {t('download')}
                        </Button>
                        <Button variant="ghost" size="sm" asChild className="w-full h-8 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                          <Link href={`/asset/${content.originalHash}`} className="flex items-center justify-center">
                            {t('viewPage')} <ArrowRight className="w-3 h-3 ml-1" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* ページネーション */}
            {purchasedTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPurchasedPage(p => Math.max(1, p - 1))}
                  disabled={purchasedPage === 1}
                  className="border-slate-200"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="flex items-center gap-1">
                  {(() => {
                    const maxButtons = 7;
                    const pages = [];
                    let startPage = Math.max(1, purchasedPage - Math.floor(maxButtons / 2));
                    const endPage = Math.min(purchasedTotalPages, startPage + maxButtons - 1);

                    if (endPage - startPage < maxButtons - 1) {
                      startPage = Math.max(1, endPage - maxButtons + 1);
                    }

                    for (let i = startPage; i <= endPage; i++) {
                      pages.push(
                        <Button
                          key={i}
                          variant={i === purchasedPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPurchasedPage(i)}
                          className={i === purchasedPage ? "bg-indigo-600 hover:bg-indigo-700" : "border-slate-200"}
                        >
                          {i}
                        </Button>
                      );
                    }
                    return pages;
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPurchasedPage(p => Math.min(purchasedTotalPages, p + 1))}
                  disabled={purchasedPage === purchasedTotalPages}
                  className="border-slate-200"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* 編集モーダル */}
        {editingContent && userWalletAddress && (
          <EditAssetModal
            isOpen={!!editingContent}
            onClose={() => setEditingContent(null)}
            onSuccess={() => {
              setEditingContent(null);
              fetchContents(); // リストを再取得
            }}
            mediaProofId={editingContent.mediaProofId}
            currentTitle={editingContent.title}
            currentDescription={editingContent.description}
            currentPriceLamports={editingContent.priceLamports}
            walletAddress={userWalletAddress}
          />
        )}
      </main>
    </div>
  );
}