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
import { ScrollArea } from '@/components/ui/scroll-area';

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
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>コンテンツの来歴</DialogTitle>
          <DialogDescription>
            このメディアの作成から現在までの履歴を表示しています
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="px-6 pb-6 max-h-[calc(90vh-8rem)]">
          <ProvenanceTimeline c2paSummary={c2paSummary} rootSigner={rootSigner} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
