// SPDX-License-Identifier: Apache-2.0
//
// (rootAssetId, licenseUrl) → price のカタログ。YAML から読み込み。
// このファイルだけが catalog の真実の出処。サーバの他の検証は contract に任せる。

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface CatalogEntry {
  rootAssetId: string;     // base58
  licenseUrl: string;      // RootLens 公開ライセンス URL
  price: bigint;           // u64 USDC (6 decimals)
}

export interface Catalog {
  /** key = `${rootAssetId}:${licenseUrl}` */
  byKey: Map<string, CatalogEntry>;
}

/** YAML の expected shape */
interface RawCatalog {
  entries: Array<{
    rootAssetId: string;
    licenseUrl: string;
    /** "1000000" のような u64 文字列。number は精度落ちるので NG */
    price: string | number;
  }>;
}

export const WILDCARD_ASSET = "*";

export function makeKey(rootAssetId: string, licenseUrl: string): string {
  return `${rootAssetId}:${licenseUrl}`;
}

export function parseCatalog(yaml: string): Catalog {
  const raw = parseYaml(yaml) as RawCatalog | null;
  if (!raw || !Array.isArray(raw.entries)) {
    throw new Error("invalid catalog YAML: missing entries[]");
  }
  const byKey = new Map<string, CatalogEntry>();
  for (const e of raw.entries) {
    if (!e.rootAssetId || !e.licenseUrl || e.price === undefined) {
      throw new Error(`invalid catalog entry: ${JSON.stringify(e)}`);
    }
    const price = typeof e.price === "string" ? BigInt(e.price) : BigInt(Math.trunc(e.price));
    if (price <= 0n) {
      throw new Error(`invalid price in catalog: ${e.price}`);
    }
    const key = makeKey(e.rootAssetId, e.licenseUrl);
    if (byKey.has(key)) {
      throw new Error(`duplicate catalog entry for key: ${key}`);
    }
    byKey.set(key, { rootAssetId: e.rootAssetId, licenseUrl: e.licenseUrl, price });
  }
  return { byKey };
}

export function loadCatalogFromFile(path: string): Catalog {
  return parseCatalog(readFileSync(path, "utf-8"));
}

/**
 * インライン default catalog (YAML を bundle に焼き込みたい時用)。
 * Vercel 等で env `COSIGN_CATALOG_PATH` を渡せない / file system に YAML を
 * 同梱できない環境向けのフォールバック。
 *
 * `web/config/cosign-catalog.yaml` の内容と同期を取ること。
 */
export function defaultCatalog(): Catalog {
  const byKey = new Map<string, CatalogEntry>();
  const entries: CatalogEntry[] = [
    {
      rootAssetId: WILDCARD_ASSET,
      licenseUrl:
        "https://rootlens.io/licenses/commercial-v1/0000000000000000000000000000000000000000000000000000000000000000.json",
      price: 1_000_000n, // 1 USDC
    },
    {
      rootAssetId: WILDCARD_ASSET,
      licenseUrl:
        "https://rootlens.io/licenses/training-only-v1/0000000000000000000000000000000000000000000000000000000000000000.json",
      price: 500_000n, // 0.5 USDC
    },
  ];
  for (const e of entries) {
    byKey.set(makeKey(e.rootAssetId, e.licenseUrl), e);
  }
  return { byKey };
}

/**
 * カタログ参照。exact `(rootAssetId, licenseUrl)` を最優先、無ければ
 * fallback `("*", licenseUrl)` (= 当該 license 種別のデフォルト価格) を返す。
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
