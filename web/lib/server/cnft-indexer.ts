/**
 * cNFT インデクサ コアロジック
 *
 * content_hash → asset_id ルックアップ。
 * 全クエリに network フィルタを強制し、devnet/mainnet の混在を防止。
 */

import { supabase } from "./page-store";
import { DAS_RPC_URL } from "../verify/config";
import { getCollectionMints } from "../verify/config";

export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";

// ---------------------------------------------------------------------------
// DAS API
// ---------------------------------------------------------------------------

interface DasAsset {
  id: string;
  content: {
    json_uri: string;
    metadata: {
      name: string;
      attributes?: { trait_type: string; value: string }[];
    };
  };
  compression: { tree: string; leaf_id: number };
  grouping: { group_key: string; group_value: string }[];
}

async function dasSearchAssets(
  collection: string,
  page: number,
  limit: number = 1000,
): Promise<{ items: DasAsset[]; total: number }> {
  const res = await fetch(DAS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "indexer",
      method: "searchAssets",
      params: {
        grouping: ["collection", collection],
        sortBy: { sortBy: "id", sortDirection: "desc" },
        page,
        limit,
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`DAS error: ${json.error.message}`);
  return json.result;
}

export async function dasGetAsset(assetId: string): Promise<DasAsset | null> {
  const res = await fetch(DAS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "indexer",
      method: "getAsset",
      params: { id: assetId },
    }),
  });
  const json = await res.json();
  if (json.error) return null;
  return json.result;
}

/** asset_id → ミントTXの blockTime を取得 */
async function getBlockTime(assetId: string): Promise<number | null> {
  const sigRes = await fetch(DAS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "indexer",
      method: "getSignaturesForAsset",
      params: { id: assetId, limit: 1 },
    }),
  });
  const sigJson = await sigRes.json();
  const items = sigJson.result?.items;
  if (!items || items.length === 0) return null;
  const txSig = items[0][0];

  const txRes = await fetch(DAS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "indexer",
      method: "getTransaction",
      params: [txSig, { encoding: "json", maxSupportedTransactionVersion: 0 }],
    }),
  });
  const txJson = await txRes.json();
  return txJson.result?.blockTime ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAttribute(asset: DasAsset, key: string): string | undefined {
  return asset.content.metadata.attributes?.find(
    (a) => a.trait_type === key,
  )?.value;
}

