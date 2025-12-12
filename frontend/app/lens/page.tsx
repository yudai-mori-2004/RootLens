'use client';

import { useState } from 'react';
import { Upload, Search, Loader2, Image as ImageIcon, Text } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea'; // Textareaをインポート

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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [queryText, setQueryText] = useState<string>(''); // テキスト検索用ステート
  const [generatedCaption, setGeneratedCaption] = useState<string | null>(null); // 生成されたキャプション表示用

  // 画像リサイズヘルパー
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        const MAX_SIZE = 512;
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
          0.8
        );
      };
      img.onerror = (error) => reject(error);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // プレビュー表示
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setSelectedFile(file);
    setQueryText(''); // 画像選択時はテキストをクリア
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setSelectedFile(file);
    setQueryText(''); // 画像選択時はテキストをクリア
  };

  const handleSearch = async () => {
    if (!selectedFile && !queryText.trim()) {
      alert('検索する画像またはテキストを入力してください');
      return;
    }

    setIsSearching(true);
    setGeneratedCaption(null); // 前回のキャプションをクリア

    try {
      const lensWorkerUrl = process.env.NEXT_PUBLIC_LENS_WORKER_URL;
      if (!lensWorkerUrl) {
        throw new Error('LENS_WORKER_URL is not configured');
      }

      let response: Response;

      if (selectedFile) {
        // 画像検索
        const resizedBlob = await resizeImage(selectedFile);
        const resizedFile = new File([resizedBlob], selectedFile.name, {
          type: 'image/jpeg',
        });

        const formData = new FormData();
        formData.append('image', resizedFile);

        response = await fetch(`${lensWorkerUrl}/search`, {
          method: 'POST',
          body: formData,
        });
      } else {
        // テキスト検索
        response = await fetch(`${lensWorkerUrl}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_text: queryText.trim() }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Search failed: ${errorText}`);
      }

      const data = await response.json();
      setSearchResults(data.results || []);
      setGeneratedCaption(data.generated_caption || null); // 生成されたキャプションを取得
    } catch (error) {
      console.error('Search error:', error);
      alert(`検索に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  };

  const getThumbnailUrl = (originalHash: string) => {
    return `${process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL}/media/${originalHash}/thumbnail.jpg`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Lens - 類似画像検索</h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            画像またはテキストから類似する証明済みコンテンツを検索
          </p>
        </div>

        {/* Search Input Area */}
        <div className="max-w-2xl mx-auto mb-12 bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700">
          {/* Image Upload Area */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <ImageIcon className="w-6 h-6 text-blue-500" /> 画像で検索
            </h2>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer relative"
            >
              {imagePreview ? (
                <div className="space-y-4">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="max-h-64 mx-auto rounded-lg shadow-md"
                  />
                  <div className="flex gap-4 justify-center">
                    <Button asChild variant="outline" className="flex items-center gap-2">
                      <label className="cursor-pointer flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        別の画像を選択
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>
                    </Button>
                    <Button onClick={handleSearch} disabled={isSearching} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700">
                      {isSearching ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          検索中...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4" />
                          画像で検索
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <label className="cursor-pointer block py-8">
                  <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-lg mb-2">画像をドロップまたはクリックして選択</p>
                  <p className="text-sm text-gray-500">JPG, PNG, GIF対応</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
            <span className="flex-shrink mx-4 text-gray-400 dark:text-gray-500 text-sm">または</span>
            <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
          </div>

          {/* Text Search Area */}
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Text className="w-6 h-6 text-green-500" /> テキストで検索
            </h2>
            <Textarea
              placeholder="例: 夕焼けのビーチとヤシの木"
              value={queryText}
              onChange={(e) => {
                setQueryText(e.target.value);
                setImagePreview(null); // テキスト入力時は画像をクリア
                setSelectedFile(null);
              }}
              rows={4}
              className="mb-4 focus-visible:ring-green-500 focus-visible:border-green-500"
            />
            <Button
              onClick={handleSearch}
              disabled={isSearching || !queryText.trim()}
              className="w-full flex items-center gap-2 bg-green-600 hover:bg-green-700"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  検索中...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  テキストで検索
                </>
              )}
            </Button>
          </div>
        </div>
        
        {/* Generated Caption (Debug/Viz) */}
        {generatedCaption && (
          <div className="max-w-2xl mx-auto mb-12 p-6 bg-blue-50 dark:bg-blue-900 rounded-lg shadow-inner border border-blue-200 dark:border-blue-700">
            <h3 className="font-bold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
              <Text className="w-4 h-4" /> 生成されたキャプション / 検索テキスト
            </h3>
            <p className="text-blue-700 dark:text-blue-300 text-sm italic">
              "{generatedCaption}"
            </p>
          </div>
        )}

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-6">
              検索結果 ({searchResults.length}件)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {searchResults.map((result) => (
                <Link
                  key={result.media_proof_id}
                  href={`/proof/${result.original_hash}`}
                  className="group"
                >
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="relative aspect-square">
                      <img
                        src={getThumbnailUrl(result.original_hash)}
                        alt={result.title || 'Untitled'}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        {Math.round(result.similarity * 100)}%
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold mb-1 truncate group-hover:text-blue-600 transition-colors">
                        {result.title || 'Untitled'}
                      </h3>
                      {result.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
                          {result.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>
                          {result.price_lamports === 0
                            ? '無料'
                            : `${(result.price_lamports / 1e9).toFixed(2)} SOL`}
                        </span>
                        <span>{new Date(result.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {searchResults.length === 0 && imagePreview && !isSearching && !queryText.trim() && (
          <div className="text-center text-gray-500 py-12">
            画像またはテキストを入力して検索を開始してください
          </div>
        )}
        {searchResults.length === 0 && (imagePreview || queryText.trim()) && !isSearching && (
          <div className="text-center text-gray-500 py-12">
            検索結果が見つかりませんでした
          </div>
        )}
      </div>
    </div>
  );
}
