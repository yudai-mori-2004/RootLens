/**
 * cNFTインデクサベースの ContentResolver 実装
 *
 * Task 26: DAS直接検索をSupabaseインデクサに置き換え。
 * content_hashでO(1)検索。signed_json込みで即返却。
 *
 * page-store.ts (node:crypto依存) を避けて、Supabaseクライアントを直接使用。
 * これによりクライアントバンドルにnode:cryptoが引き込まれない。
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

      const coreAsset = assets.find((a: any) => a.processor_id === "core-c2pa");
      if (!coreAsset) return null;

      const coreSj = isSignedJson(coreAsset.signed_json) && isCorePayload(coreAsset.signed_json.payload)
        ? coreAsset.signed_json as SignedJson
        : null;

      const extAssets = assets.filter((a: any) => a.processor_id !== "core-c2pa");
      const extensionNfts: ExtensionNft[] = extAssets
        .filter((a: any) => isSignedJson(a.signed_json))
        .map((a: any) => ({
          assetId: a.asset_id,
          collectionAddress: "",
          signedJsonUri: "",
          attributes: [],
          signedJson: a.signed_json as SignedJson,
          ownerWallet: (a.signed_json as any)?.payload?.creator_wallet || "",
        }));

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

  async resolveAllByContentHash(
    contentHash: string,
  ): Promise<ResolvedContent[] | null> {
    try {
      const supabase = getSupabase();
      const { data: assets, error } = await supabase
        .from("cnft_assets")
        .select("asset_id, processor_id")
        .eq("network", NETWORK)
        .eq("content_hash", contentHash)
        .eq("processor_id", "core-c2pa");

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
