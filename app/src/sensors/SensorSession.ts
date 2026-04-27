import type { ISensor } from './ISensor';
import type {
  SensorCaptureResult,
  SensorSessionResult,
  StreamCaptureOptions,
  StreamHandle,
  TimeWindow,
} from './types';

/**
 * 撮影セッション抽象。Camera / IMU / Depth / 任意センサーをフラット並列に登録し、
 * capture(window) で並列同期取得する。
 *
 * exclusivityGroup の解決:
 *  - group=null の sensor は全部 capture 対象
 *  - 同じ group の sensor は登録順 (先勝ち) で1個に絞る (Task 04 でユーザー優先度ロジックに置換)
 */
export class SensorSession {
  private readonly sensors: Map<string, ISensor> = new Map();
  private readonly registrationOrder: string[] = [];

  register(sensor: ISensor): void {
    if (this.sensors.has(sensor.id)) {
      throw new Error(`Sensor already registered: ${sensor.id}`);
    }
    this.sensors.set(sensor.id, sensor);
    this.registrationOrder.push(sensor.id);
  }

  unregister(id: string): void {
    if (!this.sensors.delete(id)) return;
    const i = this.registrationOrder.indexOf(id);
    if (i >= 0) this.registrationOrder.splice(i, 1);
  }

  list(): ISensor[] {
    return this.registrationOrder
      .map((id) => this.sensors.get(id))
      .filter((s): s is ISensor => s !== undefined);
  }

  /**
   * 動画 stream 録画開始 (Task 03)。
   * デフォルト実装は throw する (NativeBatchSensorSession がこれを override)。
   * 戻り値の StreamHandle を介して stop / abort する。
   */
  async startStream(_opts: StreamCaptureOptions = {}): Promise<StreamHandle> {
    throw new Error(
      'startStream not supported by this SensorSession variant; use NativeBatchSensorSession'
    );
  }

  /**
   * 撮影窓に対して登録済み sensor を並列 capture する (デフォルト実装は per-sensor 並列)。
   * native 側で batch 取得したい場合はサブクラスで override する (registry の
   * NativeBatchSensorSession 参照)。
   */
  async capture(window: TimeWindow): Promise<SensorSessionResult> {
    const selected = this.selectActiveSensors();

    const results = await Promise.all(
      selected.map((s) => SensorSession.captureOne(s, window))
    );

    return { window, results };
  }

  /**
   * exclusivityGroup を解決して capture 対象にすべき sensor 群を返す。
   *
   * 意味論 (Task 04 で修正):
   *   - group=null の sensor: 常に選択 (他と独立)
   *   - 同じ非null group の sensor 群: 全員選択 (cooperative — 共有 controller で multi-stream)
   *     例: Camera2Sensor + Camera2Depth16Sensor が "android.camera2" 内で協調
   *   - 異なる非null group: 最初に登録された group のみ採用、他 group は skip
   *     例: 将来 ARCore sensor が "android.arcore" 等で入っても、Camera2 group が登録済みなら skip
   */
  selectActiveSensors(): ISensor[] {
    const out: ISensor[] = [];
    let activeGroup: string | null = null;
    for (const id of this.registrationOrder) {
      const s = this.sensors.get(id);
      if (!s) continue;
      if (s.exclusivityGroup === null) {
        out.push(s);
        continue;
      }
      if (activeGroup === null) {
        activeGroup = s.exclusivityGroup;
        out.push(s);
      } else if (s.exclusivityGroup === activeGroup) {
        // 同 group の cooperative sensor
        out.push(s);
      }
      // 違う group は skip (ハードウェア競合)
    }
    return out;
  }

  protected static async captureOne(
    s: ISensor,
    window: TimeWindow
  ): Promise<SensorCaptureResult> {
    try {
      return await s.capture(window);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        sensor_id: s.id,
        api_path: s.id,
        kind: 'unavailable',
        payload: {},
        timestamp: { startNs: window.startNs, endNs: window.startNs },
        unavailable_reason: `capture_error: ${message}`,
      };
    }
  }
}
