// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens - Irys/Arweave完全オンチェーン検証
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
 *
 * NOTE: IrysのGraphQLではownerアドレスによるフィルタリングが完全ではない場合があるため、
 * ここではタグによる広範囲な検索のみを行い、厳密なOwner検証は詳細取得時に行う。
 */
async function searchIrysByTag(
  tagName: string,
  tagValue: string,
  limit: number = 100
): Promise<Array<{ id: string; timestamp: number }>> {
  // エンドポイント決定 (Devnet優先)
  const irysAddress = process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY;
  const GRAPHQL_ENDPOINT = irysAddress
    ? `${irysAddress}/graphql`
    : 'https://gateway.irys.xyz/graphql';

  // Irys互換スキーマ (Simple)
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

  const result = await response.json();

  if (result.errors) {
    console.error('GraphQL Error:', result.errors);
    throw new Error('Irys GraphQL query failed');
  }

  return result.data.transactions.edges.map((edge: { node: { id: string; timestamp: number } }) => ({
    id: edge.node.id,
    timestamp: Math.floor((edge.node.timestamp || 0) / 1000) // 秒単位に統一
  }));
}

/**
 * original_hashからArweaveトランザクションを完全オンチェーン検索
 *
 * プロセス:
 * 1. GraphQLでハッシュタグ検索 (候補取得)
 * 2. Gatewayで詳細データ取得
 * 3. OwnerアドレスがRootLens公式ウォレットか厳密に検証
 *
 * 返却されるトランザクションは、target_asset_idに指定されたcNFTがSolanaチェーン上に
 * 存在することが前提です。呼び出し側で各候補のSolana存在確認（getAsset）を行い、
 * Burn済みcNFTも含めて履歴に残っているものの中で最古のものを採用してください。
 *
 * @param originalHash - 検索するハッシュ値
 * @returns 検証済みトランザクション全件（古い順、RootLens公式ウォレット発行のみ）
 */
export async function searchArweaveTransactionsByHash(
  originalHash: string
): Promise<VerifiedArweaveTransaction[]> {
  const ROOTLENS_WALLET = process.env.NEXT_PUBLIC_ROOTLENS_WALLET;

  if (!ROOTLENS_WALLET) {
    throw new Error('環境変数 NEXT_PUBLIC_ROOTLENS_WALLET が設定されていません');
  }

  console.log('🔍 完全オンチェーン検証を開始...');
  console.log(`   Target Hash: ${originalHash}`);
  console.log(`   Verified Issuer: ${ROOTLENS_WALLET}`);

  // 1. GraphQL検索 (Discovery)
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

  // 2. 詳細取得と検証 (Verification)
  const irysAddress = process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY;
  // Devnetなら devnet.irys.xyz, Mainnetなら gateway.irys.xyz
  const fetchBaseUrl = irysAddress && irysAddress.includes('devnet')
    ? irysAddress // https://devnet.irys.xyz
    : 'https://gateway.irys.xyz';
  
  const verifiedTransactions: VerifiedArweaveTransaction[] = [];

  console.log('🕵️ Verifying candidates...');

  for (const candidate of candidates) {
    try {
      // === Step A: Header取得 (Owner検証) ===
      // /tx/{id} エンドポイントはIrys Nodeで利用可能
      // Devnet: devnet.irys.xyz/tx/{id}
      // Mainnet: node1.irys.xyz/tx/{id} (gateway.irys.xyzではなくnode URLが必要)
      const txResponse = await fetch(`${fetchBaseUrl}/tx/${candidate.id}`);
      if (!txResponse.ok) {
        console.warn(`   ⚠️ Failed to fetch tx header: ${candidate.id}`);
        continue;
      }
      const txHeader = await txResponse.json();

      // Owner検証: アップロード者のアドレス(address)がRootLens公式と一致するか
      const uploaderAddress = txHeader.address; // Solana Address
      
      if (uploaderAddress !== ROOTLENS_WALLET) {
        console.warn(`   ❌ Invalid Issuer: ${candidate.id} (Owner: ${uploaderAddress})`);
        continue; // 偽物として除外
      }

      // === Step B: Body取得 (Metadata検証) ===
      const dataResponse = await fetch(`${fetchBaseUrl}/${candidate.id}`);
      if (!dataResponse.ok) {
        console.warn(`   ⚠️ Failed to fetch data body: ${candidate.id}`);
        continue;
      }

      const metadata: ArweaveMetadata = await dataResponse.json();

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

      console.log(`   ✅ Verified: ${candidate.id} (Target: ${metadata.target_asset_id})`);

    } catch (error) {
      console.warn(`   ⚠️ Processing error for ${candidate.id}:`, error);
    }
  }

  // 古い順にソート
  verifiedTransactions.sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  console.log(`🎉 Total Verified Proofs: ${verifiedTransactions.length}`);
  return verifiedTransactions;
}

/**
 * DB版: original_hashからArweaveトランザクションIDを取得
 * (Fallback用)
 */
export async function getArweaveTransactionFromDB(
  originalHash: string
): Promise<string | null> {
  const { createClient } = await import('@supabase/supabase-js');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from('media_proofs')
    .select('arweave_tx_id')
    .eq('original_hash', originalHash)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data.arweave_tx_id;
}
