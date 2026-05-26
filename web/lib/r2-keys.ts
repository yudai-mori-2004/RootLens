// R2 オブジェクトキー / プレフィックスの命名関数。 AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// WDK workflow worker bundle に取り込まれる必要があるので、 ここから AWS SDK を import しない。
// S3Client が必要な関数 (= presigned URL 発行 / direct download) は lib/r2.ts に置く。

/// クリップ 1 件のプレフィックス。 端末アップロードのファイル群がこの配下に並ぶ:
///   raw/<content_id>/rgb.mp4              ← C2PA D2 署名済 + ぼかし済の MP4
///   raw/<content_id>/sensors.jsonl
///   raw/<content_id>/imu_high_rate.jsonl
///   raw/<content_id>/camera_intrinsics.json
///   raw/<content_id>/depth/<frame_id>.png ← Pro 端末のみ
///
/// 「raw」 という prefix 名は v0.1.2 由来 (= 端末から直接来るデータ、 という意味)。
/// v0.1.3 でも継承するが、 中身は既にデバイス側で blur + D2 署名済。
export function rawSessionPrefix(contentId: string): string {
  return `raw/${contentId}/`;
}

/// 端末アップロードの固定 4 ファイル分のキー命名。 depth/ は別途扱う (= ファイル数が可変)。
export type RawSessionFilename =
  | "rgb.mp4"
  | "sensors.jsonl"
  | "imu_high_rate.jsonl"
  | "camera_intrinsics.json";

export function rawSessionFileKey(contentId: string, filename: RawSessionFilename): string {
  return `${rawSessionPrefix(contentId)}${filename}`;
}

/// 署名済 MP4 (= 端末で blur + D2 署名済) の R2 キー。
/// Pipeline 2 の VLM / GTSAM 採点と、 Pipeline 3 の WiLoR が入力として読む。
/// Pipeline 2 完了後の撮影者プレビューもこれを presigned GET URL で配る。
export function signedMp4Key(contentId: string): string {
  return rawSessionFileKey(contentId, "rgb.mp4");
}

/// Pro 端末の深度フレーム 1 枚分のキー。 frame_id は 0 始まりの整数 (= 6 桁ゼロ詰め想定)。
export function depthFrameKey(contentId: string, frameId: number): string {
  const f = String(frameId).padStart(6, "0");
  return `${rawSessionPrefix(contentId)}depth/${f}.png`;
}

/// LeRobot v3 配布 dataset の R2 prefix (= Pipeline 3 の出力)。
/// この配下に meta/ data/ videos/ が並ぶ。
export function datasetPrefix(rootAssetId: string): string {
  return `datasets/${rootAssetId}/`;
}