function deriveProcessorId(asset: DasAsset): string {
  const extId = getAttribute(asset, "extension_id");
  if (extId) return extId;
  const protocol = getAttribute(asset, "protocol");
  if (protocol === "Title-v1") return "core-c2pa";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 単一asset のインデックス
// ---------------------------------------------------------------------------

export async function indexOneAsset(asset: DasAsset): Promise<boolean> {
  const contentHash = getAttribute(asset, "content_hash");
  if (!contentHash) return false;

  const blockTime = await getBlockTime(asset.id);
  if (blockTime === null) return false;

  const processorId = deriveProcessorId(asset);

  const { error } = await supabase.from("cnft_assets").upsert(
    {
      asset_id: asset.id,
      content_hash: contentHash,
      processor_id: processorId,
      network: NETWORK,
      solana_block_time: blockTime,
      tsa_timestamp: null,
    },
    { onConflict: "asset_id" },
  );

  if (error) {
    console.error(`[indexer] upsert failed for ${asset.id}:`, error.message);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// TX署名からインデックス（publish API用リアルタイム登録）
// ---------------------------------------------------------------------------

const MAX_RETRIES = 15;
const RETRY_INTERVAL = 2000;

/**
 * txSignatureからミントされたcNFTを抽出しインデクサに登録する。
 * TX確認待ち + DASインデックス待ちの両方をリトライする。
 * 全asset_idが登録できなければエラーを投げる。
 */
export async function indexFromTransaction(txSignature: string): Promise<number> {
  // Phase 1: getTransaction をリトライ（TX確認待ち）
  let tx: any = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_INTERVAL));

    const txRes = await fetch(DAS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "indexer",
        method: "getTransaction",
        params: [txSignature, { encoding: "json", maxSupportedTransactionVersion: 0 }],
      }),
    });
    const txJson = await txRes.json();
    tx = txJson.result;
    if (tx) break;
  }

  if (!tx) throw new Error(`TX not found after ${MAX_RETRIES} retries: ${txSignature}`);
  if (tx.meta?.err) throw new Error(`TX failed on-chain: ${JSON.stringify(tx.meta.err)}`);

  const blockTime: number = tx.blockTime;

  const logs: string[] = tx.meta?.logMessages || [];
  const assetIds: string[] = [];
  for (const log of logs) {
    const match = log.match(/Leaf asset ID: (\w+)/);
    if (match) assetIds.push(match[1]);
  }

  if (assetIds.length === 0) throw new Error(`No Leaf asset IDs in TX logs: ${txSignature}`);

  // Phase 2: 各asset_idをDASから取得してDB登録（DASインデックス待ち）
  let indexed = 0;
  const pending = new Set(assetIds);

  for (let attempt = 0; attempt < MAX_RETRIES && pending.size > 0; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_INTERVAL));

    for (const assetId of [...pending]) {
      const asset = await dasGetAsset(assetId);
      if (!asset) continue;

      const contentHash = getAttribute(asset, "content_hash");
      if (!contentHash) continue;

      const processorId = deriveProcessorId(asset);

      const { error } = await supabase.from("cnft_assets").upsert(
        {
          asset_id: assetId,
          content_hash: contentHash,
          processor_id: processorId,
          network: NETWORK,
          solana_block_time: blockTime,
          tsa_timestamp: null,
        },
        { onConflict: "asset_id" },
      );

      if (!error) {
        indexed++;
        pending.delete(assetId);
      }
    }
  }

  if (pending.size > 0) {
    throw new Error(`${pending.size}/${assetIds.length} assets not indexed after ${MAX_RETRIES} retries: ${[...pending].join(", ")}`);
  }

  return indexed;
}

// ---------------------------------------------------------------------------
// 差分 Poll
// ---------------------------------------------------------------------------

async function pollCollection(collection: string, full: boolean): Promise<number> {
  let page = 1;
  let indexed = 0;

  while (true) {
    const result = await dasSearchAssets(collection, page);
    const assets = result.items;
    let hitKnown = false;

    for (const asset of assets) {
      const { data } = await supabase
        .from("cnft_assets")
        .select("asset_id")
        .eq("asset_id", asset.id)
        .maybeSingle();

      if (data) {
        if (!full) { hitKnown = true; break; }
        continue; // fullモード: スキップして続行
      }

      const ok = await indexOneAsset(asset);
      if (ok) indexed++;
    }

    if (hitKnown || assets.length < 1000) break;
    page++;
  }

  return indexed;
}

/**
 * 全コレクションの差分Pollを実行。
 * @param full true: 全件走査（穴埋め）。false: 既知到達で打ち切り（通常差分）。
 */
export async function pollAll(full = false): Promise<{ core: number; ext: number }> {
  const collections = await getCollectionMints();
  const core = await pollCollection(collections.core, full);
  const ext = await pollCollection(collections.ext, full);
  return { core, ext };
}

// ---------------------------------------------------------------------------
// クエリ（network フィルタ必須）
// ---------------------------------------------------------------------------

/** content_hashでasset_idリストを取得 */
export async function queryByContentHash(contentHash: string) {
  const { data, error } = await supabase
    .from("cnft_assets")
    .select("asset_id, content_hash, processor_id, solana_block_time, tsa_timestamp")
    .eq("network", NETWORK)
    .eq("content_hash", contentHash);

  if (error) throw new Error(`query failed: ${error.message}`);
  return data ?? [];
}
