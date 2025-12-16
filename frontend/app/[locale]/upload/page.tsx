'use client';

import { useEffect, useState } from 'react';
import { createC2pa, C2pa, ManifestStore, Manifest } from 'c2pa';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { createManifestSummary, C2PASummaryData } from '@/app/lib/c2pa-parser';
import { searchArweaveTransactionsByHash } from '@/app/lib/irys-verification';
import { checkSolanaAssetExists } from '@/app/lib/verification-helpers';
import ProgressBar from '@/app/components/ProgressBar';
import StepContainer from '@/app/components/StepContainer';
import PrivacyWarning from '@/app/components/PrivacyWarning';
import ProvenanceModal from '@/app/components/ProvenanceModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Wallet, CheckCircle, XCircle, UploadCloud, Loader2, Info, Sparkles, Clipboard, Camera, AlertTriangle, Lock, PenTool, Cloud, Link as LinkIcon, ExternalLink, FileText } from 'lucide-react';

import Header from '@/app/components/Header';
import LoadingState, { LoadingStep } from '@/app/components/LoadingState';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/navigation';

interface C2PAValidationResult {
  isValid: boolean;
  rootSigner: string | null;
  provenanceChain: unknown[];
  error?: string;
}

interface FileHashes {
  originalHash: string;
}

