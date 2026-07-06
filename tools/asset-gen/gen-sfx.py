# 撮影モード効果音の合成スクリプト。 app/assets/sounds/*.mp3 を直接上書きする。
#
# 使い方:
#   python3 tools/asset-gen/gen-sfx.py            # 全 7 音を再生成
#   python3 tools/asset-gen/gen-sfx.py rec_stop   # 1 音だけ再生成
#
# 必要なもの: numpy、 ffmpeg (PATH 上)。
# 反映: dev ビルドでは Metro が配信するので、 生成後にアプリを reload するだけで鳴り変わる。
#       設定画面のデベロッパー欄に試聴ボタンがある。
#
# 音の性格 (= Meta グラス調): ガラスベル (基音 + 微デチューン + 非整数倍音)、 ソフトアタック、
# 指数減衰、 拡散残響の短い尾、 ステレオ微差。 いじるのは主に下の SOUNDS 定義:
#   notes: (周波数Hz, 開始秒, 長さ秒, 音量, 減衰秒, きらめき量) のリスト
#   canvas: 残響前の全体尺 (秒)
# 全体の質感は REVERB_TAIL / REVERB_WET / MASTER_PEAK で調整する。

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 48000

# ─── 全体の質感 ────────────────────────────────────────────────────────
REVERB_TAIL = 0.45   # 残響の長さ (秒)。 深くしたい → 0.6〜0.8
REVERB_WET = 0.16    # 残響の混ぜ量 (0..1)。 リッチに → 0.2〜0.25
MASTER_PEAK = 0.7    # ピーク音量 (0..1)
STEREO_DELAY = 0.0004  # 右chの遅れ (秒)。 広がり。 0 でモノ相当

# ─── 音名 → 周波数 (よく使う音だけ) ────────────────────────────────────
G4, A4, Cs5, D5, E5, Fs5, A5, E6 = 392.0, 440.0, 554.37, 587.33, 659.25, 739.99, 880.0, 1318.5

# ─── 各効果音の定義 ────────────────────────────────────────────────────
# notes の 1 要素 = (freq, at, dur, amp, decay, sparkle)
SOUNDS: dict[str, dict] = {
    # 入場チャイム: E5 → A5 の上昇 2 音
    "enter_capture_chime_0.4s": {
        "canvas": 0.9,
        "notes": [(E5, 0.00, 0.70, 0.80, 0.30, 0.18),
                  (A5, 0.13, 0.80, 0.90, 0.38, 0.18)],
    },
    # パー確定: A5 の明るい単音ピック
    "detect_palm_confirm_0.4s": {
        "canvas": 0.7,
        "notes": [(A5, 0.00, 0.65, 1.00, 0.30, 0.25)],
    },
    # グッド確定 (ピロ): D5 → F#5 の軽い 2 音
    "detect_thumbs_up_confirm_0.4s": {
        "canvas": 0.75,
        "notes": [(D5, 0.00, 0.45, 0.85, 0.22, 0.18),
                  (Fs5, 0.09, 0.60, 0.95, 0.30, 0.18)],
    },
    # カウント刻み: 丸い短ティック (tick 型 = ベルではなく木琴寄り)
    "countdown_tick_blip_0.15s": {
        "tick": {"freq": 1150, "dur": 0.14, "decay": 0.045},
    },
    # 録画開始 (ゴー): A4 - C#5 - E5 の上昇アルペジオ
    "countdown_end_go_0.5s": {
        "canvas": 1.0,
        "notes": [(A4, 0.00, 0.35, 0.70, 0.16, 0.18),
                  (Cs5, 0.10, 0.35, 0.75, 0.16, 0.18),
                  (E5, 0.20, 0.75, 0.95, 0.34, 0.18)],
    },
    # 録画停止 (解決): A5 → E5 の下降 2 音
    "rec_stop_soft_0.4s": {
        "canvas": 0.9,
        "notes": [(A5, 0.00, 0.50, 0.85, 0.24, 0.18),
                  (E5, 0.12, 0.70, 0.90, 0.34, 0.18)],
    },
    # 手が見えない警告: G4 の柔らかい 2 連 (耳障りにしない)
    "warn_hand_lost_alert_0.6s": {
        "canvas": 0.8,
        "notes": [(G4, 0.00, 0.30, 0.80, 0.14, 0.05),
                  (G4, 0.20, 0.45, 0.85, 0.20, 0.05)],
    },
}

# ─── 合成の中身 ────────────────────────────────────────────────────────

rng = np.random.default_rng(7)


def bell(freq: float, dur: float, amp: float, decay: float, sparkle: float, attack: float = 0.008) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    env = np.minimum(t / attack, 1.0) * np.exp(-t / decay)
    detune = 1.0015
    y = (np.sin(2 * np.pi * freq * t) + np.sin(2 * np.pi * freq * detune * t)) * 0.5
    y += 0.22 * np.sin(2 * np.pi * freq * 2.756 * t) * np.exp(-t / (decay * 0.4))   # ガラス倍音
    y += 0.10 * np.sin(2 * np.pi * freq * 5.404 * t) * np.exp(-t / (decay * 0.22))
    y += sparkle * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t / (decay * 0.6))  # オクターブのきらめき
    return y * env * amp


def soft_tick(freq: float, dur: float, decay: float) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    env = np.minimum(t / 0.002, 1.0) * np.exp(-t / decay)
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2.01 * t)) * env


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
    return y


def reverb(y: np.ndarray) -> np.ndarray:
    ir_n = int(SR * REVERB_TAIL)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (SR * REVERB_TAIL / 5.0))
    ir /= np.sqrt((ir ** 2).sum())
    wet = np.convolve(y, ir)
    dry = np.concatenate([y, np.zeros(len(wet) - len(y))])
    return dry + REVERB_WET * wet


def write_mp3(y: np.ndarray, out_mp3: str) -> None:
    y = reverb(y)
    d = int(SR * STEREO_DELAY)
    left = np.concatenate([y, np.zeros(d)])
    right = np.concatenate([np.zeros(d), y])
    st = np.stack([left, right], axis=1)
    st *= MASTER_PEAK / max(1e-9, np.abs(st).max())
    fade = int(SR * 0.005)
    st[:fade] *= np.linspace(0, 1, fade)[:, None]
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    pcm = (st * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", tmp.name,
             "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", out_mp3],
            check=True,
        )
    os.unlink(tmp.name)


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_dir = os.path.join(repo_root, "app", "assets", "sounds")
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, spec in SOUNDS.items():
        if only and only not in name:
            continue
        out = os.path.join(out_dir, f"{name}.mp3")
        write_mp3(render(spec), out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
