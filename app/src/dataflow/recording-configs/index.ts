// 撮影構成のレジストリ (DATA_SPECS §2.2)。
//
// 「プラットフォームごとに利用可能な撮影構成のリストがある」という抽象。
// 新しいパスはいつでも 1 つ差し込めばよい。現状の実体:
//   ios     → [ultra_wide (共通), arkit (iOS 限定)]
//   android → [ultra_wide (共通)]
// ultra_wide は両プラットフォーム共通パス。arkit は iOS 限定パス (native 未実装)。
// 将来 Android に ARCore 構成を足すなら android の配列に 1 つ加えるだけで済む。
//
// UI / orchestrator はこのレジストリから構成を選ぶだけで、 native の差異を知らない。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない (= Platform は env から判定)。

import { ultraWideConfig } from './ultraWide';
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
  ios: [ultraWideConfig, arkitConfig],
  android: [ultraWideConfig],
};

/** 全プラットフォーム横断の構成一覧 (= 重複排除)。 */
export const RECORDING_CONFIGS: readonly RecordingConfig[] = Array.from(
  new Set([...RECORDING_CONFIGS_BY_PLATFORM.ios, ...RECORDING_CONFIGS_BY_PLATFORM.android]),
);

/** 既定の撮影構成 (= UI_SPECS §1.5: 超広角固定、 両プラットフォーム共通)。 */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = ultraWideConfig;

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
