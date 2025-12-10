'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, CheckCircle, XCircle, Search, FileCode, Fingerprint, Lock, Link, BookOpen, Eye, AlertCircle } from 'lucide-react';

interface TechnicalSpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
  c2paSummary: C2PASummaryData;
  rootSigner?: string | null;
  arweaveTxId: string;
  cnftMintAddress: string;
  ownerWallet: string;
  createdAt: string;
  originalHash: string;
}

export default function TechnicalSpecsModal({
  isOpen,
  onClose,
  c2paSummary,
  rootSigner,
  arweaveTxId,
  cnftMintAddress,
  ownerWallet,
  createdAt,
  originalHash,
}: TechnicalSpecsModalProps) {
  const manifest = c2paSummary.activeManifest;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 border-b border-gray-200 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Search className="w-6 h-6 text-indigo-600" />
            技術仕様 - 検証者向けガイド
          </DialogTitle>
          <DialogDescription>
            このコンテンツが本物か、AIで生成されたものか、改ざんされていないかを確認する方法
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="px-6 pb-6 max-h-[calc(90vh-10rem)]">
          <div className="space-y-6 pt-4">
            {/* 検証ステータスサマリー */}
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-8 h-8 text-indigo-600" />
                <div>
                  <h3 className="text-lg font-bold text-indigo-900">検証ステータス</h3>
                  <p className="text-sm text-indigo-700">このコンテンツの信頼性スコア</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* C2PA署名 */}
                <div className={`p-4 rounded-lg border-2 ${
                  c2paSummary.validationStatus.isValid
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  {c2paSummary.validationStatus.isValid ? (
                    <CheckCircle className="w-6 h-6 text-green-600 mb-2" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-600 mb-2" />
                  )}
                  <p className="text-xs font-bold text-gray-700 mb-1">C2PA署名</p>
                  <p className={`text-sm font-bold ${
                    c2paSummary.validationStatus.isValid ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {c2paSummary.validationStatus.isValid ? '有効' : '無効'}
                  </p>
                </div>

                {/* AI判定 */}
                <div className={`p-4 rounded-lg border-2 ${
                  manifest?.isAIGenerated
                    ? 'bg-purple-50 border-purple-200'
                    : 'bg-blue-50 border-blue-200'
                }`}>
                  <FileCode className={`w-6 h-6 mb-2 ${
                    manifest?.isAIGenerated ? 'text-purple-600' : 'text-blue-600'
                  }`} />
                  <p className="text-xs font-bold text-gray-700 mb-1">AI生成</p>
                  <p className={`text-sm font-bold ${
                    manifest?.isAIGenerated ? 'text-purple-800' : 'text-blue-800'
                  }`}>
                    {manifest?.isAIGenerated ? 'あり' : 'なし'}
                  </p>
                </div>

                {/* ブロックチェーン */}
                <div className="p-4 rounded-lg border-2 bg-indigo-50 border-indigo-200">
                  <Fingerprint className="w-6 h-6 text-indigo-600 mb-2" />
                  <p className="text-xs font-bold text-gray-700 mb-1">永久記録</p>
                  <p className="text-sm font-bold text-indigo-800">確認済み</p>
                </div>
              </div>
            </div>

            {/* 1. C2PA署名の確認方法 */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-bold text-gray-900 text-sm uppercase tracking-wider pl-1">
                <Shield className="w-5 h-5 text-gray-600" /> 1. C2PA署名の確認方法
              </h4>
              <div className="bg-gray-50 p-5 rounded-lg text-sm space-y-3 border border-gray-200">
                <p className="leading-relaxed text-gray-700">
                  <strong className="text-gray-900">C2PA（Coalition for Content Provenance and Authenticity）</strong>は、
                  Adobe、Microsoft、Sony、Canonなどが参加する業界標準規格です。
                </p>

                <div className="bg-white p-4 rounded border border-gray-200">
                  <p className="text-xs font-bold text-gray-600 mb-2">✓ 確認ポイント</p>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">•</span>
                      <div>
                        <strong>署名の有効性:</strong> このコンテンツの署名は
                        <span className={`ml-1 font-bold ${
                          c2paSummary.validationStatus.isValid ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {c2paSummary.validationStatus.isValid ? '有効' : '無効'}
                        </span>です
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">•</span>
                      <div>
                        <strong>署名者:</strong> {manifest?.signatureInfo.issuer || 'Unknown'}
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold">•</span>
                      <div>
                        <strong>署名日時:</strong> {
                          manifest?.signatureInfo.time
                            ? new Date(manifest.signatureInfo.time).toLocaleString('ja-JP')
                            : '不明'
                        }
                      </div>
                    </li>
                  </ul>
                </div>

                <div className="bg-blue-50 p-4 rounded border border-blue-200">
                  <p className="text-xs font-bold text-blue-800 mb-2 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> どうやって自分で確認できる？
                  </p>
                  <p className="text-sm text-blue-900 leading-relaxed">
                    Adobe Content Credentials（<code className="bg-white px-1 rounded text-xs">contentcredentials.org</code>）や
                    VerityなどのC2PA検証ツールに元ファイルをアップロードすることで、同じ署名情報を確認できます。
                  </p>
                </div>
              </div>
            </div>

            {/* 2. AI生成の確認方法 */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-bold text-gray-900 text-sm uppercase tracking-wider pl-1">
                <FileCode className="w-5 h-5 text-gray-600" /> 2. AI生成かどうかの確認方法
              </h4>
              <div className={`p-5 rounded-lg text-sm space-y-3 border-2 ${
                manifest?.isAIGenerated
                  ? 'bg-purple-50 border-purple-200'
                  : 'bg-blue-50 border-blue-200'
              }`}>
                <p className="leading-relaxed font-bold text-gray-900">
                  判定結果: {manifest?.isAIGenerated ? 'AI生成コンテンツ' : 'カメラ撮影または人間による作成'}
                </p>

                {manifest?.isAIGenerated ? (
                  <div className="bg-white/60 p-4 rounded border border-purple-200">
                    <p className="text-sm text-purple-900 leading-relaxed mb-3">
                      このコンテンツのC2PAメタデータには、AIによる生成を示す記録が含まれています。
                      具体的には以下のアクションが記録されています：
                    </p>
                    <ul className="space-y-2 text-sm text-purple-800">
                      {manifest.assertions.actions
                        .filter(action =>
                          action.digitalSourceType?.includes('trainedAlgorithmicMedia') ||
                          action.description?.toLowerCase().includes('generative ai')
                        )
                        .map((action, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-purple-600 font-bold">•</span>
                            <div>
                              <strong>{action.action.split('.').pop()?.replace(/_/g, ' ').toUpperCase()}</strong>
                              {action.description && ` - ${action.description}`}
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : (
                  <div className="bg-white/60 p-4 rounded border border-blue-200">
                    <p className="text-sm text-blue-900 leading-relaxed">
                      C2PAメタデータのアクション履歴を解析した結果、AI生成を示す記録は見つかりませんでした。
                      このコンテンツは、カメラで撮影されたか、PhotoshopやLightroomなどの従来の編集ツールで作成された可能性が高いです。
                    </p>
                  </div>
                )}

                <div className="bg-yellow-50 p-4 rounded border border-yellow-200 mt-3">
                  <p className="text-xs font-bold text-yellow-800 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 注意事項
                  </p>
                  <p className="text-sm text-yellow-900 leading-relaxed">
                    AI生成の判定は、C2PAメタデータに記録された情報に基づきます。
                    署名が改ざんされていない限り、この情報は信頼できます。
                  </p>
                </div>
              </div>
            </div>

            {/* 3. 改ざん検知の仕組み */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-bold text-gray-900 text-sm uppercase tracking-wider pl-1">
                <Lock className="w-5 h-5 text-gray-600" /> 3. 改ざん検知の仕組み
              </h4>
              <div className="bg-gray-50 p-5 rounded-lg text-sm space-y-3 border border-gray-200">
                <p className="leading-relaxed text-gray-700">
                  このシステムでは、<strong className="text-gray-900">ハッシュ値</strong>と<strong className="text-gray-900">ブロックチェーン</strong>を
                  組み合わせて、改ざんを検知します。
                </p>

                <div className="bg-white p-4 rounded border border-gray-200 space-y-3">
                  <div>
                    <p className="text-xs font-bold text-gray-600 mb-1">① コンテンツのハッシュ値</p>
                    <p className="font-mono text-xs text-gray-800 bg-gray-50 p-2 rounded break-all">
                      {originalHash}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      このハッシュ値は、コンテンツが1ビットでも変更されると全く異なる値になります。
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-gray-600 mb-1">② Arweaveに永久記録</p>
                    <p className="font-mono text-xs text-gray-800 bg-gray-50 p-2 rounded break-all">
                      {arweaveTxId}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      このハッシュ値とメタデータは、Arweave（永久保存ブロックチェーン）に記録されており、
                      誰も削除・変更できません。
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-gray-600 mb-1">③ Solana cNFTで所有権証明</p>
                    <p className="font-mono text-xs text-gray-800 bg-gray-50 p-2 rounded break-all">
                      {cnftMintAddress}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      Solanaブロックチェーン上のcNFT（圧縮NFT）が、このコンテンツの所有権を証明します。
                    </p>
                  </div>
                </div>

                <div className="bg-green-50 p-4 rounded border border-green-200">
                  <p className="text-xs font-bold text-green-800 mb-2 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> どうやって確認できる？
                  </p>
                  <ol className="text-sm text-green-900 leading-relaxed space-y-2">
                    <li>1. ダウンロードしたファイルのハッシュ値を計算（SHA-256）</li>
                    <li>2. 上記のOriginal Hashと一致するか確認</li>
                    <li>3. Arweave Explorerで記録を確認（変更不可能）</li>
                    <li>4. Solana Explorerで所有権NFTを確認</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* 4. 相互リンク検証 */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-bold text-gray-900 text-sm uppercase tracking-wider pl-1">
                <Link className="w-5 h-5 text-gray-600" /> 4. 二重の証明（相互リンク）
              </h4>
              <div className="bg-gray-50 p-5 rounded-lg text-sm space-y-3 border border-gray-200">
                <p className="leading-relaxed text-gray-700">
                  RootLensでは、<strong className="text-gray-900">Arweave</strong>と<strong className="text-gray-900">Solana</strong>が
                  相互にリンクすることで、「乗っ取り攻撃」を防ぎます。
                </p>

                <div className="bg-white p-4 rounded border border-gray-200">
                  <p className="text-xs font-bold text-gray-600 mb-3">仕組み:</p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded">Arweave</span>
                      <p className="text-sm text-gray-700 flex-1">
                        ハッシュ値 + Root署名者 + <strong>cNFTのアドレス</strong>を記録
                      </p>
                    </div>
                    <div className="text-center text-gray-400">↕️</div>
                    <div className="flex items-start gap-3">
                      <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded">Solana</span>
                      <p className="text-sm text-gray-700 flex-1">
                        cNFTのメタデータに<strong>ArweaveのTX ID</strong>を記録
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-red-50 p-4 rounded border border-red-200">
                  <p className="text-xs font-bold text-red-800 mb-2">これにより防げる攻撃:</p>
                  <p className="text-sm text-red-900 leading-relaxed">
                    後から別のNFTを作成してオリジナルだと主張する「乗っ取り」を防ぎます。
                    Arweave上の記録は変更不可能なので、最古の記録が真のオリジナルです。
                  </p>
                </div>
              </div>
            </div>

            {/* 用語解説 */}
            <div className="space-y-3 pt-4 border-t border-gray-100">
              <h4 className="flex items-center gap-2 font-bold text-gray-900 text-sm uppercase tracking-wider pl-1">
                <BookOpen className="w-5 h-5 text-gray-600" />
                検証に役立つ用語集
              </h4>
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> C2PA (Coalition for Content Provenance and Authenticity)
                    </dt>
                    <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                      Adobe、Microsoft、Sony、Canonなどが参加する、コンテンツの来歴と真正性を証明するための業界標準規格。
                      デジタルカメラやAdobeソフトから直接C2PA署名を埋め込むことができます。
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> ハッシュ値（SHA-256）
                    </dt>
                    <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                      デジタルデータの「指紋」。1ビットでも変更されると全く異なる値になるため、改ざん検知に使われます。
                      同じハッシュ値を持つ異なるファイルを作ることは、現在の技術では事実上不可能です。
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Arweave（アーウィーブ）
                    </dt>
                    <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                      一度書き込むと永久に削除・変更ができないブロックチェーンストレージ。
                      「デジタルの石板」として、証拠の永久保存に使われます。
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> cNFT（圧縮NFT）
                    </dt>
                    <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                      Solanaブロックチェーン上の低コストなNFT。このコンテンツの「デジタル所有権証明書」として機能します。
                      誰が所有者かをブロックチェーン上で透明に確認できます。
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Root Signer（ルート署名者）
                    </dt>
                    <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                      最初にコンテンツに署名した組織。Sony、Canon、Nikonなどのカメラメーカー、またはAdobeなどの信頼できる組織。
                      Root Signerの署名があることで、正規のデバイス・ソフトウェアで作成されたことが保証されます。
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* 検証ツールリンク */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
              <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                <Eye className="w-5 h-5 text-blue-600" />
                自分で検証する方法
              </h4>
              <div className="space-y-2 text-sm text-gray-700">
                <p className="leading-relaxed">
                  このページの情報を信じられない場合、以下の方法で自分で検証できます：
                </p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">1.</span>
                    元ファイルをダウンロード（購入が必要な場合があります）
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">2.</span>
                    Adobe Content Credentials（contentcredentials.org）でC2PA署名を確認
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">3.</span>
                    SHA-256ハッシュを計算し、上記のOriginal Hashと比較
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">4.</span>
                    Arweave Explorer / Solana ExplorerでブロックチェーンレコードをX検証
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
