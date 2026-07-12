// 撮影構成のレジストリ (DATA_SPECS §2.2)。
//
// 「プラットフォームごとに利用可能な撮影構成のリストがある」という抽象。
// 新しいパス (= 例: スマートグラス構成) はいつでも 1 つ差し込めばよい。現状の実体:
//   ios     → [arkit]
//   android → [] (未対応)
// 旧 ultra_wide 構成 (= LiDAR 非搭載端末向けの超広角パス) は 2026-07-13 に撤去した。
//
// UI / orchestrator はこのレジストリから構成を選ぶだけで、 native の差異を知らない。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない (= Platform は env から判定)。

import { arkitConfig } from './arkit';
import type { RecordingConfig } from './types';

export type {
  RecordingConfig,
  RecordingSession,
  OutputFileSpec,
  HandLandmark,
  WearerHandObservation,
  GestureKind,
  HandTrackEvent,
  DisplayOrientation,
  HandTrackSubscription,
} from './types';

export type DevicePlatform = 'ios' | 'android';

/** プラットフォームごとに使える撮影構成のリスト。 新パスはここに 1 つ足すだけ。 */
export const RECORDING_CONFIGS_BY_PLATFORM: Record<DevicePlatform, readonly RecordingConfig[]> = {
  ios: [arkitConfig],
  android: [],
};

/** 全プラットフォーム横断の構成一覧 (= 重複排除)。 */
export const RECORDING_CONFIGS: readonly RecordingConfig[] = Array.from(
  new Set([...RECORDING_CONFIGS_BY_PLATFORM.ios, ...RECORDING_CONFIGS_BY_PLATFORM.android]),
);

/** 既定の撮影構成 (= v0.1.4: 深度 + 6DoF が取れる arkit)。 */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = arkitConfig;

export function getRecordingConfig(id: string): RecordingConfig | undefined {
  return RECORDING_CONFIGS.find((c) => c.id === id);
}

/** 指定プラットフォームで定義されている構成一覧。 */
export function configsForPlatform(platform: DevicePlatform): readonly RecordingConfig[] {
  return RECORDING_CONFIGS_BY_PLATFORM[platform];
}

/**
 * 指定プラットフォームで「定義されていて、 かつ当該端末で実際に使える」構成だけを返す。
 * (= 定義はあるが native 未実装/非対応のものは isAvailable() が false で落ちる)
 */
export async function listAvailableConfigs(platform: DevicePlatform): Promise<RecordingConfig[]> {
  const defined = configsForPlatform(platform);
  const checks = await Promise.all(
    defined.map(async (c) => ({ c, ok: await c.isAvailable().catch(() => false) })),
  );
  return checks.filter((x) => x.ok).map((x) => x.c);
}
