import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* ヘッダー */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image
              src="/icon_white.png"
              alt="RootLens Logo"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              RootLens
            </h1>
            <Badge variant="secondary" className="hidden md:inline-flex">
              Ver4
            </Badge>
          </Link>
          <Button asChild>
            <Link href="/upload">アップロード</Link>
          </Button>
        </div>
      </header>

      {/* ヒーローセクション */}
      <main className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-20">
          <div className="flex justify-center mb-6">
            <Image
              src="/icon_white.png"
              alt="RootLens"
              width={120}
              height={120}
              className="rounded-2xl shadow-lg"
              priority
            />
          </div>
          <Badge variant="outline" className="mb-4">
            AI時代における現実の価値を再定義
          </Badge>
          <h2 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            AI時代の「現実」を証明する
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            C2PAハードウェア署名とブロックチェーンで、
            <br />
            本物のメディアの価値を守り、収益化を実現します。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-lg">
              <Link href="/upload">今すぐ始める</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-lg">
              <a href="#how-it-works">仕組みを知る</a>
            </Button>
          </div>

          {/* 統計情報 */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mt-12">
            <div className="bg-white/50 backdrop-blur rounded-lg p-4 border border-gray-200">
              <div className="text-3xl font-bold text-blue-600">∞</div>
              <div className="text-sm text-gray-600 mt-1">永久保存</div>
            </div>
            <div className="bg-white/50 backdrop-blur rounded-lg p-4 border border-gray-200">
              <div className="text-3xl font-bold text-blue-600">7+</div>
              <div className="text-sm text-gray-600 mt-1">信頼済みCA</div>
            </div>
            <div className="bg-white/50 backdrop-blur rounded-lg p-4 border border-gray-200">
              <div className="text-3xl font-bold text-blue-600">0%</div>
              <div className="text-sm text-gray-600 mt-1">手数料</div>
            </div>
          </div>
        </div>

        {/* 特徴セクション */}
        <div className="mb-20">
          <h3 className="text-3xl font-bold mb-8 text-center">なぜRootLensなのか</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <div className="text-4xl mb-2">🔒</div>
                <CardTitle>ハードウェア署名検証</CardTitle>
                <CardDescription>
                  撮影デバイスから暗号学的に証明
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  Sony、Canon、Nikonなどの信頼できるカメラメーカーのC2PA署名を検証。
                  ハードウェアレベルで本物を証明します。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="text-4xl mb-2">♾️</div>
                <CardTitle>永久保存</CardTitle>
                <CardDescription>
                  Arweave + Solana cNFT
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  証明データをArweaveに永久保存。所有権をcNFTで管理。
                  RootLensが消えても検証可能なトラストレス設計。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="text-4xl mb-2">💰</div>
                <CardTitle>直接収益化</CardTitle>
                <CardDescription>
                  Solana Pay統合
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  撮影者が直接販売価格を設定。中間マージンなしで、
                  本物のメディアの価値を最大限に収益化できます。
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Separator className="my-16" />

        {/* 技術スタック */}
        <div className="mb-20">
          <h3 className="text-3xl font-bold mb-8 text-center">技術スタック</h3>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4">
                  <div className="text-2xl mb-2">📜</div>
                  <div className="font-semibold text-sm">C2PA</div>
                  <div className="text-xs text-gray-500">コンテンツ認証</div>
                </div>
                <div className="text-center p-4">
                  <div className="text-2xl mb-2">🌐</div>
                  <div className="font-semibold text-sm">Arweave</div>
                  <div className="text-xs text-gray-500">永久保存</div>
                </div>
                <div className="text-center p-4">
                  <div className="text-2xl mb-2">⛓️</div>
                  <div className="font-semibold text-sm">Solana cNFT</div>
                  <div className="text-xs text-gray-500">所有権管理</div>
                </div>
                <div className="text-center p-4">
                  <div className="text-2xl mb-2">💳</div>
                  <div className="font-semibold text-sm">Solana Pay</div>
                  <div className="text-xs text-gray-500">決済</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator className="my-16" />

        {/* 使い方セクション */}
        <div id="how-it-works" className="mb-20">
          <h3 className="text-3xl font-bold mb-8 text-center">使い方</h3>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    1
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold mb-2">ウォレットを接続</h4>
                    <p className="text-gray-600 text-sm">
                      Solanaウォレットを接続してアカウントを作成します。
                      Privyで簡単にログイン可能です。
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    2
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold mb-2">メディアをアップロード</h4>
                    <p className="text-gray-600 text-sm">
                      C2PA対応カメラで撮影した写真や動画をアップロード。
                      自動的にハードウェア署名を検証します。
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">Sony</Badge>
                      <Badge variant="secondary">Canon</Badge>
                      <Badge variant="secondary">Nikon</Badge>
                      <Badge variant="secondary">Leica</Badge>
                      <Badge variant="secondary">Google</Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    3
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold mb-2">検証とプライバシー確認</h4>
                    <p className="text-gray-600 text-sm">
                      C2PA署名の検証結果を確認。
                      公開される情報（GPS、撮影日時など）を確認して同意します。
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    4
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold mb-2">価格を設定して公開</h4>
                    <p className="text-gray-600 text-sm">
                      販売価格を設定（無料も可能）。
                      cNFTが発行され、証明書ページが公開されます。
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    ✓
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold mb-2 text-green-700">収益化完了</h4>
                    <p className="text-gray-600 text-sm">
                      購入者はSolana Payで支払い、元データをダウンロードできます。
                      あなたには中間マージンなしで収益が入ります。
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ユースケース */}
        <div className="mb-20">
          <h3 className="text-3xl font-bold mb-8 text-center">こんな方におすすめ</h3>
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>📸</span>
                  <span>フォトグラファー</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  撮影した写真の真正性を証明し、報道機関やメディアに直接販売。
                  作品の価値を最大化できます。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>📰</span>
                  <span>ジャーナリスト</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  現地で撮影した証拠写真の信頼性を担保。
                  フェイク情報と差別化できます。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🎬</span>
                  <span>クリエイター</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  オリジナル作品の所有権と来歴を証明。
                  AI生成コンテンツと明確に区別できます。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🏢</span>
                  <span>報道機関</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  信頼できるソースから証明付きメディアを購入。
                  フェイクニュース対策に。
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Separator className="my-16" />

        {/* CTAセクション */}
        <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200">
          <CardContent className="pt-12 pb-12 text-center">
            <h3 className="text-3xl font-bold mb-4">今すぐ始めましょう</h3>
            <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
              本物のメディアを証明し、その価値を収益化。
              <br />
              数分で始められます。手数料は0%。
            </p>
            <Button asChild size="lg" className="text-lg px-10">
              <Link href="/upload">アップロードを始める →</Link>
            </Button>
          </CardContent>
        </Card>
      </main>

      {/* フッター */}
      <footer className="border-t mt-20 py-8 bg-white/50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/icon_white.png"
                alt="RootLens Logo"
                width={32}
                height={32}
                className="rounded-lg"
              />
              <div className="text-center md:text-left">
                <p className="font-bold text-lg bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  RootLens
                </p>
                <p className="text-sm text-gray-500">AI時代における現実の価値を守る</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-gray-500">
              <a href="#" className="hover:text-blue-600 transition-colors">
                ドキュメント
              </a>
              <a href="#" className="hover:text-blue-600 transition-colors">
                GitHub
              </a>
              <a href="#" className="hover:text-blue-600 transition-colors">
                お問い合わせ
              </a>
            </div>
          </div>
          <Separator className="my-4" />
          <p className="text-center text-gray-400 text-xs">
            © 2025 RootLens. Built with C2PA, Arweave, and Solana.
          </p>
        </div>
      </footer>
    </div>
  );
}
