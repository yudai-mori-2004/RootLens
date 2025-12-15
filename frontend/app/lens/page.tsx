'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2, Image as ImageIcon, Camera, X, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import NextImage from 'next/image';
import Header from '@/app/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SearchResult {
  media_proof_id: string;
  similarity: number;
  arweave_tx_id: string;
  cnft_mint_address: string;
  original_hash: string;
  file_extension: string;
  title: string | null;
  description: string | null;
  price_lamports: number;
  owner_wallet: string;
  created_at: string;
}

export default function LensPage() {
  const [queryText, setQueryText] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [_generatedCaption, setGeneratedCaption] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // カメラ起動
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // 外カメラ優先
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraOpen(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      toast.error("カメラへのアクセスが許可されていません");
    }
  };

  // カメラ停止
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  // 写真撮影
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
            handleImageSelect(file);
            stopCamera();
          }
        }, 'image/jpeg');
      }
    }
  };

  // 画像選択処理
  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error("画像ファイルを選択してください");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setSelectedImage(file);
    setQueryText(''); // 画像選択時はテキストをクリア
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  }, []);

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 画像リサイズヘルパー
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        const MAX_SIZE = 800; // 検索精度向上のため少し大きく
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round(height * (MAX_SIZE / width));
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round(width * (MAX_SIZE / height));
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas to Blob failed'));
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = (error) => reject(error);
    });
  };

  const handleSearch = async () => {
    if (!selectedImage && !queryText.trim()) {
      toast.error("検索ワードまたは画像を入力してください");
      return;
    }

    setIsSearching(true);
    setGeneratedCaption(null);

    try {
      const lensWorkerUrl = process.env.NEXT_PUBLIC_LENS_WORKER_URL;
      if (!lensWorkerUrl) {
        throw new Error('LENS_WORKER_URL is not configured');
      }

      let response: Response;

      if (selectedImage) {
        const resizedBlob = await resizeImage(selectedImage);
        const formData = new FormData();
        formData.append('image', resizedBlob, 'search.jpg');

        response = await fetch(`${lensWorkerUrl}/search`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(`${lensWorkerUrl}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_text: queryText.trim() }),
        });
      }

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      setSearchResults(data.results || []);
      setGeneratedCaption(data.generated_caption);
      
      // 結果位置へスムーズスクロール（モバイル向け）
      if (window.innerWidth < 768) {
        setTimeout(() => {
          document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }

    } catch (error: unknown) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : "検索中にエラーが発生しました");
    } finally {
      setIsSearching(false);
    }
  };

  const getThumbnailUrl = (originalHash: string) => {
    return `${process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL}/media/${originalHash}/thumbnail.jpg`;
  };

  return (
    <div 
      className="min-h-screen bg-slate-50 relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* 全画面ドラッグオーバーレイ */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-blue-500/20 backdrop-blur-sm border-4 border-blue-500 border-dashed m-4 rounded-3xl flex items-center justify-center pointer-events-none">
          <div className="bg-white p-6 rounded-xl shadow-xl flex flex-col items-center animate-bounce">
            <ImageIcon className="w-12 h-12 text-blue-600 mb-2" />
            <p className="text-xl font-bold text-blue-700">画像をドロップして検索</p>
          </div>
        </div>
      )}

      {/* カメラモーダル (Google Lens風) */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="absolute top-4 right-4 z-10">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 rounded-full w-12 h-12" onClick={stopCamera}>
              <X className="w-8 h-8" />
            </Button>
          </div>
          
          <div className="flex-1 relative overflow-hidden flex items-center justify-center">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* スキャン演出用のオーバーレイ */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-64 h-64 border-2 border-white/50 rounded-lg relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white -mb-1 -mr-1"></div>
                <div className="w-full h-1 bg-blue-500/80 shadow-[0_0_10px_rgba(59,130,246,0.8)] absolute top-1/2 -translate-y-1/2 animate-scan"></div>
              </div>
              <p className="absolute bottom-20 text-white/80 text-sm font-medium bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
                対象を枠に合わせてください
              </p>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="h-32 bg-black flex items-center justify-center pb-8 pt-4">
            <button 
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full border-4 border-white p-1 hover:scale-95 transition-transform"
            >
              <div className="w-full h-full bg-white rounded-full"></div>
            </button>
          </div>
        </div>
      )}

      <Header />

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 py-8 md:py-16 pt-8 md:pt-16">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 bg-white">Verify Reality</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-slate-900">
            RootLens <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Search</span>
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            テキスト、画像、またはカメラから。<br className="md:hidden" />
            世界中の証明済みコンテンツを検索。
          </p>
        </div>

        {/* 統合検索バー */}
        <div className="max-w-3xl mx-auto mb-16 relative z-10">
          <div className={cn(
            "bg-white rounded-2xl shadow-xl border transition-all duration-300 overflow-hidden",
            isSearching ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-300"
          )}>
            <div className="p-2">
              {selectedImage ? (
                // 画像プレビューモード
                <div className="relative h-48 md:h-64 bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center group">
                  <NextImage 
                    src={imagePreview || ''} // srcはstringが必須なので空文字をフォールバック
                    alt="Search Target" 
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    style={{ objectFit: 'contain' }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                     <Button variant="secondary" onClick={clearImage} className="rounded-full">
                       <X className="w-4 h-4 mr-2" /> 解除
                     </Button>
                  </div>
                </div>
              ) : (
                // テキスト入力モード
                <div className="flex items-center px-4 py-2">
                  <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
                  <Input 
                    placeholder="何を検索しますか？ (例: 「夕焼けの海」)" 
                    className="border-none shadow-none focus-visible:ring-0 text-base sm:text-lg px-0 placeholder:text-slate-400 h-12"
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <div className="flex items-center gap-2 pl-2 border-l ml-2">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full"
                      onClick={startCamera}
                      title="カメラで検索"
                    >
                      <Camera className="w-5 h-5" />
                    </Button>
                    <div className="relative">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full"
                        onClick={() => fileInputRef.current?.click()}
                        title="画像をアップロード"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleImageSelect(e.target.files[0])}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 検索アクションバー */}
            <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 flex justify-between items-center">
              <div className="text-xs text-slate-400 flex items-center gap-2">
                {!selectedImage && <span className="hidden sm:inline">画像をここにドロップ</span>}
                {selectedImage && <span className="text-blue-600 font-medium">画像検索モード</span>}
              </div>
              <Button 
                onClick={handleSearch} 
                disabled={isSearching || (!queryText.trim() && !selectedImage)}
                className={cn(
                  "rounded-full px-6 transition-all duration-300",
                  (queryText.trim() || selectedImage) ? "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200" : "bg-slate-200 text-slate-400"
                )}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 検索中...
                  </>
                ) : (
                  <>
                    検索 <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* 検索結果セクション */}
        <div id="results-section">
          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6 animate-in fade-in duration-500">
              {searchResults.map((result, i) => (
                <Link
                  key={result.media_proof_id}
                  href={`/asset/${result.original_hash}`}
                  className="group block"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <Card className="overflow-hidden border-slate-200 hover:border-blue-300 hover:shadow-xl transition-all duration-300 h-full">
                    <div className="relative aspect-square overflow-hidden bg-slate-100">
                      <NextImage
                        src={getThumbnailUrl(result.original_hash)}
                        alt={result.title || 'Untitled'}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        style={{ objectFit: 'cover' }}
                        loading="lazy"
                      />
                      <div className="absolute top-2 right-2">
                        <Badge variant="secondary" className="bg-black/60 text-white hover:bg-black/70 backdrop-blur-sm border-none text-[10px] px-1.5 py-0.5 md:text-xs md:px-2.5 md:py-0.5">
                          {Math.round(result.similarity * 100)}%
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-3 md:p-4">
                      <h3 className="font-semibold text-slate-900 truncate mb-1 group-hover:text-blue-600 transition-colors text-sm md:text-base">
                        {result.title || 'Untitled'}
                      </h3>
                      <p className="text-xs text-slate-500 line-clamp-2 mb-2 md:mb-3 h-8 md:h-10">
                        {result.description || 'No description'}
                      </p>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <span className="text-[10px] md:text-xs text-slate-400">
                          {new Date(result.created_at).toLocaleDateString()}
                        </span>
                        <span className="font-bold text-blue-600 text-xs md:text-sm">
                          {result.price_lamports === 0
                            ? 'Free'
                            : `${(result.price_lamports / 1e9).toFixed(2)} SOL`}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* Empty States */}
          {!isSearching && searchResults.length === 0 && (selectedImage || queryText) && (
            <div className="text-center py-20 text-slate-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>条件に一致するコンテンツは見つかりませんでした</p>
            </div>
          )}
        </div>
      </main>
      
      <style jsx global>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan {
          animation: scan 2s linear infinite;
        }
      `}</style>
    </div>
  );
}