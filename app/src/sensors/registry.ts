import type { ISensor } from './ISensor';
import { SensorSession } from './SensorSession';
import type {
  ExclusivityGroup,
  SensorCapability,
  SensorCaptureResult,
  SensorSessionResult,
  StreamCaptureOptions,
  StreamHandle,
  TimeWindow,
} from './types';
import {
  isSensorSessionNativeAvailable,
  nativeAbortStream,
  nativeCapture,
  nativeListAvailableSensors,
  nativeStartStream,
  nativeStopStream,
  type NativeSensorDescriptor,
  type NativeSensorResult,
} from '../native/sensorSession';

/**
 * NativeBackedSensor — ネイティブ層に実体がある ISensor の TS 側プロキシ。
 * 同一 id の native sensor を 1 対 1 で表現する。
 *
 * NativeBatchSensorSession.capture() に集約して native 側に一括 dispatch するため、
 * このクラス単体の capture() は デバッグ目的に限定する想定 (内部で N=1 の batch を呼ぶ)。
 */
export class NativeBackedSensor implements ISensor {
  constructor(
    public readonly id: string,
    public readonly exclusivityGroup: ExclusivityGroup,
    private readonly cachedCapability: SensorCapability
  ) {}

  async capability(): Promise<SensorCapability> {
    return this.cachedCapability;
  }

  async capture(window: TimeWindow): Promise<SensorCaptureResult> {
    const results = await nativeCapture(
      [this.id],
      window.startNs,
      window.durationMs,
      window.lookbackMs ?? 0
    );
    const r = results.find((x) => x.sensor_id === this.id);
    if (!r) {
      return {
        sensor_id: this.id,
        api_path: this.id,
        kind: 'unavailable',
        payload: {},
        timestamp: { startNs: window.startNs, endNs: window.startNs },
        unavailable_reason: 'native_no_response',
      };
    }
    return nativeResultToTs(r);
  }
}

/**
 * NativeBatchSensorSession — capture を「選択済み sensor IDs を一発で native に投げて batch 取得」
 * に上書きしたサブクラス。
 *
 * 理由: HW timestamp で同期されたサンプル取得には、ネイティブ側で同一スレッド/同一サイクル内に
 * 各 sensor を読み出すことが望ましい。Promise.all で TS から N 回呼ぶと latency が積み重なる。
 */
class NativeBatchSensorSession extends SensorSession {
  override async startStream(opts: StreamCaptureOptions = {}): Promise<StreamHandle> {
    const selected = this.selectActiveSensors();
    const native = selected.filter((s): s is NativeBackedSensor => s instanceof NativeBackedSensor);
    if (native.length === 0) {
      throw new Error('startStream: no native sensors registered');
    }
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const lookbackMs = opts.lookbackMs ?? 0;
    const outputPath = opts.outputPath ?? '';
    const ids = native.map((s) => s.id);
    const streamId = await nativeStartStream(ids, startNs, lookbackMs, outputPath);

    const window: TimeWindow = { startNs, durationMs: 0, lookbackMs };
    const tsOnly = selected.filter((s) => !(s instanceof NativeBackedSensor));

    return {
      streamId,
      stop: async (): Promise<SensorSessionResult> => {
        const [nativeRaw, tsResults] = await Promise.all([
          nativeStopStream(streamId).then((raw) => raw.map(nativeResultToTs)),
          Promise.all(
            tsOnly.map(async (s) => {
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
                } as SensorCaptureResult;
              }
            })
          ),
        ]);
        return { window, results: [...nativeRaw, ...tsResults] };
      },
      abort: async () => {
        await nativeAbortStream(streamId);
      },
    };
  }

  override async capture(window: TimeWindow): Promise<SensorSessionResult> {
    const selected = this.selectActiveSensors();
    if (selected.length === 0) return { window, results: [] };

    const native = selected.filter(
      (s): s is NativeBackedSensor => s instanceof NativeBackedSensor
    );
    const others = selected.filter((s) => !(s instanceof NativeBackedSensor));

    const [nativeResults, otherResults] = await Promise.all([
      native.length > 0
        ? nativeCapture(
            native.map((s) => s.id),
            window.startNs,
            window.durationMs,
            window.lookbackMs ?? 0
          ).then((raw) => raw.map(nativeResultToTs))
        : Promise.resolve([] as SensorCaptureResult[]),
      Promise.all(
        others.map(async (s) => {
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
            } as SensorCaptureResult;
          }
        })
      ),
    ]);

    const results: SensorCaptureResult[] = [...nativeResults, ...otherResults];

    // batch が返さなかった sensor は unavailable として補完
    const returned = new Set(results.map((r) => r.sensor_id));
    for (const s of selected) {
      if (!returned.has(s.id)) {
        results.push({
          sensor_id: s.id,
          api_path: s.id,
          kind: 'unavailable',
          payload: {},
          timestamp: { startNs: window.startNs, endNs: window.startNs },
          unavailable_reason: 'no_response',
        });
      }
    }

    return { window, results };
  }
}

function descriptorToCapability(d: NativeSensorDescriptor): SensorCapability {
  return {
    available: d.available,
    api_descriptor: d.api_descriptor,
    unavailable_reason: d.unavailable_reason,
  };
}

function nativeResultToTs(r: NativeSensorResult): SensorCaptureResult {
  return {
    sensor_id: r.sensor_id,
    api_path: r.api_path,
    kind: r.kind,
    payload: r.payload,
    timestamp: {
      startNs: BigInt(r.timestamp.start_ns),
      endNs: BigInt(r.timestamp.end_ns),
    },
    unavailable_reason: r.unavailable_reason,
  };
}

/**
 * デフォルトの SensorSession を構築する。
 * 1. ネイティブ層 (Camera / IMU) が列挙した sensor を全部 NativeBackedSensor として登録
 * 2. TS-only な DeviceInfoSensor (expo-device 経由の機種情報) を登録
 *
 * ネイティブモジュール未実装時 (スカフォールド段階) は DeviceInfoSensor のみ登録された
 * SensorSession を返す (撮影は機能しないが機種情報のみ assertion 化できる)。
 */
export async function createDefaultSensorSession(): Promise<{
  session: SensorSession;
  descriptors: NativeSensorDescriptor[];
}> {
  const session = new NativeBatchSensorSession();
  let descriptors: NativeSensorDescriptor[] = [];

  if (isSensorSessionNativeAvailable()) {
    descriptors = await nativeListAvailableSensors();
    for (const d of descriptors) {
      session.register(
        new NativeBackedSensor(d.id, d.exclusivity_group, descriptorToCapability(d))
      );
    }
  }

  // TS-only DeviceInfoSensor を最後に登録 (Camera / IMU と並列に capture される)
  // 動的 import でネイティブ環境以外 (テスト等) でも壊れないようにする
  try {
    const { DeviceInfoSensor } = await import('./DeviceInfoSensor');
    session.register(new DeviceInfoSensor());
  } catch (e) {
    console.warn('[SensorSession] DeviceInfoSensor unavailable:', e);
  }

  return { session, descriptors };
}
