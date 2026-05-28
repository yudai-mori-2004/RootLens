// R2 オブジェクトキー / プレフィックスの命名関数。 AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// WDK workflow worker bundle に取り込まれる必要があるので、 ここから AWS SDK を import しない。
// S3Client が必要な関数 (= presigned URL 発行 / direct download) は lib/r2.ts に置く。
//
// raw/ と processed/ は同じ signature_hash をキーにする対称構造 (DATA_SPECS §5)。
//   raw/<signature_hash>/        端末アップロード (= 撮影構成の出力ファイル + TP signed-json)
//   processed/<signature_hash>/  Pipeline 2 / 3 が raw を元に計算した追加情報

// ─── raw (= 端末アップロード) ───────────────────────────────────────────

/// クリップ 1 件の raw プレフィックス。 端末アップロードのファイル群がこの配下に並ぶ:
///   raw/<signature_hash>/rgb.mp4                  ← C2PA D2 署名済 + ぼかし済の MP4
///   raw/<signature_hash>/realtime_handpose.jsonl  ← 軽量リアルタイム手ランドマーク (= Pipeline 2 スコアリング用)
///   raw/<signature_hash>/metadata.json            ← 機種 / OS / カメラスペック / 構成 ID 等の静的情報
///   raw/<signature_hash>/imu.jsonl                ← ARKit 構成のみ
///   raw/<signature_hash>/depth/<frame_id>.png     ← ARKit + Pro 端末のみ
///   raw/<signature_hash>/signed-json.json         ← TP /process 応答
export function rawSessionPrefix(signatureHash: string): string {
  return `raw/${signatureHash}/`;
}

/// 撮影構成が出力するファイル名 (DATA_SPECS §2.2)。 構成が増えたら固有ファイルを足す。
export type RawSessionFilename =
  | "rgb.mp4"
  | "realtime_handpose.jsonl"
  | "metadata.json"
  | "imu.jsonl"           // ARKit 構成のみ実際にアップロードされる (= 超広角構成では生成されない)
  | "depth.tar";          // ARKit + LiDAR (Pro) のみ。 16-bit PNG (mm) / フレームを 1 本の tar にまとめたもの

export function rawSessionFileKey(signatureHash: string, filename: RawSessionFilename): string {
  return `${rawSessionPrefix(signatureHash)}${filename}`;
}

/// 署名済 MP4 (= 端末で blur + D2 署名済) の R2 キー。
/// Pipeline 2 のフレームサンプリング / VLM と、 Pipeline 3 の WiLoR が入力として読む。
/// Pipeline 2 完了後の撮影者プレビューもこれを presigned GET URL で配る。
export function signedMp4Key(signatureHash: string): string {
  return rawSessionFileKey(signatureHash, "rgb.mp4");
}

/// Pro 端末の深度フレーム 1 枚分のキー (= ARKit 構成のみ)。 frame_id は 6 桁ゼロ詰め。
export function depthFrameKey(signatureHash: string, frameId: number): string {
  const f = String(frameId).padStart(6, "0");
  return `${rawSessionPrefix(signatureHash)}depth/${f}.png`;
}

// ─── processed (= Pipeline 2 / 3 の計算結果) ───────────────────────────

/// クリップ 1 件の processed プレフィックス (DATA_SPECS §5)。
/// raw と同じ signature_hash をキーにする (= 同一動画は同一ハッシュで重複吸収)。
/// この配下に Pipeline 2 / 3 の計算結果が並ぶ。 データセット形式には寄せない (= 集計は事後に別途行う)。
export function processedPrefix(signatureHash: string): string {
  return `processed/${signatureHash}/`;
}

/// Pipeline 2 出力: 総合スコア + 全サブ指標 (DATA_SPECS §3.3)。
export function qualityScoresKey(signatureHash: string): string {
  return `${processedPrefix(signatureHash)}quality_scores.json`;
}

/// Pipeline 2 出力: フレーム単位のセマンティックラベル (= VLM 推定区間をフレーム展開、 DATA_SPECS §3.3)。
export function semanticKey(signatureHash: string): string {
  return `${processedPrefix(signatureHash)}semantic.jsonl`;
}

/// Pipeline 3 出力: フレームごとの WiLoR 手ポーズ推定結果 (DATA_SPECS §4.4)。
export function wilorKey(signatureHash: string): string {
  return `${processedPrefix(signatureHash)}wilor.jsonl`;
}
