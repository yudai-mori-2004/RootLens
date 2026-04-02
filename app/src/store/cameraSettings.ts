import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rootlens:cameraSettings';

export interface CameraSettings {
  grid: boolean;
  mirror: boolean;
  shutterSound: boolean;
}

const defaults: CameraSettings = {
  grid: false,
  mirror: false,
  shutterSound: false,
};

let cached: CameraSettings | null = null;

export async function loadCameraSettings(): Promise<CameraSettings> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      cached = { ...defaults, ...JSON.parse(raw) };
    }
  } catch {}
  if (!cached) cached = { ...defaults };
  return cached;
}

export async function saveCameraSettings(settings: CameraSettings): Promise<void> {
  cached = settings;
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
