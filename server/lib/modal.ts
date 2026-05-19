// Modal (= Python GPU 関数) を Node.js から HTTP 経由で呼ぶラッパ。
//
// Modal 側 endpoints:
//   - MODAL_BLUR_ENDPOINT       : ぼかし MP4 を生成 + C2PA 署名 (= 「署名 S」) を付与
//   - MODAL_SYNTHESIZE_ENDPOINT : ぼかし MP4 + hand pose → Stera 互換 MCAP を合成
//
// 入出力は R2 オブジェクトキー (= 大きいバイナリは HTTP body で運ばない)。
// Modal 側が R2 から読み書きする。 サーバは key + idempotencyKey の調整だけ。

// ─── blur ───────────────────────────────────────────────────────────────

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

// ─── synthesize (= MP4 → Stera 互換 MCAP) ──────────────────────────────

interface SynthesizeRequest {
  /// ぼかし済 MP4 の R2 オブジェクトキー (= バケット = R2_BUCKET_BLURRED)
  blurredKey: string;
  /// 出力 MCAP の R2 オブジェクトキー (= 同 bucket、 delivery-mcap/ prefix)
  outputKey: string;
  /// 冪等性キー
  idempotencyKey: string;
  /// TP から返った Root NFT asset id (= MCAP の metadata に焼く)
  rootAssetId: string;
}

interface SynthesizeResult {
  mcapContentHash: string;
  frameCount: number;
  handsDetected: number;
  durationMs: number;
  cached: boolean;
}

export async function callSynthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
  const base = process.env.MODAL_SYNTHESIZE_ENDPOINT;
  if (!base) throw new Error("MODAL_SYNTHESIZE_ENDPOINT is not set.");

  const url = new URL(base);
  url.searchParams.set("blurred_key", req.blurredKey);
  url.searchParams.set("output_key", req.outputKey);
  url.searchParams.set("idempotency_key", req.idempotencyKey);
  url.searchParams.set("root_asset_id", req.rootAssetId);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal synthesize endpoint failed: ${res.status} ${text}`);
  }
  return (await res.json()) as SynthesizeResult;
}
