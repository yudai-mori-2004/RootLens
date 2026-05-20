// Modal 関数を Node.js から HTTP 経由で呼ぶラッパ。
//
// Modal 側 endpoints:
//   - MODAL_BLUR_ENDPOINT   : Pipeline 2 (= 顔ぼかし + 「署名 S」 を付与)
//   - MODAL_BUNDLE_ENDPOINT : Pipeline 3 (= raw bundle + root_asset_id → LeRobot v3 dataset)
//
// 入出力は データへのリンク (= R2 オブジェクトキー / プレフィックス) で渡す。
// 大きいバイナリは HTTP body で運ばない、 Modal 側が R2 から読み書きする。

// ─── Pipeline 2: blur (= 顔ぼかし + C2PA 「署名 S」) ───────────────────

interface BlurRequest {
  /// 入力 MP4 の R2 オブジェクトキー (= バケット = R2_BUCKET_RAW)
  inputKey: string;
  /// 出力 MP4 の R2 オブジェクトキー (= バケット = R2_BUCKET_BLURRED)
  outputKey: string;
  /// 冪等性キー (= 同 contentHash で複数回呼ばれても 2 回目は短絡)
  idempotencyKey: string;
}

interface BlurResult {
  /// ぼかし + サーバ C2PA 署名 後 MP4 の sha256 hex
  blurredContentHash: string;
  facesBlurred: number;
  framesProcessed: number;
  /// Modal 処理時間 (= ms、 課金観察用)
  durationMs: number;
  /// Modal 冪等性 cache hit したか
  cached: boolean;
}

export async function callBlur(req: BlurRequest): Promise<BlurResult> {
  const base = process.env.MODAL_BLUR_ENDPOINT;
  if (!base) throw new Error("MODAL_BLUR_ENDPOINT is not set.");

  // Modal の @modal.fastapi_endpoint は str 引数を FastAPI の query param として受け取る。
  const url = new URL(base);
  url.searchParams.set("input_key", req.inputKey);
  url.searchParams.set("output_key", req.outputKey);
  url.searchParams.set("idempotency_key", req.idempotencyKey);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal blur endpoint failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BlurResult;
}

// ─── Pipeline 3: bundle (= LeRobot v3 dataset 構築) ────────────────────

interface BundleRequest {
  /// 生データ prefix (= rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl 等が並ぶ R2 prefix)
  rawPrefix: string;
  /// ぼかし済 MP4 のキー (= Pipeline 2 の出力)
  blurredKey: string;
  /// 出力 LeRobot dataset の R2 prefix (= datasetPrefix(root_asset_id))
  outputPrefix: string;
  /// TP Root NFT asset id (= meta/info.json の rootlens.* に焼く)
  rootAssetId: string;
  /// 冪等性キー
  idempotencyKey: string;
}

interface BundleResult {
  /// 生成 dataset の総 frame 数
  totalFrames: number;
  /// fps (= rgb.mp4 から取った値)
  fps: number;
  /// hands detected per frame の平均。 cached 経路では info.json に保存していないので null。
  handsDetectedAvg: number | null;
  /// Modal 処理時間 (= ms)。 cached 経路では実行していないので null。
  durationMs: number | null;
  /// R2 にアップロードしたファイル数。 cached 経路では null。
  uploadedFiles: number | null;
  cached: boolean;
}

export async function callBundle(req: BundleRequest): Promise<BundleResult> {
  const base = process.env.MODAL_BUNDLE_ENDPOINT;
  if (!base) throw new Error("MODAL_BUNDLE_ENDPOINT is not set.");

  const url = new URL(base);
  url.searchParams.set("raw_prefix", req.rawPrefix);
  url.searchParams.set("blurred_key", req.blurredKey);
  url.searchParams.set("output_prefix", req.outputPrefix);
  url.searchParams.set("root_asset_id", req.rootAssetId);
  url.searchParams.set("idempotency_key", req.idempotencyKey);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal bundle endpoint failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BundleResult;
}
