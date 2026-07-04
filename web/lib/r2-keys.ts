// R2 オブジェクトキー / プレフィックスの命名関数。 AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// v0.1.4: 後段 (blur / Pipeline 2 / Pipeline 3) を切り離したので、 raw/ プレフィックス系のみ。
// processed/ 系は使わない (= v0.1.5 で後段ワーカーを再配線する時に別ファイル / 別 schema で再導入)。

// ─── raw (= 端末アップロード) ───────────────────────────────────────────

/// クリップ 1 件の raw プレフィックス。 端末アップロードのファイル群がこの配下に並ぶ:
///   raw/<signature_hash>/rgb.mp4                  ← C2PA D1 署名済 + blur 無し (= 本当の raw)
///   raw/<signature_hash>/realtime_handpose.jsonl  ← 手ランドマーク
///   raw/<signature_hash>/metadata.json            ← 機種 / OS / カメラスペック / 構成 ID 等の静的情報
///   raw/<signature_hash>/imu.jsonl                ← ARKit 構成のみ
///   raw/<signature_hash>/depth.tar                ← ARKit + LiDAR (Pro) のみ optional
export function rawSessionPrefix(signatureHash: string): string {
  return `raw/${signatureHash}/`;
}

/// 撮影構成が出力するファイル名 (DATA_SPECS §2.2)。 構成が増えたら固有ファイルを足す。
export type RawSessionFilename =
  | "rgb.mp4"
  | "realtime_handpose.jsonl"
  | "metadata.json"
  | "imu.jsonl"           // ARKit 構成のみ実際にアップロードされる
  | "depth.tar";          // ARKit + LiDAR (Pro) のみ optional

export function rawSessionFileKey(signatureHash: string, filename: RawSessionFilename): string {
  return `${rawSessionPrefix(signatureHash)}${filename}`;
}

/// C2PA D1 署名済 MP4 の R2 キー。
export function signedMp4Key(signatureHash: string): string {
  return rawSessionFileKey(signatureHash, "rgb.mp4");
}
