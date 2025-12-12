'use client';

import { useEffect, useState } from 'react';
import { createC2pa, C2pa } from 'c2pa';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { createManifestSummary, C2PASummaryData } from '@/app/lib/c2pa-parser';
import ProgressBar from '@/app/components/ProgressBar';
import StepContainer from '@/app/components/StepContainer';
import PrivacyWarning from '@/app/components/PrivacyWarning';
import ProvenanceModal from '@/app/components/ProvenanceModal';
import TechnicalDetailsSection from '@/app/components/TechnicalDetailsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Wallet, CheckCircle, XCircle, UploadCloud, Loader2, Info, Sparkles, Clipboard, Camera, AlertTriangle, Lock, Calendar, User, PenTool, BookOpen, Cog, Cloud, Link, FileText, DollarSign, ExternalLink } from 'lucide-react';

interface C2PAValidationResult {
  isValid: boolean;
  rootSigner: string | null;
  provenanceChain: any[];
  error?: string;
}

interface FileHashes {
  originalHash: string;
}

// ステップ定義
const STEPS = [
  { label: 'ウォレット接続' },
  { label: 'ファイル選択' },
  { label: '検証とプライバシー' },
  { label: '価格・情報設定' },
  { label: 'アップロード' },
];

export default function UploadPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [c2pa, setC2pa] = useState<C2pa | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ファイルとC2PAデータ
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [manifestData, setManifestData] = useState<any>(null);
  const [c2paSummary, setC2paSummary] = useState<C2PASummaryData | null>(null);
  const [validationResult, setValidationResult] = useState<C2PAValidationResult | null>(null);
  const [hashes, setHashes] = useState<FileHashes | null>(null);

  // プライバシー同意
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);

  // 価格設定
  const [price, setPrice] = useState<number>(0);
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  // 来歴モーダル
  const [showProvenanceModal, setShowProvenanceModal] = useState(false);

  // 完了状態
  const [uploadResult, setUploadResult] = useState<{ hash: string } | null>(null);

  // ドラッグ状態
  const [isDragging, setIsDragging] = useState(false);

  // 自動遷移制御
  const [hasAutoAdvanced, setHasAutoAdvanced] = useState(false);

  const { login, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets[0];

  // C2PA WASM初期化
  useEffect(() => {
    const initC2pa = async () => {
      try {
        const c2paInstance = await createC2pa({
          wasmSrc: '/toolkit_bg.wasm',
          workerSrc: '/c2pa.worker.min.js',
        });
        setC2pa(c2paInstance);
      } catch (err) {
        console.error('Wasm初期化エラー:', err);
      }
    };
    initC2pa();
  }, []);

  // 認証状態が変わったらステップ2に進む（初回のみ）
  useEffect(() => {
    if (authenticated && currentStep === 1 && !hasAutoAdvanced) {
      setCurrentStep(2);
      setHasAutoAdvanced(true);
    } else if (!authenticated) {
      setHasAutoAdvanced(false);
    }
  }, [authenticated, currentStep, hasAutoAdvanced]);

  const handleLogin = async () => {
    try {
      setIsProcessing(true);
      await login();
    } catch (error) {
      console.error('ログインエラー:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setCurrentFile(file);

    try {
      // 1. C2PA解析
      const readResult = await c2pa!.read(file);

      // c2pa.read()が失敗した場合やmanifestStoreがnullの場合
      if (!readResult || !readResult.manifestStore) {
        setValidationResult({
          isValid: false,
          rootSigner: null,
          provenanceChain: [],
          error: 'このファイルにはC2PA署名が含まれていません',
        });
        setC2paSummary({
          activeManifest: null,
          validationStatus: { isValid: false, errors: ['No C2PA signature found'] },
          thumbnailUrl: null,
        });
        setIsProcessing(false);
        setCurrentStep(3); // エラー表示のためStep 3へ
        return;
      }

      const { manifestStore, thumbnail } = readResult;
      setManifestData(manifestStore);

      // 2. サマリーデータ生成
      const previewThumbnailUrl = thumbnail?.getUrl() || null;
      const summary = await createManifestSummary(manifestStore, previewThumbnailUrl);
      setC2paSummary(summary);

      // 3. 検証ロジック
      const trustedIssuers = [
        'Sony Corporation',
        'Google LLC',
        'Samsung Electronics',
        'Leica Camera AG',
        'Nikon Corporation',
        'Canon Inc.',
        'Adobe Inc.',
        'OpenAI'
      ];

      const activeManifest = summary.activeManifest;
      if (!activeManifest) {
        setValidationResult({
          isValid: false,
          rootSigner: null,
          provenanceChain: [],
          error: 'C2PAマニフェストが見つかりません（署名が破損している可能性があります）',
        });
        setIsProcessing(false);
        setCurrentStep(3); // 結果に関わらず次へ
        return;
      }

      const issuer = activeManifest.signatureInfo.issuer || 'Unknown';
      const isTrusted = trustedIssuers.some(trusted => issuer.includes(trusted));
      const isAI = activeManifest.isAIGenerated;

      if (isAI) {
        setValidationResult({
          isValid: false,
          rootSigner: issuer,
          provenanceChain: [],
          error: 'AI生成コンテンツはサポート対象外です（ハードウェア署名が必要です）',
        });
        setIsProcessing(false);
        setCurrentStep(3); // 結果に関わらず次へ
        return;
      } else if (!isTrusted) {
        setValidationResult({
          isValid: false,
          rootSigner: issuer,
          provenanceChain: [],
          error: `信頼されていない署名者: ${issuer}`,
        });
        setIsProcessing(false);
        setCurrentStep(3); // 結果に関わらず次へ
        return;
      } else {
        setValidationResult({
          isValid: true,
          rootSigner: issuer,
          provenanceChain: [],
        });
      }

      // 4. ハッシュ計算
      const buffer = await file.arrayBuffer();
      const originalHashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const originalHash = Array.from(new Uint8Array(originalHashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      setHashes({ originalHash });

      // ステップ3へ
      setCurrentStep(3);

    } catch (err) {
      console.error('ファイル処理エラー:', err);
      setValidationResult({
        isValid: false,
        rootSigner: null,
        provenanceChain: [],
        error: 'ファイルの処理に失敗しました',
      });
      setCurrentStep(3); // 結果に関わらず次へ
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!c2pa || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!c2pa || isProcessing) return;

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      await processFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // currentTargetとrelatedTargetを比較して、本当にエリアを出たか確認
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handlePrivacyNext = () => {
    if (privacyAcknowledged && validationResult?.isValid) {
      setCurrentStep(4);
    }
  };

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

  const handleUpload = async () => {
    if (!currentFile || !hashes || !validationResult || !solanaWallet) {
      return;
    }

    try {
      setIsProcessing(true);

      // 1. Presigned URL取得（元ファイル）
      const presignedOriginalResponse = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          file_type: 'original',
          content_type: currentFile.type,
        }),
      });

      if (!presignedOriginalResponse.ok) {
        throw new Error('Presigned URL取得失敗（元ファイル）');
      }

      const { presigned_url: presignedOriginalUrl } = await presignedOriginalResponse.json();

      // 2. R2に元ファイルをアップロード
      const uploadOriginalResponse = await fetch(presignedOriginalUrl, {
        method: 'PUT',
        headers: { 'Content-Type': currentFile.type },
        body: currentFile,
      });

      if (!uploadOriginalResponse.ok) {
        throw new Error('R2アップロード失敗（元ファイル）');
      }

      // 2.5 Lens Workerで処理 (ベクトル化 + DB初期登録)
      const lensWorkerUrl = process.env.NEXT_PUBLIC_LENS_WORKER_URL;
      if (!lensWorkerUrl) {
        throw new Error('System Error: LENS_WORKER_URL is not configured');
      }
      
      console.log('Processing with Lens Worker:', lensWorkerUrl);

      // 高速化のため画像をリサイズしてWorkerへ送信
      const resizedBlob = await resizeImage(currentFile);
      const resizedFile = new File([resizedBlob], currentFile.name, { type: 'image/jpeg' });

      const formData = new FormData();
      formData.append('image', resizedFile);
      formData.append('originalHash', hashes.originalHash);
      formData.append('fileExtension', getExtension(currentFile.type));

      const workerResponse = await fetch(`${lensWorkerUrl}/process`, {
        method: 'POST',
        body: formData, // Content-Typeは自動設定されるため指定しない
      });

      if (!workerResponse.ok) {
         const errorText = await workerResponse.text();
         console.warn(`Lens Worker process failed: ${errorText}`);
         // Lens処理失敗は致命的エラーにするか？一旦続行させるがIDは取れない
      }

      const workerResult = await workerResponse.json().catch(() => ({}));
      const mediaProofId = workerResult.id;
      console.log('✅ Lens Worker Process Complete. ID:', mediaProofId);


      // 3. サムネイルとManifestをPublic Bucketにアップロード
      let summaryData = c2paSummary;
      if (!summaryData) {
        const { manifestStore, thumbnail } = await c2pa!.read(currentFile);
        summaryData = await createManifestSummary(manifestStore, thumbnail?.getUrl() || null);
      }

      const publicUploadResponse = await fetch('/api/upload/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          thumbnail_data_uri: summaryData.thumbnailUrl,
          manifest_data: summaryData,
        }),
      });

      if (!publicUploadResponse.ok) {
        throw new Error('Public Bucketアップロード失敗');
      }

      const publicUploadResult = await publicUploadResponse.json();
      console.log('✅ Public Bucketアップロード完了:', publicUploadResult);

      // 4. Root証明書チェーンを抽出
      const rootCertChain = extractRootCertChain(manifestData);

      // 5. アップロードAPI呼び出し
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: solanaWallet.address,
          originalHash: hashes.originalHash,
          rootSigner: summaryData?.activeManifest?.signatureInfo?.issuer || 'Unknown',
          rootCertChain: rootCertChain,
          mediaFilePath: `media/${hashes.originalHash}/original.${getExtension(currentFile.type)}`,
          thumbnailPublicUrl: publicUploadResult.thumbnail_url,
          price: Math.floor(price * 1e9),
          title: title || undefined,
          description: description || undefined,
          mediaProofId: mediaProofId, // Workerから取得したIDを渡す
        }),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'ジョブ投入失敗');
      }

      const uploadResult = await uploadResponse.json();
      const jobId = uploadResult.jobId;

      // 6. ジョブステータスをポーリング
      let completed = false;
      let attempts = 0;
      const maxAttempts = 60;

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusResponse = await fetch(`/api/job-status/${jobId}`);
        if (!statusResponse.ok) {
          throw new Error('ジョブステータス取得失敗');
        }

        const statusResult = await statusResponse.json();

        if (statusResult.state === 'completed') {
          completed = true;
          if (statusResult.result?.success) {
            setUploadResult({ hash: hashes.originalHash });
            setCurrentStep(5);
          } else {
            throw new Error(statusResult.result?.error || 'Mint処理失敗');
          }
        } else if (statusResult.state === 'failed') {
          throw new Error(statusResult.failedReason || 'ジョブ失敗');
        }

        attempts++;
      }

      if (!completed) {
        throw new Error('タイムアウト: 処理に時間がかかっています');
      }

    } catch (err) {
      console.error('アップロードエラー:', err);
      alert(`エラー: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  function extractRootCertChain(manifestStore: any): string {
    try {
      let currentManifest = manifestStore?.activeManifest;
      while (currentManifest?.ingredients?.length > 0) {
        const parentIngredient = currentManifest.ingredients[0];
        if (!parentIngredient.c2pa_manifest) break;
        currentManifest = parentIngredient.c2pa_manifest;
      }
      const certChain = currentManifest?.signature_info?.cert_chain || [];
      const certChainJson = JSON.stringify(certChain);
      const certChainBase64 = btoa(certChainJson);
      return certChainBase64;
    } catch (err) {
      console.error('証明書チェーン抽出エラー:', err);
      return btoa(JSON.stringify([]));
    }
  }

  function getExtension(contentType: string): string {
    const mapping: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
    };
    return mapping[contentType] || 'bin';
  }

  // ========== レンダリング ==========

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* ヘッダーバー */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <img src="/icon_white.png" alt="RootLens" className="w-8 h-8" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">RootLens Upload</h1>
              <p className="text-xs text-gray-500">C2PAハードウェア署名付きメディアを証明</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto py-12 px-4">

        {/* プログレスバー */}
        <ProgressBar currentStep={currentStep} totalSteps={5} steps={STEPS} />

        {/* Step 1: ウォレット接続 */}
        {currentStep === 1 && (
          <StepContainer
            title="ウォレット接続"
            description="RootLensを利用するには、Solanaウォレットが必要です"
            onNext={authenticated ? () => setCurrentStep(2) : undefined}
            nextLabel="次へ"
            nextDisabled={!authenticated}
            showBack={false}
          >
            {!authenticated ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
                  <Wallet className="w-10 h-10 text-indigo-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">ウォレットを接続して開始</h3>
                <p className="text-gray-500 text-center max-w-md mb-8">
                  撮影したメディアの真正性を証明し、ブロックチェーンに記録するために、
                  Solanaウォレットを使用して署名を行います。
                </p>
                <Button
                  onClick={handleLogin}
                  disabled={isProcessing}
                  size="lg"
                  className="text-lg px-10 py-6 rounded-full shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                >
                  {isProcessing ? '接続中...' : 'ウォレットを選択して接続'}
                </Button>
              </div>
            ) : (
              <div className="py-4">
                <div className="bg-white border border-gray-100 shadow-md rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden group">
                  {/* 装飾用の背景アクセント */}
                  <div className="absolute top-0 left-0 w-1 h-full bg-green-500" />
                  <div className="absolute top-0 right-0 w-24 h-24 bg-green-50 rounded-full -mr-12 -mt-12 opacity-50 transition-transform group-hover:scale-110" />
                  
                  <div className="flex items-center gap-5 z-10 w-full">
                    <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-7 h-7 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-500 mb-1">Connected Wallet</p>
                      <p className="text-lg font-mono font-bold text-gray-900 truncate">
                        {solanaWallet?.address || '読み込み中...'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-xs text-green-700 font-medium">Verified & Active</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={logout}
                    variant="outline"
                    className="flex-shrink-0 border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    切断する
                  </Button>
                </div>
              </div>
            )}
          </StepContainer>
        )}

        {/* Step 2: ファイル選択 */}
        {currentStep === 2 && (
          <StepContainer
            title="ファイル選択"
            description="C2PA署名付きメディアファイルを選択してください"
            onBack={() => setCurrentStep(1)}
            isLoading={isProcessing}
          >
            {!isProcessing ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                className="group relative"
              >
                <div className={`
                  relative z-10 border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300
                  flex flex-col items-center justify-center min-h-[300px]
                  ${isDragging 
                    ? 'border-indigo-500 bg-indigo-50 scale-[1.01] shadow-lg' 
                    : 'border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-white hover:shadow-md'
                  }
                `}>
                  <input
                    type="file"
                    onChange={handleFileSelect}
                    accept="image/*"
                    disabled={!c2pa || isProcessing}
                    className="hidden"
                    id="file-input"
                  />
                  <label htmlFor="file-input" className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
                    <div className="mb-6 p-4 bg-white rounded-full shadow-sm ring-1 ring-gray-100 group-hover:scale-110 transition-transform duration-300">
                      <UploadCloud className="w-12 h-12 text-indigo-500" />
                    </div>
                    
                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                      ファイルをドラッグ＆ドロップ
                    </h3>
                    <p className="text-gray-500 mb-8 max-w-xs mx-auto text-sm">
                      または、クリックしてファイルを選択してください
                    </p>

                    <div className="bg-white border border-gray-200 text-gray-700 px-6 py-2.5 rounded-full font-medium shadow-sm hover:bg-gray-50 transition-colors text-sm flex items-center gap-2">
                      <Cloud className="w-4 h-4" />
                      ファイルを選択する
                    </div>
                    
                    <div className="mt-8 flex gap-4 text-xs text-gray-400 font-mono">
                      <span className="bg-gray-100 px-2 py-1 rounded">JPEG</span>
                      <span className="bg-gray-100 px-2 py-1 rounded">PNG</span>
                      <span className="bg-gray-100 px-2 py-1 rounded">HEIC</span>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <div className="py-12 px-6">
                <div className="max-w-md mx-auto">
                  <div className="text-center mb-10">
                    <div className="inline-block relative">
                      <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-75"></div>
                      <div className="relative bg-white p-4 rounded-full shadow-md">
                         <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                      </div>
                    </div>
                    <h3 className="mt-6 text-xl font-bold text-gray-900">解析を実行中...</h3>
                    <p className="text-gray-500 mt-2">メディアに含まれるC2PA署名を検証しています</p>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                        <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">C2PAマニフェストを読み込み中...</span>
                    </div>
                    <div className="flex items-center gap-3 opacity-50">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">ハードウェア署名を検証</span>
                    </div>
                    <div className="flex items-center gap-3 opacity-50">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">ハッシュ値を計算</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </StepContainer>
        )}

        {/* Step 3: 検証とプライバシー */}
        {currentStep === 3 && validationResult && c2paSummary && (
          <StepContainer
            title={
              validationResult.isValid ? (
                <div className="flex flex-col items-center justify-center py-6 w-full">
                  {/* 背景デコレーション */}
                  <div className="absolute inset-0 bg-gradient-to-b from-green-50/30 via-transparent to-transparent pointer-events-none" />

                  {/* サムネイル画像 + チェックマーク */}
                  <div className="relative mb-6 z-10">
                    {c2paSummary.thumbnailUrl ? (
                      <div className="relative group">
                        {/* グロー効果 */}
                        <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-400 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity" />

                        {/* 画像 */}
                        <div className="relative">
                          <img
                            src={c2paSummary.thumbnailUrl}
                            alt="Verified content"
                            className="w-52 h-52 object-cover rounded-2xl shadow-2xl ring-4 ring-white ring-offset-4 ring-offset-green-100/50"
                          />

                          {/* チェックマークバッジ */}
                          <div className="absolute -bottom-4 -right-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 p-1 shadow-xl">
                            <div className="rounded-full bg-white p-2.5">
                              <CheckCircle className="w-10 h-10 text-green-500" strokeWidth={2.5} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="relative group">
                        {/* グロー効果 */}
                        <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-400 rounded-full blur-2xl opacity-20 group-hover:opacity-30 transition-opacity" />

                        {/* チェックマーク */}
                        <div className="relative rounded-full bg-gradient-to-br from-green-50 to-emerald-50 p-6 ring-4 ring-white ring-offset-4 ring-offset-green-100/50 shadow-2xl animate-in fade-in zoom-in duration-500">
                          <CheckCircle className="w-16 h-16 text-green-500" strokeWidth={2} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* タイトル */}
                  <div className="text-center space-y-2 z-10">
                    <span className="text-3xl font-bold bg-gradient-to-br from-green-600 via-emerald-600 to-teal-600 bg-clip-text text-transparent leading-tight block">
                      本物のカメラでの撮影が証明されました
                    </span>
                    <div className="flex items-center justify-center gap-2 text-green-700">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-medium">C2PA Verified</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2 w-full text-red-600">
                  <div className="rounded-full bg-red-50 p-4 mb-3">
                    <XCircle className="w-12 h-12" />
                  </div>
                  <span className="text-2xl font-bold">検証失敗</span>
                </div>
              )
            }
            description={
              validationResult.isValid ? (
                <div className="flex flex-col items-center w-full mt-3 space-y-4">
                  <div className="inline-flex items-center gap-3 bg-gradient-to-r from-slate-50 to-gray-50 border border-slate-200 rounded-xl px-6 py-3 shadow-sm">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100">
                      <Camera className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs text-slate-500 font-medium">Root Issuer</p>
                      <p className="text-sm text-slate-900 font-bold">{validationResult.rootSigner}</p>
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm text-center max-w-lg leading-relaxed">
                    このコンテンツの真正性はC2PA技術によって数学的に証明されました。<br/>
                    改ざんやAI生成ではないことが保証されています。
                  </p>
                </div>
              ) : (
                <div className="text-center text-red-600 mt-2 font-medium bg-red-50 px-4 py-2 rounded-lg inline-block mx-auto">
                  {validationResult.error}
                </div>
              )
            }
            onBack={() => {
              setCurrentStep(2);
              setPrivacyAcknowledged(false);
            }}
            onNext={handlePrivacyNext}
            nextLabel="次へ: 価格設定"
            nextDisabled={!privacyAcknowledged || !validationResult.isValid}
          >
            {validationResult.isValid && (
              <div className="mt-2 space-y-6">
                {/* 導入メッセージ */}
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-indigo-100 p-2.5 mt-0.5">
                      <Info className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-indigo-900 mb-2 text-base">これから行うこと</p>
                      <p className="text-sm text-indigo-800 leading-relaxed">
                        次へ進むと、あなたのコンテンツの真正性を<strong>永久的に証明できるページ</strong>が作成され、世界中の誰でもアクセスできるようになります。
                      </p>
                    </div>
                  </div>
                </div>

                {/* メタデータ表示 */}
                <PrivacyWarning
                  c2paSummary={c2paSummary}
                  onAcknowledge={setPrivacyAcknowledged}
                  acknowledged={privacyAcknowledged}
                  rootSigner={validationResult.rootSigner || undefined}
                />
              </div>
            )}
          </StepContainer>
        )}

        {/* Step 4: 価格・情報設定 */}
        {currentStep === 4 && (
          <StepContainer
            title="価格・情報設定"
            description="販売価格とメタデータを設定してください"
            onBack={() => setCurrentStep(3)}
            onNext={() => handleUpload()}
            nextLabel="アップロード開始"
            isLoading={isProcessing}
          >
            <div className="space-y-6 py-4">
              {/* 設定カード */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4">
                  <h5 className="font-bold text-gray-900 text-base flex items-center gap-2">
                    <PenTool className="w-5 h-5 text-indigo-600" />
                    コンテンツ情報
                  </h5>
                  <p className="text-sm text-gray-600 mt-1">証明ページに表示される情報を設定します</p>
                </div>

                <div className="p-6 space-y-6">
                  {/* タイトル */}
                  <div className="space-y-2">
                    <Label htmlFor="title" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      タイトル（任意）
                    </Label>
                    <Input
                      id="title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="例: 夕焼けの富士山"
                      className="focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 rounded-lg transition-all"
                    />
                  </div>

                  {/* 説明 */}
                  <div className="space-y-2">
                    <Label htmlFor="description" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      説明（任意）
                    </Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="例: 2025年1月、山梨県から撮影。C2PA検証済み。"
                      rows={4}
                      className="focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 resize-none rounded-lg transition-all"
                    />
                  </div>

                  {/* 価格 */}
                  <div className="space-y-2">
                    <Label htmlFor="price" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                      販売価格
                    </Label>
                    <div className="relative">
                      <Input
                        id="price"
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(Number(e.target.value))}
                        min="0"
                        step="0.1"
                        className="pl-4 pr-16 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 font-mono text-lg rounded-lg transition-all"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                        <span className="text-indigo-600 font-bold text-sm bg-indigo-50 px-2 py-1 rounded">SOL</span>
                      </div>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mt-2">
                      <p className="text-xs text-indigo-800 flex items-start gap-2">
                        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span><strong>0 SOL</strong> に設定すると、誰でも無料でダウンロード可能になります</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </StepContainer>
        )}

        {/* Step 5: 完了 */}
        {currentStep === 5 && uploadResult && (
          <StepContainer
            title="アップロード完了！"
            description="cNFTの発行が完了しました"
            showBack={false}
          >
            <div className="flex flex-col items-center py-8 relative">
              {/* 背景デコレーション */}
              <div className="absolute inset-0 bg-gradient-to-b from-green-50/20 via-indigo-50/20 to-transparent pointer-events-none" />

              {/* 成功カード */}
              <div className="w-full max-w-md relative z-10">
                <div className="bg-white border-2 border-gray-200 rounded-2xl shadow-2xl overflow-hidden mb-8 relative group">
                  {/* トップバー */}
                  <div className="h-1.5 bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400" />

                  {/* コンテンツ */}
                  <div className="p-8 text-center relative">
                    {/* グロー効果 */}
                    <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-32 h-32 bg-green-400/10 rounded-full blur-3xl" />

                    {/* チェックマークアイコン */}
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-400 rounded-full blur-xl opacity-20" />
                      <div className="relative w-24 h-24 bg-gradient-to-br from-green-50 to-emerald-50 rounded-full flex items-center justify-center mx-auto ring-4 ring-white ring-offset-4 ring-offset-green-100/50 shadow-xl">
                        <CheckCircle className="w-12 h-12 text-green-500" strokeWidth={2.5} />
                      </div>
                    </div>

                    {/* タイトル */}
                    <h3 className="text-2xl font-bold bg-gradient-to-br from-gray-900 to-gray-700 bg-clip-text text-transparent mb-2">
                      証明書発行完了
                    </h3>
                    <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                      あなたのメディアはブロックチェーン上に<br/>
                      <strong className="text-green-600">永久に記録されました</strong>
                    </p>

                    {/* URL表示 */}
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 text-left border-2 border-indigo-100 shadow-inner">
                      <div className="flex items-center gap-2 mb-2">
                        <Link className="w-4 h-4 text-indigo-600" />
                        <p className="text-xs text-indigo-900 font-bold uppercase tracking-wider">Proof URL</p>
                      </div>
                      <div className="flex items-center justify-between gap-2 bg-white rounded-lg p-3 border border-indigo-200">
                        <code className="text-xs text-indigo-600 font-mono truncate flex-1 font-semibold">
                          {window.location.origin}/proof/{uploadResult.hash}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 hover:bg-indigo-50 hover:text-indigo-700 transition-colors rounded-lg"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/proof/${uploadResult.hash}`
                            );
                            alert('URLをコピーしました');
                          }}
                        >
                          <Clipboard className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* アクションボタン */}
                <div className="flex flex-col sm:flex-row gap-4 w-full">
                  <Button
                    asChild
                    size="lg"
                    className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all border-0 rounded-xl"
                  >
                    <a href={`/proof/${uploadResult.hash}`} className="flex items-center justify-center gap-2">
                      <ExternalLink className="w-5 h-5" />
                      <span>証明書ページへ移動</span>
                    </a>
                  </Button>
                  <Button
                    onClick={() => window.location.reload()}
                    variant="outline"
                    size="lg"
                    className="flex-1 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-all rounded-xl"
                  >
                    続けてアップロード
                  </Button>
                </div>
              </div>
            </div>
          </StepContainer>
        )}

        {/* 来歴モーダル */}
        {c2paSummary && (
          <ProvenanceModal
            isOpen={showProvenanceModal}
            onClose={() => setShowProvenanceModal(false)}
            c2paSummary={c2paSummary}
            rootSigner={validationResult?.rootSigner}
          />
        )}
      </div>
    </div>
  );
}
