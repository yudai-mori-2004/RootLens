import { Cloud, BookOpen, AlertTriangle, Database, FileText, Shield } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Image from 'next/image';

export default function TechnicalDetailsSection() {
  return (
    <div className="space-y-10 p-6">
      
      {/* 1. 永久保存データ (Blockchain) */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-500 pl-4 py-1">
            1. ブロックチェーン上の永久記録
        </h4>
        <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-6 border border-slate-200 shadow-sm">
            <p className="leading-loose text-slate-700">
                データの「指紋（ハッシュ値）」と所有権情報は、
                <strong className="text-slate-900 bg-slate-100 px-1 py-0.5 rounded mx-1">ブロックチェーン</strong>
                上に永久に記録され、RootLensのサービス終了後も残り続けます。
            </p>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">記録されるデータ（削除不可）</p>
                <div className="grid grid-cols-1 gap-4">
                     <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                        <Database className="w-5 h-5 text-slate-400 mt-1 shrink-0" />
                        <div>
                            <p className="font-bold text-slate-900 text-sm">Arweave (データ層)</p>
                            <ul className="text-xs text-slate-600 mt-1 space-y-1 list-disc list-inside">
                                <li>コンテンツのハッシュ値</li>
                                <li>ルート署名者情報</li>
                                <li>cNFTへのリンク情報</li>
                            </ul>
                        </div>
                     </div>
                     <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                        <div className="w-5 h-5 mt-1 shrink-0 relative">
                            <Image src="/solana_logo.png" alt="Solana Logo" fill className="object-contain" />
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">Solana (所有権層)</p>
                            <ul className="text-xs text-slate-600 mt-1 space-y-1 list-disc list-inside">
                                <li>cNFTの発行情報</li>
                                <li>現在の所有者ウォレット</li>
                                <li>Arweaveへのリンク情報</li>
                            </ul>
                        </div>
                     </div>
                </div>
                <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-slate-200/50 p-3 rounded-lg">
                    <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                        これらのハッシュデータから、元の写真や個人情報（顔写真など）を復元することは数学的に不可能です。
                    </p>
                </div>
            </div>
        </div>
      </section>

      {/* 2. サーバー保存データとプライバシー */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-indigo-500 pl-4 py-1">
            2. 公開データとプライバシー
        </h4>
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 sm:p-8 rounded-2xl border border-indigo-100 shadow-sm space-y-6">
             <div className="flex items-start gap-4">
                <div className="p-3 bg-white rounded-full shadow-sm shrink-0 text-indigo-600">
                    <Cloud className="w-6 h-6" />
                </div>
                <div>
                    <h5 className="font-bold text-indigo-900 text-lg">RootLensサーバーでの公開</h5>
                    <p className="text-indigo-800 text-sm mt-1 leading-relaxed">
                        アップロードされたファイルは、ブロックチェーン証明ページを生成するため、
                        RootLensのクラウドストレージに保存され<strong className="text-indigo-700 bg-indigo-100 px-1 rounded mx-1">一般公開</strong>されます。<br/>
                        <span className="text-xs text-slate-500">※サーバー上のデータは、あなたの操作でいつでも削除可能です（削除後は画像は閲覧できなくなります）。</span>
                    </p>
                </div>
             </div>

             <div className="bg-white/80 backdrop-blur-sm p-5 rounded-xl border border-indigo-100 space-y-4">
                <div>
                    <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">公開される内容</p>
                    <ul className="space-y-3">
                        <li className="flex items-start gap-3 text-sm text-indigo-900">
                            <FileText className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold">ファイル本体（写真・動画）</span>
                                <p className="text-xs text-indigo-700 mt-1">
                                    Exif情報（位置情報・撮影日時・機種名など）を含んだ「オリジナルの状態」で公開されます。
                                </p>
                            </div>
                        </li>
                        <li className="flex items-start gap-3 text-sm text-indigo-900">
                            <Database className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold">C2PAメタデータ</span>
                                <p className="text-xs text-indigo-700 mt-1">
                                    デジタル署名、編集履歴、サムネイル画像などが検証のために表示されます。
                                </p>
                            </div>
                        </li>
                    </ul>
                </div>

                <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 flex gap-3 items-start">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                        <p className="font-bold mb-2">プライバシーに関する重要事項（必ずお読みください）</p>
                        <p className="leading-relaxed text-xs mb-3">
                            RootLensは、データの真正性を担保する仕組み上、<strong className="text-yellow-900 bg-yellow-100 px-1 rounded">ファイルのExif情報（位置情報など）を自動削除できません。</strong>
                        </p>
                        <p className="leading-relaxed text-xs mb-3">
                            C2PAの仕様上、撮影後にExif情報を削除・編集すると「データの改ざん」と判定され、署名が無効になります。そのため、<strong>「真正性を証明したい」かつ「自宅の位置情報などは隠したい」という両立はできません。</strong>
                        </p>
                        <ul className="list-disc list-inside text-xs space-y-1 ml-1 font-medium">
                            <li>アップロードする前に、ファイルのプロパティ等でExif情報をご確認ください。</li>
                            <li>公開したくない個人情報（自宅のGPS情報など）が署名に含まれている場合は、<strong className="text-red-600 border-b border-red-200">アップロードを控えてください。</strong></li>
                        </ul>
                    </div>
                </div>
             </div>
        </div>
      </section>

      {/* 3. 証明メカニズム */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-800 pl-4 py-1">
            3. 真正性と所有権の証明メカニズム
        </h4>
        <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-8 border border-slate-200 shadow-sm">
            <p className="leading-loose text-slate-700">
                RootLensは、<strong className="text-slate-900">相互リンク技術</strong>を用いて、
                「データの真正性」と「デジタル所有権」を不可分な形で結びつけます。
            </p>

            <div className="grid grid-cols-1 gap-4">
                {/* Step 1 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">1</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">相互リンクによる証明</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Arweave上の記録（データ）とSolana上のcNFT（権利）がお互いのIDを記録し合うことで、
                            強力なペアを形成します。これにより、後から偽のNFTを作って所有権を主張する「乗っ取り」を防ぎます。
                        </p>
                    </div>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">2</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">オリジナルの定義</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            ブロックチェーン上には誰もが記録を残せますが、RootLensでは
                            「正しいハッシュ値を持ち、かつ最古のタイムスタンプを持つ相互リンク記録」
                            のみをオリジナルとして認定します。
                        </p>
                    </div>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">3</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">所有権の移転とBurn</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            cNFTを転送すれば所有権が移転します。cNFTをBurn（焼却）すれば、
                            「このデータの所有者はこの世に存在しない（権利放棄）」という事実を証明できます。
                        </p>
                    </div>
                </div>
            </div>
        </div>
      </section>

      {/* 4. 用語解説 */}
      <section className="space-y-4 border-t border-slate-100 pt-6">
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="glossary" className="border-none">
                <AccordionTrigger className="hover:no-underline py-3 px-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                    <div className="flex items-center gap-3 text-slate-600 font-bold text-sm">
                        <BookOpen className="w-4 h-4" />
                        <span>用語解説</span>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <div className="grid grid-cols-1 gap-3 pt-3 px-1">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> ハッシュ値
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                デジタルデータの「指紋」。1ビットでも変更されると全く異なる値になるため、改ざん検知に使われます。
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> ルート署名者
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                SonyやCanonなどのカメラメーカーやAdobeなどの信頼できる組織。データの出自を保証します。
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Arweave
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                半永久的なデータ保存ネットワーク。「デジタルの石板」として記録を残します。
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> cNFT
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                Solana上のデジタル証明書。これが「このコンテンツの所有権」を表します。
                            </dd>
                        </div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </section>

    </div>
  );
}