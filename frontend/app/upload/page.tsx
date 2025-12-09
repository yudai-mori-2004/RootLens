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
  { label: 'ウォレット接続', description: 'Solanaウォレットを接続' },
  { label: 'ファイル選択', description: 'C2PA署名付きメディアを選択' },
  { label: '検証とプライバシー', description: 'C2PA署名を検証し、公開情報を確認' },
  { label: '価格・情報設定', description: '販売価格とメタデータを設定' },
  { label: 'アップロード', description: 'cNFTを発行してアップロード' },
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

  // 認証状態が変わったらステップ2に進む
  useEffect(() => {
    if (authenticated && currentStep === 1) {
      setCurrentStep(2);
    }
  }, [authenticated, currentStep]);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!c2pa || !e.target.files?.[0]) return;
    const file = e.target.files[0];

    setIsProcessing(true);
    setCurrentFile(file);

    try {
      // 1. C2PA解析
      const { manifestStore, thumbnail } = await c2pa.read(file);
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
        'Adobe Inc.'
      ];

      const activeManifest = summary.activeManifest;
      if (!activeManifest) {
        setValidationResult({
          isValid: false,
          rootSigner: null,
          provenanceChain: [],
          error: 'C2PAマニフェストが見つかりません',
        });
        setIsProcessing(false);
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
        return;
      } else if (!isTrusted) {
        setValidationResult({
          isValid: false,
          rootSigner: issuer,
          provenanceChain: [],
          error: `信頼されていない署名者: ${issuer}`,
        });
        setIsProcessing(false);
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
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrivacyNext = () => {
    if (privacyAcknowledged && validationResult?.isValid) {
      setCurrentStep(4);
    }
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

      // 3. Presigned URL取得（Manifest JSON）
      const presignedManifestResponse = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          file_type: 'manifest',
          content_type: 'application/json',
        }),
      });

      if (!presignedManifestResponse.ok) {
        throw new Error('Presigned URL取得失敗（Manifest JSON）');
      }

      const { presigned_url: presignedManifestUrl } = await presignedManifestResponse.json();

      // 4. Manifest JSONをアップロード
      let summaryData = c2paSummary;
      if (!summaryData) {
        const { manifestStore, thumbnail } = await c2pa!.read(currentFile);
        summaryData = await createManifestSummary(manifestStore, thumbnail?.getUrl() || null);
      }

      const manifestJsonBlob = new Blob(
        [JSON.stringify(summaryData, null, 2)],
        { type: 'application/json' }
      );
      const uploadManifestResponse = await fetch(presignedManifestUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: manifestJsonBlob,
      });

      if (!uploadManifestResponse.ok) {
        throw new Error('R2アップロード失敗（Manifest JSON）');
      }

      // 5. Root証明書チェーンを抽出
      const rootCertChain = extractRootCertChain(manifestData);

      // 6. アップロードAPI呼び出し
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: solanaWallet.address,
          originalHash: hashes.originalHash,
          rootSigner: summaryData?.activeManifest?.signatureInfo?.issuer || 'Unknown',
          rootCertChain: rootCertChain,
          mediaFilePath: `media/${hashes.originalHash}/original.${getExtension(currentFile.type)}`,
          price: Math.floor(price * 1e9),
          title: title || undefined,
          description: description || undefined,
        }),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'ジョブ投入失敗');
      }

      const uploadResult = await uploadResponse.json();
      const jobId = uploadResult.jobId;

      // 7. ジョブステータスをポーリング
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            RootLens
          </h1>
          <p className="text-gray-600">
            C2PAハードウェア署名付きメディアをcNFT + Arweaveで証明
          </p>
        </div>

        {/* プログレスバー */}
        <ProgressBar currentStep={currentStep} totalSteps={5} steps={STEPS} />

        {/* Step 1: ウォレット接続 */}
        {currentStep === 1 && (
          <StepContainer
            title="ウォレット接続"
            description="Solanaウォレットを接続してください"
            onNext={authenticated ? () => setCurrentStep(2) : undefined}
            nextLabel="次へ"
            nextDisabled={!authenticated}
            showBack={false}
          >
            {!authenticated ? (
              <div className="text-center py-12">
                <div className="mb-6">
                  <span className="text-6xl">👛</span>
                </div>
                <button
                  onClick={handleLogin}
                  disabled={isProcessing}
                  className="bg-blue-600 text-white px-8 py-4 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg text-lg"
                >
                  {isProcessing ? '接続中...' : 'ウォレットを接続'}
                </button>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">✅</span>
                  <div>
                    <p className="font-bold text-green-800">接続済み</p>
                    <p className="text-sm text-green-600">ウォレットが接続されました</p>
                  </div>
                </div>
                <div className="font-mono text-sm bg-white p-3 rounded border break-all">
                  {solanaWallet?.address || 'アドレス取得中...'}
                </div>
                <button
                  onClick={logout}
                  className="mt-4 text-sm text-red-500 hover:text-red-700 underline"
                >
                  ログアウト
                </button>
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
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                onChange={handleFileSelect}
                accept="image/*"
                disabled={!c2pa || isProcessing}
                className="hidden"
                id="file-input"
              />
              <label htmlFor="file-input" className="cursor-pointer">
                <div className="mb-4">
                  <span className="text-6xl">📁</span>
                </div>
                <p className="text-lg font-medium text-gray-700 mb-2">
                  ファイルをドラッグ＆ドロップ
                </p>
                <p className="text-sm text-gray-500 mb-4">または</p>
                <span className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors">
                  ファイルを選択
                </span>
                <p className="text-xs text-gray-400 mt-4">
                  対応形式: JPEG, PNG, HEIC, MP4
                  <br />
                  C2PA署名が必要です
                </p>
              </label>
            </div>

            {currentFile && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-800">選択されたファイル</p>
                <p className="text-sm text-blue-600">{currentFile.name}</p>
                <p className="text-xs text-blue-500">
                  {(currentFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}
          </StepContainer>
        )}

        {/* Step 3: 検証とプライバシー */}
        {currentStep === 3 && validationResult && c2paSummary && (
          <StepContainer
            title="検証とプライバシー"
            description="C2PA署名の検証結果と公開される情報を確認してください"
            onBack={() => {
              setCurrentStep(2);
              setPrivacyAcknowledged(false);
            }}
            onNext={handlePrivacyNext}
            nextLabel="次へ: 価格設定"
            nextDisabled={!privacyAcknowledged || !validationResult.isValid}
          >
            {/* 検証結果 */}
            {validationResult.isValid ? (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-4">
                <span className="text-4xl">✅</span>
                <div className="flex-1">
                  <p className="font-bold text-green-800 text-lg">ハードウェア署名検証済み</p>
                  <p className="text-sm text-green-700">
                    署名者: {validationResult.rootSigner}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    このメディアは信頼できるカメラで撮影されました
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-4">
                <span className="text-4xl">❌</span>
                <div className="flex-1">
                  <p className="font-bold text-red-800 text-lg">検証失敗</p>
                  <p className="text-sm text-red-700">{validationResult.error}</p>
                </div>
              </div>
            )}

            {/* 来歴詳細ボタン */}
            {validationResult.isValid && (
              <div className="mb-6">
                <button
                  onClick={() => setShowProvenanceModal(true)}
                  className="w-full bg-blue-50 border border-blue-200 rounded-lg p-4 hover:bg-blue-100 transition-colors text-blue-700 font-medium"
                >
                  📋 コンテンツの来歴を詳しく見る
                </button>
              </div>
            )}

            {/* プライバシー警告 */}
            {validationResult.isValid && (
              <PrivacyWarning
                c2paSummary={c2paSummary}
                onAcknowledge={setPrivacyAcknowledged}
                acknowledged={privacyAcknowledged}
              />
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
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  タイトル（任意）
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 夕焼けの富士山"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  説明（任意）
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例: 2025年1月、山梨県から撮影"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  価格（SOL）
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  min="0"
                  step="0.1"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-2">
                  💡 0 SOL = 無料ダウンロード
                </p>
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
            <div className="text-center py-8">
              <div className="mb-6">
                <span className="text-8xl">🎉</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                証明書が発行されました
              </h3>
              <p className="text-gray-600 mb-8">
                あなたのメディアはブロックチェーン上で永久に証明されます
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <p className="text-sm text-blue-600 mb-2">証明書URL</p>
                <p className="font-mono text-sm break-all text-blue-900">
                  {window.location.origin}/proof/{uploadResult.hash}
                </p>
              </div>

              <div className="flex gap-4 justify-center">
                <a
                  href={`/proof/${uploadResult.hash}`}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors"
                >
                  証明書を見る
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/proof/${uploadResult.hash}`
                    );
                    alert('URLをコピーしました');
                  }}
                  className="bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors"
                >
                  URLをコピー
                </button>
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
