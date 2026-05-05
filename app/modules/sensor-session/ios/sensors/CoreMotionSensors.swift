import CoreMotion
import Foundation

// CoreMotion 系 ISensor 実装群。
// 各 sensor は CoreMotionController.shared のリングバッファを切り出して payload を構築する。
//
// id 規則: ios.core_motion.<api_path>
// exclusivityGroup = nil (IMU は他とフラット並列可)
//
// 思想 (Don't be the judge):
//   - "raw" / "fused" の判定はしない。CMMotionManager の API ごとに 1 ISensor を立てる。
//     - accelerometer / gyro / magnetometer は raw API
//     - device_motion は fused API (Apple が融合済みで提供)
//     - altimeter は別ハードウェア (バロメーター)
//   - consumer (TP Extension / 検証側) が API path を見て解釈する

// MARK: - CoreMotionAccelerometerSensor

final class CoreMotionAccelerometerSensor: NativeSensor {
  let id: String = "ios.core_motion.accelerometer"
  let exclusivityGroup: String? = nil

  func descriptor() async -> SensorDescriptor {
    let mgr = CoreMotionController.shared.motionManager
    let available = mgr.isAccelerometerAvailable
    let info: [String: Any] = [
      "is_available": available,
      "is_active": mgr.isAccelerometerActive,
      "update_interval_s": mgr.accelerometerUpdateInterval
    ]
    if available { CoreMotionController.shared.startAccelerometerIfAvailable() }
    return SensorDescriptor(
      id: id,
      exclusivityGroup: exclusivityGroup,
      available: available,
      apiDescriptor: info,
      unavailableReason: available ? nil : "accelerometer_unavailable"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let (startNs, endNs) = CoreMotionController.windowRangeNs(window)
    let samples = CoreMotionController.shared.accelBuffer.sliceByTimestamp(startNs: startNs, endNs: endNs)
    let payload: [String: Any] = [
      "samples": samples.map { sampleToDict($0) },
      "sample_count": samples.count,
      "update_interval_s": CoreMotionController.shared.motionManager.accelerometerUpdateInterval,
      "window_start_ns": String(startNs),
      "window_end_ns": String(endNs)
    ]
    return SensorResult(
      sensorId: id, apiPath: id, kind: "point",
      payload: payload, startNs: startNs, endNs: endNs, unavailableReason: nil
    )
  }

  private func sampleToDict(_ s: AccelSample) -> [String: Any] {
    return [
      "t_ns": String(s.timestampNs),
      "x": s.x, "y": s.y, "z": s.z
    ]
  }
}

// MARK: - CoreMotionGyroSensor

final class CoreMotionGyroSensor: NativeSensor {
  let id: String = "ios.core_motion.gyro"
  let exclusivityGroup: String? = nil

  func descriptor() async -> SensorDescriptor {
    let mgr = CoreMotionController.shared.motionManager
    let available = mgr.isGyroAvailable
    let info: [String: Any] = [
      "is_available": available,
      "is_active": mgr.isGyroActive,
      "update_interval_s": mgr.gyroUpdateInterval
    ]
    if available { CoreMotionController.shared.startGyroIfAvailable() }
    return SensorDescriptor(
      id: id, exclusivityGroup: exclusivityGroup,
      available: available, apiDescriptor: info,
      unavailableReason: available ? nil : "gyro_unavailable"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let (startNs, endNs) = CoreMotionController.windowRangeNs(window)
    let samples = CoreMotionController.shared.gyroBuffer.sliceByTimestamp(startNs: startNs, endNs: endNs)
    let payload: [String: Any] = [
      "samples": samples.map { ["t_ns": String($0.timestampNs), "x": $0.x, "y": $0.y, "z": $0.z] },
      "sample_count": samples.count,
      "update_interval_s": CoreMotionController.shared.motionManager.gyroUpdateInterval,
      "window_start_ns": String(startNs),
      "window_end_ns": String(endNs)
    ]
    return SensorResult(
      sensorId: id, apiPath: id, kind: "point",
      payload: payload, startNs: startNs, endNs: endNs, unavailableReason: nil
    )
  }
}

// MARK: - CoreMotionMagnetometerSensor

final class CoreMotionMagnetometerSensor: NativeSensor {
  let id: String = "ios.core_motion.magnetometer"
  let exclusivityGroup: String? = nil

