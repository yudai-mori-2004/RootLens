import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rootlens:sns-share';

export interface SnsShareSettings {
  instagramUsername: string;
  twitterUsername: string;
  showWatermark: boolean;
}

const defaults: SnsShareSettings = {
  instagramUsername: '',
  twitterUsername: '',
  showWatermark: true,
};

let cached: SnsShareSettings | null = null;

export async function loadSnsShareSettings(): Promise<SnsShareSettings> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cached = { ...defaults, ...JSON.parse(raw) };
  } catch {}
  if (!cached) cached = { ...defaults };
  return cached;
}

export async function saveSnsShareSettings(
  settings: SnsShareSettings,
): Promise<void> {
  cached = { ...settings };
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
}
