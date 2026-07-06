# 撮影モード効果音の合成スクリプト v2 (リッチ版)。 app/assets/sounds/*.mp3 を直接上書きする。
#
# 使い方:
#   python3 tools/asset-gen/gen-sfx.py            # 全 7 音を再生成
#   python3 tools/asset-gen/gen-sfx.py rec_stop   # 1 音だけ再生成
#
# 必要なもの: numpy、 ffmpeg (PATH 上)。
# 反映: dev ビルドでは Metro が配信するので、 生成後にアプリを reload するだけで鳴り変わる。
#       設定画面のデベロッパー欄に試聴ボタンがある。
#
# v1 からの変更点 (リッチ化の中身):
#   1. ベルを「モーダル合成」に: 部分音ごとに独立した減衰を持たせ、 高い部分音ほど速く消える
#      (実物のガラス/ベルの挙動)。 3 声の微デチューンユニゾン + ランダム位相でコーラスの厚み。
#   2. アタックに +0.35% → 0 の微小ピッチグライドと、 打点の帯域ノイズ (マレットの「息」) を追加。
#      物理感が出て、 純粋なサイン波の「安っぽさ」が消える。
#   3. サブオクターブ (基音の 1 オクターブ下) を薄く敷いて温かみを追加。
#   4. リバーブを本物寄りに: プリディレイ (輪郭を保つ) + 疎らな初期反射 + 帯域制限した拡散尾。
#      左右で別々の IR を使う「真のステレオ」 (ドライは中央のままなのでモノ互換も安全)。
#   5. マスターを実効値 (RMS) 基準のラウドネス正規化に変更。 7 音の体感音量がそろう。
#
# 音の性格 (= Meta グラス調): ガラスベル、 ソフトアタック、 指数減衰、 拡散残響、 ステレオの広がり。
# いじるのは主に下の SOUNDS 定義:
#   notes: (周波数Hz, 開始秒, 長さ秒, 音量, 減衰秒, きらめき量) のリスト
#   canvas: 残響前の全体尺 (秒)
#   ticks: (周波数Hz, 開始秒, 長さ秒, 減衰秒, 音量) のリスト。 ベルにティック声を重ねる
#   wet:   その音だけの残響量 (省略時は REVERB_WET)
# 全体の質感は REVERB_* / TARGET_RMS / MASTER_PEAK で調整する。

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 48000
TWO_PI = 2.0 * np.pi

# ─── 全体の質感 ────────────────────────────────────────────────────────
REVERB_TAIL = 0.90      # 拡散残響の長さ (秒)。 深く → 1.1〜1.3
REVERB_WET = 0.30       # 残響の混ぜ量 (0..1)。 リッチに → 0.3〜0.38、 ドライに → 0.15〜0.2
REVERB_PREDELAY = 0.018  # 残響の立ち上がり遅れ (秒)。 ドライ音の輪郭を保つ。 12〜25ms が自然
REVERB_HP = 260.0       # 残響のローカット (Hz)。 モコモコ防止
REVERB_LP = 7800.0      # 残響のハイカット (Hz)。 シャリつき防止
TARGET_RMS = 0.085      # 知覚音量の基準 (実効値)。 全体を大きく → 0.10
MASTER_PEAK = 0.85      # 最終ピーク上限 (0..1)

# ─── 音名 → 周波数 (よく使う音だけ) ────────────────────────────────────
A3, D4, E4, G4, A4, Cs5, D5, E5, Fs5, A5, B5, E6 = (
    220.0, 293.66, 329.63, 392.0, 440.0, 554.37, 587.33, 659.25, 739.99, 880.0, 987.77, 1318.5)