  func descriptor() async -> SensorDescriptor {
    let mgr = CoreMotionController.shared.motionManager
    let available = mgr.isMagnetometerAvailable
    let info: [String: Any] = [
      "is_available": available,
      "is_active": mgr.isMagnetometerActive,
      "update_interval_s": mgr.magnetometerUpdateInterval
    ]
    if available { CoreMotionController.shared.startMagnetometerIfAvailable() }
    return SensorDescriptor(
      id: id, exclusivityGroup: exclusivityGroup,
      available: available, apiDescriptor: info,
      unavailableReason: available ? nil : "magnetometer_unavailable"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let (startNs, endNs) = CoreMotionController.windowRangeNs(window)
    let samples = CoreMotionController.shared.magBuffer.sliceByTimestamp(startNs: startNs, endNs: endNs)
    let payload: [String: Any] = [
      "samples": samples.map { ["t_ns": String($0.timestampNs), "x": $0.x, "y": $0.y, "z": $0.z] },
      "sample_count": samples.count,
      "update_interval_s": CoreMotionController.shared.motionManager.magnetometerUpdateInterval,
      "window_start_ns": String(startNs),
      "window_end_ns": String(endNs)
    ]
    return SensorResult(
      sensorId: id, apiPath: id, kind: "point",
      payload: payload, startNs: startNs, endNs: endNs, unavailableReason: nil
    )
  }
}

// MARK: - CoreMotionDeviceMotionSensor (fused)

final class CoreMotionDeviceMotionSensor: NativeSensor {
  let id: String = "ios.core_motion.device_motion"
  let exclusivityGroup: String? = nil

  func descriptor() async -> SensorDescriptor {
    let mgr = CoreMotionController.shared.motionManager
    let available = mgr.isDeviceMotionAvailable
    let info: [String: Any] = [
      "is_available": available,
      "is_active": mgr.isDeviceMotionActive,
      "update_interval_s": mgr.deviceMotionUpdateInterval,
      "available_attitude_reference_frames": availableAttitudeFrames(),
    ]
    if available { CoreMotionController.shared.startDeviceMotionIfAvailable() }
    return SensorDescriptor(
      id: id, exclusivityGroup: exclusivityGroup,
      available: available, apiDescriptor: info,
      unavailableReason: available ? nil : "device_motion_unavailable"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let (startNs, endNs) = CoreMotionController.windowRangeNs(window)
    let samples = CoreMotionController.shared.deviceMotionBuffer.sliceByTimestamp(startNs: startNs, endNs: endNs)
    let payload: [String: Any] = [
      "samples": samples.map { dmToDict($0) },
      "sample_count": samples.count,
      "update_interval_s": CoreMotionController.shared.motionManager.deviceMotionUpdateInterval,
      "window_start_ns": String(startNs),
      "window_end_ns": String(endNs)
    ]
    return SensorResult(
      sensorId: id, apiPath: id, kind: "point",
      payload: payload, startNs: startNs, endNs: endNs, unavailableReason: nil
    )
  }

  private func dmToDict(_ s: DeviceMotionSample) -> [String: Any] {
    var d: [String: Any] = [
      "t_ns": String(s.timestampNs),
      "attitude_quaternion": ["x": s.qx, "y": s.qy, "z": s.qz, "w": s.qw],
      "user_acceleration": ["x": s.userAx, "y": s.userAy, "z": s.userAz],
      "gravity": ["x": s.gx, "y": s.gy, "z": s.gz],
      "rotation_rate": ["x": s.rx, "y": s.ry, "z": s.rz]
    ]
    if let mx = s.mx, let my = s.my, let mz = s.mz {
      var mag: [String: Any] = ["x": mx, "y": my, "z": mz]
      if let acc = s.mAccuracy { mag["accuracy"] = acc }
      d["magnetic_field"] = mag
    }
    return d
  }

  private func availableAttitudeFrames() -> [String] {
    let mask = CMMotionManager.availableAttitudeReferenceFrames()
    var out: [String] = []
    if mask.contains(.xArbitraryZVertical) { out.append("xArbitraryZVertical") }
    if mask.contains(.xArbitraryCorrectedZVertical) { out.append("xArbitraryCorrectedZVertical") }
    if mask.contains(.xMagneticNorthZVertical) { out.append("xMagneticNorthZVertical") }
    if mask.contains(.xTrueNorthZVertical) { out.append("xTrueNorthZVertical") }
    return out
  }
}

// MARK: - CoreMotionAltimeterSensor

final class CoreMotionAltimeterSensor: NativeSensor {
  let id: String = "ios.core_motion.altimeter"
  let exclusivityGroup: String? = nil

  func descriptor() async -> SensorDescriptor {
    let available = CMAltimeter.isRelativeAltitudeAvailable()
    let info: [String: Any] = [
      "is_relative_altitude_available": available,
      "authorization_status": String(describing: CMAltimeter.authorizationStatus())
    ]
    if available { CoreMotionController.shared.startAltimeterIfAvailable() }
    return SensorDescriptor(
      id: id, exclusivityGroup: exclusivityGroup,
      available: available, apiDescriptor: info,
      unavailableReason: available ? nil : "altimeter_unavailable"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let (startNs, endNs) = CoreMotionController.windowRangeNs(window)
    let samples = CoreMotionController.shared.altitudeBuffer.sliceByTimestamp(startNs: startNs, endNs: endNs)
    let payload: [String: Any] = [
      "samples": samples.map {
        [
          "t_ns": String($0.timestampNs),
          "pressure_kpa": $0.pressure,
          "relative_altitude_m": $0.relativeAltitude
        ]
      },
      "sample_count": samples.count,
      "window_start_ns": String(startNs),
      "window_end_ns": String(endNs)
    ]
    return SensorResult(
      sensorId: id, apiPath: id, kind: "point",
      payload: payload, startNs: startNs, endNs: endNs, unavailableReason: nil
    )
  }
}
