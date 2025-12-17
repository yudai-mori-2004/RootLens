'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2, Image as ImageIconLucide, Camera, X, ArrowRight, Shield } from 'lucide-react';
import { Link } from '@/lib/navigation'; // Changed from 'next/link'
import NextImage from 'next/image';
import Header from '@/app/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import AssetThumbnail from '@/app/components/AssetThumbnail';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('lens');
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
    setIsCameraOpen(true);
  };

  // カメラモーダルが開いたらstreamを取得してvideoに設定
  useEffect(() => {
    let mounted = true;

    const initCamera = async () => {
      if (!isCameraOpen || !videoRef.current) return;

      try {
        // カメラストリームを取得
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playError) {
            console.error("Video play error:", playError);
          }
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        if (mounted) {
          toast.error(t('cameraError'));
          setIsCameraOpen(false);
        }
      }
    };

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isCameraOpen, t]);

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
      toast.error(t('fileError'));
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
  }, [t]);

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
      toast.error(t('inputError'));
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
      toast.error(error instanceof Error ? error.message : t('error'));
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
            <ImageIconLucide className="w-12 h-12 text-blue-600 mb-2" />
            <p className="text-xl font-bold text-blue-700">{t('dragDrop')}</p>
          </div>
        </div>
      )}

      {/* カメラモーダル (シンプル版) */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-[100] bg-black">
          {/* 閉じるボタン */}
          <div className="absolute top-4 right-4 z-20">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 rounded-full w-12 h-12"
              onClick={stopCamera}
            >
              <X className="w-8 h-8" />
            </Button>
          </div>

          {/* カメラ映像（全画面） */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* シャッターボタン（下部固定） */}
          <div className="absolute bottom-0 left-0 right-0 z-20 p-8 flex items-center justify-center bg-gradient-to-t from-black/60 to-transparent">
            <button
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full border-4 border-white bg-transparent hover:bg-white/10 active:scale-95 transition-all"
              aria-label="撮影"
            >
              <div className="w-full h-full rounded-full border-2 border-white"></div>
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
            {t('title')} <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Search</span>
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto whitespace-pre-line">
            {t('subtitle')}
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
                  {imagePreview && (
                    <NextImage
                      src={imagePreview}
                      alt="Search Target"
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      style={{ objectFit: 'contain' }}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                     <Button variant="secondary" onClick={clearImage} className="rounded-full">
                       <X className="w-4 h-4 mr-2" /> {t('clear')}
                     </Button>
                  </div>
                </div>
              ) : (
                // テキスト入力モード
                <div className="flex items-center px-4 py-2">
                  <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
                  <Input 
                    placeholder={t('placeholder')}
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
                      title={t('lensSearch')}
                    >
                      <Camera className="w-5 h-5" />
                    </Button>
                    <div className="relative">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full"
                        onClick={() => fileInputRef.current?.click()}
                        title={t('upload')}
                      >
                        <ImageIconLucide className="w-5 h-5" />
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
                {!selectedImage && <span className="hidden sm:inline">{t('dropImage')}</span>}
                {selectedImage && <span className="text-blue-600 font-medium">{t('imageMode')}</span>}
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
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('searching')}
                  </>
                ) : (
                  <>
                    {t('search')} <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* 検索結果セクション */}
        <div id="results-section">
          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {searchResults.map((result, i) => (
                <Link
                  key={result.media_proof_id}
                  href={`/asset/${result.original_hash}`}
                  className="group block"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <Card className="overflow-hidden hover:shadow-md transition-all duration-300 border-slate-200 group bg-white rounded-xl p-0 gap-0">
                    <div className="relative aspect-video bg-slate-100 overflow-hidden border-b border-slate-100">
                      <AssetThumbnail
                        src={getThumbnailUrl(result.original_hash)}
                        alt={result.title || t('untitled')}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute top-2 right-2">
                        <Badge
                          variant="default"
                          className="backdrop-blur-md shadow-sm border-0 bg-indigo-500/90 hover:bg-indigo-600 text-white"
                        >
                          {Math.round(result.similarity * 100)}%
                        </Badge>
                      </div>
                    </div>

                    <CardHeader className="p-3 pb-2 space-y-1">
                      <CardTitle className="truncate text-sm font-bold text-slate-900">
                        {result.title || t('untitled')}
                      </CardTitle>
                      {result.description && (
                        <CardDescription className="text-xs text-slate-500 line-clamp-1 leading-tight">
                          {result.description}
                        </CardDescription>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-100 gap-2">
                        <div className="flex items-center gap-1 min-w-0 flex-1 truncate">
                          <Shield className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{result.cnft_mint_address.slice(0, 4)}...{result.cnft_mint_address.slice(-4)}</span>
                        </div>
                        <span className="font-bold text-indigo-600 flex-shrink-0 text-[10px]">
                          {result.price_lamports === 0 ? t('free') : `${(result.price_lamports / 1e9).toFixed(2)} SOL`}
                        </span>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* Empty States */}
          {!isSearching && searchResults.length === 0 && (selectedImage || queryText) && (
            <div className="text-center py-20 text-slate-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>{t('noResults')}</p>
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