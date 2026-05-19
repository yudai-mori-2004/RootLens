// 品質評価 (= SPECS_JA §6.2 ステップ 4 + §6.3)。
//
// ぼかし済 MCAP の中身を読んで、 以下のメトリクスを算出:
//   - 1 つ以上の手の出現率
//   - 両手の出現率
//   - いずれかの手の出現率
//   - 深度データ有効率 (= LiDAR 搭載機のみ)
//   - RGB / 深度 / IMU の同期率
//   - IMU 重力ベクトルの重力定数からの偏差
//   - RGB フレーム欠落数
// これらから 0..100 の総合スコアを算出する。
//
// **棄却閾値は設けない** (= SPECS §6.3)。 スコアが低くてもクリップは ready に進む。
// スコアは買い手向けカタログのフィルタ軸として表示される。
//
// MCAP 解析は重い (= 数百 MB / 数千メッセージ) ので、 Modal の Python 関数で
// mcap library を使って処理するのが現実的。 ここは Modal 呼び出しの薄ラッパ。

export interface QualityBreakdown {
  anyHandRatio: number;          // 0..1
  twoHandRatio: number;          // 0..1
  depthValidRatio: number | null;
  syncRatio: number;             // 0..1
  imuGravityDeviation: number;   // m/s² (重力定数からの偏差)
  frameGapCount: number;
}

export interface QualityScore {
  total: number;  // 0..100
  breakdown: QualityBreakdown;
}

/// MVP stub。 Modal 経由で本物の MCAP 解析を呼ぶようになるまでの placeholder。
/// 実装時は callQualityEval(modal_endpoint, blurredR2Key) のような形式に。
export async function computeQuality(opts: {
  blurredR2Key: string;
}): Promise<QualityScore> {
  console.warn("[quality] computeQuality is a stub. Returning placeholder score.");
  void opts;
  return {
    total: 75,
    breakdown: {
      anyHandRatio: 0.72,
      twoHandRatio: 0.42,
      depthValidRatio: null,
      syncRatio: 0.95,
      imuGravityDeviation: 0.32,
      frameGapCount: 0,
    },
  };
}
