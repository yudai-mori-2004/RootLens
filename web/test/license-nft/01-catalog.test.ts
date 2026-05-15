// SPDX-License-Identifier: Apache-2.0
//
// Catalog の lookup 動作テスト。 catalog 自体はコード内定数 (= 旧 YAML パース時代の
// `parseCatalog` テストは廃止)。 ここで検証するのは「`(rootAssetId, licenseUrl)` の
// 解決ロジック (= exact 優先 + wildcard fallback + 未登録 URL は null)」 のみ。

import { describe, it, expect } from "vitest";
import { type Catalog, type CatalogEntry, lookup, makeKey, WILDCARD_ASSET } from "@/lib/license-nft/catalog";

function buildCatalog(entries: CatalogEntry[]): Catalog {
  const byKey = new Map<string, CatalogEntry>();
  for (const e of entries) byKey.set(makeKey(e.rootAssetId, e.licenseUrl), e);
  return { byKey };
}

const SAMPLE = buildCatalog([
  {
    rootAssetId: WILDCARD_ASSET,
    licenseUrl: "https://rootlens.io/licenses/commercial-v1/abc.json",
    price: 1_000_000n,
  },
  {
    rootAssetId: "7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456",
    licenseUrl: "https://rootlens.io/licenses/commercial-v1/abc.json",
    price: 5_000_000n,
  },
  {
    rootAssetId: WILDCARD_ASSET,
    licenseUrl: "https://rootlens.io/licenses/training-only-v1/def.json",
    price: 500_000n,
  },
]);

describe("catalog", () => {
  it("lookup exact match wins over wildcard", () => {
    const e = lookup(
      SAMPLE,
      "7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456",
      "https://rootlens.io/licenses/commercial-v1/abc.json",
    )!;
    expect(e.price).toBe(5_000_000n);
    expect(e.rootAssetId).toBe("7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456");
  });

  it("lookup falls back to wildcard when no exact match", () => {
    const e = lookup(
      SAMPLE,
      "AnyUnregisteredAssetIdHereXYZ999",
      "https://rootlens.io/licenses/commercial-v1/abc.json",
    )!;
    expect(e.price).toBe(1_000_000n);
    expect(e.rootAssetId).toBe("AnyUnregisteredAssetIdHereXYZ999");
  });

  it("lookup returns null when license URL not in catalog", () => {
    const e = lookup(
      SAMPLE,
      "AnyAssetId",
      "https://rootlens.io/licenses/unknown-license-type/zzz.json",
    );
    expect(e).toBeNull();
  });

  it("WILDCARD_ASSET is the literal '*'", () => {
    expect(WILDCARD_ASSET).toBe("*");
  });
});
