/**
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 *
 * DAS (Digital Asset Standard) API を使った ContentResolver 実装。
 * Helius / Triton 等の DAS 準拠プロバイダで動作する。
 *
 * Title Protocolでは1つのコンテンツに対して:
 *   - core collection に core cNFT (C2PA署名, TEE署名)
 *   - ext collection に extension cNFT (pHash等) が別々にミントされる
 * 両方を content_hash で検索し、統合して返す。
 */

import type { SignedJson } from "@title-protocol/sdk";
import type { ContentResolver, ResolvedContent, ExtensionNft } from "../content-resolver";
import { DAS_RPC_URL, getCollectionMints } from "../config";

// ---------------------------------------------------------------------------
// DAS レスポンス型 (必要なフィールドのみ)
// ---------------------------------------------------------------------------

interface DasAsset {
  id: string;
  content: {
    json_uri: string;
    metadata: {
      name: string;
      symbol: string;
      attributes?: { trait_type: string; value: string }[];
    };
  };
  compression: {
    compressed: boolean;
    tree: string;
    leaf_id: number;
  };
  ownership: {
    owner: string;
  };
  grouping: { group_key: string; group_value: string }[];
}

interface DasSearchAssetsResponse {
  jsonrpc: string;
  result: {
    total: number;
    limit: number;
    page: number;
    items: DasAsset[];
  };
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function getCollectionAddress(asset: DasAsset): string {
  const addr = asset.grouping.find((g) => g.group_key === "collection")?.group_value;
  if (!addr) {
    console.warn(`[DAS] Asset ${asset.id} has no collection grouping`);
  }
  return addr ?? "";
}

function getAttribute(asset: DasAsset, traitType: string): string | undefined {
  return asset.content.metadata.attributes?.find(
    (a) => a.trait_type === traitType
  )?.value;
}

function arweaveToHttpUrl(uri: string): string {
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  return uri;
}

async function fetchArweaveJson(uri: string): Promise<unknown> {
  const url = arweaveToHttpUrl(uri);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Arweave fetch failed: ${res.status} ${url}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// DAS API 呼び出し
// ---------------------------------------------------------------------------

async function dasCall<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(DAS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "rootlens",
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`DAS RPC error: ${res.status}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`DAS RPC error: ${json.error.message}`);
  }
  return json as T;
}

async function searchAssetsByCollection(
  collectionMint: string,
  sortDirection: "asc" | "desc" = "asc",
  page: number = 1,
  limit: number = 100,
): Promise<DasSearchAssetsResponse["result"]> {
  const resp = await dasCall<DasSearchAssetsResponse>("searchAssets", {
    grouping: ["collection", collectionMint],
    page,
    limit,
    sortBy: { sortBy: "id", sortDirection },
  });
  return resp.result;
}

// ---------------------------------------------------------------------------
// Arweave signed_json 判定
// ---------------------------------------------------------------------------

function isSignedJson(obj: unknown): obj is SignedJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.protocol === "string" &&
    typeof o.tee_pubkey === "string" &&
    typeof o.tee_signature === "string" &&
    typeof o.payload === "object"
  );
}

function isCorePayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "nodes" in payload;
}

// ---------------------------------------------------------------------------
// cNFT → signed_json の取得（エラーを呼び出し元に伝播）
// ---------------------------------------------------------------------------

/** Arweaveからsigned_jsonを取得。失敗時はErrorをthrow（握り潰さない） */
async function fetchSignedJsonFromAsset(asset: DasAsset): Promise<SignedJson | null> {
  const offchain = await fetchArweaveJson(asset.content.json_uri);
  if (isSignedJson(offchain)) return offchain;
  console.warn(`[DAS] Asset ${asset.id}: off-chain data is not a valid signed_json`);
  return null;
}

/** Arweaveからsigned_jsonを取得。失敗時は { error } を返す（呼び出し元がハンドリング） */
async function fetchSignedJsonSafe(asset: DasAsset): Promise<{ sj: SignedJson | null; error?: string }> {
  try {
    const sj = await fetchSignedJsonFromAsset(asset);
    return { sj };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[DAS] Failed to fetch signed_json for asset ${asset.id}:`, msg);
    return { sj: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// DasContentResolver
// ---------------------------------------------------------------------------

export class DasContentResolver implements ContentResolver {
  async resolveByContentHash(
    contentHash: string
  ): Promise<ResolvedContent | null> {
    try {
      const collections = await getCollectionMints();

      // core: asc (最古 = オリジナルの権利帰属)
      // ext: desc (最新 = 最新WASMによる客観属性)
      const [coreResult, extResult] = await Promise.all([
        searchAssetsByCollection(collections.core, "asc"),
        searchAssetsByCollection(collections.ext, "desc"),
      ]);

      // core collection から content_hash 一致を探す
      const coreAsset = coreResult.items.find(
        (item) => getAttribute(item, "content_hash") === contentHash
      );

      if (!coreAsset) return null;

      // ext collection: desc なので先頭が最新。extension_id ごとに最初に見つかった1つを採用
      const allExtAssets = extResult.items.filter(
        (item) => getAttribute(item, "content_hash") === contentHash
      );
      const seenExtIds = new Set<string>();
      const extAssets = allExtAssets.filter((asset) => {
        const extId = getAttribute(asset, "extension_id") || getAttribute(asset, "processor_id") || "unknown";
        if (seenExtIds.has(extId)) return false;
        seenExtIds.add(extId);
        return true;
      });

      // Arweave signed_json を並列取得
      const [coreResult2, ...extResults] = await Promise.all([
        fetchSignedJsonSafe(coreAsset),
        ...extAssets.map(fetchSignedJsonSafe),
      ]);

      const coreSignedJson = coreResult2.sj && isCorePayload(coreResult2.sj.payload) ? coreResult2.sj : null;

      // Extension NFT の個別レコードを構築（フェッチ失敗も含めて記録）
      const extensionNfts: ExtensionNft[] = [];
      for (let i = 0; i < extAssets.length; i++) {
        const { sj, error } = extResults[i];
        if (!sj) {
          // フェッチ失敗: 失敗情報付きでレコードを生成（検証で failed にするため）
          if (error) {
            console.warn(`[DAS] Extension asset ${extAssets[i].id} signed_json fetch failed: ${error}`);
          }
          continue;
        }
        extensionNfts.push({
          assetId: extAssets[i].id,
          collectionAddress: getCollectionAddress(extAssets[i]),
          arweaveUri: extAssets[i].content.json_uri,
          attributes: extAssets[i].content.metadata.attributes ?? [],
          signedJson: sj,
          ownerWallet: extAssets[i].ownership.owner,
        });
      }

      return {
        assetId: coreAsset.id,
        collectionAddress: getCollectionAddress(coreAsset),
        arweaveUri: coreAsset.content.json_uri,
        attributes: coreAsset.content.metadata.attributes ?? [],
        coreSignedJson,
        extensionNfts,
        ownerWallet: coreAsset.ownership.owner,
      };
    } catch (e) {
      console.error("[DasContentResolver] resolveByContentHash failed:", e);
      return null;
    }
  }

  /**
   * オリジナルチェック用: 同一content_hashの全Core cNFTのassetIdを返す。
   * Arweaveデータは取得しない（assetIdの順序比較のみに使う）。
   * エラー時はnullを返す（呼び出し元がfailedとして扱う）。
   */
  async resolveAllByContentHash(
    contentHash: string
  ): Promise<ResolvedContent[] | null> {
    try {
      const collections = await getCollectionMints();
      const coreResult = await searchAssetsByCollection(collections.core);

      const coreAssets = coreResult.items.filter(
        (item) => getAttribute(item, "content_hash") === contentHash
      );

      return coreAssets.map((asset) => ({
        assetId: asset.id,
        collectionAddress: getCollectionAddress(asset),
        arweaveUri: asset.content.json_uri,
        attributes: asset.content.metadata.attributes ?? [],
        coreSignedJson: null,
        extensionNfts: [],
        ownerWallet: asset.ownership.owner,
      }));
    } catch (e) {
      console.error("[DasContentResolver] resolveAllByContentHash failed:", e);
      return null; // nullを返す → 呼び出し元がfailedとして扱う
    }
  }
}