export default function UploadPage() {
  const t = useTranslations('upload');
  const [currentStep, setCurrentStep] = useState(1);
  const [c2pa, setC2pa] = useState<C2pa | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUploadProgressModal, setShowUploadProgressModal] = useState(false);
  const [uploadProgressStep, setUploadProgressStep] = useState(0); // 0: 初期状態, 1-4: 各ステップ
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');

  // ファイルとC2PAデータ
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [manifestData, setManifestData] = useState<ManifestStore | null>(null);
  const [c2paSummary, setC2paSummary] = useState<C2PASummaryData | null>(null);
  const [validationResult, setValidationResult] = useState<C2PAValidationResult | null>(null);
  const [hashes, setHashes] = useState<FileHashes | null>(null);
  const [previewThumbnailDataUri, setPreviewThumbnailDataUri] = useState<string | null>(null); // 追加

  // プライバシー同意
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);

  // 価格設定
  const [price, setPrice] = useState<number>(0);
  const [priceStr, setPriceStr] = useState('0');
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

  // ステップ定義
  const STEPS = [
    { label: t('steps.wallet') },
    { label: t('steps.file') },
    { label: t('steps.verify') },
    { label: t('steps.settings') },
    { label: t('steps.upload') },
  ];

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

  // 検証結果に応じてタイトルと説明を自動設定
  useEffect(() => {
    if (validationResult?.isValid && c2paSummary?.activeManifest && validationResult.rootSigner) {
      const manifestTitle = c2paSummary.activeManifest.title || currentFile?.name.split('.')[0] || '';
      setTitle(manifestTitle);

      const rootSignerText = validationResult.rootSigner;
      setDescription(`${rootSignerText}`);
    } else {
      // 無効になった場合や初期状態に戻す場合
      setTitle('');
      setDescription('');
    }
  }, [validationResult, c2paSummary, currentFile]);

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

      const { manifestStore } = readResult;
      setManifestData(manifestStore);

      // 2. サマリーデータ生成
      const thumbnail = (readResult as any).thumbnail;
      const previewThumbnailUrl = thumbnail?.getUrl().url || null;
      const summary = await createManifestSummary(manifestStore, previewThumbnailUrl);
      setC2paSummary(summary);

      // 2.5. C2PA検証ステータスの確認
      if (!summary.validationStatus.isValid) {
        const errorErrors = summary.validationStatus.errors.join(', ');
        setValidationResult({
          isValid: false,
          rootSigner: null,
          provenanceChain: [],
          error: `ファイルの改ざんが検知されました (C2PA Validation Failed): ${errorErrors}`,
        });
        setIsProcessing(false);
        setCurrentStep(3); // エラー表示のためStep 3へ
        return;
      }

      // 3. 検証ロジック
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
      const isTrusted = activeManifest.isTrustedIssuer; // c2pa-parser.tsから判定結果を取得
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
      // C2PAのData Hash (c2pa.hash.data) を優先的に使用する。
      // これにより、ファイル末尾のパディングやExifの軽微な変更によるファイル全体ハッシュの変化を無視できる。
      let originalHash: string;
      
      if (summary.activeManifest?.dataHash) {
        originalHash = summary.activeManifest.dataHash;
        console.log('✅ Used C2PA Data Hash:', originalHash);
      } else {
        // フォールバック削除: エラーにする
        throw new Error('C2PA Data Hash (Hard Binding) が見つかりません。このファイルはRootLensで検証できません。');
      }

      setHashes({ originalHash });

      // プレビュー画像の生成
      try {
        // resizeImageを使ってブラウザ表示用の軽量なDataURIを生成
        const resizedBlob = await resizeImage(file);
        const reader = new FileReader();
        reader.onloadend = () => {
             setPreviewThumbnailDataUri(reader.result as string);
        };
        reader.readAsDataURL(resizedBlob);
      } catch (e) {
        console.warn('プレビュー生成失敗:', e);
        // 失敗しても致命的ではないので続行
      }

      // 5. 重複チェック（既存の証明が存在しないか確認）
      console.log('🔍 重複チェック開始:', originalHash);
      try {
        const existingProofs = await searchArweaveTransactionsByHash(originalHash);

        if (existingProofs.length > 0) {
          // Solanaチェーン上でcNFTが存在するか確認
          let hasValidProof = false;
          for (const proof of existingProofs) {
            const cnftExists = await checkSolanaAssetExists(proof.targetAssetId);
            if (cnftExists) {
              hasValidProof = true;
              console.log('❌ 既存の証明が見つかりました:', proof.targetAssetId);
              break;
            }
          }

          if (hasValidProof) {
            setValidationResult({
              isValid: false,
              rootSigner: null,
              provenanceChain: [],
              error: `このファイルは既に証明が発行されています。<br/>証明書ページをご確認ください： <a href="${process.env.NEXT_PUBLIC_APP_URL}/asset/${originalHash}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-700 underline font-bold break-all">${process.env.NEXT_PUBLIC_APP_URL}/asset/${originalHash}</a>`,
            });
            setCurrentStep(3);
            setIsProcessing(false);
            return;
          }
        }
        console.log('✅ 重複なし - アップロード可能');
      } catch (err) {
        console.warn('⚠️ 重複チェックでエラー（続行）:', err);
        // モバイルデバッグ用：エラー内容を表示
        alert(`重複チェックエラー: ${err instanceof Error ? err.message : String(err)}`);
        // エラーが発生しても続行（ネットワークエラー等を考慮）
      }

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
      alert('必要な情報が不足しています。');
      return;
    }

    setShowUploadProgressModal(true);
    setIsProcessing(true);
    setUploadProgressStep(0);
    setUploadStatusMessage(t('progress.message'));

    try {
      // 1. Presigned URL取得（元ファイル）とR2アップロード
      setUploadProgressStep(1);
      setUploadStatusMessage(t('progress.steps.0'));
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

      const uploadOriginalResponse = await fetch(presignedOriginalUrl, {
        method: 'PUT',
        headers: { 'Content-Type': currentFile.type },
        body: currentFile,
      });

      if (!uploadOriginalResponse.ok) {
        throw new Error('R2アップロード失敗（元ファイル）');
      }

      // 2. Lens Workerで処理 (ベクトル化 + DB初期登録)
      setUploadProgressStep(2);
      setUploadStatusMessage(t('progress.steps.1'));
      const lensWorkerUrl = process.env.NEXT_PUBLIC_LENS_WORKER_URL;
      if (!lensWorkerUrl) {
        throw new Error('System Error: LENS_WORKER_URL is not configured');
      }
      
      console.log('Processing with Lens Worker:', lensWorkerUrl);

      const resizedBlob = await resizeImage(currentFile);
      const formData = new FormData();
      formData.append('image', resizedBlob, 'search.jpg');
      formData.append('originalHash', hashes.originalHash);
      formData.append('fileExtension', getExtension(currentFile.type));

      const workerResponse = await fetch(`${lensWorkerUrl}/process`, {
        method: 'POST',
        body: formData,
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
      setUploadProgressStep(3);
      setUploadStatusMessage(t('progress.steps.2'));
      
      // 3-1. サムネイル生成 & 直接アップロード (Presigned URL)
      const thumbnailBlob = await resizeImage(currentFile);
      
      // サムネイル用Presigned URL取得
      const presignedThumbResponse = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          file_type: 'thumbnail',
          content_type: 'image/jpeg',
        }),
      });

      if (!presignedThumbResponse.ok) {
        throw new Error('サムネイル用URL取得失敗');
      }

      const { presigned_url: thumbUrl } = await presignedThumbResponse.json();

      // R2へ直接アップロード
      const uploadThumbResponse = await fetch(thumbUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: thumbnailBlob,
      });

      if (!uploadThumbResponse.ok) {
        console.warn('サムネイルアップロード失敗（続行します）');
      }

      // 3-2. Manifest生成
      let summaryData = c2paSummary;
      // サムネイルURLはPublic URLを推定して設定
      const publicThumbnailUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_BUCKET_URL}/media/${hashes.originalHash}/thumbnail.jpg`;
      
      if (!summaryData) {
        const result = await c2pa!.read(currentFile);
        const manifestStore = result.manifestStore;
        summaryData = await createManifestSummary(manifestStore, previewThumbnailDataUri);
      } else {
        // 既存のsummaryDataのthumbnailUrlを更新
        summaryData = { ...summaryData, thumbnailUrl: publicThumbnailUrl };
      }

      // 3-3. ManifestをPublic Bucketにアップロード (API経由)
      const publicUploadResponse = await fetch('/api/upload/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          thumbnail_data_uri: null, // 直接アップロードしたのでnull
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

      // 5. アップロードAPI呼び出し (ジョブ投入)
      setUploadProgressStep(4);
      setUploadStatusMessage(t('progress.steps.3'));
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
          price: Math.floor(parseFloat(priceStr || '0') * 1e9),
          title: title || undefined,
          description: description || undefined,
          mediaProofId: mediaProofId,
        }),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'ジョブ投入失敗');
      }

      const uploadResultData = await uploadResponse.json();
      const jobId = uploadResultData.jobId;

      // 6. ジョブステータスをポーリング
      let completed = false;
      let attempts = 0;
      const maxAttempts = 60; // 60秒タイムアウト

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusResponse = await fetch(`/api/job-status/${jobId}`);
        if (!statusResponse.ok) {
          throw new Error('ジョブステータス取得失敗');
        }

        const statusResult = await statusResponse.json();

        if (statusResult.state === 'completed') {
          completed = true;
          // BullMQはジョブ結果を "returnvalue" に格納する
          if (statusResult.returnvalue?.success) {
            setUploadProgressStep(5);
            setUploadStatusMessage(t('complete.successDesc'));
            await new Promise(resolve => setTimeout(resolve, 1000));
            setShowUploadProgressModal(false);
            setUploadResult({ hash: hashes.originalHash });
            setCurrentStep(5);
          } else {
            throw new Error(statusResult.returnvalue?.error || 'Mint処理失敗');
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
      setShowUploadProgressModal(false); // エラー時はモーダルを閉じる
    } finally {
      setIsProcessing(false);
    }
  };

  function extractRootCertChain(manifestStore: ManifestStore | null): string {
    try {
      let currentManifest: Manifest | undefined | null = manifestStore?.activeManifest;
      while (currentManifest?.ingredients && currentManifest.ingredients.length > 0) {
        const parentIngredient: any = currentManifest.ingredients[0];
        if (!parentIngredient.c2pa_manifest) break;
        currentManifest = parentIngredient.c2pa_manifest;
      }
      const certChain = (currentManifest?.signatureInfo as any)?.cert_chain || [];
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
      <Header />

      <div className="max-w-4xl mx-auto py-12 px-4">

        {/* プログレスバー */}
        <ProgressBar currentStep={currentStep} totalSteps={5} steps={STEPS} />

        {/* Step 1: ウォレット接続 */}
        {currentStep === 1 && (
          <StepContainer
            title={t('wallet.title')}
            description={t('wallet.desc')}
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
                <h3 className="text-xl font-bold text-gray-900 mb-2">{t('wallet.notConnected.title')}</h3>
                <p className="text-gray-500 text-center max-w-md mb-8 whitespace-pre-line">
                  {t('wallet.notConnected.desc')}
                </p>
                <Button
                  onClick={handleLogin}
                  disabled={isProcessing}
                  size="lg"
                  className="text-lg px-10 py-6 rounded-full shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                >
                  {isProcessing ? t('wallet.notConnected.connecting') : t('wallet.notConnected.button')}
                </Button>
              </div>
            ) : (
              <div className="py-4">
                <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 transition-all hover:border-slate-300">
                  <div className="flex items-center gap-5 w-full">
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 border border-slate-200">
                      <Wallet className="w-6 h-6 text-slate-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{t('wallet.connected.label')}</p>
                      <p className="text-lg font-mono font-bold text-slate-900 truncate">
                        {solanaWallet?.address || '読み込み中...'}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex items-center gap-1.5 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-xs text-green-700 font-bold">{t('wallet.connected.active')}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={logout}
                    variant="outline"
                    className="flex-shrink-0 border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                  >
                    {t('wallet.connected.disconnect')}
                  </Button>
                </div>
              </div>
            )}
          </StepContainer>
        )}

        {/* Step 2: ファイル選択 */}
        {currentStep === 2 && (
          <StepContainer
            title={t('file.title')}
            description={t('file.desc')}
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
                  relative z-10 border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200
                  flex flex-col items-center justify-center min-h-[320px]
                  ${isDragging 
                    ? 'border-indigo-500 bg-indigo-50/50' 
                    : 'border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-white'
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
                    <div className={`mb-6 p-5 rounded-full transition-transform duration-300 ${isDragging ? 'bg-indigo-100 scale-110' : 'bg-white shadow-sm ring-1 ring-slate-100 group-hover:scale-105'}`}>
                      <UploadCloud className={`w-10 h-10 ${isDragging ? 'text-indigo-600' : 'text-slate-400 group-hover:text-indigo-500'}`} />
                    </div>
                    
                    <h3 className="text-lg font-bold text-slate-900 mb-2">
                      {t('file.dropzone.title')}
                    </h3>
                    <p className="text-slate-500 mb-8 max-w-xs mx-auto text-sm leading-relaxed whitespace-pre-line">
                      {t('file.dropzone.desc')}
                    </p>

                    <div className="bg-slate-900 text-white px-6 py-2.5 rounded-full font-bold shadow-md hover:bg-slate-800 transition-all hover:shadow-lg text-sm flex items-center gap-2 transform active:scale-95">
                      <Cloud className="w-4 h-4" />
                      {t('file.dropzone.button')}
                    </div>
                    
                    <div className="mt-8 flex gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">JPEG</span>
                      <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">PNG</span>
                      <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">HEIC</span>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <LoadingState
                fullScreen={false}
                message={t('file.loading.title')}
                subMessage={t('file.loading.desc')}
                steps={[
                  { label: t('file.loading.step1'), status: 'loading' },
                  { label: t('file.loading.step2'), status: 'pending' },
                  { label: t('file.loading.step3'), status: 'pending' },
                ]}
                className="py-12"
              />
            )}
          </StepContainer>
        )}

        {/* Step 3: 検証とプライバシー */}
        {currentStep === 3 && validationResult && c2paSummary && (
          <StepContainer
            title={
              validationResult.isValid ? (
                <div className="flex flex-col items-center justify-center py-4 w-full">
                  {/* サムネイル画像 + チェックマーク */}
                  <div className="relative mb-6 z-10">
                    {previewThumbnailDataUri ? (
                      <div className="relative group">
                        <div className="relative p-1 bg-white rounded-2xl shadow-lg border border-slate-100">
                          <img
                            src={previewThumbnailDataUri}
                            alt="Verified content"
                            className="w-48 h-48 object-cover rounded-xl"
                          />
                          {/* チェックマークバッジ */}
                          <div className="absolute -bottom-3 -right-3 rounded-full bg-white p-1.5 shadow-md border border-slate-100">
                              <CheckCircle className="w-8 h-8 text-green-500 fill-green-50" strokeWidth={2} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="relative rounded-full bg-slate-50 p-6 border border-slate-200 shadow-sm">
                          <CheckCircle className="w-16 h-16 text-green-500" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>

                  {/* タイトル */}
                  <div className="text-center space-y-1 z-10">
                    <span className="text-2xl font-bold text-slate-900 tracking-tight block">
                      {t('verify.success.title')}
                    </span>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                        {t('verify.success.badge')}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 w-full text-red-600">
                  <div className="rounded-full bg-red-50 p-4 mb-3 border border-red-100">
                    <XCircle className="w-12 h-12" />
                  </div>
                  <span className="text-2xl font-bold">{t('verify.error.title')}</span>
                </div>
              )
            }
            description={
              validationResult.isValid ? (
                <div className="flex flex-col items-center w-full mt-2 space-y-4">
                  <div className="inline-flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-5 py-2.5 shadow-sm">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100">
                      <Camera className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('verify.success.rootIssuer')}</p>
                      <p className="text-sm text-slate-900 font-bold">{validationResult.rootSigner}</p>
                    </div>
                  </div>
                  <p className="text-slate-500 text-sm text-center max-w-md leading-relaxed whitespace-pre-line">
                    {t('verify.success.desc')}
                  </p>
                </div>
              ) : (
                <div className="text-center text-red-600 mt-2 font-medium bg-red-50 px-4 py-2 rounded-lg inline-block mx-auto border border-red-100 text-sm">
                  <span dangerouslySetInnerHTML={{ __html: validationResult.error || '' }} />
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
              <div className="mt-4 space-y-6">
                {/* 次のステップへの導入 */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  <h4 className="text-lg font-bold text-slate-900 mb-2 flex items-center justify-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                    {t('verify.success.nextTitle')}
                  </h4>
                  <p className="text-slate-600 text-sm max-w-lg mx-auto leading-relaxed whitespace-pre-line">
                    {t.rich('verify.success.nextDesc', {
                         strong: (chunks) => <strong className="text-indigo-600 font-bold">{chunks}</strong>
                    })}
                  </p>
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
            title={t('settings.title')}
            description={t('settings.desc')}
            onBack={() => setCurrentStep(3)}
            onNext={() => handleUpload()}
            nextLabel={t('settings.next')}
            isLoading={isProcessing}
          >
            <div className="space-y-6 py-4">
              {/* 設定カード */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
                  <h5 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <PenTool className="w-5 h-5 text-slate-500" />
                    {t('settings.cardTitle')}
                  </h5>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.cardDesc')}</p>
                </div>

                <div className="p-6 space-y-6">
                  {/* タイトル */}
                  <div className="space-y-2">
                    <Label htmlFor="title" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      {t('settings.inputTitle')}
                    </Label>
                    <Input
                      id="title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t('settings.placeholderTitle')}
                      className="focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 rounded-lg transition-all"
                    />
                  </div>

                  {/* 説明 */}
                  <div className="space-y-2">
                    <Label htmlFor="description" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      {t('settings.inputDesc')}
                    </Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('settings.placeholderDesc')}
                      rows={4}
                      className="focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 resize-none rounded-lg transition-all"
                    />
                  </div>

                  {/* 価格 */}
                  <div className="space-y-2">
                    <Label htmlFor="price" className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                      {t('settings.inputPrice')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="price"
                        type="text"
                        inputMode="decimal"
                        value={priceStr}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (/^\d*\.?\d*$/.test(val)) {
                                setPriceStr(val);
                                setPrice(parseFloat(val) || 0);
                            }
                        }}
                        onBlur={() => {
                            if (priceStr === '' || priceStr === '.') {
                                setPriceStr('0');
                                setPrice(0);
                            } else {
                                const val = parseFloat(priceStr);
                                setPriceStr(val.toString());
                                setPrice(val);
                            }
                        }}
                        className="pl-4 pr-16 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 border-gray-300 font-mono text-lg rounded-lg transition-all"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                        <span className="text-indigo-600 font-bold text-sm bg-indigo-50 px-2 py-1 rounded">SOL</span>
                      </div>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mt-2">
                      <p className="text-xs text-indigo-800 flex items-start gap-2">
                        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span dangerouslySetInnerHTML={{ __html: t('settings.priceInfo') }} />
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
            title={t('complete.title')}
            description={t('complete.desc')}
            showBack={false}
          >
            <div className="flex flex-col items-center py-8 px-4">
              {/* 成功カード */}
              <div className="w-full max-w-md">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden mb-8">
                  {/* トップバー */}
                  <div className="h-1 bg-green-500" />

                  {/* コンテンツ */}
                  <div className="p-4 sm:p-6 md:p-8 text-center">
                    {/* チェックマークアイコン */}
                    <div className="relative mb-6">
                      <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto border border-green-100">
                        <CheckCircle className="w-10 h-10 text-green-500" strokeWidth={2} />
                      </div>
                    </div>

                    {/* タイトル */}
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">
                      {t('complete.successTitle')}
                    </h3>
                    <p className="text-slate-600 text-sm mb-8 leading-relaxed whitespace-pre-line">
                      {t.rich('complete.successDesc', {
                         strong: (chunks) => <strong className="text-green-600 font-bold">{chunks}</strong>
                      })}
                    </p>

                    {/* URL表示 */}
                    <div className="bg-slate-50 rounded-xl p-3 sm:p-4 text-left border border-slate-200">
                      <div className="flex items-center gap-2 mb-2">
                        <LinkIcon className="w-3.5 h-3.5 text-slate-500" />
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{t('complete.publicUrl')}</p>
                      </div>
                      <div className="flex items-center justify-between gap-2 bg-white rounded-lg p-2 sm:p-3 border border-slate-200 shadow-sm">
                        <code className="text-xs text-indigo-600 font-mono truncate flex-1 font-semibold break-all">
                          {window.location.origin}/asset/{uploadResult.hash}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 hover:bg-indigo-50 hover:text-indigo-700 transition-colors rounded-lg"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/asset/${uploadResult.hash}`
                            );
                            alert(t('complete.copyAlert'));
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
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all rounded-xl"
                  >
                    <Link href={`/asset/${uploadResult.hash}`} className="flex items-center justify-center gap-2">
                      <ExternalLink className="w-5 h-5" />
                      <span>{t('complete.viewPage')}</span>
                    </Link>
                  </Button>
                  <Button
                    onClick={() => window.location.reload()}
                    variant="outline"
                    size="lg"
                    className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl"
                  >
                    {t('complete.uploadMore')}
                  </Button>
                </div>
              </div>
            </div>
          </StepContainer>
        )}

        {/* アップロード進捗モーダル */}
        <Dialog open={showUploadProgressModal}>
          <DialogContent className="w-[95vw] sm:w-[90vw] max-w-md p-0 overflow-hidden bg-transparent border-none shadow-none" showCloseButton={false}>
            <DialogHeader>
              <VisuallyHidden.Root>
                <DialogTitle>{t('progress.title')}</DialogTitle>
              </VisuallyHidden.Root>
            </DialogHeader>
            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
             <LoadingState
                fullScreen={false}
                message={t('progress.message')}
                subMessage={t('progress.subMessage')}
                steps={[
                  t('progress.steps.0'),
                  t('progress.steps.1'),
                  t('progress.steps.2'),
                  t('progress.steps.3'),
                ].map((step, index) => ({
                    label: step,
                    status: uploadProgressStep > index + 1 ? 'success' : uploadProgressStep === index + 1 ? 'loading' : 'pending'
                } as LoadingStep))}
              />
              <div className="text-center pb-6 px-6 text-sm text-gray-500">
                <p>{uploadStatusMessage}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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