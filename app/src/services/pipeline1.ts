// v0.1.3 Pipeline 1 (= iOS デバイス側) 全 7 ステップの orchestrator。
// tools/mock-device/src/main.rs の挙動を iOS 上で再現する。
//
// 流れ:
//   1. C2PA D1 署名 (= c2pa.actions.v2 [c2pa.created])
//   2. Apple Vision 顔ぼかし (= privacy-blur module)
//   3. C2PA D2 署名 (= D1 を ingredient parentOf 参照、 c2pa.placed action)
//   4. signature_hash = SHA-256(D2 active manifest 署名 bytes)
//   5. R2 へ 2 ファイル並列 PUT (rgb.mp4 + realtime_handpose.jsonl)。
//      presigned URL は /api/v1/raw-uploads から
//   6. TP /process via /api/v1/tp-process (= server proxy)
//      → signedJsonUri (公開 URL) を取得
//      → cNFT mint:
//         a. /api/v1/tp-mint-tx で partial_tx を取得
//         b. AuthProvider で署名
//         c. Solana RPC で broadcast、 confirmed まで待機
//         d. TreeConfig PDA を読んで num_minted - 1 を nonce として asset_id を導出
//   7. POST /api/clips に rootAssetId + signedJsonUri 付きで送信
//
// 帰り値は { clipId, signatureHash, rootAssetId, signedJsonUri, txSignature }。

import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';

import { signD1, signD2, computeSignatureHash } from '../native/c2paBridge';
import { processPrivacyBlur } from '../units/privacy-blur';
import { getAuthProvider, requireCurrentSession } from './auth';
import { SERVER_URL, SOLANA_RPC_URL } from '../env';

// ─── 定数 ──────────────────────────────────────────────────────────────

const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');

// TreeConfig PDA layout: discriminator(8) + tree_creator(32) + tree_delegate(32) + total_mint_capacity(8) + num_minted(8) ...
const TREE_CONFIG_NUM_MINTED_OFFSET = 8 + 32 + 32 + 8;

// 旧 capture flow (= 本番 UI 用に残置)。 超広角構成の rgb.mp4 + realtime_handpose.jsonl を上げる。
// metadata.json は新 dataflow 層 (app/src/dataflow) 経由でのみ対応 (= この旧経路は Phase C で置換予定)。
const RAW_FILENAMES = [
  'rgb.mp4',
  'realtime_handpose.jsonl',
] as const;
type RawFilename = (typeof RAW_FILENAMES)[number];

// ─── 公開型 ────────────────────────────────────────────────────────────

export interface Pipeline1Input {
  /** 撮影後の raw mp4 (= capture native の出力) */
  rawMp4Uri: string;
  /** 同時取得した realtime_handpose.jsonl (= timestamp_ns + frame_index + hand_landmarks) */
  sensorsUri: string;
  /** cNFT 発行先 Bubblegum tree pubkey */
  merkleTree: string;
  /** MPL Core collection (= public tree なら省略可) */
  collection?: string;
  /** legacy: 撮影前タスク選択 (= 2026-05-27 撤去、 新撮影では渡さない) */
  taskId?: string;
  /** legacy: 端末側 VLM 達成確度 (= 2026-05-27 VLM gate 撤去で渡さない) */
  achievementConfidence?: number;
}

export interface Pipeline1Result {
  clipId: string;
  signatureHash: string;         // 64-char hex (= "sha256:" prefix なし)
  rootAssetId: string;       // Solana cNFT asset id (base58)
  signedJsonUri: string;     // rootlens-public の TP signed-json URL
  txSignature: string;       // Solana cNFT mint tx signature
  walletPubkey: string;      // X-Wallet-Pubkey に使った pubkey
  contentSize: number;       // D2 mp4 のサイズ
  facesBlurred: number;
}

export type Pipeline1Step =
  | 'sign-d1'
  | 'blur'
  | 'sign-d2'
  | 'signature-hash'
  | 'r2-upload'
  | 'tp-process'
  | 'cnft-mint'
  | 'register-clip';

export interface Pipeline1Progress {
  step: Pipeline1Step;
  detail?: string;
}

// ─── orchestrator ──────────────────────────────────────────────────────

