// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Worker - Verification Logic (Ported from Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Arweaveメタデータ構造
 */
interface ArweaveMetadata {
  name: string;
  target_asset_id: string;
  attributes: Array<{ 
    trait_type: string;
    value: string;
  }>;
}

/**
 * 検証済みArweaveトランザクション
 */
export interface VerifiedArweaveTransaction {
  txId: string;
  metadata: ArweaveMetadata;
  originalHash: string;
  targetAssetId: string;
  createdAt: string;
  ownerAddress: string;
}

/**
 * Irys GraphQL APIでタグ検索
 */
async function searchIrysByTag(
  tagName: string,
  tagValue: string,
  limit: number = 100
): Promise<Array<{ id: string; timestamp: number }>> {
  // エンドポイント決定 (Devnet優先)
  // Workerでは NEXT_PUBLIC_ プレフィックスなしの環境変数を参照
  const irysAddress = process.env.ARWEAVE_GATEWAY || process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY;
  const GRAPHQL_ENDPOINT = irysAddress
    ? `${irysAddress}/graphql` 
    : 'https://gateway.irys.xyz/graphql';

  const query = `
    query SearchByTag(
      $tags: [TagFilter!]!
      $first: Int!
    ) {
      transactions(
        tags: $tags
        first: $first
      ) {
        edges {
          node {
            id
            timestamp
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: {
        tags: [
          { name: tagName, values: [tagValue] } 
        ],
        first: limit
      }
    })
  });

    if (!response.ok) {
      throw new Error(`Irys GraphQL API Error: ${response.status}`);
    }
  
    const result = await response.json() as { data: { transactions: { edges: { node: { id: string; timestamp: number } }[] } }, errors?: any };
  
    if (result.errors) {
      console.error('GraphQL Error:', result.errors);
      throw new Error('Irys GraphQL query failed');
    }
  
    return result.data.transactions.edges.map((edge) => ({
      id: edge.node.id,
      timestamp: Math.floor((edge.node.timestamp || 0) / 1000) // 秒単位に統一
    }));
  }
  
  /**
   * original_hashからArweaveトランザクションを完全オンチェーン検索
   */
  export async function searchArweaveTransactionsByHash(
    originalHash: string
  ): Promise<VerifiedArweaveTransaction[]> {
    // Workerではサーバーウォレット(KEYPAIR_JSONから導出される公開鍵)がIssuerとなる
    // しかし、環境変数として設定されているとは限らないため、ここでは一旦Issuer検証をスキップするか、
    // 環境変数が設定されていれば検証する形にする。
    // 今回の要件「サーバーウォレットを変えたらOK」を実現するには、
    // 「現在のサーバーウォレット」と一致するものだけを重複として検出すれば良い。
    // つまり、この関数の呼び出し側で ownerAddress をフィルタリングする。
    
    console.log('🔍 Searching Arweave for existing proofs...');
    console.log(`   Target Hash: ${originalHash}`);
  
    // 1. GraphQL検索
    console.log('\n📡 Querying Irys GraphQL...');
    let candidates: Array<{ id: string; timestamp: number }> = [];
    try {
      candidates = await searchIrysByTag('original_hash', originalHash);
      console.log(`   ✓ Found ${candidates.length} candidates`);
    } catch (e) {
      console.warn('   ⚠️ GraphQL search failed:', e);
      return [];
    }
  
    if (candidates.length === 0) {
      return [];
    }
  
    // 2. 詳細取得
    const irysAddress = process.env.ARWEAVE_GATEWAY || process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY;
    const fetchBaseUrl = irysAddress && irysAddress.includes('devnet')
      ? irysAddress
      : 'https://gateway.irys.xyz';
    
    const verifiedTransactions: VerifiedArweaveTransaction[] = [];
  
    console.log('🕵️ Fetching candidate details...');
  
    for (const candidate of candidates) {
      try {
        // === Step A: Header取得 (Owner検証用) ===
        const txResponse = await fetch(`${fetchBaseUrl}/tx/${candidate.id}`);
        if (!txResponse.ok) {
          console.warn(`   ⚠️ Failed to fetch tx header: ${candidate.id}`);
          continue;
        }
        const txHeader = await txResponse.json() as { address: string };
        const uploaderAddress = txHeader.address; // Solana Address
  
        // === Step B: Body取得 (Metadata検証) ===
        const dataResponse = await fetch(`${fetchBaseUrl}/${candidate.id}`);
        if (!dataResponse.ok) {
          console.warn(`   ⚠️ Failed to fetch data body: ${candidate.id}`);
          continue;
        }
  
        const metadata = await dataResponse.json() as ArweaveMetadata;
  
        // Metadata検証
        const hashAttr = metadata.attributes?.find(attr => attr.trait_type === 'original_hash');
        
        if (hashAttr?.value !== originalHash) {
          console.warn(`   ❌ Hash Mismatch: ${candidate.id}`);
          continue;
        }
  
        const createdAtAttr = metadata.attributes?.find(attr => attr.trait_type === 'created_at');
  
        verifiedTransactions.push({
          txId: candidate.id,
          metadata,
          originalHash: originalHash,
          targetAssetId: metadata.target_asset_id,
          createdAt: createdAtAttr?.value || new Date(candidate.timestamp * 1000).toISOString(),
          ownerAddress: uploaderAddress
        });
  
        console.log(`   ✅ Found Proof: ${candidate.id} (Owner: ${uploaderAddress})`);
  
      } catch (error) {
        console.warn(`   ⚠️ Processing error for ${candidate.id}:`, error);
      }
    }
  
    return verifiedTransactions;
  }
  
  /**
   * Solana cNFTの存在確認（Helius DAS API）
   */
  export async function checkSolanaAssetExists(assetId: string): Promise<boolean> {
    const heliusRpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (!heliusRpcUrl) {
      throw new Error('SOLANA_RPC_URL is not configured');
    }
  
    try {
      const response = await fetch(heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'rootlens-worker-verify',
          method: 'getAsset',
          params: { id: assetId }
        })
      });
  
      const { result } = await response.json() as { result: any };
      return !!result;
    } catch (e) {
      console.warn(`Failed to check Solana asset ${assetId}:`, e);
      return false;
    }
  }
