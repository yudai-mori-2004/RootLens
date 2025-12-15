'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Shield, CheckCircle, XCircle, Search, FileCode, Fingerprint, Lock, Link as LinkIcon, BookOpen, Eye, AlertCircle, HelpCircle, Camera, Sparkles, Check, Activity, Database, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

interface VerificationDetails {
  arweaveToCnft: boolean;
  cnftToArweave: boolean;
  noDuplicates: boolean;
  isRootLensWallet: boolean;
  cnftUri?: string;
  expectedUri?: string;
}

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
  verificationDetails?: VerificationDetails;
  isBurned?: boolean;
  lastOwnerBeforeBurn?: string;
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
  verificationDetails,
  isBurned,
  lastOwnerBeforeBurn,
}: TechnicalSpecsModalProps) {
  const manifest = c2paSummary.activeManifest;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] p-0 bg-white shadow-2xl rounded-xl sm:rounded-2xl flex flex-col overflow-hidden border border-slate-100 gap-0">
        
        {/* ヘッダー (固定) */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 shrink-0 z-10 sticky top-0">
            <DialogHeader className="text-left">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-50 rounded-xl border border-indigo-100 shrink-0">
                        <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
                    </div>
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                        検証レポート
                    </DialogTitle>
                </div>
            </DialogHeader>
        </div>

        {/* スクロールエリア */}
        <div className="flex-1 w-full min-h-0 overflow-y-auto px-6 py-8 space-y-10 scroll-smooth">
            
            {/* 検証ステータスサマリー */}
            <section>
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100/50">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-white rounded-full shadow-sm shrink-0 ring-1 ring-indigo-100">
                            <FileCode className="w-5 h-5 text-indigo-600" /> {/* Iconも書類系に変更 */}
                        </div>
                        <div>
                            {/* 修正: 検証結果ではなく、情報の提示とする */}
                            <h3 className="text-lg font-bold text-slate-900">埋め込みメタデータと資産情報</h3>
                            <p className="text-sm text-slate-500">ファイルに含まれるC2PA情報およびオンチェーン記録の概要</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* C2PA署名 */}
                        <div className={`p-5 rounded-xl border flex flex-col items-center text-center bg-white/60 backdrop-blur-sm shadow-sm transition-colors ${
                        c2paSummary.validationStatus.isValid
                            ? 'border-green-200/60'
                            : 'border-slate-200/60' // 無効というより「未検出」等の場合に合わせる
                        }`}>
                            <div className={`mb-3 p-3 rounded-full ${
                                c2paSummary.validationStatus.isValid ? 'bg-green-100' : 'bg-slate-100'
                            }`}>
                                <Fingerprint className={`w-6 h-6 ${
                                    c2paSummary.validationStatus.isValid ? 'text-green-700' : 'text-slate-500'
                                }`} />
                            </div>
                            <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">ハードウェア署名</p>
                            <p className={`text-lg font-bold ${
                                c2paSummary.validationStatus.isValid ? 'text-green-700' : 'text-slate-600'
                            }`}>
                                {c2paSummary.validationStatus.isValid ? 'あり' : '未検出'}
                            </p>
                        </div>

                        {/* AI判定 */}
                        <div className={`p-5 rounded-xl border flex flex-col items-center text-center bg-white/60 backdrop-blur-sm shadow-sm transition-colors ${
                        manifest?.isAIGenerated
                            ? 'border-purple-200/60'
                            : 'border-blue-200/60'
                        }`}>
                            <div className={`mb-3 p-3 rounded-full ${
                                manifest?.isAIGenerated ? 'bg-purple-100' : 'bg-blue-100'
                            }`}>
                                <FileCode className={`w-6 h-6 ${
                                    manifest?.isAIGenerated ? 'text-purple-700' : 'text-blue-700'
                                }`} />
                            </div>
                            <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">AI生成</p>
                            <p className={`text-lg font-bold ${
                                manifest?.isAIGenerated ? 'text-purple-700' : 'text-blue-700'
                            }`}>
                                {manifest?.isAIGenerated ? 'あり' : 'なし'}
                            </p>
                        </div>

                        {/* ブロックチェーン */}
                        <div className="p-5 rounded-xl border border-indigo-200/60 flex flex-col items-center text-center bg-white/60 backdrop-blur-sm shadow-sm">
                            <div className="mb-3 p-3 rounded-full bg-indigo-100">
                                <Database className="w-6 h-6 text-indigo-700" />
                            </div>
                            <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">ブロックチェーン</p>
                            <p className="text-lg font-bold text-indigo-700">登録済み</p>
                        </div>
                    </div>
                </div>
            </section>
            
            {/* コンテンツエリア：読みやすさ重視で1カラム構成に変更 */}
            <div className="space-y-12">
                
                {/* 1. C2PA署名の確認方法 */}
                <section className="space-y-4">
                    <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-indigo-500 pl-4 py-1">
                        1. ハードウェア署名の確認
                    </h4>
                    <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-6 border border-slate-200 shadow-sm">
                        <p className="leading-loose text-slate-700">
                        <strong className="text-slate-900 font-semibold border-b border-indigo-200 pb-0.5">C2PA（Coalition for Content Provenance and Authenticity）</strong>は、
                        Adobe、Microsoft、Sony、Canonなどが参加する業界標準規格です。
                        </p>

                        <div className="bg-slate-50/80 p-6 rounded-xl border border-slate-200">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">確認ポイント</p>
                            <ul className="space-y-4 text-slate-700">
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="font-bold text-slate-900 mb-1">署名の有効性</div>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium ${
                                            c2paSummary.validationStatus.isValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                            このコンテンツの署名は{c2paSummary.validationStatus.isValid ? '有効' : '無効'}です
                                        </span>
                                    </div>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                    <div className="w-full">
                                        <div className="font-bold text-slate-900 mb-1">署名者</div>
                                        <div className="bg-white p-2 rounded border border-slate-200 text-sm font-mono text-slate-600 break-all">
                                            {manifest?.signatureInfo.issuer || 'Unknown'}
                                        </div>
                                    </div>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="font-bold text-slate-900 mb-1">署名日時</div>
                                        <div className="text-slate-700">
                                            {manifest?.signatureInfo.time
                                                ? new Date(manifest.signatureInfo.time).toLocaleString('ja-JP')
                                                : '不明'
                                            }
                                        </div>
                                    </div>
                                </li>
                            </ul>
                        </div>

                        <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 flex gap-4 items-start">
                            <Eye className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-bold text-blue-900 mb-2">どうやって自分で確認できる？</p>
                                <p className="text-sm text-blue-900 leading-relaxed">
                                    この画像の真正性は、Adobe Content Credentials
                                    （<a 
                                        href="https://verify.contentauthenticity.org" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="font-mono text-blue-600 underline decoration-blue-300 hover:text-blue-800 mx-1"
                                    >
                                        verify.contentauthenticity.org
                                    </a>）
                                    等の外部ツールでも検証可能です。
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 2. AI生成の確認方法 */}
                <section className="space-y-4">
                    <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-purple-500 pl-4 py-1">
                        2. AI技術の使用確認
                    </h4>
                    <div className={`p-6 sm:p-8 rounded-2xl text-base space-y-6 border-2 bg-white shadow-sm ${
                        manifest?.isAIGenerated
                        ? 'border-purple-100'
                        : 'border-blue-100'
                    }`}>
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${manifest?.isAIGenerated ? 'bg-purple-100' : 'bg-blue-100'}`}>
                                <Sparkles className={`w-6 h-6 ${manifest?.isAIGenerated ? 'text-purple-600' : 'text-blue-600'}`} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">判定結果</p>
                                <p className="font-bold text-slate-900 text-lg">
                                    {/* 修正点: 生成だけでなく編集の可能性も含める / AIなしの場合は「記録なし」とする */}
                                    {manifest?.isAIGenerated ? 'AI技術の使用あり（生成・編集）' : 'AI生成・編集の記録なし'}
                                </p>
                            </div>
                        </div>

                        {manifest?.isAIGenerated ? (
                        <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                            <p className="text-sm text-purple-900 leading-relaxed mb-4">
                            このコンテンツの来歴情報には、生成AIまたはAIモデルを使用した処理の記録が含まれています。
                            検出されたアクションは以下の通りです：
                            </p>
                            <ul className="space-y-3 text-sm text-purple-800">
                            {manifest.assertions.actions
                                .filter(action =>
                                    // 修正点: 'compositeWith...' も含めることで、部分的なAI編集も拾えるようにする
                                    action.digitalSourceType?.includes('TrainedAlgorithmicMedia') || 
                                    action.description?.toLowerCase().includes('generative ai')
                                )
                                .map((action, i) => (
                                <li key={i} className="flex items-start gap-3 bg-white/50 p-3 rounded-lg">
                                    <span className="text-purple-600 font-bold mt-0.5">•</span>
                                    <div>
                                    {/* アクション名を読みやすく整形 */}
                                    <strong className="block text-purple-900 mb-1">
                                        {action.action.split('.').pop()?.replace(/_/g, ' ').toUpperCase()}
                                    </strong>
                                    {action.description && <span className="text-purple-700 text-xs">{action.description}</span>}
                                    
                                    {/* digitalSourceTypeがわかる場合は補足表示（任意） */}
                                    {action.digitalSourceType?.includes('composite') && (
                                        <span className="block text-xs text-purple-500 mt-1">※既存画像へのAI合成・編集</span>
                                    )}
                                    </div>
                                </li>
                                ))}
                            </ul>
                        </div>
                        ) : (
                        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                            <p className="text-sm text-blue-900 leading-relaxed">
                            {/* 修正点: カメラ撮影と断定せず、あくまでメタデータ上の事実を述べる */}
                            C2PAメタデータ内に、AIによる生成や編集を示す明確な記録は見つかりませんでした。
                            （※通常の編集ツールによる加工や、手動による作成、またはカメラ撮影の可能性があります）
                            </p>
                        </div>
                        )}

                        <div className="flex items-start gap-3 text-sm text-slate-500 pt-4 border-t border-slate-100">
                            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-slate-400" />
                            <p className="leading-relaxed text-xs sm:text-sm">
                                {/* 修正点: 信頼性の定義をより正確に */}
                                AI判定は、作成・編集時に使用されたソフトウェアがC2PAメタデータに記録した情報に基づきます。
                                「記録なし」の場合でも、C2PA非対応のAIツールが使用された可能性は否定できません。
                            </p>
                        </div>
                    </div>
                </section>

                {/* 3. 改ざん検知の仕組み */}
                <section className="space-y-4">
                    {/* タイトルを「改ざん検知」から「所有権と紐付け」に変更 */}
                    <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-500 pl-4 py-1">
                        3. 所有権の証明とデータ紐付け
                    </h4>
                    
                    <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-8 border border-slate-200 shadow-sm">
                        <p className="leading-loose text-slate-700">
                            C2PAによって内容の真正性が保証されたファイルと、ブロックチェーン上の所有権を
                            <strong className="text-slate-900 bg-slate-100 px-1 py-0.5 rounded mx-1">ハッシュ値</strong>
                            によって強固に紐付けています。
                        </p>

                        <div className="grid grid-cols-1 gap-6">
                            {/* 1. アンカーとしてのハッシュ値 */}
                            <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0">1</div>
                                <div className="space-y-2 min-w-0 flex-1">
                                    <p className="font-bold text-slate-900">紐付け用ハッシュ (Binding Hash)</p>
                                    <div className="bg-slate-800 rounded-lg p-3 relative group">
                                        <code className="text-slate-300 text-xs sm:text-sm font-mono break-all leading-relaxed block">
                                            {originalHash}
                                        </code>
                                    </div>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        ダウンロードしたファイル固有のIDです。このIDがブロックチェーン上に記録されていることで、「このファイルこそが、NFTに紐づく正当なデータである」と特定できます。
                                    </p>
                                </div>
                            </div>

                            {/* 2. Arweave（登録簿） */}
                            <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0">2</div>
                                <div className="space-y-2 min-w-0 flex-1">
                                    <div className="flex items-center justify-between">
                                        <p className="font-bold text-slate-900">Arweaveによる永続記録</p>
                                        <a 
                                            href={`https://devnet.irys.xyz/tx/${arweaveTxId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                        >
                                            View on Explorer <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                        <code className="text-indigo-600 text-xs sm:text-sm font-mono break-all leading-relaxed block">
                                            {arweaveTxId}
                                        </code>
                                    </div>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        「上記のハッシュ値を持つファイルが存在する」という事実が、Arweave上に永久に記録されています。
                                    </p>
                                </div>
                            </div>

                            {/* 3. Solana（所有権） */}
                            <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0">3</div>
                                <div className="space-y-2 min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-bold text-slate-900">Solana cNFTによる所有権</p>
                                        {isBurned ? (
                                            <span className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded font-bold whitespace-nowrap">
                                                Burned (破棄済み)
                                            </span>
                                        ) : (
                                            <a 
                                                href={`https://orb.helius.dev/address/${cnftMintAddress}?cluster=devnet`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                            >
                                                View on Solscan <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                        <code className={`text-xs sm:text-sm font-mono break-all leading-relaxed block ${isBurned ? 'text-slate-400 line-through' : 'text-purple-600'}`}>
                                            {cnftMintAddress}
                                        </code>
                                    </div>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        {isBurned 
                                            ? 'このコンテンツの所有権トークン（cNFT）は破棄されています。'
                                            : 'このcNFTを持つウォレットが、上記ハッシュ値を持つファイルの正当な保有者（Owner）であることをSolanaチェーンが証明しています。'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 検証フローの説明も修正 */}
                        <div className="bg-green-50 p-5 rounded-xl border border-green-100">
                            <p className="text-sm font-bold text-green-900 mb-3 flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-green-600" /> RootLensでの真正性担保の構造
                            </p>
                            <ul className="space-y-3 ml-1">
                                <li className="flex items-start gap-3 text-sm text-green-800">
                                    <span className="bg-green-200 text-green-800 text-xs font-bold px-2 py-0.5 rounded mt-0.5">CONTENT</span>
                                    <span>
                                        <strong>ファイルの中身（改ざん検知）:</strong><br/>
                                        C2PAの電子署名によって、画像のピクセルやメタデータが変更されていないことを保証します。（外部ツールで検証可能）
                                    </span>
                                </li>
                                <li className="flex items-start gap-3 text-sm text-green-800">
                                    <span className="bg-green-200 text-green-800 text-xs font-bold px-2 py-0.5 rounded mt-0.5">OWNERSHIP</span>
                                    <span>
                                        <strong>ファイルの所有権（資産証明）:</strong><br/>
                                        ファイルのハッシュ値をキーとして、Solanaブロックチェーン上のNFTと紐付けます。「誰がこのファイルのオーナーか」を保証します。
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* 4. 相互リンク検証 */}
                <section className="space-y-4">
                    <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-800 pl-4 py-1">
                        4. 堅牢な所有権証明（相互リンク）
                    </h4>
                    <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-6 border border-slate-200 shadow-sm">
                        <p className="leading-loose text-slate-700">
                        RootLensでは、<strong className="text-slate-900">Arweave</strong>と<strong className="text-slate-900">Solana</strong>が
                        相互にリンクすることで、「乗っ取り攻撃」を防ぎます。
                        </p>

                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">仕組み</p>
                            <div className="flex flex-col md:flex-row items-center gap-4">
                                <div className="bg-white p-5 rounded-xl border border-slate-200 w-full md:w-auto flex-1 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-10">
                                        <Database className="w-16 h-16" />
                                    </div>
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge className="bg-black hover:bg-black">Arweave</Badge>
                                            <span className="text-xs text-slate-500 font-bold">Data Layer</span>
                                        </div>
                                        <p className="text-sm text-slate-700 break-all leading-relaxed">
                                            cNFTのアドレス<br/>
                                            <span className="font-mono bg-slate-100 px-1 rounded text-slate-900">{cnftMintAddress.slice(0, 8)}...</span>
                                            <br/>を記録済み
                                        </p>
                                    </div>
                                </div>

                                <div className="flex-shrink-0 flex justify-center py-2 md:py-0 text-slate-300">
                                    <LinkIcon className="w-8 h-8 rotate-90 md:rotate-0" />
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-slate-200 w-full md:w-auto flex-1 shadow-sm relative overflow-hidden">
                                     <div className="absolute top-0 right-0 p-2 opacity-10">
                                        <Fingerprint className="w-16 h-16" />
                                    </div>
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge className="bg-purple-600 hover:bg-purple-700">Solana</Badge>
                                            <span className="text-xs text-slate-500 font-bold">Ownership Layer</span>
                                        </div>
                                        <p className="text-sm text-slate-700 break-all leading-relaxed">
                                            ArweaveのTX ID<br/>
                                            <span className="font-mono bg-slate-100 px-1 rounded text-slate-900">{arweaveTxId.slice(0, 8)}...</span>
                                            <br/>を記録済み
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 検証結果の表示 */}
                        {verificationDetails && (
                        <div className={`p-5 rounded-xl border-2 ${
                            verificationDetails.arweaveToCnft && verificationDetails.cnftToArweave
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                        }`}>
                            <p className="text-base font-bold mb-4 flex items-center gap-2">
                            {verificationDetails.arweaveToCnft && verificationDetails.cnftToArweave ? (
                                <>
                                <CheckCircle className="w-6 h-6 text-green-600" />
                                <span className="text-green-800">相互リンク検証: 成功</span>
                                </>
                            ) : (
                                <>
                                <XCircle className="w-6 h-6 text-red-600" />
                                <span className="text-red-800">相互リンク検証: 失敗</span>
                                </>
                            )}
                            </p>

                            <div className="space-y-3">
                            <div className="flex items-center gap-3 bg-white/60 p-3 rounded-lg">
                                {verificationDetails.arweaveToCnft ? (
                                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                ) : (
                                <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                                )}
                                <span className={`text-sm font-medium ${verificationDetails.arweaveToCnft ? 'text-green-800' : 'text-red-800'}`}>
                                Arweave → cNFT: {verificationDetails.arweaveToCnft ? '一致' : '不一致'}
                                </span>
                            </div>

                            <div className="flex items-center gap-3 bg-white/60 p-3 rounded-lg">
                                {verificationDetails.cnftToArweave ? (
                                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                ) : (
                                <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                                )}
                                <span className={`text-sm font-medium ${verificationDetails.cnftToArweave ? 'text-green-800' : 'text-red-800'}`}>
                                cNFT → Arweave: {verificationDetails.cnftToArweave ? '一致' : '不一致'}
                                </span>
                            </div>
                            </div>
                        </div>
                        )}
                    </div>
                </section>
            </div>

            {/* 用語解説 */}
            <div className="pt-8 border-t border-slate-100">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="glossary" className="border-none">
                    <AccordionTrigger className="hover:no-underline py-4 px-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                        <div className="flex items-center gap-3 text-slate-600 font-bold">
                            <BookOpen className="w-5 h-5" />
                            <span>検証に役立つ用語集</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
                        <div className="grid grid-cols-1 gap-4 pt-4 px-1">
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                <dt className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full" /> C2PA (Coalition for Content Provenance and Authenticity)
                                </dt>
                                <dd className="text-sm text-slate-600 leading-loose pl-4 border-l-2 border-slate-100 ml-1">
                                    Adobe、Microsoft、Sony、Canonなどが参加する、コンテンツの来歴と真正性を証明するための業界標準規格。
                                    デジタルカメラやAdobeソフトから直接C2PA署名を埋め込むことができます。
                                </dd>
                            </div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                <dt className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full" /> ハッシュ値（SHA-256）
                                </dt>
                                <dd className="text-sm text-slate-600 leading-loose pl-4 border-l-2 border-slate-100 ml-1">
                                    デジタルデータの「指紋」。1ビットでも変更されると全く異なる値になるため、改ざん検知に使われます。
                                    同じハッシュ値を持つ異なるファイルを作ることは、現在の技術では事実上不可能です。
                                </dd>
                            </div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                <dt className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full" /> Arweave（アーウィーブ）
                                </dt>
                                <dd className="text-sm text-slate-600 leading-loose pl-4 border-l-2 border-slate-100 ml-1">
                                    一度書き込むと永久に削除・変更ができないブロックチェーンストレージ。
                                    「デジタルの石板」として、証拠の永久保存に使われます。
                                </dd>
                            </div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                <dt className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full" /> cNFT（圧縮NFT）
                                </dt>
                                <dd className="text-sm text-slate-600 leading-loose pl-4 border-l-2 border-slate-100 ml-1">
                                    Solanaブロックチェーン上の低コストなNFT。このコンテンツの「デジタル所有権証明書」として機能します。
                                    誰が所有者かをブロックチェーン上で透明に確認できます。
                                </dd>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

          </div>
      </DialogContent>
    </Dialog>
  );
}