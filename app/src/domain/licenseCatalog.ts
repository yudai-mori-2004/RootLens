// ライセンスカタログのアプリ側ミラー。
//
// 単一の source of truth は web/lib/license-nft/license-urls.ts と
// web/lib/license-nft/catalog.ts (= co-sign API が参照)。 アプリ は web パッケージを直接
// import できないので、 同じ値を ここに 二重定義する。
//
// 更新手順:
//   1. document/v0.1.2/license-templates/<type>.txt を編集
//   2. node web/scripts/build-license-json.mjs (= 新 hash 付き URL を出力)
//   3. web/lib/license-nft/license-urls.ts を貼り替え
//   4. **本ファイルも貼り替え** (= ここを忘れるとアプリの URL が古いまま issue_license を叩いて co-sign で reject される)
//
// URL の `<sha256>.json` 部分は条文 JSON 自身の sha256。 placeholder
// (0000...0000) を使うと co-sign API 側 catalog でマッチせず、 ライセンス発行は失敗する。

export const LICENSE_TYPES = [
  'commercial-v1',
  'non-commercial-v1',
  'training-only-v1',
  'redistribution-v1',
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_URLS: Record<LicenseType, string> = {
  'commercial-v1':
    'https://rootlens.io/licenses/commercial-v1/a45b97b96684e972516d2188a6fea2e9d37a6f50e6518bb2b23659b3948672dd.json',
  'non-commercial-v1':
    'https://rootlens.io/licenses/non-commercial-v1/e541d00f60f973c34d5bff9d7665fab30ea09e5c6b3d4d7c8f25c147cee6cc4d.json',
  'training-only-v1':
    'https://rootlens.io/licenses/training-only-v1/1aa2b7a6e6991944fe2125e272c2b6abf6f6206ed98b47ed589ff7ff5a1fc450.json',
  'redistribution-v1':
    'https://rootlens.io/licenses/redistribution-v1/bdccbb8167d9a1ac8a994404104dacbaab613ead208e989070ac7137b7008944.json',
};

/// USDC (= 6 decimals)。 web/lib/license-nft/catalog.ts と一致させる。
export const LICENSE_PRICE_USDC: Record<LicenseType, number> = {
  'commercial-v1': 1.0,
  'non-commercial-v1': 0.2,
  'training-only-v1': 0.5,
  'redistribution-v1': 5.0,
};

/// URL から license slug を抽出 (= /licenses/<slug>/<hash>.json)。 該当なしは null。
export function licenseTypeFromUrl(url: string | null | undefined): LicenseType | null {
  if (!url) return null;
  const m = url.match(/\/licenses\/([^/]+)\//);
  if (!m) return null;
  const slug = m[1] as LicenseType;
  return (LICENSE_TYPES as readonly string[]).includes(slug) ? slug : null;
}

export function priceFromLicenseUrl(url: string | null | undefined): number | null {
  const t = licenseTypeFromUrl(url);
  return t ? LICENSE_PRICE_USDC[t] : null;
}
