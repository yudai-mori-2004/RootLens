// SPDX-License-Identifier: Apache-2.0
//
// 4 種別のライセンス条文 JSON URL の唯一の出処。 catalog (server) と issue tools
// (test scripts) はここから読む。 URL の `<sha256>.json` 部分は条文 JSON 自身の
// sha256 で、 条文を更新したら以下の手順で同期する:
//
//   1. document/v0.1.2/license-templates/<type>.txt を編集
//   2. node web/scripts/build-license-json.mjs を実行 (= 新 hash 付き JSON 出力)
//   3. 出力されたパスをここに貼り替え (catalog / issue script 両方が一括で追従)
//
// hash と URL を分けてもよかったが、 URL に hash が焼き込まれた path 構造のため
// 「URL 全体」 が canonical。 hash 単体を別 export にしても二重管理になる。

export const LICENSE_TYPES = [
  "commercial-v1",
  "non-commercial-v1",
  "training-only-v1",
  "redistribution-v1",
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_URLS: Record<LicenseType, string> = {
  "commercial-v1":
    "https://rootlens.io/licenses/commercial-v1/a45b97b96684e972516d2188a6fea2e9d37a6f50e6518bb2b23659b3948672dd.json",
  "non-commercial-v1":
    "https://rootlens.io/licenses/non-commercial-v1/e541d00f60f973c34d5bff9d7665fab30ea09e5c6b3d4d7c8f25c147cee6cc4d.json",
  "training-only-v1":
    "https://rootlens.io/licenses/training-only-v1/1aa2b7a6e6991944fe2125e272c2b6abf6f6206ed98b47ed589ff7ff5a1fc450.json",
  "redistribution-v1":
    "https://rootlens.io/licenses/redistribution-v1/bdccbb8167d9a1ac8a994404104dacbaab613ead208e989070ac7137b7008944.json",
};
