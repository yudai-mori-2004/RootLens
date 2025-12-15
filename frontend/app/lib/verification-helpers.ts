import { ArweaveProofMetadata } from '@shared/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens - 検証ロジック ヘルパー関数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Irys Gateway URLを取得
 */
export function getIrysGatewayUrl(): string {
  const irysAddress = process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY;
  return irysAddress && irysAddress.includes('devnet')
    ? irysAddress
    : 'https://gateway.irys.xyz';
}

/**
 * Arweaveメタデータを取得
 */
export async function fetchArweaveMetadata(txId: string): Promise<ArweaveProofMetadata | null> {
  try {
    const fetchBaseUrl = getIrysGatewayUrl();
    const response = await fetch(`${fetchBaseUrl}/${txId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.warn(`Failed to fetch Arweave metadata for ${txId}:`, e);
    return null;
  }
}

/**
 * Solana cNFTの存在確認（Helius DAS API）
 *
 * @param assetId - cNFT Asset ID
 * @returns cNFTデータ、または存在しない場合はnull
 *
 * 注意: Burn済みcNFTもresultに含まれます（result.burnt === true）
 * これにより、過去のSolanaチェーン履歴に残っているかを確認できます。
 */
export async function checkSolanaAssetExists(assetId: string): Promise<unknown | null> {
  const heliusRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!heliusRpcUrl) {
    throw new Error('Helius RPC URLが設定されていません');
  }

  try {
    const response = await fetch(heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rootlens-verify',
        method: 'getAsset',
        params: { id: assetId }
      })
    });

    const { result } = await response.json();

    // resultがnull/undefinedの場合、Solanaチェーンに存在しない
    // resultが存在する場合、現存またはBurn済みだが履歴に残っている
    return result || null;
  } catch (e) {
    console.warn(`Failed to check Solana asset ${assetId}:`, e);
    return null;
  }
}

/**
 * DB Fallback: DBからArweave TxIDを取得し、メタデータをフェッチ
 */
export async function fallbackToDatabase(
  originalHash: string
): Promise<{ arweaveTxId: string; arweaveData: unknown; targetAssetId?: string } | null> {
  const { getArweaveTransactionFromDB } = await import('./irys-verification');

  const txIdFromDB = await getArweaveTransactionFromDB(originalHash);
  if (!txIdFromDB) return null;

  const arweaveData = await fetchArweaveMetadata(txIdFromDB);
  const metadata = arweaveData as ArweaveProofMetadata | null;

  return {
    arweaveTxId: txIdFromDB,
    arweaveData,
    targetAssetId: metadata?.target_asset_id
  };
}
