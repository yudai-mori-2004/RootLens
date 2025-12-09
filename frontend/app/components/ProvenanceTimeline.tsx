'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';

interface ProvenanceTimelineProps {
  c2paSummary: C2PASummaryData;
  rootSigner?: string | null;
}

/**
 * コンテンツの来歴を時系列で表示するタイムラインコンポーネント
 *
 * @param c2paSummary - C2PA Manifest のサマリーデータ
 * @param rootSigner - ルート署名者（オプション、c2paSummaryから取得できない場合に使用）
 */
export default function ProvenanceTimeline({ c2paSummary, rootSigner }: ProvenanceTimelineProps) {
  const activeManifest = c2paSummary.activeManifest;

  if (!activeManifest) {
    return (
      <div className="text-gray-500 text-sm">
        来歴情報がありません
      </div>
    );
  }

  // ルート署名者の決定（優先順位: props > activeManifest）
  const finalRootSigner = rootSigner || activeManifest.signatureInfo.issuer || 'Unknown';

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-6 border-b pb-2">
        コンテンツの来歴 (Provenance Timeline)
      </h3>

      <div className="relative border-l-2 border-gray-200 ml-3 space-y-8 pb-8">
        {/* 1. Root (Start) */}
        <div className="relative pl-8">
          <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-green-500 border-2 border-white ring-2 ring-green-100"></div>
          <div>
            <p className="text-sm font-bold text-gray-900">Created / Captured</p>
            <p className="text-xs text-gray-500 mt-1">
              {activeManifest.signatureInfo.time
                ? new Date(activeManifest.signatureInfo.time).toLocaleString()
                : 'Unknown Date'}
            </p>
            <div className="mt-2 bg-gray-50 p-3 rounded text-sm border border-gray-100">
              <span className="block text-xs text-gray-400 uppercase tracking-wide mb-1">Origin (Root Issuer)</span>
              <span className="font-medium text-gray-800">{finalRootSigner}</span>

              {activeManifest.rootThumbnailUrl && (
                <div className="mt-2 rounded overflow-hidden border border-gray-200">
                  <img
                    src={activeManifest.rootThumbnailUrl}
                    alt="Original captured content"
                    className="w-full h-auto object-contain max-h-48"
                  />
                  <p className="text-[10px] text-gray-400 mt-1 text-center">Original Snapshot</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Middle (Actions) */}
        {activeManifest.assertions.actions.map((action, index) => (
          <div key={index} className="relative pl-8">
            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ring-2 ring-gray-100 ${
                action.digitalSourceType?.includes('trainedAlgorithmicMedia')
                  ? 'bg-purple-500'
                  : 'bg-blue-400'
            }`}></div>
            <div>
              <p className="text-sm font-bold text-gray-900">
                {action.action.split('.').pop()?.replace(/_/g, ' ').toUpperCase()}
              </p>
              {action.when && (
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(action.when).toLocaleString()}
                </p>
              )}
              {action.description && (
                <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-2 rounded inline-block">
                  {action.description}
                </p>
              )}
              {action.digitalSourceType?.includes('trainedAlgorithmicMedia') && (
                <span className="ml-2 bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full">
                  AI Generated
                </span>
              )}
            </div>
          </div>
        ))}

        {/* 3. Current (End) */}
        <div className="relative pl-8">
          <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-blue-600 border-2 border-white ring-2 ring-blue-100"></div>
          <div>
            <p className="text-sm font-bold text-gray-900">Current Version</p>
            <p className="text-xs text-gray-500 mt-1">
              {activeManifest.signatureInfo.time
                ? new Date(activeManifest.signatureInfo.time).toLocaleString()
                : 'Unknown'}
            </p>

            <div className="mt-3 bg-blue-50 p-4 rounded-lg border border-blue-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-2xl">📄</div>
                <div>
                  <p className="text-xs text-blue-600 uppercase tracking-wide">Final Signer</p>
                  <p className="font-bold text-blue-900">
                    {activeManifest.signatureInfo.issuer || 'Unknown'}
                  </p>
                </div>
              </div>

              {c2paSummary.thumbnailUrl && (
                <div className="mt-2 rounded overflow-hidden border border-blue-200">
                  <img
                    src={c2paSummary.thumbnailUrl}
                    alt="Current version thumbnail"
                    className="w-full h-auto object-contain max-h-48"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
