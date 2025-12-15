// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helius DAS API 型定義
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface HeliusAssetOwnership {
  frozen: boolean;
  delegated: boolean;
  delegate: string | null;
  ownership_model: string;
  owner: string;
}

export interface HeliusAssetContent {
  $schema: string;
  json_uri: string;
  files?: Array<{
    uri: string;
    cdn_uri?: string;
    mime: string;
  }>;
  metadata: {
    attributes?: Array<{
      trait_type: string;
      value: string | number;
    }>;
    description?: string;
    name?: string;
    symbol?: string;
  };
  links?: {
    image?: string;
    external_url?: string;
  };
}

export interface HeliusAssetCompression {
  eligible: boolean;
  compressed: boolean;
  data_hash: string;
  creator_hash: string;
  asset_hash: string;
  tree: string;
  seq: number;
  leaf_id: number;
}

export interface HeliusAssetGrouping {
  group_key: string;
  group_value: string;
}

export interface HeliusAssetAuthority {
  address: string;
  scopes: string[];
}

export interface HeliusAsset {
  interface: string;
  id: string;
  content?: HeliusAssetContent;
  authorities?: HeliusAssetAuthority[];
  compression?: HeliusAssetCompression;
  grouping?: HeliusAssetGrouping[];
  royalty?: {
    royalty_model: string;
    target: string | null;
    percent: number;
    basis_points: number;
    primary_sale_happened: boolean;
    locked: boolean;
  };
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  ownership: HeliusAssetOwnership;
  supply?: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number | null;
  };
  mutable: boolean;
  burnt: boolean;
}
