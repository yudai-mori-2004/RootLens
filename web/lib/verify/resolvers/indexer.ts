/**
 * cNFTインデクサベースの ContentResolver 実装
 *
 * Task 26: DAS直接検索をSupabaseインデクサに置き換え。
 * content_hashでO(1)検索。signed_json込みで即返却。
 */

import type { SignedJson } from "@title-protocol/sdk";
import type { ContentResolver, ResolvedContent, ExtensionNft } from "../content-resolver";
import { queryByContentHash } from "@/lib/server/cnft-indexer";

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
      const assets = await queryByContentHash(contentHash);
      if (assets.length === 0) return null;

      // core-c2pa を探す
      const coreAsset = assets.find((a) => a.processor_id === "core-c2pa");
      if (!coreAsset) return null;

      const coreSj = isSignedJson(coreAsset.signed_json) && isCorePayload(coreAsset.signed_json.payload)
        ? coreAsset.signed_json as SignedJson
        : null;

      // extension assets
      const extAssets = assets.filter((a) => a.processor_id !== "core-c2pa");
      const extensionNfts: ExtensionNft[] = extAssets
        .filter((a) => isSignedJson(a.signed_json))
        .map((a) => ({
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
        ownerWallet: coreSj?.payload?.creator_wallet as string || "",
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
      const assets = await queryByContentHash(contentHash);
      const coreAssets = assets.filter((a) => a.processor_id === "core-c2pa");

      return coreAssets.map((a) => ({
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
