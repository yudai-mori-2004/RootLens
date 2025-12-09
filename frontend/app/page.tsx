import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* ヘッダー */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            RootLens
          </h1>
          <Link
            href="/upload"
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            アップロード
          </Link>
        </div>
      </header>

      {/* ヒーローセクション */}
      <main className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-20">
          <h2 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            AI時代の「現実」を証明する
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            C2PAハードウェア署名とブロックチェーンで、
            <br />
            本物のメディアの価値を守り、収益化を実現します。
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/upload"
              className="bg-blue-600 text-white px-8 py-4 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-lg text-lg"
            >
              今すぐ始める
            </Link>
            <a
              href="#how-it-works"
              className="bg-white text-blue-600 px-8 py-4 rounded-lg font-bold hover:bg-gray-50 transition-all shadow-lg text-lg border-2 border-blue-600"
            >
              仕組みを知る
            </a>
          </div>
        </div>

        {/* 特徴セクション */}
        <div className="grid md:grid-cols-3 gap-8 mb-20">
          <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100">
            <div className="text-4xl mb-4">🔒</div>
            <h3 className="text-xl font-bold mb-3">ハードウェア署名検証</h3>
            <p className="text-gray-600">
              Sony、Canon、Nikonなどの信頼できるカメラメーカーのC2PA署名を検証し、本物の証明を提供します。
            </p>
          </div>

          <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100">
            <div className="text-4xl mb-4">♾️</div>
            <h3 className="text-xl font-bold mb-3">永久保存</h3>
            <p className="text-gray-600">
              ArweaveとSolana cNFTで証明データを永久保存。RootLensが消えても検証可能です。
            </p>
          </div>

          <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100">
            <div className="text-4xl mb-4">💰</div>
            <h3 className="text-xl font-bold mb-3">直接収益化</h3>
            <p className="text-gray-600">
              Solana Payで撮影者が直接販売。中間マージンなしで本物の価値を収益化できます。
            </p>
          </div>
        </div>

        {/* 使い方セクション */}
        <div id="how-it-works" className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100 mb-20">
          <h3 className="text-3xl font-bold mb-12 text-center">使い方</h3>
          <div className="space-y-8">
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                1
              </div>
              <div>
                <h4 className="text-xl font-bold mb-2">ウォレットを接続</h4>
                <p className="text-gray-600">Solanaウォレットを接続してアカウントを作成します。</p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                2
              </div>
              <div>
                <h4 className="text-xl font-bold mb-2">C2PA署名付きメディアをアップロード</h4>
                <p className="text-gray-600">
                  対応カメラで撮影した写真や動画をアップロード。自動的にハードウェア署名を検証します。
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                3
              </div>
              <div>
                <h4 className="text-xl font-bold mb-2">価格を設定して公開</h4>
                <p className="text-gray-600">
                  販売価格を設定（無料も可能）。cNFTが発行され、証明書ページが公開されます。
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                ✓
              </div>
              <div>
                <h4 className="text-xl font-bold mb-2">収益化完了</h4>
                <p className="text-gray-600">
                  購入者はSolana Payで支払い、元データをダウンロードできます。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTAセクション */}
        <div className="text-center">
          <h3 className="text-3xl font-bold mb-6">今すぐ始めましょう</h3>
          <p className="text-gray-600 mb-8">
            本物のメディアを証明し、その価値を収益化。数分で始められます。
          </p>
          <Link
            href="/upload"
            className="inline-block bg-blue-600 text-white px-10 py-4 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-lg text-lg"
          >
            アップロードを始める →
          </Link>
        </div>
      </main>

      {/* フッター */}
      <footer className="border-t mt-20 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-gray-500 text-sm">
          <p>© 2025 RootLens. AI時代における現実の価値を守る。</p>
        </div>
      </footer>
    </div>
  );
}
