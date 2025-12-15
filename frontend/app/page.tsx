import Link from 'next/link';
import Image from 'next/image';
import Header from '@/app/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Check, X, Shield, Coins, Search, Camera, Lock, ArrowRight, ExternalLink, X as XIcon } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-slate-900 font-sans">
      <Header isLandingPage={true} />

      <main>
        {/* ヒーローセクション */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/50 via-transparent to-transparent opacity-70"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 border-blue-100">
              Proof of Reality, Ownership on Chain.
            </Badge>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 mb-8 max-w-5xl mx-auto leading-tight">
              <span className="inline-block">「本物」を、</span>
              <span className="inline-block">あなたの<span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">『デジタル資産』</span>に。</span>
            </h1>
            <p className="text-xl text-slate-600 mb-10 max-w-3xl mx-auto leading-relaxed">
              <span className="inline-block">AI生成コンテンツが氾濫する時代。</span>
              <span className="inline-block">C2PAハードウェア署名で「現実」を証明し、</span>
              <span className="inline-block">ブロックチェーンで唯一無二の</span>
              <span className="inline-block">「デジタル所有権」と「流動性」を確立する、</span>
              <span className="inline-block">次世代のマーケットプレイス。</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button asChild size="lg" className="h-14 px-8 text-lg rounded-full shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all">
                <Link href="/upload">
                  <Camera className="w-5 h-5 mr-2" />
                  証明付きでアップロード
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full border-2 hover:bg-slate-50">
                <Link href="/lens">
                  <Search className="w-5 h-5 mr-2" />
                  コンテンツを検索
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Why Now: AI時代の信頼の危機 */}
        <section id="why" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl font-bold mb-6 text-slate-900">
                  AI時代の「信頼の危機」と<br />
                  失われつつある「現実の価値」
                </h2>
                <div className="space-y-6 text-lg text-slate-600">
                  <p>
                    2024年、生成AIの爆発的な普及により、誰もが数秒で「本物そっくり」の画像を作れるようになりました。
                    しかし、それは同時に「目の前の画像が現実なのか、AIなのか区別できない」という深刻な問題を引き起こしています。
                  </p>
                  <p className="font-medium text-slate-800 border-l-4 border-blue-500 pl-4">
                    皮肉なことに、今最も価値が高まっているのは「本当にカメラで撮影された、加工されていない現実」です。
                  </p>
                  <p>
                    RootLensは、C2PA対応カメラのハードウェア署名とブロックチェーンを組み合わせ、
                    この「現実の価値」を正当に評価し、収益化する仕組みを提供します。
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-tr from-blue-100 to-purple-100 rounded-2xl opacity-50 blur-xl"></div>
                <div className="relative bg-slate-50 rounded-2xl p-8 border border-slate-200 shadow-sm">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                        <X className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">AI生成画像</div>
                        <div className="text-sm text-slate-500">誰でも作成可能・無限に複製</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-blue-100 ring-2 ring-blue-500/20">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                        <Check className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">ハードウェア撮影画像 (RootLens)</div>
                        <div className="text-sm text-slate-500">
                          <span className="font-medium text-blue-600">証明可能</span>な唯一無二の現実
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Technology: C2PA x Blockchain */}
        <section id="technology" className="py-24 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <Badge variant="outline" className="mb-4">Technology</Badge>
              <h2 className="text-3xl font-bold text-slate-900">2つの技術の融合</h2>
              <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
                真正性の証明は「C2PA」で、権利の管理と流動性は「ブロックチェーン」で。<br />
                それぞれの得意分野を組み合わせることで、完全な信頼基盤を構築します。
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-16">
              <Card className="border-blue-200 bg-blue-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-700">
                    <Shield className="w-6 h-6" />
                    C2PA (Content Provenance)
                  </CardTitle>
                  <CardDescription>ハードウェアによる「真正性」の証明</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">カメラ内でのデジタル署名埋め込み</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">改ざんの検知と履歴の追跡</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">数学的な「撮影証明」</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-purple-200 bg-purple-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-purple-700">
                    <Coins className="w-6 h-6" />
                    Blockchain (Solana + Arweave)
                  </CardTitle>
                  <CardDescription>権利の「所有」と「流動化」</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">所有権の明確化（ウォレット紐付け）</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">NFTとしての自由な売買・譲渡</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">相互リンクによる乗っ取り防止</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Web2 vs Web3 Comparison */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="p-8 border-b bg-slate-50/50">
                <h3 className="text-xl font-bold text-center">なぜWeb3なのか？ - Web2的アプローチとの比較</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-sm">
                      <th className="p-4 font-medium border-b">機能・課題</th>
                      <th className="p-4 font-medium border-b">Web2 (従来型)</th>
                      <th className="p-4 font-medium border-b bg-blue-50/50 text-blue-700">RootLens (Web3)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="p-4 font-medium text-slate-900">真正性証明・改ざん検出</td>
                      <td className="p-4 text-slate-600">C2PAで可能 ✓</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">C2PAで可能 ✓</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">所有権の記録</td>
                      <td className="p-4 text-slate-600">DBに記録 (プラットフォーム依存)</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">ウォレットに紐付け (自律分散的)</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">証明付き画像の流出時</td>
                      <td className="p-4 text-slate-600 text-red-500">権利者の特定が困難</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">ウォレットで権利者を特定可能</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">権利の売買・流動性</td>
                      <td className="p-4 text-slate-600 text-red-500">困難 (プラットフォーム内限定)</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">NFTとして自由に流通</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">乗っ取り防止</td>
                      <td className="p-4 text-slate-600">困難</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">相互リンクで完全防止</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3 Core Values */}
        <section id="values" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center mb-16 text-slate-900">RootLensが提供する3つの価値</h2>
            <div className="grid md:grid-cols-3 gap-10">
              <div className="space-y-4">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mb-4">
                  <Camera className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">1. ハードウェア証明の<br />マーケットプレイス</h3>
                <p className="text-slate-600 leading-relaxed">
                  「本当にそこにいた人が撮った」こと自体に価値を見出し、対価を支払える初めての場所です。
                  報道、AI学習データ、法務証拠など、信頼性が不可欠な領域に。
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mb-4">
                  <Lock className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">2. 所有権の可視化と<br />流動化</h3>
                <p className="text-slate-600 leading-relaxed">
                  デジタルデータの所有権をウォレットに紐付けることで、権利の所在を明確化。
                  さらにNFT化することで、証明付きコンテンツを資産として売買可能にします。
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center text-purple-600 mb-4">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">3. 信頼の検索エンジン<br />(Lens機能)</h3>
                <p className="text-slate-600 leading-relaxed">
                  「この画像は証明付きの本物か？」を即座に検証。
                  単なる画像検索ではなく、信頼性を確認するためのツールとして機能します。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Target Users */}
        <section className="py-24 bg-slate-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-16">
              <div>
                <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <span className="text-blue-400">For Creator</span>
                  <span>(供給側)</span>
                </h3>
                <ul className="space-y-6">
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">フォトジャーナリスト</h4>
                      <p className="text-slate-400 text-sm">証明付きコンテンツをマーケットプレイスで適正価格で販売。フェイクとの差別化。</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">プロフォトグラファー</h4>
                      <p className="text-slate-400 text-sm">ストックフォトの高い手数料を回避。Solana Payによる直接取引で収益最大化。</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">市民ジャーナリスト</h4>
                      <p className="text-slate-400 text-sm">匿名性を保ちながら、ウォレットベースで権利を保持・主張可能。</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <span className="text-purple-400">For Consumer</span>
                  <span>(需要側)</span>
                </h3>
                <ul className="space-y-6">
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">報道機関・メディア</h4>
                      <p className="text-slate-400 text-sm">フェイクニュース対策として、ハードウェア署名付きの信頼できる素材を調達。</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">AI企業</h4>
                      <p className="text-slate-400 text-sm">著作権と出自が明確な「クリーンな学習データ」として購入。</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">法務・保険業界</h4>
                      <p className="text-slate-400 text-sm">改ざんされていないことが数学的に証明された、確実な証拠画像として。</p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-24 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center mb-12 text-slate-900">よくある質問</h2>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>C2PA対応カメラを持っていない人は使えないのですか？</AccordionTrigger>
                <AccordionContent>
                  現在、Sony α7シリーズ、Google Pixel（特定モデル）、Nikon Z9、Leicaなどが対応しており、対応機種は急速に増加中です。
                  また、スマートフォンへの搭載も進んでおり、将来的にはより多くのデバイスで利用可能になる見込みです。
                  現時点では、これらの対応デバイスで撮影された画像のみが「ハードウェア証明」の対象となります。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>従来のストックフォトサイトとの違いは何ですか？</AccordionTrigger>
                <AccordionContent>
                  最大の違いは「所有権の扱い」です。Web2的なサービスではデータベース上の記録に過ぎませんが、
                  RootLensではブロックチェーン（NFT）を用いて所有権をユーザーのウォレットに紐付けます。
                  これにより、権利の自由な売買、譲渡が可能になり、万が一の流出時にも真の所有者を特定できます。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>「改ざん不可能」なのはブロックチェーンのおかげですか？</AccordionTrigger>
                <AccordionContent>
                  いいえ。画像の改ざん検知や真正性の証明自体は「C2PA」技術によって実現されています。
                  ブロックチェーンの役割は、その証明されたコンテンツが「誰のものか」を記録し、権利を流動化させることです。
                  この2つを組み合わせることで、真正性と所有権の両方を担保しています。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>なぜSolanaとArweaveを選んだのですか？</AccordionTrigger>
                <AccordionContent>
                  画像データ（大容量）の永久保存にはArweaveが最適であり、
                  大量の証明書（NFT）を低コストで発行するにはSolanaのcNFT（圧縮NFT）技術が必須でした。
                  1枚の画像につき1つの証明を発行するモデルにおいて、ガス代の安さと処理速度は非常に重要です。
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* Footer / CTA */}
        <footer className="bg-slate-50 border-t border-slate-200 pt-20 pb-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-slate-900 mb-6">
                現実の証明を、あなたの資産に。
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                手数料0%で、今すぐ始められます。
              </p>
              <Button asChild size="lg" className="h-14 px-10 text-lg rounded-full shadow-xl shadow-blue-600/20">
                <Link href="/upload">
                  アップロードを始める
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
            </div>

            <Separator className="my-10" />

            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-3">
                <Image
                  src="/icon_white.png"
                  alt="RootLens Logo"
                  width={32}
                  height={32}
                  className="rounded-lg opacity-80"
                />
                <span className="font-semibold text-slate-700">RootLens</span>
              </div>
              <div className="flex gap-8 text-sm text-slate-500">
                <Link href="/privacy-policy" className="hover:text-blue-600 transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-blue-600 transition-colors">Terms of Service</Link>
                <a href="https://github.com/yudai-mori-2004/RootLens" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
                <a href="https://x.com/RootLens_sol" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  X <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div className="text-center mt-8 text-xs text-slate-400">
              © 2025 RootLens. Built with C2PA, Arweave, and Solana.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}