import ExpoModulesCore
import AVFoundation
import CoreMotion

// 抽象センサー層 — iOS 側 Expo Module スカフォールド
//
// Phase 1 では module 定義 + native 列挙 IF + capture IF のシグネチャまで。
// 実 sensor (CameraSensor / CoreMotion 系) は Phase 2 / 3 で本実装。
//
// 設計:
//  - listAvailableSensors() は registered ISensor 群をデバイスで実機列挙して descriptor を返す
//  - capture(sensorIds, windowStartNs, windowDurationMs) は TS 側で exclusivity 解決済みの
//    sensor IDs を受け取り、対応する NativeSensor.capture() を並列実行して結果配列を返す
//
// 注意:
//  - bigint (windowStartNs) は JS から string で渡される
//  - 戻り値は Array<{sensor_id, api_path, kind, payload, timestamp:{start_ns,end_ns}, unavailable_reason?}>

public class SensorSessionModule: Module {
  // 登録された native sensor 群。Phase 2/3 で CameraSensor / CoreMotion 系を register する。
  private let registry = SensorRegistry()

  public func definition() -> ModuleDefinition {
    Name("SensorSession")

    OnCreate {
      Task.detached(priority: .userInitiated) {
        await self.registry.register(CameraSensor())
        await self.registry.register(AvCaptureDepthDataSensor())  // Task 04
        await self.registry.register(CoreMotionAccelerometerSensor())
        await self.registry.register(CoreMotionGyroSensor())
        await self.registry.register(CoreMotionMagnetometerSensor())
        await self.registry.register(CoreMotionDeviceMotionSensor())
        await self.registry.register(CoreMotionAltimeterSensor())
        // 全ストリーム listener 開始 (リングバッファに常時溜める)
        CoreMotionController.shared.startAllAvailable()
      }
    }

    View(SensorPreviewView.self) {
      // Phase 2: プロパティなし (zoom/focus/orientation は Task 05 で追加)
    }

    AsyncFunction("listAvailableSensors") { (promise: Promise) in
      Task.detached(priority: .userInitiated) {
        let descriptors = await self.registry.listDescriptors()
        promise.resolve(descriptors.map { $0.toJSON() })
      }
    }

    AsyncFunction("capture") {
      (sensorIds: [String], windowStartNs: String, windowDurationMs: Int, windowLookbackMs: Int, promise: Promise) in
      // anchor: ネイティブ層 capture 入口で記録する monotonic ns。
      // CMLogItem.timestamp / mach_absolute_time 同軸 → IMU リングバッファ slice の基準。
      // (JS-side の windowStartNs は wall-clock ns で時間軸が違うため slice には使えない)
      let anchorMonotonicNs = monotonicNanoseconds()
      Task.detached(priority: .userInitiated) {
        let startNs = UInt64(windowStartNs) ?? 0
        let window = SensorTimeWindow(
          startNs: startNs,
          durationMs: windowDurationMs,
          lookbackMs: windowLookbackMs,
          anchorMonotonicNs: anchorMonotonicNs
        )
        let results = await self.registry.capture(ids: sensorIds, window: window)
        promise.resolve(results.map { $0.toJSON() })
      }
    }
  }
}

// MARK: - 共通型

/// 撮影窓 (iOS native 内部表現)。
/// - startNs           : JS-side wall-clock ns (Date.now()*1e6)。CMLogItem.timestamp とは時間軸が違うため slice には使えない。
/// - durationMs        : 0 で静止画、>0 で動画 (Task 03)。
/// - lookbackMs        : window 開始前のルックバック ms。
/// - anchorMonotonicNs : ネイティブ層 capture 入口で記録した monotonic ns (mach_absolute_time)。
///                       CMLogItem.timestamp / AVCaptureSession sample timestamp と同軸。IMU slice 基準。
struct SensorTimeWindow {
  let startNs: UInt64
  let durationMs: Int
  let lookbackMs: Int
  let anchorMonotonicNs: UInt64
}

struct SensorDescriptor {
  let id: String
  let exclusivityGroup: String?
  let available: Bool
  let apiDescriptor: [String: Any]
  let unavailableReason: String?

  func toJSON() -> [String: Any] {
    var d: [String: Any] = [
      "id": id,
      "exclusivity_group": exclusivityGroup as Any? ?? NSNull(),
      "available": available,
      "api_descriptor": apiDescriptor
    ]
    if let r = unavailableReason { d["unavailable_reason"] = r }
    return d
  }
}

struct SensorResult {
  let sensorId: String
  let apiPath: String
  let kind: String         // "point" | "stream" | "unavailable"
  let payload: Any
  let startNs: UInt64
  let endNs: UInt64
  let unavailableReason: String?

  func toJSON() -> [String: Any] {
    var d: [String: Any] = [
      "sensor_id": sensorId,
      "api_path": apiPath,
      "kind": kind,
      "payload": payload,
      "timestamp": [
        "start_ns": String(startNs),
        "end_ns": String(endNs)
      ]
    ]
    if let r = unavailableReason { d["unavailable_reason"] = r }
    return d
  }
}

// MARK: - NativeSensor protocol (Phase 2/3 で実装する sensor が満たす契約)

protocol NativeSensor {
  var id: String { get }
  var exclusivityGroup: String? { get }
  func descriptor() async -> SensorDescriptor
  func capture(window: SensorTimeWindow) async -> SensorResult
}

// MARK: - Registry

actor SensorRegistry {
  private var sensors: [String: NativeSensor] = [:]
  private var registrationOrder: [String] = []

  func register(_ s: NativeSensor) {
    if sensors[s.id] == nil {
      sensors[s.id] = s
      registrationOrder.append(s.id)
    }
  }

  func listDescriptors() async -> [SensorDescriptor] {
    var out: [SensorDescriptor] = []
    for id in registrationOrder {
      guard let s = sensors[id] else { continue }
      let d = await s.descriptor()
      out.append(d)
    }
    return out
  }

  func capture(ids: [String], window: SensorTimeWindow) async -> [SensorResult] {
    let targets = ids.compactMap { sensors[$0] }
    return await withTaskGroup(of: SensorResult.self) { group in
      for s in targets {
        group.addTask { await s.capture(window: window) }
      }
      var results: [SensorResult] = []
      for await r in group { results.append(r) }
      return results
    }
  }
}
