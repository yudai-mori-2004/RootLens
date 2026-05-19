// R2 オブジェクトキーの命名関数。 AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// workflow worker bundle に取り込まれる必要があるので、 ここから AWS SDK を import しない。
// S3Client が必要な関数 (= presigned URL 発行 / direct download) は lib/r2.ts の方に置く。

/// 生 MP4 (= 端末 upload)
export function rawMp4Key(contentHash: string): string {
  return `mp4/${contentHash}.mp4`;
}

/// ぼかし済 MP4 (= Modal blur 出力、 preview 兼配信検証)
export function blurredMp4Key(contentHash: string): string {
  return `blurred-mp4/${contentHash}.mp4`;
}

/// 配信用 Stera 互換 MCAP (= Modal synthesize 出力)
export function deliveryMcapKey(contentHash: string): string {
  return `delivery-mcap/${contentHash}.mcap`;
}
