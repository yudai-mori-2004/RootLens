// /sample のショーケースビューアが読む JSON の型。
//
// スキーマは tools/lp-sample/lp_sample.py が吐く物と 1:1 に一致する。
// 変えるときは両方 (Python 出力 + この型) を同時に触ること。

export interface AssetStats {
  bytes: number;
  [k: string]: unknown;
}

/** trajectory.json: 一定 Hz にデシメートしたカメラ姿勢の列。 */
export interface TrajectoryData {
  /** 内部でどの Hz にデシメートしたか (10 Hz 想定)。 */
  hz: number;
  /** クリップ先頭の絶対時刻 (ARKit systemUptime ベース、 ns)。 */
  t0_ns: number;
  poses: {
    /** t0_ns からの相対時刻 (ms)。 */
    t: number;
    /** カメラ位置 (m, world)。 */
    xyz: [number, number, number];
    /** カメラ姿勢 (x, y, z, w)。 */
    quat: [number, number, number, number];
  }[];
}

/** timeseries.json: 30 Hz の共通時刻軸に並べたセンサ値。 */
export interface TimeSeriesData {
  hz: number;
  t0_ns: number;
  imu: {
    /** [x, y, z] m/s² (userAccel + gravity)、 各サンプル 1 行。 */
    accel: [number, number, number][];
    /** [x, y, z] rad/s、 各サンプル 1 行。 */
    gyro: [number, number, number][];
  };
  /** 各サンプル時点で装着者の左手 / 右手それぞれが映っていたか (handedness で分離)。 */
  hands: { left: boolean[]; right: boolean[] };
  /** ARKit の trackingState (0=notAvailable, 1=limited, 2=normal)。 */
  tracking: number[];
}

/** summary.json: クリップ全体の統計。 4 パネルの下に静的表示される。 */
export interface SummaryData {
  pipelineVersion: string;
  device: string | null;
  osVersion: string | null;
  appVersion: string | null;
  recordingConfig: string;
  camera: {
    lens?: string;
    field_of_view_deg?: number;
    width?: number;
    height?: number;
    fps?: number;
    recording_fps?: number;
    fx?: number;
    fy?: number;
    cx?: number;
    cy?: number;
    depth?: {
      width: number;
      height: number;
      fx: number; fy: number; cx: number; cy: number;
    };
  } | null;
  captureSettings: unknown | null;
  durationSec: number;
  frames: number;
  fps: number;
  pathLengthM: number;
  areaM2: number;
  trajectoryBBoxMin: [number, number, number];
  trajectoryBBoxMax: [number, number, number];
  handDetectionRate: number;
  trackingNormalRate: number;
  assets: Record<string, AssetStats>;
  /** 取引先に納品する形式 (fpvlabs パイプラインの session.mcap = 顔ぼかし済み MCAP)。
   *  lp_sample.py が入力に使った session.mcap のファイルサイズをそのまま埋める。
   *  旧世代の summary.json では null がありうる (LP 側で「準備中」 表示にする)。 */
  delivery: {
    format: string;
    bytes: number;
    blurred: boolean;
    spec: string;
  } | null;
}

/** /sample にぶら下がる 1 個のショーケース = 1 個の slug ぶんの URL 集合。
 *  slug はドライブのセッションフォルダ名末尾と同じ id (= content_hash 先頭 8 桁)。
 *  R2 public bucket からの絶対 URL を持たせる (= LP は静的に配信するだけ)。 */
export interface ShowcaseAssetUrls {
  slug: string;
  rgb: string;
  depth: string | null;      // LiDAR デバイスの時のみ
  mesh: string | null;       // 同上
  trajectory: string;
  timeseries: string;
  summary: string;
}

/** ビューアで切替表示できる 1 セッション = ドライブ samples/ 配下の 1 フォルダに対応。 */
export interface SessionOption {
  /** セッション id (= content_hash 先頭 8 桁。 ドライブのフォルダ名末尾と同じ)。 */
  id: string;
  /** 撮影ドメインの表示ラベル (i18n 済み文字列。 例: パン屋)。 */
  domainLabel: string;
  /** 撮影日時の短縮表示 (ドライブのフォルダ名と同じ UTC 表記。 例: 7/20 14:40)。 */
  when: string;
  assets: ShowcaseAssetUrls;
  /** ドライブ上の対応セッション (= サンプルの正への参照)。 */
  drive: { path: string; url: string };
}

/** ヘッダーの「収録スタック」 切替ボタンで表示するオプション。 arkit がデフォルト、
 *  今後 mentra 等を足すたびに配列に追加する。 available=false のものはプレースホルダー。 */
export interface PipelineOption {
  id: string;
  label: string;
  description: string;
  available: boolean;
  /** available=true のときの切替可能セッション一覧 (先頭が初期表示)。 */
  sessions?: SessionOption[];
}
