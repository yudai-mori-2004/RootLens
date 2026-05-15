// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseCatalog, lookup, makeKey, WILDCARD_ASSET } from "@/lib/license-nft/catalog";

const SAMPLE = `
entries:
  - rootAssetId: "*"
    licenseUrl: https://rootlens.io/licenses/commercial-v1/abc.json
    price: "1000000"
  - rootAssetId: 7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456
    licenseUrl: https://rootlens.io/licenses/commercial-v1/abc.json
    price: "5000000"
  - rootAssetId: "*"
    licenseUrl: https://rootlens.io/licenses/training-only-v1/def.json
    price: "500000"
`;

describe("catalog", () => {
  it("parses entries with bigint price", () => {
    const cat = parseCatalog(SAMPLE);
    expect(cat.byKey.size).toBe(3);
    const e = cat.byKey.get(makeKey("*", "https://rootlens.io/licenses/commercial-v1/abc.json"))!;
    expect(e.price).toBe(1_000_000n);
  });

  it("lookup exact match wins over wildcard", () => {
    const cat = parseCatalog(SAMPLE);
    const e = lookup(
      cat,
      "7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456",
      "https://rootlens.io/licenses/commercial-v1/abc.json",
    )!;
    expect(e.price).toBe(5_000_000n);
    expect(e.rootAssetId).toBe("7gK8vL2y3hPQR4xZmN6Wfp1JKLMNqRsTuVwXyZ123456");
  });

  it("lookup falls back to wildcard when no exact match", () => {
    const cat = parseCatalog(SAMPLE);
    const e = lookup(
      cat,
      "AnyUnregisteredAssetIdHereXYZ999",
      "https://rootlens.io/licenses/commercial-v1/abc.json",
    )!;
    expect(e.price).toBe(1_000_000n);
    // rootAssetId は呼び出し側のものになる (catalog の "*" ではない)
    expect(e.rootAssetId).toBe("AnyUnregisteredAssetIdHereXYZ999");
  });

  it("lookup returns null when license URL not in catalog", () => {
    const cat = parseCatalog(SAMPLE);
    const e = lookup(
      cat,
      "AnyAssetId",
      "https://rootlens.io/licenses/unknown-license-type/zzz.json",
    );
    expect(e).toBeNull();
  });

  it("rejects duplicate (assetId, licenseUrl) entries", () => {
    expect(() => parseCatalog(`
entries:
  - rootAssetId: "*"
    licenseUrl: https://x/y.json
    price: "1"
  - rootAssetId: "*"
    licenseUrl: https://x/y.json
    price: "2"
`)).toThrow(/duplicate/);
  });

  it("rejects price <= 0", () => {
    expect(() => parseCatalog(`
entries:
  - rootAssetId: "*"
    licenseUrl: https://x/y.json
    price: "0"
`)).toThrow(/invalid price/);
  });

  it("WILDCARD_ASSET is the literal '*'", () => {
    expect(WILDCARD_ASSET).toBe("*");
  });
});
