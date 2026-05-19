// R2 オブジェクトキー / プレフィックスの命名関数。 AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// workflow worker bundle に取り込まれる必要があるので、 ここから AWS SDK を import しない。
// S3Client が必要な関数 (= presigned URL 発行 / direct download) は lib/r2.ts の方に置く。

/// 生 MP4 (= 端末 upload)
export function rawMp4Key(contentHash: string): string {
  return `mp4/${contentHash}.mp4`;
}

/// セッション 1 件の生データ prefix。 rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl
/// + camera_intrinsics.json + depth/* がこの prefix 配下に並ぶ (= task 15)。
export function rawSessionPrefix(contentHash: string): string {
  return `raw/${contentHash}/`;
}

/// ぼかし済 MP4 (= Pipeline 2 の出力、 preview 兼 dataset RGB ソース)
export function blurredMp4Key(contentHash: string): string {
  return `blurred-mp4/${contentHash}.mp4`;
}

/// LeRobot v3 配布 dataset の R2 prefix (= Pipeline 3 の出力)。
/// この配下に meta/ data/ videos/ が並ぶ。
export function datasetPrefix(rootAssetId: string): string {
  return `datasets/${rootAssetId}/`;
}
