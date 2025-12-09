'use client';

import { useEffect, useState } from 'react';
import { createC2pa, C2pa } from 'c2pa';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { Buffer } from 'buffer';

const PROGRAM_ID = new PublicKey("7xWahXcTC24ErT8gRLgpAbRDGiuMuRUuLzrTsCjw8qeJ");

const IDL: Idl = {
    "address": "7xWahXcTC24ErT8gRLgpAbRDGiuMuRUuLzrTsCjw8qeJ",
    "metadata": {
        "name": "rootscan",
        "version": "0.1.0",
        "spec": "0.1.0"
    },
    "instructions": [
        {
            "name": "registerMedia",
            "discriminator": [101, 134, 234, 23, 196, 157, 178, 167],
            "accounts": [
                { "name": "mediaProof", "writable": true },
                { "name": "owner", "writable": true, "signer": true },
                { "name": "systemProgram", "address": "11111111111111111111111111111111" }
            ],
            "args": [{ "name": "originalHash", "type": { "array": ["u8", 32] } }]
        },
        {
            "name": "invalidateMedia",
            "discriminator": [154, 75, 127, 116, 73, 79, 52, 146],
            "accounts": [{ "name": "mediaProof", "writable": true }],
            "args": []
        }
    ],
    "accounts": [
        {
            "name": "MediaProof",
            "discriminator": []
        }
    ],
    "types": [
        {
            "name": "MediaProof",
            "type": {
                "kind": "struct",
                "fields": [
                    { "name": "contentId", "type": { "array": ["u8", 32] } },
                    { "name": "originalHash", "type": { "array": ["u8", 32] } },
                    { "name": "owner", "type": "pubkey" },
                    { "name": "createdAt", "type": "i64" },
                    { "name": "isValid", "type": "bool" }
                ]
            }
        }
    ]
} as any;