export async function runPipeline1(
  input: Pipeline1Input,
  onProgress?: (p: Pipeline1Progress) => void,
): Promise<Pipeline1Result> {
  const t0 = Date.now();
  const progress = (step: Pipeline1Step, detail?: string) => {
    onProgress?.({ step, detail });
    const ms = Date.now() - t0;
    console.log(`[Pipeline1 +${ms}ms] ${step}${detail ? ` (${detail})` : ''}`);
  };

  const session = requireCurrentSession();
  const walletPubkey = session.pubkey.toBase58();

  // tmp 作業 dir (= 完走後にクリーンアップ)
  const tmpDir = `${FileSystem.cacheDirectory}pipeline1-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });
  const cleanup = async () => {
    try {
      await FileSystem.deleteAsync(tmpDir, { idempotent: true });
    } catch {}
  };

  try {
    // ─── Step 1: D1 sign ─────────────────────────────────────────────
    progress('sign-d1');
    const d1Path = `${tmpDir}d1.mp4`;
    await signD1(input.rawMp4Uri, d1Path);

    // ─── Step 2: Apple Vision face blur ──────────────────────────────
    progress('blur');
    const blurResult = await processPrivacyBlur({
      inputUri: d1Path,
      outputUri: `${tmpDir}blurred.mp4`,
    });
    progress('blur', `${blurResult.facesBlurred} faces, ${blurResult.framesProcessed} frames`);

    // ─── Step 3: D2 sign (parentOf D1) ──────────────────────────────
    progress('sign-d2');
    const d2Path = `${tmpDir}d2.mp4`;
    await signD2(blurResult.outputUri, d1Path, d2Path, blurResult.facesBlurred);

    // ─── Step 4: signature_hash 抽出 ─────────────────────────────────────
    progress('signature-hash');
    const signatureHashFull = await computeSignatureHash(d2Path);
    if (!signatureHashFull.startsWith('sha256:')) {
      throw new Error(`unexpected signature_hash format: ${signatureHashFull}`);
    }
    const signatureHash = signatureHashFull.slice('sha256:'.length);
    progress('signature-hash', signatureHash);

    // D2 mp4 を最終アップロード用に rgb.mp4 として配置
    const finalMp4Path = `${tmpDir}rgb.mp4`;
    await FileSystem.copyAsync({ from: d2Path, to: finalMp4Path });
    const mp4Info = await FileSystem.getInfoAsync(finalMp4Path, { size: true });
    if (!mp4Info.exists) throw new Error('D2 mp4 missing after copy');
    const contentSize = (mp4Info as { size?: number }).size ?? 0;

    // ─── Step 5: R2 upload (rgb.mp4 + realtime_handpose.jsonl の並列 PUT) ──
    progress('r2-upload', 'requesting presigned URLs');
    const presigned = await requestPresignedUrls(signatureHash);
    progress('r2-upload', 'uploading files');
    await uploadFiles(presigned, {
      'rgb.mp4': finalMp4Path,
      'realtime_handpose.jsonl': input.sensorsUri,
    });

    // ─── Step 6: TP /process (via server proxy) ─────────────────────
    progress('tp-process');
    const { signedJsonUri, signatureHash: tpSignatureHash } = await callTpProcess(signatureHash);
    progress('tp-process', tpSignatureHash);

    // ─── Step 7: cNFT mint ───────────────────────────────────────────
    progress('cnft-mint', 'requesting partial_tx');
    const partialTxB64 = await fetchPartialMintTx({
      offchainDataUrl: signedJsonUri,
      payer: walletPubkey,
      merkleTree: input.merkleTree,
      collection: input.collection,
    });
    progress('cnft-mint', 'signing + broadcasting');
    const { rootAssetId, txSignature } = await signAndBroadcastMint(
      partialTxB64,
      input.merkleTree,
    );
    progress('cnft-mint', `${rootAssetId}`);

    // ─── Step 8: POST /api/clips ─────────────────────────────────────
    progress('register-clip');
    const clipId = await postClip({
      taskId: input.taskId,
      achievementConfidence: input.achievementConfidence,
      signatureHash,
      contentSize,
      rootAssetId,
      signedJsonUri,
      walletPubkey,
    });

    return {
      clipId,
      signatureHash,
      rootAssetId,
      signedJsonUri,
      txSignature,
      walletPubkey,
      contentSize,
      facesBlurred: blurResult.facesBlurred,
    };
  } finally {
    await cleanup();
  }
}

// ─── 個別ステップの実装 ────────────────────────────────────────────────

interface PresignedFile {
  url: string;
  key: string;
  contentType: string;
}
type PresignedUploads = Record<RawFilename, PresignedFile>;

async function requestPresignedUrls(signatureHash: string): Promise<PresignedUploads> {
  const res = await fetch(`${SERVER_URL}/api/v1/raw-uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureHash }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/raw-uploads ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { files: PresignedUploads };
  return json.files;
}

