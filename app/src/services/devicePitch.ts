// カメラ俯角の読み取り (= 加速度計の重力ベクトル)。 撮影画面の装着判定に使う。
//
// 背面カメラの光軸は端末座標の -z。 準静的なら加速度計の読みが重力方向なので、
// 俯角 = asin(-z成分)。 iOS の符号規約 (画面上向き静置で z ≈ -1g) で検証済み:
//   画面上向き静置 (カメラ真下) → +90°、 直立 (カメラ水平) → 0°。
// 端末の UI 向き (横持ち) には依存しない。

import { useEffect, useRef } from 'react';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';

export interface CameraPitchReading {
  /** 平滑化済み俯角 (deg、 下向き正)。 未計測 / 激しく動かしている間は null。 */
  pitchDownDeg: number | null;
  /** 加速度計が使えない端末なら false (= 装着判定をスキップすべき)。 */
  available: boolean;
}

function pitchDownDegOf(r: AccelerometerMeasurement): number | null {
  const mag = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  if (mag < 0.5 || mag > 1.5) return null; // 大きく動かしている最中は読まない
  const s = Math.min(1, Math.max(-1, -r.z / mag));
  return (Math.asin(s) * 180) / Math.PI;
}

/**
 * カメラ俯角の購読 hook。 active の間だけ加速度計を回す (~10Hz、 EMA 平滑)。
 * 値は ref で返す (= 状態機械の ticker から読む。 毎サンプル再描画しない)。
 */
export function useCameraPitch(active: boolean): React.MutableRefObject<CameraPitchReading> {
  const readingRef = useRef<CameraPitchReading>({ pitchDownDeg: null, available: true });

  useEffect(() => {
    if (!active) {
      readingRef.current = { ...readingRef.current, pitchDownDeg: null };
      return;
    }
    let ema: number | null = null;
    let cancelled = false;

    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!cancelled && !ok) readingRef.current = { pitchDownDeg: null, available: false };
      })
      .catch(() => {});

    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener((m) => {
      const raw = pitchDownDegOf(m);
      if (raw == null) return;
      ema = ema == null ? raw : ema + 0.25 * (raw - ema);
      readingRef.current = { pitchDownDeg: ema, available: true };
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [active]);

  return readingRef;
}
