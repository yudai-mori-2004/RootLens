// Pipeline 1 step: Title Protocol 登録 + cNFT 発行 (DATA_SPECS §2.6)。
//
//   1. TP /process (via server proxy /api/v1/tp-process)
//      → C2PA 署名を TEE 内で検証し attestation を取得、 signed-json を R2 に保存
//   2. cNFT mint:
//      a. /api/v1/tp-mint-tx で partial_tx を取得
//      b. AuthProvider (wallet) で署名
//      c. Solana RPC で broadcast、 confirmed まで待機
//      d. TreeConfig PDA を読んで num_minted - 1 を nonce として asset_id を導出
//   → rootAssetId 確定 (= Pipeline 2 起動の前提条件)
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。
//    auth は React 経路 (AuthContext) ではなく instance (非 React) から取る。

import { Buffer } from 'buffer';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

import { SERVER_URL, SOLANA_RPC_URL, SOLANA_NETWORK } from '../../env';
import { getAuthProvider, requireCurrentSession } from '../../services/auth/instance';
import type { EventSink } from '../events';
import type { TpInput, TpResult } from '../types';

const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');

// TreeConfig PDA layout: discriminator(8) + tree_creator(32) + tree_delegate(32) + total_mint_capacity(8) + num_minted(8) ...
const TREE_CONFIG_NUM_MINTED_OFFSET = 8 + 32 + 32 + 8;

export async function registerWithTitleProtocol(
  input: TpInput,
  sink: EventSink,
): Promise<TpResult> {
  const walletPubkey = requireCurrentSession().pubkey.toBase58();

  // ─── mint 前 冪等チェック ────────────────────────────────────────────
  // 同 wallet × 同 signature_hash × 同 network で既に cNFT 発行済みなら、 TP /process +
  // mint を丸ごとスキップして再利用する (= cNFT mint はオンチェーンで非冪等。 再実行ごとに
  // 新しい asset を発行して SOL を浪費し、 孤児資産を生むのを防ぐ)。
  // 判定は DB lookup (= 既存 clip) → DAS getAsset (= その rootAssetId が実在するか) の 2 段。
  const reusable = await findReusableMint(input.signatureHash, walletPubkey, sink);
  if (reusable) {
    sink({
      step: 'cnft-mint',
      level: 'success',
      message: `既存 cNFT を再利用 (network=${SOLANA_NETWORK}) rootAssetId=${reusable.rootAssetId}`,
      detail: { ...reusable, reused: true },
    });
    return {
      rootAssetId: reusable.rootAssetId,
      signedJsonUri: reusable.signedJsonUri,
      signatureHash: input.signatureHash,
      txSignature: '',
      walletPubkey,
    };
  }

  // ─── TP /process ───────────────────────────────────────────────────
  sink({ step: 'tp-process', level: 'info', message: 'TP /process (TEE 検証 + signed-json 保存)' });
  const { signedJsonUri, signatureHash } = await callTpProcess(input.signatureHash);
  sink({
    step: 'tp-process',
    level: 'success',
    message: `TP 検証完了 signature_hash=${signatureHash}`,
    detail: { signedJsonUri, signatureHash },
  });

  // ─── cNFT mint ───────────────────────────────────────────────────
  sink({ step: 'cnft-mint', level: 'info', message: 'partial mint tx を取得' });
  const partialTxB64 = await fetchPartialMintTx({
    offchainDataUrl: signedJsonUri,
    payer: walletPubkey,
    merkleTree: input.merkleTree,
    collection: input.collection,
  });

  sink({ step: 'cnft-mint', level: 'info', message: 'wallet 署名 + broadcast (confirmed 待機)' });
  const { rootAssetId, txSignature } = await signAndBroadcastMint(partialTxB64, input.merkleTree);
  sink({
    step: 'cnft-mint',
    level: 'success',
    message: `cNFT 発行完了 rootAssetId=${rootAssetId}`,
    detail: { rootAssetId, txSignature },
  });

  return { rootAssetId, signedJsonUri, signatureHash, txSignature, walletPubkey };
}

// ─── 内部 ─────────────────────────────────────────────────────────────

/// mint 前冪等チェック: 同 wallet × hash × network の既存 clip を引き、 その rootAssetId が
/// DAS 上で実在するなら再利用候補として返す。 該当なし / 検証失敗時は null (= 通常 mint へ)。
/// lookup や DAS の失敗で全体を止めない (= 最悪 mint し直すだけで安全側)。
async function findReusableMint(
  signatureHash: string,
  walletPubkey: string,
  sink: EventSink,
): Promise<{ rootAssetId: string; signedJsonUri: string } | null> {
  let candidate: { rootAssetId: string; signedJsonUri: string } | null = null;
  try {
    const url =
      `${SERVER_URL}/api/clips?signatureHash=${encodeURIComponent(signatureHash)}` +
      `&network=${encodeURIComponent(SOLANA_NETWORK)}`;
    const res = await fetch(url, { headers: { 'X-Wallet-Pubkey': walletPubkey } });
    if (res.ok) {
      const { clips } = (await res.json()) as {
        clips: Array<{ rootAssetId: string | null; signedJsonUri: string | null }>;
      };
      const hit = clips.find((c) => c.rootAssetId && c.signedJsonUri);
      if (hit) candidate = { rootAssetId: hit.rootAssetId!, signedJsonUri: hit.signedJsonUri! };
    }
  } catch (e) {
    sink({
      step: 'cnft-mint',
      level: 'warn',
      message: `既存 clip lookup 失敗 (新規 mint で続行): ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
  if (!candidate) return null;

  const exists = await dasAssetExists(SOLANA_RPC_URL, candidate.rootAssetId).catch(() => false);
  if (!exists) {
    sink({
      step: 'cnft-mint',
      level: 'warn',
      message: `既存 rootAssetId が DAS で確認できず、 新規 mint します (${candidate.rootAssetId})`,
    });
    return null;
  }
  return candidate;
}

/// DAS getAsset で asset の実在 (= burn 済でない) を確認する。 標準 RPC が DAS API を同居提供する前提。
async function dasAssetExists(rpcUrl: string, assetId: string): Promise<boolean> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'getAsset', method: 'getAsset', params: { id: assetId } }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { result?: { id?: string; burnt?: boolean } };
  const r = json.result;
  return !!r && r.id === assetId && r.burnt !== true;
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
  const bytes = Buffer.from(partialTxB64, 'base64');
  const tx = VersionedTransaction.deserialize(new Uint8Array(bytes));

  const provider = getAuthProvider();
  await provider.signTransaction(tx);

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

  // asset_id 導出: TreeConfig.num_minted - 1 を nonce にする
  const merklePk = new PublicKey(merkleTree);
  const [treeConfigPda] = PublicKey.findProgramAddressSync(
    [merklePk.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );
  const accountInfo = await connection.getAccountInfo(treeConfigPda, 'confirmed');
  if (!accountInfo) throw new Error(`TreeConfig PDA not found: ${treeConfigPda.toBase58()}`);
  const data = accountInfo.data;
  if (data.length < TREE_CONFIG_NUM_MINTED_OFFSET + 8) {
    throw new Error(
      `TreeConfig too short: ${data.length} bytes (need >= ${TREE_CONFIG_NUM_MINTED_OFFSET + 8})`,
    );
  }
  const numMinted = readU64LE(data, TREE_CONFIG_NUM_MINTED_OFFSET);
  if (numMinted === 0n) throw new Error('TreeConfig.num_minted == 0 after mint');
  const nonce = numMinted - 1n;

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
