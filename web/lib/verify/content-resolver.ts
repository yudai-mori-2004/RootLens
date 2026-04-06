/**
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 *
 * ContentResolver: content_hash → cNFT + オフチェーンデータの解決レイヤー。
 * DAS プロバイダ（Helius, Triton, 自前インデクサ等）は差し替え可能。
 */

import type { SignedJson } from "@title-protocol/sdk";

// ---------------------------------------------------------------------------
// 解決結果
// ---------------------------------------------------------------------------

/** Extension NFT の個別レコード */
export interface ExtensionNft {
  /** cNFT Asset ID (Solana mint address) */
  assetId: string;
  /** cNFT が属するコレクションアドレス */
  collectionAddress: string;
  /** signed_json URI (off-chain metadata) */
  signedJsonUri: string;
  /** cNFT の属性 (trait_type/value ペア) */
  attributes: { trait_type: string; value: string }[];
  /** signed_json (オフチェーンストレージから取得・パース済み) */
  signedJson: SignedJson;
  /** 所有者ウォレットアドレス */
  ownerWallet: string;
}

/** cNFT + オフチェーンデータを統合した解決済みコンテンツ */
export interface ResolvedContent {
  /** Core cNFT Asset ID (Solana mint address) */
  assetId: string;
  /** Core cNFT が属するコレクションアドレス */
  collectionAddress: string;
  /** Core signed_json URI (off-chain metadata) */
  signedJsonUri: string;
  /** Core cNFT の属性 (trait_type/value ペア) */
  attributes: { trait_type: string; value: string }[];
  /** Core signed_json (オフチェーンストレージから取得・パース済み) */
  coreSignedJson: SignedJson | null;
  /** Extension NFT の個別レコード配列 */
  extensionNfts: ExtensionNft[];
  /** Core NFT の所有者ウォレットアドレス */
  ownerWallet: string;
}

// ---------------------------------------------------------------------------
// ContentResolver インターフェース
// ---------------------------------------------------------------------------

export interface ContentResolver {
  /** content_hash trait から cNFT を検索し、オフチェーンデータを含むレコードを返す */
  resolveByContentHash(contentHash: string): Promise<ResolvedContent | null>;
  /** content_hash trait から全 Core cNFT を返す（重複解決用）。エラー時はnull */
  resolveAllByContentHash?(contentHash: string): Promise<ResolvedContent[] | null>;
}

// ---------------------------------------------------------------------------
// アクティブなリゾルバ（DAS プロバイダ実装を注入）
// ---------------------------------------------------------------------------

import { IndexerContentResolver } from "./resolvers/indexer";

/** cNFTインデクサ経由。content_hashでO(1)検索、signed_json込み。 */
export const contentResolver: ContentResolver = new IndexerContentResolver();