export default function Home() {
    const [c2pa, setC2pa] = useState<C2pa | null>(null);
    const [status, setStatus] = useState<string>('Wasmを準備中...');
    const [manifestData, setManifestData] = useState<any>(null);

    // Rust側が [u8; 32] を求めているため、数値の配列で保持する
    const [hashArray, setHashArray] = useState<number[] | null>(null);
    const [currentFile, setCurrentFile] = useState<File | null>(null);
    const [solanaTxId, setSolanaTxId] = useState<string | null>(null);

    const { login, authenticated, logout } = usePrivy();
    const { wallets } = useWallets(); // Solana用のウォレットを取得
    const { signTransaction } = useSignTransaction();
    const solanaWallet = wallets[0]; // 最初のSolanaウォレットを使用

    // 1. 初期化：ページ読み込み時にWasmをロードする
    useEffect(() => {
        const initC2pa = async () => {
            try {
                // publicフォルダに置いたWasmファイルを指定して初期化
                const c2paInstance = await createC2pa({
                    wasmSrc: '/toolkit_bg.wasm',
                    workerSrc: '/c2pa.worker.min.js', // (必要であれば同様にpublicへコピー。今回は省略可の場合が多いですが念のため)
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

    const getCircularReplacer = () => {
        const seen = new WeakSet();
        return (key: string, value: any) => {
            // オブジェクトかつ、すでに見たことがあるオブジェクトなら無視（削除）
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) {
                    return "[Circular Reference]"; // ここを "undefined" にすれば消えます
                }
                seen.add(value);
            }
            return value;
        };
    };

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
            setManifestData(null); // 表示中のデータもクリア
            setHashArray(null);    // ハッシュもクリア
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

        // 1. C2PA解析
        const { manifestStore } = await c2pa.read(file);
        setManifestData(manifestStore);

        // 2. ハッシュ計算 (SHA-256)
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);

        // Rustの [u8; 32] に合わせるため、number[] 型に変換
        const byteArray = Array.from(new Uint8Array(hashBuffer));
        setHashArray(byteArray);

        setStatus('準備完了: 登録可能');
    };

    const handleRegisterAnchor = async () => {
        if (!solanaWallet || !hashArray) {
            setStatus('エラー: ウォレットまたはハッシュが見つかりません');
            return;
        }

        try {
            setStatus('処理開始: ウォレット承認待ち...');

            // 1. プロバイダーのセットアップ
            const connection = new Connection("https://api.devnet.solana.com");
            const walletPublicKey = new PublicKey(solanaWallet.address);

            // AnchorProviderを作成 (Solana Standard Walletアダプター)
            const walletAdapter = {
                publicKey: walletPublicKey,
                signTransaction: async (tx: Transaction) => {
                    const serialized = tx.serialize({ requireAllSignatures: false });
                    const { signedTransaction } = await signTransaction({
                        transaction: serialized,
                        wallet: solanaWallet,
                        chain: 'solana:devnet'
                    });
                    return Transaction.from(signedTransaction);
                },
                signAllTransactions: async (txs: Transaction[]) => {
                    return Promise.all(txs.map(async (tx: Transaction) => {
                        const serialized = tx.serialize({ requireAllSignatures: false });
                        const { signedTransaction } = await signTransaction({
                            transaction: serialized,
                            wallet: solanaWallet,
                            chain: 'solana:devnet'
                        });
                        return Transaction.from(signedTransaction);
                    }));
                },
            };

            const provider = new AnchorProvider(
                connection,
                walletAdapter as any,
                { commitment: 'confirmed' }
            );

            // 2. プログラムのインスタンス化
            const program = new Program(IDL, provider);

            // 3. PDA (データの保存場所) を計算
            // Seeds: [b"media", original_hash]
            const [mediaProofPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("media"), Buffer.from(hashArray)],
                PROGRAM_ID
            );

            console.log("Saving to PDA:", mediaProofPda.toString());

            // 4. トランザクション実行 (Rustの register_media 関数を呼ぶ)
            const tx = await program.methods
                .registerMedia(hashArray) // 引数: [u8; 32]
                .accounts({
                    mediaProof: mediaProofPda, // 保存先
                    owner: walletPublicKey, // 支払う人
                    systemProgram: SystemProgram.programId, // システムプログラム
                })
                .rpc();

            console.log("Success!", tx);
            setSolanaTxId(tx);
            setStatus(`登録成功！🎉 Tx: ${tx.substring(0, 8)}...`);

        } catch (err) {
            console.error("Anchor Error:", err);
            setStatus('エラーが発生しました。コンソールを確認してください。');
        }
    };

    const handleUploadToR2 = async () => {
        if (!currentFile || !hashArray || !solanaTxId || !solanaWallet) {
            setStatus('エラー: 必要な情報が揃っていません');
            return;
        }

        try {
            setStatus('Step 1/3: アップロード準備中...');

            // 1. /api/upload/prepare を呼び出し
            const prepareResponse = await fetch('/api/upload/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_hash: Buffer.from(hashArray).toString('hex'),
                    solana_tx_id: solanaTxId,
                    owner_wallet: solanaWallet.address,
                    file_size: currentFile.size,
                    mime_type: currentFile.type,
                    privacy_settings: {},
                }),
            });

            if (!prepareResponse.ok) {
                const error = await prepareResponse.json();
                throw new Error(error.error || 'Prepare failed');
            }

            const { upload_id, presigned_url } = await prepareResponse.json();

            // 2. R2に直接アップロード
            setStatus('Step 2/3: R2へアップロード中...');

            const uploadResponse = await fetch(presigned_url, {
                method: 'PUT',
                headers: { 'Content-Type': currentFile.type },
                body: currentFile,
            });

            if (!uploadResponse.ok) {
                throw new Error('R2 upload failed');
            }

            // 3. /api/upload/complete を呼び出し
            setStatus('Step 3/3: 完了処理中...');

            const completeResponse = await fetch('/api/upload/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload_id }),
            });

            if (!completeResponse.ok) {
                const error = await completeResponse.json();
                throw new Error(error.error || 'Complete failed');
            }

            const { content_id, verification_url } = await completeResponse.json();

            setStatus(`✅ アップロード完了！\n証明書URL: ${verification_url}`);

        } catch (err) {
            console.error('Upload error:', err);
            setStatus(`エラー: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    return (
        <div className="p-10 max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">RootScan MVP</h1>

            {/* ステータス表示 */}
            <div className={`p-4 rounded mb-6 text-center font-bold ${status.includes('成功') ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                {status}
            </div>

            {/* ファイル入力 */}
            <div className="mb-8">
                <label className="block mb-2 font-bold">1. 画像を選択</label>
                <input type="file" onChange={handleFileChange} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100" />
            </div>

            {/* C2PAデータ表示 */}
            {manifestData && (
                <div className="mb-8 p-4 bg-slate-50 rounded border text-xs overflow-auto max-h-40">
                    <pre>{JSON.stringify(manifestData, getCircularReplacer(), 2)}</pre>
                </div>
            )}

            {/* ウォレット接続 & 登録ボタン */}
            <div className="border-t pt-8 mt-8">
                <label className="block mb-4 font-bold">2. ブロックチェーン接続</label>

                {!authenticated ? (
                    <button
                        onClick={handleLogin}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 w-full transition-colors"
                    >
                        ウォレットを接続して開始
                    </button>
                ) : (
                    <div className="space-y-4 bg-gray-50 p-4 rounded-lg border">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-bold text-gray-700">接続中のウォレット</span>

                            {/* ★ここがログアウトボタン */}
                            <button
                                onClick={handleLogout}
                                className="text-xs text-red-500 hover:text-red-700 underline font-medium"
                            >
                                ログアウト
                            </button>
                        </div>

                        <div className="font-mono text-xs bg-white p-2 rounded border break-all">
                            {solanaWallet?.address || 'アドレス取得中...'}
                        </div>

                        {/* 証明書発行ボタン */}
                        <button
                            onClick={handleRegisterAnchor}
                            disabled={!hashArray || !!solanaTxId}
                            className={`w-full py-3 rounded-lg font-bold text-white transition-colors shadow-sm
                                ${hashArray && !solanaTxId
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-gray-300 cursor-not-allowed'}`}
                        >
                            {!hashArray ? '↑ 先に画像を選択してください' : solanaTxId ? '✅ 登録済み' : '証明書を発行 (オンチェーン登録)'}
                        </button>

                        {/* R2アップロードボタン */}
                        {solanaTxId && (
                            <button
                                onClick={handleUploadToR2}
                                className="w-full py-3 rounded-lg font-bold text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 mt-4"
                            >
                                🚀 R2にアップロード
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}