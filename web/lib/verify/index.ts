/**
 * RootLens Trustless Verification Module
 *
 * このモジュールはクライアントサイド検証を完全にブラウザ内で完結させる。
 * 接続先は Solana RPC / Arweave / WASM バイナリソースのみ。
 * RootLens サーバーには一切接続しない。
 *
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 */

// 検証ロジック
export { verifyContentOnChain, hammingDistance } from "./verify-content";
export type { CheckTranslator, PerceptualInputs } from "./verify-content";

// コンテンツ解決 (DAS API)
export { contentResolver } from "./content-resolver";
export type { ContentResolver, ResolvedContent, ExtensionNft } from "./content-resolver";

// PDQ 計算 (WASM)
export { computePdqWasm } from "./pdq-wasm";

// オンチェーン設定 (GlobalConfig)
export {
  getGlobalConfigData,
  getProtocolAddresses,
  getCollectionMints,
  findWasmVersionByHash,
  DAS_RPC_URL,
  PDQ_THRESHOLD,
} from "./config";
export type { GlobalConfigData } from "./config";
