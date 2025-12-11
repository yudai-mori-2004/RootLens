'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ExternalLink, Shield, Package, EyeOff, Eye, XCircle, ShoppingBag, Download } from 'lucide-react';
import Link from 'next/link';

interface CreatorContent {
  mediaProofId: string;
  originalHash: string;
  cnftMintAddress: string;
  title: string;
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [creatorContents, setCreatorContents] = useState<CreatorContent[]>([]);
  const [purchasedContents, setPurchasedContents] = useState<PurchasedContent[]>([]);

  // 認証チェックとコンテンツのフェッチ
  useEffect(() => {
    async function fetchContents() {
      if (!authenticated || !userWalletAddress) {
        setLoading(false);
        if (authenticated && !userWalletAddress) {
            setError('ウォレットが接続されていません。');
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // 並行して両方のデータを取得
        const [creatorRes, purchasedRes] = await Promise.all([
            fetch(`/api/creator-content?walletAddress=${userWalletAddress}`),
            fetch(`/api/purchased-content?walletAddress=${userWalletAddress}`)
        ]);

        if (!creatorRes.ok) throw new Error('所有コンテンツの取得に失敗しました。');
        if (!purchasedRes.ok) throw new Error('購入コンテンツの取得に失敗しました。');

        const creatorData: CreatorContent[] = await creatorRes.json();
        const purchasedData: PurchasedContent[] = await purchasedRes.json();

        setCreatorContents(creatorData);
        setPurchasedContents(purchasedData);

      } catch (err) {
        console.error('コンテンツ取得エラー:', err);
        setError(err instanceof Error ? err.message : 'コンテンツの読み込み中にエラーが発生しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchContents();
  }, [authenticated, userWalletAddress]);

  const handleTogglePublic = async (mediaProofId: string, currentIsPublic: boolean) => {
    if (!userWalletAddress) {
      setError('ウォレットが接続されていません。');
      return;
    }
    setLoading(true); // ボタンを押したときのローディング
    try {
      const response = await fetch('/api/creator-content/toggle-public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaProofId,
          walletAddress: userWalletAddress,
          isPublic: !currentIsPublic, // 現在のisPublicの逆を設定
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
      setError(err instanceof Error ? err.message : '公開設定の切り替え中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    // 認証が完了するまで何も表示しないか、ローディング表示
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center space-y-4">
          <Loader2 className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-lg text-gray-600 font-medium">認証中...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center space-y-4">
          <Loader2 className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-lg text-gray-600 font-medium">コンテンツを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">エラーが発生しました</h2>
          <p className="text-gray-600">{error}</p>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-indigo-50/30 to-gray-50">
      {/* ヘッダーバー (ProofPageのものを簡略化) */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/icon_white.png" alt="RootLens" className="w-8 h-8" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">マイページ</h1>
                <p className="text-xs text-gray-500 font-mono">{userWalletAddress?.slice(0, 8)}...{userWalletAddress?.slice(-8)}</p>
              </div>
            </div>
            {/* ここにログアウトボタンなどを配置可能 */}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="owned" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                <TabsTrigger value="owned">所有するコンテンツ</TabsTrigger>
                <TabsTrigger value="purchased">購入したコンテンツ</TabsTrigger>
            </TabsList>

            {/* 所有するコンテンツタブ */}
            <TabsContent value="owned" className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">あなたが所有するコンテンツ</h2>
                    <Button className="bg-indigo-600 hover:bg-indigo-700">
                        <Link href="/upload">新規アップロード</Link>
                    </Button>
                </div>

                {creatorContents.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                    <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-900 mb-2">管理できるコンテンツがありません</h3>
                    <p className="text-gray-600">あなたが作成・所有するコンテンツはまだありません。</p>
                </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {creatorContents.map((content) => (
                    <Card key={content.mediaProofId}>
                        <CardHeader>
                        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3">
                            {content.thumbnailUrl ? (
                            <img src={content.thumbnailUrl} alt={content.title} className="w-full h-full object-cover" />
                            ) : (
                            <div className="flex items-center justify-center w-full h-full text-gray-400">
                                <FileText className="w-10 h-10" />
                            </div>
                            )}
                            <div className="absolute top-2 right-2">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${content.isPublic ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                    {content.isPublic ? '公開中' : '非公開'}
                                </span>
                            </div>
                        </div>
                        <CardTitle className="truncate">{content.title || '無題のコンテンツ'}</CardTitle>
                        <CardDescription className="font-mono text-xs">{content.cnftMintAddress.slice(0, 8)}...{content.cnftMintAddress.slice(-8)}</CardDescription>
                        </CardHeader>
                        <CardContent>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" asChild className="flex-1">
                            <Link href={`/proof/${content.originalHash}`}>
                                詳細 <ExternalLink className="w-3 h-3 ml-1" />
                            </Link>
                            </Button>
                            <Button variant="outline" size="sm" className="flex-1"
                                onClick={() => handleTogglePublic(content.mediaProofId, content.isPublic)}
                                disabled={loading} // ローディング中はボタンを無効化
                            >
                                {content.isPublic ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                                {content.isPublic ? '非公開' : '公開'}
                            </Button>
                        </div>
                        </CardContent>
                    </Card>
                    ))}
                </div>
                )}
            </TabsContent>

            {/* 購入したコンテンツタブ */}
            <TabsContent value="purchased" className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">購入したコンテンツ</h2>

                {purchasedContents.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                    <ShoppingBag className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-900 mb-2">購入履歴がありません</h3>
                    <p className="text-gray-600">まだコンテンツを購入していません。</p>
                </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {purchasedContents.map((content) => (
                    <Card key={content.purchaseId}>
                        <CardHeader>
                        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3">
                            {content.thumbnailUrl ? (
                            <img src={content.thumbnailUrl} alt={content.title} className="w-full h-full object-cover" />
                            ) : (
                            <div className="flex items-center justify-center w-full h-full text-gray-400">
                                <FileText className="w-10 h-10" />
                            </div>
                            )}
                        </div>
                        <CardTitle className="truncate">{content.title || '無題のコンテンツ'}</CardTitle>
                        <CardDescription className="text-xs text-gray-500">
                            購入日: {new Date(content.purchasedAt).toLocaleDateString('ja-JP')}
                        </CardDescription>
                        </CardHeader>
                        <CardContent>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" asChild className="flex-1">
                            <Link href={`/proof/${content.originalHash}`}>
                                詳細 <ExternalLink className="w-3 h-3 ml-1" />
                            </Link>
                            </Button>
                            <Button 
                                size="sm" 
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                                onClick={() => window.open(`/api/download/${content.downloadToken}`, '_blank')}
                            >
                                <Download className="w-3 h-3 mr-1" />
                                再DL
                            </Button>
                        </div>
                        </CardContent>
                    </Card>
                    ))}
                </div>
                )}
            </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
