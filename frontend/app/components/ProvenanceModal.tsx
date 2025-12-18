'use client';

import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import ProvenanceTimeline from './ProvenanceTimeline';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { History, Clock, X } from 'lucide-react'; // アイコンのバリエーション
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('components.provenanceModal');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] p-0 bg-white shadow-2xl rounded-xl sm:rounded-2xl flex flex-col overflow-hidden border border-slate-100 gap-0" showCloseButton={false}>
        
        {/* ヘッダー (固定: 前回のスタイルに合わせる) */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 shrink-0 z-10 sticky top-0">
            <DialogHeader className="text-left space-y-1">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    {/* アイコンのスタイルを統一 (例: 歴史なのでオレンジやアンバー、または落ち着いたSlate) */}
                    <div className="p-2.5 bg-orange-50 rounded-xl border border-orange-100 shrink-0">
                        <History className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
                    </div>
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                        {t('title')}
                    </DialogTitle>
                </div>
                <DialogClose className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-slate-100 data-[state=open]:text-slate-500 dark:ring-offset-slate-950 dark:focus:ring-slate-300 dark:data-[state=open]:bg-slate-800 dark:data-[state=open]:text-slate-400">
                    <X className="h-5 w-5" />
                    <span className="sr-only">Close</span>
                </DialogClose>
            </div>
            <DialogDescription className="text-slate-500 text-sm mt-2 sm:ml-14 leading-relaxed">
                {t('description')}
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