# ─── 各効果音の定義 ────────────────────────────────────────────────────
# notes の 1 要素 = (freq, at, dur, amp, decay, sparkle)
# 低い音 (A3/D4/E4) は「土台」: 小さめの音量で敷くと厚みが出る。 目立たせる音ではない。
#
# ◆ セットの音楽設計 (A メジャーの機能和声で役割分担):
#     入場チャイム = I の Amaj9 ロール (豊かな「ようこそ」。 最上音 9th = 開いた表情)
#     パー確定     = I (トニック) のブルーム        グッド確定 = IV (D メジャー) のきらめき
#     刻み         = V (属音 E のペダル。 溜め)      go = トニック上昇 / stop = その反行形 (下降して主音に着地)
#   どの順で鳴っても 1 つの調の文法に収まる。 確定系は 2〜3 音 150ms 以内、 移行系は 3〜5 音。
SOUNDS: dict[str, dict] = {
    # 入場チャイム: Amaj9 のハープ・ロール (E4→A4→C#5→E5→B5 を 50〜70ms 間隔で掻き鳴らす)。
    # 音を密に重ねると「メロディ」ではなく「1 つの豊かな和音」に聞こえる。
    # 最上音 B5 (9th) = 浮遊感のある「準備 OK」。 落ち着かせたいなら B5 → A5 に
    "enter_capture_chime_0.4s": {
        "canvas": 0.95,
        "notes": [(A3, 0.00, 0.90, 0.25, 0.45, 0.00),
                  (E4, 0.00, 0.80, 0.30, 0.35, 0.00),
                  (A4, 0.05, 0.75, 0.45, 0.32, 0.08),
                  (Cs5, 0.10, 0.70, 0.55, 0.30, 0.12),
                  (E5, 0.16, 0.70, 0.65, 0.32, 0.16),
                  (B5, 0.23, 0.70, 0.85, 0.40, 0.24)],
    },
    # パー確定: E5 の装飾音から A5 へ「プルン」と跳ねるブルーム (4 度上昇 → 主音 = 確定)
    "detect_palm_confirm_0.4s": {
        "canvas": 0.7,
        "notes": [(A4, 0.00, 0.45, 0.26, 0.22, 0.00),
                  (E5, 0.00, 0.30, 0.45, 0.14, 0.10),
                  (A5, 0.045, 0.65, 1.00, 0.30, 0.28)],
    },
    # グッド確定 (タダッ): D5 → F#5 → A5 の速い D メジャー・ロール (IV の色 = パー確定と響きで区別)
    "detect_thumbs_up_confirm_0.4s": {
        "canvas": 0.8,
        "notes": [(D4, 0.00, 0.60, 0.20, 0.30, 0.00),
                  (D5, 0.00, 0.45, 0.80, 0.20, 0.15),
                  (Fs5, 0.08, 0.55, 0.90, 0.26, 0.18),
                  (A5, 0.14, 0.55, 0.55, 0.30, 0.22)],
    },
    # カウント刻み: 丸い短ティック (tick 型 = ベルではなく木琴寄り)。 残響は控えめ。
    # 音程は E6 = A メジャーの属音 (ドミナント)。 刻みで溜めて go の A メジャーで解決する
    "countdown_tick_blip_0.15s": {
        "tick": {"freq": E6, "dur": 0.14, "decay": 0.045},
        "wet": 0.16,
    },
    # 録画開始 (ゴー): A4 - C#5 - E5 - A5 の上昇アルペジオ。 主音オクターブで確信を持って離陸。
    # 拍頭にティックと同じ声 (E6) を重ねる → 刻みのリズムとアタック感が途切れず go に流れ込む
    "countdown_end_go_0.5s": {
        "canvas": 1.0,
        "ticks": [(E6, 0.00, 0.12, 0.040, 0.50)],
        "notes": [(A3, 0.00, 0.90, 0.26, 0.45, 0.00),
                  (A4, 0.00, 0.32, 0.70, 0.15, 0.12),
                  (Cs5, 0.09, 0.32, 0.75, 0.15, 0.12),
                  (E5, 0.18, 0.40, 0.85, 0.20, 0.16),
                  (A5, 0.27, 0.70, 0.95, 0.36, 0.30)],
    },
    # 録画停止: go の反行形。 E5 - C#5 - A4 と下降して主音に着地 = 本当の終止 (「撮れたよ、 完了」)。
    # ベース (A3) は着地の瞬間に置くと解決感が強まる
    "rec_stop_soft_0.4s": {
        "canvas": 0.95,
        "notes": [(E5, 0.00, 0.45, 0.85, 0.20, 0.14),
                  (Cs5, 0.09, 0.50, 0.80, 0.22, 0.10),
                  (A4, 0.20, 0.80, 0.90, 0.40, 0.10),
                  (A3, 0.20, 0.80, 0.30, 0.50, 0.00)],
    },
    # 手が見えない警告: G4 (調性外の b7 = 「おや?」という注意の色) の柔らかい 2 連。
    # きらめき無し = 鈍い音色。 快適系と明確に聞き分けられるが耳障りではない
    "warn_hand_lost_alert_0.6s": {
        "canvas": 0.8,
        "wet": 0.22,
        "notes": [(G4, 0.00, 0.30, 0.80, 0.14, 0.03),
                  (G4, 0.20, 0.45, 0.85, 0.20, 0.03)],
    },
}

