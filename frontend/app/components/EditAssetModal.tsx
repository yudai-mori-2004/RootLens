'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PenTool, Save, Loader2, Sparkles, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface EditAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mediaProofId: string;
  currentTitle: string;
  currentDescription: string;
  currentPriceLamports: number;
  walletAddress: string;
}

export default function EditAssetModal({
  isOpen,
  onClose,
  onSuccess,
  mediaProofId,
  currentTitle,
  currentDescription,
  currentPriceLamports,
  walletAddress,
}: EditAssetModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const [description, setDescription] = useState(currentDescription);
  // 表示用はSOL単位、保存用はLamports
  const [priceSol, setPriceSol] = useState(currentPriceLamports / 1_000_000_000);
  const [isSaving, setIsSaving] = useState(false);

  // モーダルが開くたびに初期値をセット
  useEffect(() => {
    if (isOpen) {
      setTitle(currentTitle);
      setDescription(currentDescription || '');
      setPriceSol(currentPriceLamports / 1_000_000_000);
    }
  }, [isOpen, currentTitle, currentDescription, currentPriceLamports]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const priceLamports = Math.floor(priceSol * 1_000_000_000);

      const response = await fetch('/api/creator-content/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaProofId,
          walletAddress,
          title,
          description,
          price: priceLamports,
        }),
      });

      if (!response.ok) {
        throw new Error('更新に失敗しました');
      }

      toast.success('アセット情報を更新しました');
      onSuccess();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('エラーが発生しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => !isSaving && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white shadow-2xl rounded-xl border border-slate-100 gap-0">
        
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 rounded-xl border border-indigo-100 shrink-0">
              <PenTool className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">
                アセット情報の編集
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-sm mt-0.5">
                公開されるタイトルや価格を変更します
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-500" />
              タイトル
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="アセットのタイトル"
              className="focus-visible:ring-indigo-500 focus-visible:border-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-500" />
              説明
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="アセットの詳細な説明"
              className="resize-none focus-visible:ring-indigo-500 focus-visible:border-indigo-500 min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              販売価格 (SOL)
            </Label>
            <div className="relative">
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={priceSol}
                onChange={(e) => setPriceSol(parseFloat(e.target.value))}
                className="pl-4 pr-12 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 font-mono"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <span className="text-slate-400 font-bold text-xs">SOL</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              ※ 0 SOLに設定すると無料ダウンロード可能になります
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
            className="text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm min-w-[100px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                保存中
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                保存する
              </>
            )}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
