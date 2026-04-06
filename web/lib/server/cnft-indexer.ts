/**
 * cNFT インデクサ コアロジック
 *
 * Task 26: DAS APIのページネーション制約を回避し、content_hashでO(1)検索可能にする。
 * Webhook と Poll の両方から呼ばれる共通INSERT処理。
 * 全クエリに network フィルタを強制し、devnet/mainnet の混在を防止。
 */

import { supabase } from "./page-store";
import { DAS_RPC_URL } from "../verify/config";
import { getCollectionMints } from "../verify/config";

/** devnet | mainnet。環境変数で決定。 */
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

// ---------------------------------------------------------------------------
// Asset → DB レコード変換
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

/** 1つのassetをfetch → DBにUPSERT。既に存在する場合はスキップ。 */
export async function indexOneAsset(asset: DasAsset): Promise<boolean> {
  const contentHash = getAttribute(asset, "content_hash");
  if (!contentHash) return false;

  const jsonUri = asset.content.json_uri;
  if (!jsonUri) return false;

  let signedJson: unknown;
  try {
    const url = jsonUri.startsWith("ar://")
      ? `https://arweave.net/${jsonUri.slice(5)}`
      : jsonUri;
    const res = await fetch(url);
    if (!res.ok) return false;
    signedJson = await res.json();
  } catch {
    return false;
  }

  const processorId = deriveProcessorId(asset);

  const { error } = await supabase.from("cnft_assets").upsert(
    {
      asset_id: asset.id,
      content_hash: contentHash,
      processor_id: processorId,
      signed_json: signedJson,
      network: NETWORK,
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
// 差分 Poll
// ---------------------------------------------------------------------------

async function pollCollection(collection: string): Promise<number> {
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
        hitKnown = true;
        break;
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
 * 全コレクション（core + ext）の差分Pollを実行。
 * @returns { core: number, ext: number } 新規インデックス件数
 */
export async function pollAll(): Promise<{ core: number; ext: number }> {
  const collections = await getCollectionMints();
  const core = await pollCollection(collections.core);
  const ext = await pollCollection(collections.ext);
  return { core, ext };
}

// ---------------------------------------------------------------------------
// クエリ（network フィルタ必須）
// ---------------------------------------------------------------------------

/** content_hashで全cNFT（core + extensions）を取得。networkフィルタ強制。 */
export async function queryByContentHash(contentHash: string) {
  const { data, error } = await supabase
    .from("cnft_assets")
    .select("*")
    .eq("network", NETWORK)
    .eq("content_hash", contentHash);

  if (error) throw new Error(`query failed: ${error.message}`);
  return data ?? [];
}