async function uploadFiles(
  presigned: PresignedUploads,
  localPaths: Record<RawFilename, string>,
): Promise<void> {
  const tasks = RAW_FILENAMES.map(async (name) => {
    const local = localPaths[name];
    const target = presigned[name];
    if (!target) throw new Error(`presigned URL missing for ${name}`);
    const info = await FileSystem.getInfoAsync(local);
    if (!info.exists) throw new Error(`${name} not found: ${local}`);
    const res = await FileSystem.uploadAsync(target.url, local, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': target.contentType },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `R2 PUT ${name} ${res.status}: ${res.body?.slice(0, 200) ?? ''}`,
      );
    }
  });
  await Promise.all(tasks);
}

async function callTpProcess(
  signatureHash: string,
): Promise<{ signedJsonUri: string; signatureHash: string }> {
  const res = await fetch(`${SERVER_URL}/api/v1/tp-process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureHash }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/tp-process ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { signedJsonUri: string; signatureHash: string };
}

async function fetchPartialMintTx(args: {
  offchainDataUrl: string;
  payer: string;
  merkleTree: string;
  collection?: string;
}): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/v1/tp-mint-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/tp-mint-tx ${res.status}: ${text.slice(0, 200)}`);
  }
  const { partialTx } = (await res.json()) as { partialTx: string };
  return partialTx;
}

async function signAndBroadcastMint(
  partialTxB64: string,
  merkleTree: string,
): Promise<{ rootAssetId: string; txSignature: string }> {
  // base64 → VersionedTransaction
  const bytes = Buffer.from(partialTxB64, 'base64');
  const tx = VersionedTransaction.deserialize(new Uint8Array(bytes));

  // payer 鍵で署名 (= AuthProvider 経由)
  const provider = getAuthProvider();
  await provider.signTransaction(tx);

  // broadcast + confirmed まで待機
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const txSignature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const blockhash = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction(
    {
      signature: txSignature,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    },
    'confirmed',
  );

  // TreeConfig PDA を読んで num_minted - 1 を nonce として asset_id 導出
  const merklePk = new PublicKey(merkleTree);
  const [treeConfigPda] = PublicKey.findProgramAddressSync(
    [merklePk.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );
  const accountInfo = await connection.getAccountInfo(treeConfigPda, 'confirmed');
  if (!accountInfo) {
    throw new Error(`TreeConfig PDA not found: ${treeConfigPda.toBase58()}`);
  }
  const data = accountInfo.data;
  if (data.length < TREE_CONFIG_NUM_MINTED_OFFSET + 8) {
    throw new Error(
      `TreeConfig too short: ${data.length} bytes (need >= ${TREE_CONFIG_NUM_MINTED_OFFSET + 8})`,
    );
  }
  const numMinted = readU64LE(data, TREE_CONFIG_NUM_MINTED_OFFSET);
  if (numMinted === 0n) throw new Error('TreeConfig.num_minted == 0 after mint');
  const nonce = numMinted - 1n;

  // asset_id = find_program_address([b"asset", tree, &nonce.to_le_bytes()], BUBBLEGUM_ID)
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  const [assetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('asset'), merklePk.toBuffer(), nonceBuf],
    BUBBLEGUM_PROGRAM_ID,
  );

  return { rootAssetId: assetPda.toBase58(), txSignature };
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(data[offset + i]) << BigInt(8 * i);
  }
  return result;
}

async function postClip(args: {
  signatureHash: string;
  contentSize: number;
  rootAssetId: string;
  signedJsonUri: string;
  walletPubkey: string;
  /** legacy: server 互換のため optional で送り続ける (= server 側 zod は optional) */
  taskId?: string;
  achievementConfidence?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {
    signatureHash: args.signatureHash,
    contentSize: args.contentSize,
    rootAssetId: args.rootAssetId,
    signedJsonUri: args.signedJsonUri,
  };
  if (args.taskId !== undefined) body.taskId = args.taskId;
  if (args.achievementConfidence !== undefined) body.achievementConfidence = args.achievementConfidence;

  const res = await fetch(`${SERVER_URL}/api/clips`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Pubkey': args.walletPubkey,
    },
    body: JSON.stringify(body),
  });
  if (!(res.status === 200 || res.status === 201)) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: { id: string } };
  return clip.id;
}
