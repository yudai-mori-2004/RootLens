// SPDX-License-Identifier: Apache-2.0
//
// (rootAssetId, licenseUrl) → price のカタログ。
//
// コード内で直接定義する (= ランタイムでファイル読み込みしない)。 Vercel の
// function bundle に YAML を持ち込むと outputFileTracingIncludes の設定が
// 必要になり fragile。 catalog は 3 行程度の規模なので コード化が正解。
//
// 編集は本ファイルを直接書き換える + redeploy。 動的更新 UI は別 unit。
// 統合フェーズで dataset / 複雑な条件付き販売に置き換える前提の最小モック。

export interface CatalogEntry {
  rootAssetId: string;     // base58
  licenseUrl: string;      // RootLens 公開ライセンス URL
  price: bigint;           // u64 USDC (6 decimals)
}

export interface Catalog {
  /** key = `${rootAssetId}:${licenseUrl}` */
  byKey: Map<string, CatalogEntry>;
}

export const WILDCARD_ASSET = "*";

export function makeKey(rootAssetId: string, licenseUrl: string): string {
  return `${rootAssetId}:${licenseUrl}`;
}

// URL の <sha256>.json 部分は条文 JSON 自身の sha256。 条文を更新したら
// `node web/scripts/build-license-json.mjs` を再実行 → ここの URL を貼り替え。
const URL_COMMERCIAL_V1 =
  "https://rootlens.io/licenses/commercial-v1/a45b97b96684e972516d2188a6fea2e9d37a6f50e6518bb2b23659b3948672dd.json";
const URL_NON_COMMERCIAL_V1 =
  "https://rootlens.io/licenses/non-commercial-v1/e541d00f60f973c34d5bff9d7665fab30ea09e5c6b3d4d7c8f25c147cee6cc4d.json";
const URL_TRAINING_ONLY_V1 =
  "https://rootlens.io/licenses/training-only-v1/1aa2b7a6e6991944fe2125e272c2b6abf6f6206ed98b47ed589ff7ff5a1fc450.json";
const URL_REDISTRIBUTION_V1 =
  "https://rootlens.io/licenses/redistribution-v1/bdccbb8167d9a1ac8a994404104dacbaab613ead208e989070ac7137b7008944.json";

const ENTRIES: ReadonlyArray<CatalogEntry> = [
  // 4 種別すべてに wildcard 価格を設定。 価格は撮影者側の rate card を尊重する
  // 単純化として、 公開デフォルトはここに置く (= 著作権等管理事業法 一任型を回避
  // する rate card 方式の最小実装、 legal-rationale.md §2.6)。
  { rootAssetId: WILDCARD_ASSET, licenseUrl: URL_COMMERCIAL_V1, price: 1_000_000n }, // 1 USDC
  { rootAssetId: WILDCARD_ASSET, licenseUrl: URL_NON_COMMERCIAL_V1, price: 200_000n }, // 0.2 USDC
  { rootAssetId: WILDCARD_ASSET, licenseUrl: URL_TRAINING_ONLY_V1, price: 500_000n }, // 0.5 USDC
  { rootAssetId: WILDCARD_ASSET, licenseUrl: URL_REDISTRIBUTION_V1, price: 5_000_000n }, // 5 USDC
  // override 例: 特定 clip の高品質枠 (テストフィクスチャ leaf_0 を mock として流用)
  { rootAssetId: "FHnFnX2fhtEDY2pCow16mWQRnUyhpBuRCNowm3ZNNHQt", licenseUrl: URL_COMMERCIAL_V1, price: 5_000_000n },
];

export function getCatalog(): Catalog {
  const byKey = new Map<string, CatalogEntry>();
  for (const e of ENTRIES) {
    const key = makeKey(e.rootAssetId, e.licenseUrl);
    if (byKey.has(key)) throw new Error(`duplicate catalog entry: ${key}`);
    byKey.set(key, e);
  }
  return { byKey };
}

/**
 * exact `(rootAssetId, licenseUrl)` を最優先、無ければ `("*", licenseUrl)` を返す。
 * licenseUrl 側は wildcard 不可 (URL が決まらないと delegate サインの対象が定まらない)。
 */
export function lookup(
  catalog: Catalog,
  rootAssetId: string,
  licenseUrl: string,
): CatalogEntry | null {
  const exact = catalog.byKey.get(makeKey(rootAssetId, licenseUrl));
  if (exact) return exact;
  const wildcard = catalog.byKey.get(makeKey(WILDCARD_ASSET, licenseUrl));
  if (wildcard) {
    // exact match と同じ shape で返す。rootAssetId は呼び出し側のものを使う
    return { rootAssetId, licenseUrl: wildcard.licenseUrl, price: wildcard.price };
  }
  return null;
}