# ─── 合成の中身 ────────────────────────────────────────────────────────

rng = np.random.default_rng(7)


def _fft_band(y: np.ndarray, lo: float | None = None, hi: float | None = None,
              tilt_db_oct: float = 0.0, tilt_from: float = 1500.0) -> np.ndarray:
    """FFT で緩やかな帯域制限 (2次相当の肩) と高域チルトをかける。"""
    n = len(y)
    spec = np.fft.rfft(y)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1.0 / (1.0 + (lo / np.maximum(f, 1e-6)) ** 4)
    if hi:
        g *= 1.0 / (1.0 + (f / hi) ** 4)
    if tilt_db_oct:
        octs = np.log2(np.maximum(f, 1.0) / tilt_from)
        g *= 10.0 ** (tilt_db_oct * np.clip(octs, 0.0, None) / 20.0)
    return np.fft.irfft(spec * g, n)


def _env(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    """ソフトアタック (raised cosine) + 指数減衰。"""
    env = np.exp(-t / decay)
    a = max(1, int(SR * attack))
    if a < len(env):
        env[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, a))
    return env


def bell(freq: float, dur: float, amp: float, decay: float, sparkle: float,
         attack: float = 0.010) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR

    # アタックの微小ピッチグライド (+0.35% → 0)。 ガラスの「チン」という立ち上がり感
    inst_f = freq * (1.0 + 0.0035 * np.exp(-t / 0.045))
    phase = TWO_PI * np.cumsum(inst_f) / SR

    # 3 声ユニゾン (微デチューン + 独立位相) = コーラスの厚み
    y = np.zeros(n)
    for det, g in ((1.0, 1.0), (1.0021, 0.60), (0.9982, 0.60)):
        y += g * np.sin(phase * det + rng.uniform(0.0, TWO_PI))
    y /= 2.2

    # 非整数倍音 (ガラスのモード)。 高い部分音ほど速く減衰 → 時間とともに音色が丸くなる
    for ratio, g, dscale in ((2.756, 0.24, 0.42), (4.07, 0.12, 0.30),
                             (5.404, 0.075, 0.20), (6.79, 0.045, 0.13)):
        y += g * np.sin(TWO_PI * freq * ratio * t + rng.uniform(0.0, TWO_PI)) \
             * np.exp(-t / (decay * dscale))

    # オクターブ上のきらめき (5.3Hz のゆらぎ付きでシマー感)
    trem = 1.0 + 0.25 * np.sin(TWO_PI * 5.3 * t + rng.uniform(0.0, TWO_PI))
    y += sparkle * np.sin(TWO_PI * freq * 2.0 * t + rng.uniform(0.0, TWO_PI)) \
         * np.exp(-t / (decay * 0.6)) * trem

    # サブオクターブの温かみ
    y += 0.17 * np.sin(TWO_PI * freq * 0.5 * t) * np.exp(-t / (decay * 0.55))

    # マレットの「息」: 打点付近だけの帯域ノイズ。 物理感が出る
    nz = rng.standard_normal(n) * np.exp(-t / 0.007)
    nz = _fft_band(nz, lo=freq * 1.2, hi=freq * 5.0)
    y += 0.12 * nz / max(1e-9, np.abs(nz).max())

    return y * _env(t, attack, decay) * amp


def soft_tick(freq: float, dur: float, decay: float) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    y = np.sin(TWO_PI * freq * t)
    y += 0.35 * np.sin(TWO_PI * freq * 2.01 * t) * np.exp(-t / (decay * 0.6))
    y += 0.18 * np.sin(TWO_PI * freq * 3.94 * t) * np.exp(-t / (decay * 0.35))  # 木質の倍音
    nz = rng.standard_normal(n) * np.exp(-t / 0.003)
    nz = _fft_band(nz, lo=freq, hi=freq * 6.0)
    y += 0.10 * nz / max(1e-9, np.abs(nz).max())
    return y * _env(t, 0.0015, decay)


