/**
 * cNFTインデクサ + DAS検証ベースの ContentResolver 実装
 *
 * インデクサ: content_hash → asset_id ルックアップ（信頼しない）
 * DAS: getAsset(asset_id) → コレクション所属確認 + json_uri取得（信頼する）
 * signed_json: json_uriから直接取得 → TEE署名で検証（自己証明的）
 *
 * 重複解決:
 * - Core: tsa_timestamp（TSAあり）or solana_block_time → 最古を選択
 * - Extension: solana_block_time → 同一extension_idごとに最古を選択
 */

import { createClient } from "@supabase/supabase-js";
import type { SignedJson } from "@title-protocol/sdk";
import type { ContentResolver, ResolvedContent, ExtensionNft } from "../content-resolver";
import { SOLANA_RPC_URL, getCollectionMints } from "../config";

const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// DAS
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
  grouping: { group_key: string; group_value: string }[];
  ownership: { owner: string };
}

async function dasGetAsset(assetId: string): Promise<DasAsset | null> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "resolver",
      method: "getAsset",
      params: { id: assetId },
    }),
  });
  const json = await res.json();
  if (json.error) return null;
  return json.result;
}

function getCollectionAddress(asset: DasAsset): string {
  return asset.grouping.find((g) => g.group_key === "collection")?.group_value ?? "";
}

function getAttribute(asset: DasAsset, key: string): string | undefined {
  return asset.content.metadata.attributes?.find((a) => a.trait_type === key)?.value;
}

// ---------------------------------------------------------------------------
// signed_json fetch
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

async function fetchSignedJson(jsonUri: string): Promise<SignedJson | null> {
  try {
    const url = jsonUri.startsWith("ar://")
      ? `https://arweave.net/${jsonUri.slice(5)}`
      : jsonUri;
    const res = await fetch(url);
    if (!res.ok) return null;
    const obj = await res.json();
    return isSignedJson(obj) ? obj : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 重複解決
// ---------------------------------------------------------------------------

function getCreationTime(row: any): number {
  if (row.tsa_timestamp != null) return row.tsa_timestamp;
  return row.solana_block_time;
}

/** Core: 最古を選択（権利帰属の優先順位） */
function selectOldest(rows: any[]): any | null {
  if (rows.length === 0) return null;
  return rows.reduce((oldest, row) => {
    const oldestTime = getCreationTime(oldest);
    const rowTime = getCreationTime(row);
    if (rowTime < oldestTime) return row;
    if (rowTime === oldestTime && row.solana_block_time < oldest.solana_block_time) return row;
    return oldest;
  });
}

/** Extension: 最新を選択（最新WASMバージョンの結果を優先） */
function selectNewest(rows: any[]): any | null {
  if (rows.length === 0) return null;
  return rows.reduce((newest, row) => {
    if (row.solana_block_time > newest.solana_block_time) return row;
    return newest;
  });
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export class IndexerContentResolver implements ContentResolver {
  async resolveByContentHash(
    contentHash: string,
  ): Promise<ResolvedContent | null> {
    try {
      const supabase = getSupabase();
      const collections = await getCollectionMints();

      // Step 1: インデクサからasset_idリスト取得
      const { data: rows, error } = await supabase
        .from("cnft_assets")
        .select("asset_id, processor_id, solana_block_time, tsa_timestamp")
        .eq("network", NETWORK)
        .eq("content_hash", contentHash);

      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) return null;

      // Step 2: Core の重複解決 → 最古を選択
      const coreRows = rows.filter((r: any) => r.processor_id === "core-c2pa");
      const coreRow = selectOldest(coreRows);
      if (!coreRow) return null;

      // Step 3: DAS で Core asset を検証
      const coreAsset = await dasGetAsset(coreRow.asset_id);
      if (!coreAsset) return null;

      // コレクション所属確認
      const coreCollection = getCollectionAddress(coreAsset);
      if (coreCollection !== collections.core) return null;

      // content_hash 一致確認
      const dasContentHash = getAttribute(coreAsset, "content_hash");
      if (dasContentHash !== contentHash) return null;

      // signed_json を json_uri から取得
      const coreSj = await fetchSignedJson(coreAsset.content.json_uri);
      const coreSignedJson = coreSj && isCorePayload(coreSj.payload) ? coreSj : null;

      // Step 4: Extension → extension_id ごとに最新を選択（最新WASM結果を優先）
      const extRows = rows.filter((r: any) => r.processor_id !== "core-c2pa");
      const extByProcessorId = new Map<string, any[]>();
      for (const r of extRows) {
        const list = extByProcessorId.get(r.processor_id) || [];
        list.push(r);
        extByProcessorId.set(r.processor_id, list);
      }

      const extensionNfts: ExtensionNft[] = [];
      for (const [, group] of extByProcessorId) {
        const newest = selectNewest(group);
        if (!newest) continue;

        // DAS で検証
        const extAsset = await dasGetAsset(newest.asset_id);
        if (!extAsset) continue;

        const extCollection = getCollectionAddress(extAsset);
        if (extCollection !== collections.ext) continue;

        if (getAttribute(extAsset, "content_hash") !== contentHash) continue;

        const extSj = await fetchSignedJson(extAsset.content.json_uri);
        if (!extSj) continue;

        extensionNfts.push({
          assetId: newest.asset_id,
          collectionAddress: extCollection,
          signedJsonUri: extAsset.content.json_uri,
          attributes: extAsset.content.metadata.attributes ?? [],
          signedJson: extSj,
          ownerWallet: extAsset.ownership.owner,
        });
      }

      return {
        assetId: coreRow.asset_id,
        collectionAddress: coreCollection,
        signedJsonUri: coreAsset.content.json_uri,
        attributes: coreAsset.content.metadata.attributes ?? [],
        coreSignedJson: coreSignedJson,
        extensionNfts,
        ownerWallet: coreAsset.ownership.owner,
      };
    } catch (e) {
      console.error("[IndexerContentResolver] resolveByContentHash failed:", e);
      return null;
    }
  }

  async resolveAllByContentHash(
    contentHash: string,
  ): Promise<ResolvedContent[] | null> {
    try {
      const supabase = getSupabase();
      const collections = await getCollectionMints();

      const { data: rows, error } = await supabase
        .from("cnft_assets")
        .select("asset_id, solana_block_time, tsa_timestamp")
        .eq("network", NETWORK)
        .eq("content_hash", contentHash)
        .eq("processor_id", "core-c2pa")
        .order("solana_block_time", { ascending: true });

      if (error) throw new Error(error.message);
      if (!rows) return null;

      // 各asset_idをDASで検証
      const results: ResolvedContent[] = [];
      for (const row of rows) {
        const asset = await dasGetAsset(row.asset_id);
        if (!asset) continue;
        if (getCollectionAddress(asset) !== collections.core) continue;

        results.push({
          assetId: row.asset_id,
          collectionAddress: collections.core,
          signedJsonUri: asset.content.json_uri,
          attributes: asset.content.metadata.attributes ?? [],
          coreSignedJson: null,
          extensionNfts: [],
          ownerWallet: asset.ownership.owner,
        });
      }

      return results;
    } catch (e) {
      console.error("[IndexerContentResolver] resolveAllByContentHash failed:", e);
      return null;
    }
  }
}
