import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import type { ISensor } from './ISensor';
import type {
  ExclusivityGroup,
  SensorCapability,
  SensorCaptureResult,
  TimeWindow,
} from './types';

/**
 * DeviceInfoSensor — 端末の機種情報を `expo-device` 経由で取得する TS-only ISensor。
 *
 * 思想 (Don't be the judge):
 *  - expo-device / expo-application が返す値をそのまま payload に格納する。
 *    RootLens 独自の分類・正規化はしない。
 *  - "P2 アプリ自己申告" 経路 — Android Key Attestation や iOS DeviceCheck からの
 *    機種情報抽出は将来検討。現状は cert chain 信頼の上で OS API レスポンスをそのまま信じる。
 *  - exclusivityGroup = null (他センサーと並列稼働、他に依存しない)
 */
export class DeviceInfoSensor implements ISensor {
  readonly id: string = 'expo.device.info';
  readonly exclusivityGroup: ExclusivityGroup = null;

  async capability(): Promise<SensorCapability> {
    return {
      available: true,
      api_descriptor: {
        platform: Platform.OS,
        platform_version: Platform.Version,
        is_device: Device.isDevice,
      },
    };
  }

  async capture(_window: TimeWindow): Promise<SensorCaptureResult> {
    const captureNs = BigInt(Date.now()) * 1_000_000n;

    // expo-device / expo-application のプロパティをそのまま列挙
    const payload: Record<string, unknown> = {
      // 基本識別
      brand: Device.brand,
      manufacturer: Device.manufacturer,
      model_name: Device.modelName,
      model_id: Device.modelId,
      design_name: Device.designName,
      product_name: Device.productName,
      device_year_class: Device.deviceYearClass,

      // OS 情報
      os_name: Device.osName,
      os_version: Device.osVersion,
      os_build_id: Device.osBuildId,
      os_internal_build_id: Device.osInternalBuildId,
      os_build_fingerprint: Device.osBuildFingerprint,
      platform_api_level: Device.platformApiLevel,

      // ハードウェア識別
      device_type: Device.deviceType,
      device_name: Device.deviceName,
      supported_cpu_architectures: Device.supportedCpuArchitectures,
      total_memory: Device.totalMemory,

      // RN 側 Platform
      rn_platform: Platform.OS,
      rn_platform_version: Platform.Version,
      rn_is_pad: Platform.OS === 'ios' ? Platform.isPad : undefined,
      rn_is_tv: Platform.isTV,

      // App 識別 (機種情報ではないが capture コンテキストとして有用)
      application_id: Application.applicationId,
      application_name: Application.applicationName,
      native_application_version: Application.nativeApplicationVersion,
      native_build_version: Application.nativeBuildVersion,
    };

    // 値が undefined のキーは除く (シリアライズ時の挙動安定化)
    for (const k of Object.keys(payload)) {
      if (payload[k] === undefined) delete payload[k];
    }

    return {
      sensor_id: this.id,
      api_path: this.id,
      kind: 'point',
      payload,
      timestamp: { startNs: captureNs, endNs: captureNs },
    };
  }
}
