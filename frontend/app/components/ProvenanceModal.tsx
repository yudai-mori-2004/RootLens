'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import ProvenanceTimeline from './ProvenanceTimeline';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { History, Clock } from 'lucide-react'; // アイコンのバリエーション

interface ProvenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  c2paSummary: C2PASummaryData;
  rootSigner?: string | null;
}

export default function ProvenanceModal({
  isOpen,
  onClose,
  c2paSummary,
  rootSigner,
}: ProvenanceModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] p-0 bg-white shadow-2xl rounded-xl sm:rounded-2xl flex flex-col overflow-hidden border border-slate-100 gap-0">
        
        {/* ヘッダー (固定: 前回のスタイルに合わせる) */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 shrink-0 z-10 sticky top-0">
            <DialogHeader className="text-left space-y-1">
            <div className="flex items-center gap-3">
                {/* アイコンのスタイルを統一 (例: 歴史なのでオレンジやアンバー、または落ち着いたSlate) */}
                <div className="p-2.5 bg-orange-50 rounded-xl border border-orange-100 shrink-0">
                    <History className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
                </div>
                <DialogTitle className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                    コンテンツ来歴タイムライン
                </DialogTitle>
            </div>
            <DialogDescription className="text-slate-500 text-sm mt-2 sm:ml-14 leading-relaxed">
                撮影から現在までのすべての編集・加工プロセス。改ざん不可能なデジタル署名の連鎖を表示しています。
            </DialogDescription>
            </DialogHeader>
        </div>

        {/* スクロールエリア (Flexbox方式に変更) */}
        {/* ScrollAreaを使わず、nativeのscrollを使うことでスマホでの操作感が統一されます */}
        <div className="flex-1 w-full min-h-0 overflow-y-auto px-6 pb-8 pt-0 scroll-smooth">
          {/* 上部の余白調整: Headerとの兼ね合いで pt-6 などを入れても良い */}
          <div className="pt-6 pb-6">
             <ProvenanceTimeline c2paSummary={c2paSummary} rootSigner={rootSigner} />
          </div>
        </div>
        
      </DialogContent>
    </Dialog>
  );
}