/**
 * 仕様書 §7.4 クライアントサイド検証
 *
 * 検証結果の型定義。
 * 全 processor_id が同一の構造で結果を返す。
 */

// ---------------------------------------------------------------------------
// 個別チェック結果
// ---------------------------------------------------------------------------

export interface CheckResult {
  /** チェック識別子 (例: "collection", "tee_signature", "pdq_match") */
  id: string;
  /** 2値。検証できない場合も failed。 */
  status: "verified" | "failed";
  /** 人が読める説明。失敗理由や数値を含む */
  detail?: string;
}

// ---------------------------------------------------------------------------
// processor_id 単位の検証結果
// ---------------------------------------------------------------------------

export interface ProcessorVerification {
  /** processor_id (例: "core-c2pa", "image-pdq", "cert-google") */
  processorId: string;
  /** 共通4チェック: collection, tee_signature, tee_identity, content_binding */
  common: [CheckResult, CheckResult, CheckResult, CheckResult];
  /** processor 固有チェック (0個以上) */
  specific: CheckResult[];
}

// ---------------------------------------------------------------------------
// ページ全体の検証結果
// ---------------------------------------------------------------------------

export interface VerificationResult {
  /** 各 processor の検証結果 */
  processors: ProcessorVerification[];
  /** 全体判定 */
  overall: "verified" | "failed" | "pending";
}
