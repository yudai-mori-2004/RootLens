// 撮影モード用の効果音 player。
//
// 設計:
//   - 7 種類の SFX を起動時に preload (= 再生時のラグを排除)
//   - 名前 (= キー文字列) で play() を呼ぶ簡素 API
//   - 同じ音を連続再生する時は replayAsync で先頭から再生し直す
//   - file は app/assets/sounds/*.mp3、 後から差替えやすいよう外部 file 参照
//   - file が無い場合は silently skip (= 動作を阻害しない)、 console.warn のみ


import { Audio } from 'expo-av';
import type { AVPlaybackSource } from 'expo-av/build/AV.types';

export type SfxName =
  | 'enter_capture'
  | 'detect_palm'
  | 'detect_thumbs_up'
  | 'detect_cancel'
  | 'countdown_tick'
  | 'countdown_end'
  | 'rec_stop'
  | 'warn_hand_lost';

// 効果音の意図する仕様 (= 役割・音色・長さ)。 ファイル名にも長さと内容を埋め込んである。
// 音源を差し替える時はこの仕様 (短く・テンポ良く) に沿った音を同じファイル名で置くこと。
// ⚠ 鳴らすタイミングは音声シーケンサが「前の音/TTS の完了を待って」 から順に再生するので、
//   多少長くても重ならないが、 UX のテンポのため下記の短い長さを推奨。
//
//   enter_capture    入場時の柔らかいチャイム         ~0.4s   (session 開始時に 1 回)
//   detect_palm      キャリブ確定の肯定的な確定音      ~0.4s   (手のひら中央 OK)
//   detect_thumbs_up サムズアップ → 停止の確定音        ~0.4s
//   detect_cancel    停止シーケンス中のキャンセル音    ~0.2s   (下降ベンド、 目立たせない)
//   countdown_tick   3/2/1 の極短ブリップ               ~0.15s  (各カウントで 1 回)
//   countdown_end    カウント終了 = 録画開始の合図音    ~0.5s   (上昇音など「ゴー」)
//   rec_stop         録画停止音                          ~0.4s
//   warn_hand_lost   手がフレーム外の警告 (繰り返し用)  ~0.6s   (短く、 耳障りでない程度)
//
// require() の path は static 文字列のみ解決可。 ファイル名に長さ・内容を含める。
const SOURCES: Record<SfxName, AVPlaybackSource> = {
  enter_capture:    require('../../assets/sounds/enter_capture_chime_0.4s.mp3'),
  detect_palm:      require('../../assets/sounds/detect_palm_confirm_0.4s.mp3'),
  detect_thumbs_up: require('../../assets/sounds/detect_thumbs_up_confirm_0.4s.mp3'),
  detect_cancel:    require('../../assets/sounds/detect_cancel_blip_0.2s.mp3'),
  countdown_tick:   require('../../assets/sounds/countdown_tick_blip_0.15s.mp3'),
  countdown_end:    require('../../assets/sounds/countdown_end_go_0.5s.mp3'),
  rec_stop:         require('../../assets/sounds/rec_stop_soft_0.4s.mp3'),
  warn_hand_lost:   require('../../assets/sounds/warn_hand_lost_alert_0.6s.mp3'),
};

const sounds: Partial<Record<SfxName, Audio.Sound>> = {};
let preloaded = false;
let preloading: Promise<void> | null = null;

/// AudioSession を再生用に許可する。 既に撮影 native 側で .playAndRecord 系を
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

/// 起動時 1 度だけ呼ぶ。 全 file を Sound インスタンスに展開して preload。
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

/// 名前指定で再生し、 再生完了まで待つ (= 音声シーケンサが重なりを避けるために使う)。
/// didJustFinish で解決。 取りこぼし対策に safety timeout も張る。 未 load 時は即解決。
export async function playSfxAwait(name: SfxName): Promise<void> {
  // preload 未完なら待ってから再生する (= 起動直後の enter_capture 等が「未ロードだから skip」 で
  // 無音になり、 後続の TTS だけ流れて順序が崩れるのを防ぐ)。
  if (!sounds[name]) await preloadCaptureSounds();
  const s = sounds[name];
  if (!s) return;
  await new Promise<void>((resolve) => {
    let done = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      s.setOnPlaybackStatusUpdate(null);
      resolve();
    };
    s.setOnPlaybackStatusUpdate((st) => {
      if (!st.isLoaded) return;
      if (st.isPlaying) { started = true; return; }
      // 自然終了 (didJustFinish) だけでなく、 stopAllSfx で止められた場合 (= 再生開始後に
      // isPlaying が false へ戻る) も即 resolve する。 ⚠ これが無いと停止された音の await が
      // 下の保険タイマーまで宙吊りになり、 音声キュー全体が数秒止まる。
      if (st.didJustFinish || started) finish();
    });
    s.replayAsync().catch(() => finish());
    // status 更新が一切来ないケースの保険 (= 想定最大長 0.6s + 余裕)。
    timer = setTimeout(finish, 3000);
  });
}

/// 再生中の全 SFX を停止する (= 音声シーケンサの割り込み/クリア用)。
export function stopAllSfx(): void {
  for (const name of Object.keys(sounds) as SfxName[]) {
    sounds[name]?.stopAsync().catch(() => {});
  }
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
