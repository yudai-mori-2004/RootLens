// ジェスチャー確定の時間方向フィルタ。
//
// per-frame のジェスチャー分類 (open_palm / thumbs_up) は arkit-capture native 側の
// WearerHandClassifier が行い、 TS 側はそのラベル列をここで安定化してから状態機械に渡す。
// 学習モデルではなく多数決なので、 分類器を差し替えてもこのフィルタはそのまま使える。

export type GestureLabel = 'thumbs_up' | 'open_palm';

/**
 * 連続 N フレーム同じ label が出て初めて confirm する単純な多数決安定器。
 * 30fps を想定して default windowSize=5 (約 167ms)。
 *
 * 用途: gesture trigger を録画開始/終了に使う場合、瞬間的な誤検出をフィルタする。
 */
export class GestureStabilizer {
  private readonly windowSize: number;
  private buffer: (GestureLabel | null)[] = [];
  private lastConfirmed: GestureLabel | null = null;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  /**
   * 新しい label を投入し、安定化済み (= 直近 windowSize 連続で同じだった) ラベルを返す。
   * 確定が変わらない間は同じ値を返す。
   */
  push(label: GestureLabel | null): GestureLabel | null {
    this.buffer.push(label);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    if (this.buffer.length < this.windowSize) {
      return this.lastConfirmed;
    }
    const first = this.buffer[0];
    const allSame = this.buffer.every((l) => l === first);
    if (allSame) {
      this.lastConfirmed = first;
    }
    return this.lastConfirmed;
  }

  reset(): void {
    this.buffer = [];
    this.lastConfirmed = null;
  }
}
