// Voice エージェントの言語設定 (= AI 応答 + TTS 読み上げの言語)。
//
// AsyncStorage に永続化。 アプリ全体で 1 値共有 (= dialogue mode 共通)。
// 値は `ja` または `en` のみ受け付ける。 default は ja (= 日本語ユーザ前提)。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type VoiceLanguage = 'ja' | 'en';

const STORAGE_KEY = 'rootlens.voice.language.v1';
const DEFAULT_LANGUAGE: VoiceLanguage = 'ja';

let cached: VoiceLanguage = DEFAULT_LANGUAGE;
let loaded = false;
const listeners = new Set<(lang: VoiceLanguage) => void>();

function notify() {
  for (const fn of listeners) fn(cached);
}

/// 起動時に AsyncStorage から復元。 App.tsx 等で 1 回呼ぶ想定だが、 idempotent。
export async function initVoiceLanguage(): Promise<VoiceLanguage> {
  if (loaded) return cached;
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === 'ja' || v === 'en') cached = v;
  } catch {}
  loaded = true;
  notify();
  return cached;
}

/// 同期的に現在の言語を取得。 init() 前は default を返す。
export function getVoiceLanguage(): VoiceLanguage {
  return cached;
}

/// 言語を保存して全リスナーに通知。
export async function setVoiceLanguage(lang: VoiceLanguage): Promise<void> {
  if (cached === lang) return;
  cached = lang;
  try { await AsyncStorage.setItem(STORAGE_KEY, lang); } catch {}
  notify();
}

/// React コンポーネント側で reactive に購読する hook。
export function useVoiceLanguage(): VoiceLanguage {
  const [lang, setLang] = useState<VoiceLanguage>(cached);
  useEffect(() => {
    let alive = true;
    void initVoiceLanguage().then((v) => { if (alive) setLang(v); });
    const handler = (v: VoiceLanguage) => setLang(v);
    listeners.add(handler);
    return () => {
      alive = false;
      listeners.delete(handler);
    };
  }, []);
  return lang;
}
