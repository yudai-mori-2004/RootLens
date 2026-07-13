// R2 オブジェクトキー / プレフィックス / 撮影構成マニフェストの命名関数。
// AWS SDK 依存ゼロ (= 純粋な文字列関数)。
//
// バケットは撮影構成ごとに分離する:
//   ultra_wide → R2_BUCKET_RAW        (= rootlens-raw、 超広角 RGB の raw)
//   arkit      → R2_BUCKET_RAW_ARKIT  (= depth / IMU / 6DoF ポーズ等 ARKit 由来 raw)
// key prefix はどちらのバケットでも raw/<content_hash>/ で対称。

// ─── raw (= 端末アップロード) ───────────────────────────────────────────

/// クリップ 1 件の raw プレフィックス。 端末アップロードのファイル群がこの配下に並ぶ。
export function rawSessionPrefix(contentHash: string): string {
  return `raw/${contentHash}/`;
}

/// 撮影構成 ID (= app/src/dataflow/recording-configs/ と 1:1)。
export type RecordingConfigId = "ultra_wide" | "arkit";

/// 撮影構成が出力するファイル名。 構成が増えたら固有ファイルを足す。
export type RawSessionFilename =
  | "rgb.mp4"
  | "frames.jsonl"            // per-frame の pose / intrinsics / tracking / hands (旧名 realtime_handpose.jsonl)
  | "realtime_handpose.jsonl" // 旧ビルド (= build 30 以前) 互換。 新規アップロードが frames.jsonl に揃ったら削除
  | "metadata.json"
  | "imu.jsonl"           // ARKit 構成のみ
  | "depth.tar"           // ARKit + LiDAR (Pro) のみ optional
  | "pointcloud.jsonl"    // ARKit 構成のみ optional (= VIO 特徴点群)
  | "mesh.jsonl";         // ARKit + LiDAR (Pro) のみ optional (= シーン再構成メッシュ)

/// 構成ごとのアップロードファイルマニフェスト (= 端末の config.outputFiles と対応する server 側 contract)。
/// 端末は presign に無い名前をアップロードしようとすると fail-loud する (= ズレ検出)。
export const RAW_SESSION_MANIFEST: Record<
  RecordingConfigId,
  { filename: RawSessionFilename; contentType: string }[]
> = {
  ultra_wide: [
    { filename: "rgb.mp4", contentType: "video/mp4" },
    { filename: "realtime_handpose.jsonl", contentType: "application/x-ndjson" },
    { filename: "metadata.json", contentType: "application/json" },
  ],
  arkit: [
    { filename: "rgb.mp4", contentType: "video/mp4" },
    { filename: "frames.jsonl", contentType: "application/x-ndjson" },
    { filename: "realtime_handpose.jsonl", contentType: "application/x-ndjson" },
    { filename: "imu.jsonl", contentType: "application/x-ndjson" },
    { filename: "metadata.json", contentType: "application/json" },
    { filename: "depth.tar", contentType: "application/x-tar" },
    { filename: "pointcloud.jsonl", contentType: "application/x-ndjson" },
    { filename: "mesh.jsonl", contentType: "application/x-ndjson" },
  ],
};

export function rawSessionFileKey(contentHash: string, filename: RawSessionFilename): string {
  return `${rawSessionPrefix(contentHash)}${filename}`;
}

/// raw MP4 の R2 キー。
export function rawMp4Key(contentHash: string): string {
  return rawSessionFileKey(contentHash, "rgb.mp4");
}
