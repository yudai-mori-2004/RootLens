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

import { SERVER_URL, SOLANA_RPC_URL } from '../../env';
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
