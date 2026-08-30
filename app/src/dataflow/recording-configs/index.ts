// Registry of recording configs.
//
// Each platform declares the list of configs available on it; a new capture rig
// (smart glasses, ...) plugs in by adding one entry. Currently:
//   ios     → [arkit, iphone]
//   android → [] (unsupported)
//
// UI and orchestrators pick a config from this registry and never see native
// differences.
//
// ⚠ Dataflow layer: must not import react / react-native.

import { arkitConfig } from './arkit';
import { iphoneConfig } from './iphone';
import type { CaptureMethod, CaptureMethodId, RecordingConfig } from './types';

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
  CaptureMethod,
  CaptureMethodId,
} from './types';

export type DevicePlatform = 'ios' | 'android';

/** Configs available per platform. A new rig is one entry here. */
export const RECORDING_CONFIGS_BY_PLATFORM: Record<DevicePlatform, readonly RecordingConfig[]> = {
  ios: [arkitConfig, iphoneConfig],
  android: [],
};

/** Settings-level capture choices. Mentra is intentionally not a
 * RecordingConfig because its camera session does not run on this phone. */
export const CAPTURE_METHODS: readonly CaptureMethod[] = [
  { id: 'arkit', label: 'iPhone ARKit', location: 'this_device', recordingConfigId: 'arkit' },
  { id: 'mentra', label: 'Mentra', location: 'external_device' },
  { id: 'iphone', label: 'iPhone', location: 'this_device', recordingConfigId: 'iphone' },
];

export function getCaptureMethod(id: CaptureMethodId | string): CaptureMethod | undefined {
  return CAPTURE_METHODS.find((method) => method.id === id);
}

export function recordingConfigForMethod(id: CaptureMethodId | string): RecordingConfig | undefined {
  const method = getCaptureMethod(id);
  return method?.location === 'this_device'
    ? getRecordingConfig(method.recordingConfigId)
    : undefined;
}

/** All configs across platforms, deduplicated. */
export const RECORDING_CONFIGS: readonly RecordingConfig[] = Array.from(
  new Set([...RECORDING_CONFIGS_BY_PLATFORM.ios, ...RECORDING_CONFIGS_BY_PLATFORM.android]),
);

/** The default config: arkit, which captures depth and 6DoF poses. */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = arkitConfig;

export function getRecordingConfig(id: string): RecordingConfig | undefined {
  return RECORDING_CONFIGS.find((c) => c.id === id);
}

/** Configs defined for a platform. */
export function configsForPlatform(platform: DevicePlatform): readonly RecordingConfig[] {
  return RECORDING_CONFIGS_BY_PLATFORM[platform];
}

/**
 * Configs that are defined for the platform AND actually usable on this device
 * (defined-but-unsupported ones drop out via isAvailable()).
 */
export async function listAvailableConfigs(platform: DevicePlatform): Promise<RecordingConfig[]> {
  const defined = configsForPlatform(platform);
  const checks = await Promise.all(
    defined.map(async (c) => ({ c, ok: await c.isAvailable().catch(() => false) })),
  );
  return checks.filter((x) => x.ok).map((x) => x.c);
}
