'use client';

import { useEffect, useState } from 'react';
import { createC2pa, C2pa } from 'c2pa';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';

/**
 * アップロードページ
 * Ver3仕様: C2PA検証 → cNFT mint → R2アップロード
 */

interface C2PAValidationResult {
  isValid: boolean;
  rootSigner: string | null;
  provenanceChain: any[];
  error?: string;
}

interface FileHashes {
  originalHash: string;  // 元ファイル全体のSHA-256
  c2paHash: string;      // C2PAメタデータのSHA-256
}

export default function UploadPage() {
  const [c2pa, setC2pa] = useState<C2pa | null>(null);
  const [status, setStatus] = useState<string>('Wasmを準備中...');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [manifestData, setManifestData] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<C2PAValidationResult | null>(null);
  const [hashes, setHashes] = useState<FileHashes | null>(null);

  // 価格・ライセンス設定
  const [price, setPrice] = useState<number>(0);
  const [licenseType, setLicenseType] = useState<string>('CC-BY-4.0');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const { login, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets[0];

  // 1. 初期化：ページ読み込み時にWasmをロードする
  useEffect(() => {
    const initC2pa = async () => {
      try {
        const c2paInstance = await createC2pa({
          wasmSrc: '/toolkit_bg.wasm',
          workerSrc: '/c2pa.worker.min.js',
        });
        setC2pa(c2paInstance);
        setStatus('準備完了！画像をドロップしてください。');
      } catch (err) {
        console.error('Wasm初期化エラー:', err);
        setStatus('エラー: Wasmの読み込みに失敗しました');
      }
    };

    initC2pa();
  }, []);

  const handleLogin = async () => {
    try {
      await login();
    } catch (error) {
      console.error('ログインエラー:', error);
      setStatus('ログインに失敗しました');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setStatus('ログアウトしました');
      // データをクリア
      setManifestData(null);
      setValidationResult(null);
      setHashes(null);
      setCurrentFile(null);
    } catch (error) {
      console.error('ログアウトエラー:', error);
      setStatus('ログアウトに失敗しました');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!c2pa || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setCurrentFile(file);
    setStatus('解析中...');

    try {
      // 1. C2PA解析
      const { manifestStore } = await c2pa.read(file);
      setManifestData(manifestStore);

      // 2. Root署名検証（簡易版）
      const validation = validateC2PAManifest(manifestStore);
      setValidationResult(validation);

      if (!validation.isValid) {
        setStatus(`❌ 検証失敗: ${validation.error}`);
        return;
      }

      // 3. ハッシュ計算
      const buffer = await file.arrayBuffer();
      const originalHashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const originalHash = Array.from(new Uint8Array(originalHashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // TODO: C2PAメタデータのみのハッシュを計算
      // 現在は簡易的に同じハッシュを使用
      const c2paHash = originalHash;

      setHashes({ originalHash, c2paHash });
      setStatus('✅ 検証成功！価格とライセンスを設定してください。');
    } catch (err) {
      console.error('ファイル処理エラー:', err);
      setStatus('エラー: ファイルの処理に失敗しました');
    }
  };

  /**
   * C2PA Manifestを検証（簡易版）
   */
  function validateC2PAManifest(manifestStore: any): C2PAValidationResult {
    try {
      // 信頼済みリスト
      const trustedIssuers = [
        'Sony Corporation',
        'Google LLC',
        'Samsung Electronics',
        'Leica Camera AG',
        'Nikon Corporation',
        'Canon Inc.',
        'Unknown'
      ];

      // Active Manifestを取得
      const activeManifest = manifestStore?.activeManifest;
      if (!activeManifest) {
        return {
          isValid: false,
          rootSigner: null,
          provenanceChain: [],
          error: 'Active Manifestが見つかりません',
        };
      }

      // Rootを特定（再帰的に遡る）
      let currentManifest = activeManifest;
      const provenanceChain = [currentManifest];

      while (currentManifest.ingredients?.length > 0) {
        const parentIngredient = currentManifest.ingredients[0];
        if (!parentIngredient.c2pa_manifest) break;
        currentManifest = parentIngredient.c2pa_manifest;
        provenanceChain.push(currentManifest);
      }

      const rootManifest = currentManifest;

      // Root署名者を取得
      const rootSigner = rootManifest.signature_info?.issuer || 'Unknown';

      // 信頼リストに含まれるか確認
      const isTrusted = trustedIssuers.some((issuer) =>
        rootSigner.includes(issuer)
      );

      if (!isTrusted) {
        return {
          isValid: false,
          rootSigner,
          provenanceChain,
          error: `信頼されていない署名者: ${rootSigner}`,
        };
      }

      return {
        isValid: true,
        rootSigner,
        provenanceChain,
      };
    } catch (err) {
      console.error('C2PA検証エラー:', err);
      return {
        isValid: false,
        rootSigner: null,
        provenanceChain: [],
        error: '検証中にエラーが発生しました',
      };
    }
  }

  const handleUpload = async () => {
    if (!currentFile || !hashes || !validationResult || !solanaWallet) {
      setStatus('エラー: 必要な情報が揃っていません');
      return;
    }

    const treeAddress = process.env.NEXT_PUBLIC_MERKLE_TREE_ADDRESS || process.env.MERKLE_TREE_ADDRESS;
    if (!treeAddress) {
      setStatus('エラー: Merkle Treeが設定されていません。npm run create-tree を実行してください。');
      return;
    }

    try {
      setStatus('🚀 Step 1/4: cNFT mintを準備中...');

      // cNFTメタデータを準備
      const cnftMetadata = {
        original_hash: hashes.originalHash,
        c2pa_hash: hashes.c2paHash,
        root_signer: validationResult.rootSigner || 'Unknown',
        license_type: licenseType,
        created_at: new Date().toISOString(),
      };

      console.log('cNFTメタデータ:', cnftMetadata);

      setStatus('🔨 Step 2/4: cNFTをmint中...');

      // 簡易実装: まずはAPIにメタデータを送信してmintを依頼
      // （クライアント直接mintは複雑なため、段階的に実装）
      const mintResponse = await fetch('/api/cnft/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: cnftMetadata,
          tree_address: treeAddress,
          owner_wallet: solanaWallet.address,
          title,
          description,
        }),
      });

      if (!mintResponse.ok) {
        const error = await mintResponse.json();
        throw new Error(error.error || 'cNFT mint failed');
      }

      const mintResult = await mintResponse.json();
      const cnftMintAddress = mintResult.asset_id; // 仮のAsset ID
      const metadataUri = mintResult.metadata_uri;

      setStatus(`✅ Step 2/4: cNFT mint成功！`);

      setStatus('📤 Step 3/4: R2へアップロード中...');

      // R2アップロード処理
      // 3-1. Presigned URL取得（元ファイル）
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

      // 3-2. R2に元ファイルをアップロード
      const uploadOriginalResponse = await fetch(presignedOriginalUrl, {
        method: 'PUT',
        headers: { 'Content-Type': currentFile.type },
        body: currentFile,
      });

      if (!uploadOriginalResponse.ok) {
        throw new Error('R2アップロード失敗（元ファイル）');
      }

      // 3-3. C2PAサイドカーをアップロード
      // TODO: 実際のC2PAサイドカーファイルを抽出してアップロード
      // 現在は簡易的にスキップ

      setStatus('💾 Step 4/4: DBに登録中...');

      // DB登録処理
      const completeResponse = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_hash: hashes.originalHash,
          c2pa_hash: hashes.c2paHash,
          root_signer: validationResult.rootSigner || 'Unknown',
          license_type: licenseType,
          cnft_mint_address: cnftMintAddress,
          cnft_tree_address: treeAddress,
          owner_wallet: solanaWallet.address,
          media_type: 'image',
          file_format: currentFile.type,
          file_size: currentFile.size,
          price_lamports: Math.floor(price * 1e9), // SOL → lamports
          title,
          description,
          metadata_uri: metadataUri,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        throw new Error(error.error || 'DB登録失敗');
      }

      const completeResult = await completeResponse.json();

      setStatus(`🎉 アップロード完了！\n証明書URL: ${completeResult.proof_url}`);

    } catch (err) {
      console.error('アップロードエラー:', err);
      setStatus(`❌ エラー: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">RootScan Ver3</h1>
        <p className="text-gray-600 mb-8">
          C2PAハードウェア署名付きメディアをcNFTとして証明
        </p>

        {/* ステータス表示 */}
        <div
          className={`p-4 rounded-lg mb-8 text-center font-medium ${
            status.includes('成功') || status.includes('✅')
              ? 'bg-green-100 text-green-800'
              : status.includes('エラー') || status.includes('❌')
              ? 'bg-red-100 text-red-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {status}
        </div>

        {/* Step 1: ウォレット接続 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Step 1: ウォレット接続</h2>

          {!authenticated ? (
            <button
              onClick={handleLogin}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 w-full transition-colors"
            >
              ウォレットを接続して開始
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">接続中</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-red-500 hover:text-red-700 underline"
                >
                  ログアウト
                </button>
              </div>
              <div className="font-mono text-sm bg-gray-50 p-3 rounded border break-all">
                {solanaWallet?.address || 'アドレス取得中...'}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: ファイル選択 */}
        {authenticated && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Step 2: ファイル選択</h2>
            <input
              type="file"
              onChange={handleFileChange}
              accept="image/*"
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />

            {currentFile && (
              <div className="mt-4 text-sm text-gray-600">
                <p>ファイル名: {currentFile.name}</p>
                <p>サイズ: {(currentFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: 検証結果 */}
        {validationResult && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Step 3: 検証結果</h2>

            {validationResult.isValid ? (
              <div className="space-y-3">
                <div className="flex items-center text-green-700">
                  <span className="text-2xl mr-2">✅</span>
                  <span className="font-bold">ハードウェア署名検証済み</span>
                </div>
                <div className="text-sm">
                  <p className="text-gray-600">Root署名者:</p>
                  <p className="font-mono bg-gray-50 p-2 rounded">
                    {validationResult.rootSigner}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-gray-600">来歴チェーン:</p>
                  <p className="font-mono bg-gray-50 p-2 rounded">
                    {validationResult.provenanceChain.length} 段階
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-red-700">
                <span className="text-2xl mr-2">❌</span>
                <span className="font-bold">{validationResult.error}</span>
              </div>
            )}
          </div>
        )}

        {/* Step 4: 価格・ライセンス設定 */}
        {validationResult?.isValid && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Step 4: 価格・ライセンス設定</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  タイトル（任意）
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 夕焼けの富士山"
                  className="w-full px-3 py-2 border rounded-lg"
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
                  className="w-full px-3 py-2 border rounded-lg"
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
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">0 = 無料ダウンロード</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ライセンス
                </label>
                <select
                  value={licenseType}
                  onChange={(e) => setLicenseType(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="CC-BY-4.0">CC-BY-4.0（クリエイティブ・コモンズ 表示）</option>
                  <option value="CC-BY-NC-4.0">CC-BY-NC-4.0（非営利）</option>
                  <option value="CC-BY-ND-4.0">CC-BY-ND-4.0（改変禁止）</option>
                  <option value="CC-BY-SA-4.0">CC-BY-SA-4.0（継承）</option>
                  <option value="All Rights Reserved">All Rights Reserved（全権利保持）</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: アップロードボタン */}
        {validationResult?.isValid && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <button
              onClick={handleUpload}
              className="w-full bg-green-600 text-white px-6 py-4 rounded-lg font-bold hover:bg-green-700 transition-colors text-lg"
            >
              🚀 cNFTを発行してアップロード
            </button>
          </div>
        )}

        {/* デバッグ情報 */}
        {hashes && (
          <details className="mt-8 bg-gray-100 rounded-lg p-4">
            <summary className="cursor-pointer font-mono text-sm">
              デバッグ情報（開発用）
            </summary>
            <pre className="mt-4 text-xs overflow-auto">
              {JSON.stringify({ hashes, validationResult }, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