def render(spec: dict) -> np.ndarray:
    if "tick" in spec:
        p = spec["tick"]
        return soft_tick(p["freq"], p["dur"], p["decay"])
    y = np.zeros(int(SR * spec["canvas"]))
    for freq, at, dur, amp, decay, sparkle in spec["notes"]:
        s = bell(freq, dur, amp, decay, sparkle)
        i = int(SR * at)
        end = min(len(y), i + len(s))
        y[i:end] += s[: end - i]
    # ticks: ベルの上にティック声を重ねる (リズムの連続性・拍頭の明確化用)
    for freq, at, dur, decay, amp in spec.get("ticks", ()):
        s = soft_tick(freq, dur, decay) * amp
        i = int(SR * at)
        end = min(len(y), i + len(s))
        y[i:end] += s[: end - i]
    return y


def _make_ir(seed: int) -> np.ndarray:
    """プリディレイ + 疎らな初期反射 + 帯域制限つき拡散尾の簡易 IR。"""
    r = np.random.default_rng(seed)
    pre_n = int(SR * REVERB_PREDELAY)
    tail_n = int(SR * REVERB_TAIL)
    ir = np.zeros(pre_n + tail_n)
    # 初期反射: 6〜45ms に 4 本の疎らなタップ (seed 依存で左右非対称 → 広がり)
    for at, g in zip(sorted(r.uniform(0.006, 0.045, 4)), (0.55, 0.42, 0.33, 0.26)):
        ir[pre_n + int(SR * at)] += g * r.choice((-1.0, 1.0))
    # 拡散尾: 尾の終端で -60dB になる指数減衰ノイズ
    ir[pre_n:] += r.standard_normal(tail_n) * np.exp(-np.arange(tail_n) / (SR * REVERB_TAIL / 6.91)) * 0.9
    ir = _fft_band(ir, lo=REVERB_HP, hi=REVERB_LP, tilt_db_oct=-1.5)
    return ir / np.sqrt((ir ** 2).sum())


IR_L = _make_ir(101)
IR_R = _make_ir(202)


def write_mp3(y: np.ndarray, out_mp3: str, wet: float = REVERB_WET) -> None:
    # ドライは中央、 残響だけ左右別 IR = 自然な広がり + モノ再生でも破綻しない
    wl = np.convolve(y, IR_L)
    wr = np.convolve(y, IR_R)
    dry = np.concatenate([y, np.zeros(len(wl) - len(y))])
    st = np.stack([dry + wet * wl, dry + wet * wr], axis=1)

    # トーン整え: 90Hz 以下と 16kHz 以上をそっと落とす
    for c in range(2):
        st[:, c] = _fft_band(st[:, c], lo=90.0, hi=16000.0)

    # ラウドネス正規化: 300ms 窓の実効値の最大を TARGET_RMS に合わせる → 7 音の体感音量がそろう
    mono = st.mean(axis=1)
    w = int(SR * 0.3)
    power = np.convolve(mono ** 2, np.ones(w) / w, mode="same")
    st *= TARGET_RMS / max(1e-9, np.sqrt(power.max()))
    peak = np.abs(st).max()
    if peak > MASTER_PEAK:
        st *= MASTER_PEAK / peak

    # 聞こえない尾をトリム (ピーク比 -66dB を下回った点まで + 60ms 余白)
    envelope = np.abs(st).max(axis=1)
    threshold = envelope.max() * 10 ** (-66 / 20)
    last = np.argwhere(envelope > threshold).max()
    st = st[: min(len(st), last + int(SR * 0.06))]

    fade = int(SR * 0.005)
    st[:fade] *= np.linspace(0, 1, fade)[:, None]
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    pcm = (st * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as wv:
            wv.setnchannels(2)
            wv.setsampwidth(2)
            wv.setframerate(SR)
            wv.writeframes(pcm.tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", tmp.name,
             "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", out_mp3],
            check=True,
        )
    os.unlink(tmp.name)


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_dir = os.environ.get("SFX_OUT") or os.path.join(repo_root, "app", "assets", "sounds")
    os.makedirs(out_dir, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, spec in SOUNDS.items():
        if only and only not in name:
            continue
        out = os.path.join(out_dir, f"{name}.mp3")
        write_mp3(render(spec), out, wet=spec.get("wet", REVERB_WET))
        print(f"wrote {out}")


if __name__ == "__main__":
    main()