'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle, XCircle } from 'lucide-react';
import LoadingState from '@/app/components/LoadingState';

interface DownloadPageState {
  status: 'loading' | 'valid' | 'error';
  error?: string;
  downloadUrl?: string;
  expiresAt?: string;
  downloadCount?: number;
}

export default function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<DownloadPageState>({ status: 'loading' });

  useEffect(() => {
    async function validateToken() {
      try {
        // トークンの有効性を検証（実際にはダウンロードAPIに直接リダイレクトでもOK）
        const downloadUrl = `/api/download/${token}`;

        setState({
          status: 'valid',
          downloadUrl,
        });

      } catch (error) {
        console.error('Token validation error:', error);
        setState({
          status: 'error',
          error: 'ダウンロードリンクが無効または期限切れです',
        });
      }
    }

    if (token) {
      validateToken();
    }
  }, [token]);

  const handleDownload = async () => {
    if (!state.downloadUrl) return;

    try {
      // 1. ダウンロード情報を取得
      const infoResponse = await fetch(state.downloadUrl);
      if (!infoResponse.ok) {
        throw new Error('ダウンロード情報の取得に失敗しました');
      }

      const { presignedUrl, originalHash, fileExtension } = await infoResponse.json();

      // 2. 実際の画像バイナリを取得
      const imageResponse = await fetch(presignedUrl);
      if (!imageResponse.ok) {
        throw new Error('画像のダウンロードに失敗しました');
      }

      const blob = await imageResponse.blob();

      // 3. ダウンロード実行
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${originalHash}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      setState({
        status: 'error',
        error: 'ダウンロードに失敗しました',
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        {state.status === 'loading' && (
          <LoadingState fullScreen={false} message="ダウンロードリンクを確認中..." />
        )}

        {state.status === 'valid' && (
          <div className="text-center space-y-6">
            <div className="rounded-full bg-green-100 p-4 w-20 h-20 mx-auto flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                ダウンロード準備完了
              </h1>
              <p className="text-gray-600">
                購入いただきありがとうございます
              </p>
            </div>

            <Button
              onClick={handleDownload}
              className="w-full bg-indigo-600 hover:bg-indigo-700 py-6 text-lg font-bold"
            >
              <Download className="w-5 h-5 mr-2" />
              ダウンロード開始
            </Button>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs text-blue-800 leading-relaxed">
                ダウンロード後、c2pa.read()でファイルの真正性を検証できます
              </p>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="text-center space-y-6">
            <div className="rounded-full bg-red-100 p-4 w-20 h-20 mx-auto flex items-center justify-center">
              <XCircle className="w-12 h-12 text-red-600" />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                エラー
              </h1>
              <p className="text-gray-600">
                {state.error || 'ダウンロードリンクが無効です'}
              </p>
            </div>

            <Button
              onClick={() => router.push('/')}
              variant="outline"
              className="w-full"
            >
              ホームに戻る
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
