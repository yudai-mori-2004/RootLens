/**
 * RootLens Trustless Verification Module
 *
 * このモジュールはクライアントサイド検証を完全にブラウザ内で完結させる。
 * 接続先は Solana RPC + オフチェーンストレージのみ。WASM 依存なし。
 * RootLens サーバーには一切接続しない。
 *
 * 仕様書 §7.4 クライアントサイド検証アーキテクチャ
 */

// 検証オーケストレータ
export { verifyAll } from "./verify";
export type { VerifyInput } from "./verify";

// 検証結果型
export type { CheckResult, ProcessorVerification, VerificationResult } from "./checks/types";

// コンテンツ解決 (DAS API)
export { contentResolver } from "./content-resolver";
export type { ContentResolver, ResolvedContent, ExtensionNft } from "./content-resolver";

// PDQ / vPDQ 計算 (純粋 TypeScript)
export { computePdq, computeVpdqKeyframes } from "./pdq";
export type { VpdqFrame } from "./pdq";

// Hamming distance
export { hammingDistance } from "./checks/image-pdq";

// オンチェーン設定 (GlobalConfig)
export {
  getGlobalConfigData,
  getProtocolAddresses,
  findWasmVersionByHash,
  SOLANA_RPC_URL,
  PDQ_THRESHOLD,
} from "./config";
export type { GlobalConfigData } from "./config";
