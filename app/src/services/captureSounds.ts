// 撮影モード用の効果音 player。
//
// 設計:
//   - 8 種類の SFX を起動時に preload (= 再生時のラグを排除)
//   - 名前 (= キー文字列) で play() を呼ぶ簡素 API
//   - 同じ音を連続再生する時は replayAsync で先頭から再生し直す
//   - file は app/assets/sounds/*.mp3、 後から差替えやすいよう外部 file 参照
//   - file が無い場合は silently skip (= 動作を阻害しない)、 console.warn のみ
//
// 2026-05-27 大方針転換で BGM 連動 hand framing は撤去、 こちらの SFX は新仕様 (= UI_SPECS §5.2)
// の効果音一覧に対応。

import { Audio } from 'expo-av';
import type { AVPlaybackSource } from 'expo-av/build/AV.types';

export type SfxName =
  | 'enter_capture'
  | 'detect_palm'
  | 'detect_thumbs_up'
  | 'countdown_tick'
  | 'countdown_end'
  | 'rec_start'
  | 'rec_stop'
  | 'warn_hand_lost';

// require() の path resolution は static 文字列のみで動くため、 明示的に書く。
// ファイルが無い (= sub-agent の DL が未完了) 段階でも JS は壊れない (= require の解決は実 build 時)。
// この module を import するだけでバンドラが該当 file を含めようとするため、 file 不在だと
// build error になる可能性ある。 try-require を避け、 file 存在を前提に書く。
const SOURCES: Record<SfxName, AVPlaybackSource> = {
  enter_capture:    require('../../assets/sounds/enter_capture.mp3'),
  detect_palm:      require('../../assets/sounds/detect_palm.mp3'),
  detect_thumbs_up: require('../../assets/sounds/detect_thumbs_up.mp3'),
  countdown_tick:   require('../../assets/sounds/countdown_tick.mp3'),
  countdown_end:    require('../../assets/sounds/countdown_end.mp3'),
  rec_start:        require('../../assets/sounds/rec_start.mp3'),
  rec_stop:         require('../../assets/sounds/rec_stop.mp3'),
  warn_hand_lost:   require('../../assets/sounds/warn_hand_lost.mp3'),
};

const sounds: Partial<Record<SfxName, Audio.Sound>> = {};
let preloaded = false;
let preloading: Promise<void> | null = null;

/// AudioSession を再生用に許可する。 既に WideCapture native 側で .playAndRecord 系を
/// 取っているはずだが、 念のため Audio module 側でも mode 設定する (= silent switch でも鳴るように)。
async function ensureAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch {
    // silent fail (= mode 設定エラーで効果音が止まる方が UX 上痛い)
  }
}

/// 起動時 1 度だけ呼ぶ。 全 8 file を Sound インスタンスに展開して preload。
export async function preloadCaptureSounds(): Promise<void> {
  if (preloaded) return;
  if (preloading) return preloading;
  preloading = (async () => {
    await ensureAudioMode();
    const entries = Object.entries(SOURCES) as [SfxName, AVPlaybackSource][];
    await Promise.all(
      entries.map(async ([name, src]) => {
        try {
          const { sound } = await Audio.Sound.createAsync(src, { shouldPlay: false });
          sounds[name] = sound;
        } catch (e) {
          console.warn(`[captureSounds] failed to preload ${name}:`, e);
        }
      }),
    );
    preloaded = true;
    preloading = null;
  })();
  return preloading;
}

/// 名前指定で再生 (= 既に再生中なら先頭から再生し直し)。 file 未 load 時は黙って skip。
export function playSfx(name: SfxName): void {
  const s = sounds[name];
  if (!s) return;
  s.replayAsync().catch(() => {});
}

/// アプリ終了 / 撮影モード退場で呼ぶ。 メモリ解放。
export async function unloadCaptureSounds(): Promise<void> {
  for (const name of Object.keys(sounds) as SfxName[]) {
    const s = sounds[name];
    if (s) {
      try { await s.unloadAsync(); } catch {}
      delete sounds[name];
    }
  }
  preloaded = false;
}
