'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import { Camera, Edit3, ShieldCheck, Sparkles, User, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useTranslations } from 'next-intl';

interface ProvenanceTimelineProps {
  c2paSummary: C2PASummaryData;
  rootSigner?: string | null;
}

/**
 * コンテンツの来歴を時系列で表示するタイムラインコンポーネント
 * 日本語ローカライズ版
 */
export default function ProvenanceTimeline({ c2paSummary, rootSigner }: ProvenanceTimelineProps) {
  const t = useTranslations('components.provenanceTimeline');
  const activeManifest = c2paSummary.activeManifest;

  if (!activeManifest) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
        <ShieldCheck className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm font-medium">{t('notFound')}</p>
      </div>
    );
  }

  // ルート署名者の決定
  const finalRootSigner = rootSigner || activeManifest.signatureInfo.issuer || 'Unknown';

  return (
    <div className="relative pb-4 pl-2">
      {/* タイムラインの縦線 */}
      <div className="absolute left-6 md:left-8 top-4 bottom-4 w-0.5 bg-gradient-to-b from-green-200 via-slate-200 to-blue-200" />

      <div className="space-y-8 relative">
        {/* 1. Root (Start) - 撮影/作成 */}
        <div className="relative pl-14 md:pl-20 group">
          {/* マーカー */}
          <div className="absolute left-6 md:left-8 top-0 -translate-x-1/2 w-8 h-8 rounded-full bg-white border-2 border-green-500 shadow-md flex items-center justify-center z-10 group-hover:scale-110 transition-transform">
            <Camera className="w-4 h-4 text-green-600" />
          </div>
          
          <Card className="p-4 border-l-4 border-l-green-500 hover:shadow-md transition-shadow overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-3">
              <div>
                {/* 日本語に変更 */}
                <h4 className="font-bold text-slate-900 text-base">{t('origin')}</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeManifest.signatureInfo.time
                    ? new Date(activeManifest.signatureInfo.time).toLocaleString()
                    : t('unknownDate')}
                </p>
              </div>
              {/* バッジも日本語に */}
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 shrink-0">
                {t('originalBadge')}
              </Badge>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
                {/* 専門用語はカタカナ併記などで分かりやすく */}
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{t('rootSigner')}</span>
              </div>
              <p className="font-semibold text-slate-800 text-sm mb-3 flex flex-wrap items-center gap-2">
                 <span className="break-all">{finalRootSigner}</span>
                 {/* 信頼性の高さを日本語でアピール */}
                 <Badge variant="secondary" className="text-[10px] h-5 shrink-0 bg-slate-200 text-slate-700">
                    {t('trustedDevice')}
                 </Badge>
              </p>

              {activeManifest.rootThumbnailUrl && (
                <div className="relative rounded-lg overflow-hidden border border-slate-200 group/img">
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm z-10">
                    {t('snapshot')}
                  </div>
                  <Image
                    src={activeManifest.rootThumbnailUrl}
                    alt="Original captured content"
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    style={{ objectFit: 'contain' }}
                    className="bg-slate-100/50"
                  />
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* 2. Middle (Actions) - 編集履歴 */}
        {activeManifest.assertions.actions.map((action, index) => {
           const isAI = action.digitalSourceType?.includes('trainedAlgorithmicMedia');
           
           return (
            <div key={index} className="relative pl-14 md:pl-20 group">
              <div className={`absolute left-6 md:left-8 top-0 -translate-x-1/2 w-8 h-8 rounded-full bg-white border-2 shadow-sm flex items-center justify-center z-10 group-hover:scale-110 transition-transform ${
                  isAI ? 'border-purple-500' : 'border-slate-400'
              }`}>
                {isAI ? <Sparkles className="w-4 h-4 text-purple-600" /> : <Edit3 className="w-4 h-4 text-slate-600" />}
              </div>
              
              <div className="mb-2 pt-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-bold text-slate-800 text-sm break-words">
                        {/* アクション名は英語のままか、主要なものだけマッピングしても良いが、ここでは英語のまま表示しつつ読みやすく整形 */}
                        {action.action.split('.').pop()?.replace(/_/g, ' ').toUpperCase()}
                    </p>
                    {isAI && (
                        <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-none text-[10px]">
                            {t('aiEdited')}
                        </Badge>
                    )}
                </div>
                {action.when && (
                    <p className="text-[10px] text-slate-400">
                    {new Date(action.when).toLocaleString()}
                    </p>
                )}
              </div>
              
              {action.description && (
                <div className="bg-white p-3 rounded-lg border border-slate-200 text-xs text-slate-600 shadow-sm block w-full break-words">
                  {action.description}
                </div>
              )}
            </div>
          );
        })}

        {/* 3. Current (End) - 現在の状態 */}
        <div className="relative pl-14 md:pl-20 group">
          <div className="absolute left-6 md:left-8 top-0 -translate-x-1/2 w-8 h-8 rounded-full bg-white border-2 border-blue-600 shadow-md flex items-center justify-center z-10 group-hover:scale-110 transition-transform">
             <ImageIcon className="w-4 h-4 text-blue-600" />
          </div>
          
          <Card className="p-4 border-l-4 border-l-blue-600 shadow-sm hover:shadow-md transition-shadow bg-blue-50/30 overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-3">
               <div>
                  {/* 日本語に変更 */}
                  <h4 className="font-bold text-blue-900 text-base">{t('currentVersion')}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeManifest.signatureInfo.time
                      ? new Date(activeManifest.signatureInfo.time).toLocaleString()
                      : t('unknownDate')}
                  </p>
               </div>
               <Badge className="bg-blue-600 hover:bg-blue-700 shrink-0">{t('latestBadge')}</Badge>
            </div>

            <div className="bg-white p-3 rounded-lg border border-blue-100 shadow-sm">
              <div className="flex items-center gap-3 mb-3 border-b border-slate-100 pb-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">{t('signedBy')}</p>
                  <p className="font-bold text-slate-900 text-sm truncate">
                    {activeManifest.signatureInfo.issuer || 'Unknown'}
                  </p>
                </div>
              </div>

              {c2paSummary.thumbnailUrl && (
                <div className="relative rounded-lg overflow-hidden border border-slate-200">
                  <div className="absolute top-2 left-2 bg-blue-600/90 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm z-10">
                    {t('currentImage')}
                  </div>
                  <Image
                    src={c2paSummary.thumbnailUrl}
                    alt="Current version thumbnail"
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    style={{ objectFit: 'contain' }}
                    className="bg-slate-50"
                  />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}