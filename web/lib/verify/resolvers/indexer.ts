/**
 * cNFTインデクサベースの ContentResolver 実装
 *
 * Task 26: DAS直接検索をSupabaseインデクサに置き換え。
 *
 * 重複解決:
 * - Core: tsa_timestamp（TSAあり）or solana_block_time → 最古を選択
 * - Extension: solana_block_time → 同一extension_idごとに最古を選択
 */

import { createClient } from "@supabase/supabase-js";
import type { SignedJson } from "@title-protocol/sdk";
import type { ContentResolver, ResolvedContent, ExtensionNft } from "../content-resolver";

const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

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

/**
 * 作成時刻の決定
 * TSAあり → tsa_timestamp、TSAなし → solana_block_time
 */
function getCreationTime(row: any): number {
  if (row.tsa_timestamp != null) return row.tsa_timestamp;
  return row.solana_block_time;
}

/**
 * 同一作成時刻ならsolana_block_time（登録時刻）で最古を選択
 */
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

export class IndexerContentResolver implements ContentResolver {
  async resolveByContentHash(
    contentHash: string,
  ): Promise<ResolvedContent | null> {
    try {
      const supabase = getSupabase();
      const { data: assets, error } = await supabase
        .from("cnft_assets")
        .select("*")
        .eq("network", NETWORK)
        .eq("content_hash", contentHash);

      if (error) throw new Error(error.message);
      if (!assets || assets.length === 0) return null;

      // Core: 最古を選択（§2.4）
      const coreAssets = assets.filter((a: any) => a.processor_id === "core-c2pa");
      const coreAsset = selectOldest(coreAssets);
      if (!coreAsset) return null;

      const coreSj = isSignedJson(coreAsset.signed_json) && isCorePayload(coreAsset.signed_json.payload)
        ? coreAsset.signed_json as SignedJson
        : null;

      // Extension: extension_idごとに最古を選択（§3.4）
      const extAssets = assets.filter((a: any) => a.processor_id !== "core-c2pa");
      const extByProcessorId = new Map<string, any[]>();
      for (const a of extAssets) {
        const list = extByProcessorId.get(a.processor_id) || [];
        list.push(a);
        extByProcessorId.set(a.processor_id, list);
      }

      const extensionNfts: ExtensionNft[] = [];
      for (const [, rows] of extByProcessorId) {
        const oldest = selectOldest(rows);
        if (!oldest || !isSignedJson(oldest.signed_json)) continue;
        extensionNfts.push({
          assetId: oldest.asset_id,
          collectionAddress: "",
          signedJsonUri: "",
          attributes: [],
          signedJson: oldest.signed_json as SignedJson,
          ownerWallet: (oldest.signed_json as any)?.payload?.creator_wallet || "",
        });
      }

      return {
        assetId: coreAsset.asset_id,
        collectionAddress: "",
        signedJsonUri: "",
        attributes: [],
        coreSignedJson: coreSj,
        extensionNfts,
        ownerWallet: (coreSj?.payload as any)?.creator_wallet || "",
      };
    } catch (e) {
      console.error("[IndexerContentResolver] resolveByContentHash failed:", e);
      return null;
    }
  }

  /**
   * 同一content_hashの全Core cNFTを返す（重複解決表示用）。
   * solana_block_time昇順でソート。
   */
  async resolveAllByContentHash(
    contentHash: string,
  ): Promise<ResolvedContent[] | null> {
    try {
      const supabase = getSupabase();
      const { data: assets, error } = await supabase
        .from("cnft_assets")
        .select("asset_id, processor_id, solana_block_time, tsa_timestamp")
        .eq("network", NETWORK)
        .eq("content_hash", contentHash)
        .eq("processor_id", "core-c2pa")
        .order("solana_block_time", { ascending: true });

      if (error) throw new Error(error.message);
      if (!assets) return null;

      return assets.map((a: any) => ({
        assetId: a.asset_id,
        collectionAddress: "",
        signedJsonUri: "",
        attributes: [],
        coreSignedJson: null,
        extensionNfts: [],
        ownerWallet: "",
      }));
    } catch (e) {
      console.error("[IndexerContentResolver] resolveAllByContentHash failed:", e);
      return null;
    }
  }
}
