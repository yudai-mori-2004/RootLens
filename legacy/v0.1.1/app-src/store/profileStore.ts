import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { config } from '../config';

const KEY = 'rootlens:profile';

/** ユーザー設定のみ。認証情報(address)はPrivyが管理。 */
export interface Profile {
  displayName: string;
  bio: string;
  deviceName: string;   // 自動取得、編集不可
  showDeviceName: boolean;
}

const defaults: Profile = {
  displayName: '',
  bio: '',
  deviceName: '',
  showDeviceName: true,
};

let cached: Profile | null = null;

function getDeviceName(): string {
  return Device.modelName || Device.deviceName || 'Unknown Device';
}

export async function loadProfile(): Promise<Profile> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      cached = { ...defaults, ...JSON.parse(raw) };
    }
  } catch {}
  if (!cached) cached = { ...defaults };
  cached.deviceName = getDeviceName();
  return cached;
}

export async function saveProfile(profile: Profile): Promise<void> {
  cached = { ...profile };
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
}

/** アドレスを短縮表示 */
export function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/**
 * Supabaseにユーザープロフィールを同期する。
 * 認証フロー（RegistrationScreen）から呼ばれる。
 */
export async function syncUserToSupabase(
  address: string,
  profile: Profile,
): Promise<void> {
  const res = await fetch(`${config.serverUrl}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      displayName: profile.displayName,
      bio: profile.bio,
      deviceName: profile.deviceName,
    }),
  });
  if (!res.ok) throw new Error('User sync failed');
}
