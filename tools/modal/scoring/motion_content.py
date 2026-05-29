"""MotionContent 軸: 撮影者の手の動きの豊富さ (0-100)。 内在・タスク非依存・安い。

raw/<hash>/realtime_handpose.jsonl の手ランドマーク (手首 = landmark[0]、 正規化 x,y) の
フレーム間変位を集計する。 動きが多い = 能動的な手作業の示唆。

⚠ ランドマーク自体は推測値だが、 ここで評価するのは「検出できたか (= 推測の当たり外れ)」ではなく
   「写っている手がどれだけ動いているか (= 内容)」。 採点基準は今後パターンが増える想定で、
   Scorer interface 越しに手法を差し替えられる (= これは v1: 手首平均変位ベース)。
"""

from __future__ import annotations

import json

from scoring.base import AxisScore, Scorer, clamp01
from r2ctx import Ctx

# フレーム間の手首変位 (正規化座標) がこの値で「十分な動き」=1.0 に正規化。 運用データで調整。
DISPLACEMENT_NORMALIZE = 0.02


class MotionContentScorer(Scorer):
    name = "motion_content"
    axis = "motion_content"

    def score(self, ctx: Ctx) -> AxisScore:
        path = ctx.download_raw("realtime_handpose.jsonl")
        # handedness ごとに直前フレームの手首座標を保持し、 変位の大きさを集計する。
        prev: dict[str, tuple[float, float]] = {}
        per_hand: dict[str, list] = {}  # handed -> [disp_sum, disp_n]
        frames = 0
        frames_with_hand = 0
        gap_resets = 0   # 手が一旦消えて再起点した回数 (= 高チラつき検出。 低動作と区別する)
        legacy_rows = 0  # 旧スキーマ (hand_landmarks) を検出した行数 (= dummy/古い producer 警告用)
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                frames += 1
                hands = row.get("hands") or []
                if not hands and "hand_landmarks" in row:
                    legacy_rows += 1
                if hands:
                    frames_with_hand += 1
                seen: set[str] = set()
                for h in hands:
                    lms = h.get("landmarks") or []
                    if not lms:
                        continue
                    handed = str(h.get("handedness", "unknown"))
                    seen.add(handed)
                    wx, wy = float(lms[0].get("x", 0.0)), float(lms[0].get("y", 0.0))
                    if handed in prev:
                        px, py = prev[handed]
                        d = ((wx - px) ** 2 + (wy - py) ** 2) ** 0.5
                        acc = per_hand.setdefault(handed, [0.0, 0])
                        acc[0] += d
                        acc[1] += 1
                    prev[handed] = (wx, wy)
                # 消えた手の状態は次の出現時に再起点 (= 連続性が切れた区間は変位に数えない)
                for handed in list(prev.keys()):
                    if handed not in seen:
                        prev.pop(handed, None)
                        gap_resets += 1

        total_sum = sum(v[0] for v in per_hand.values())
        total_n = sum(v[1] for v in per_hand.values())
        mean_disp = (total_sum / total_n) if total_n else 0.0
        motion = clamp01(mean_disp / DISPLACEMENT_NORMALIZE)
        return AxisScore(
            axis=self.axis,
            score=round(motion * 100.0, 2),
            method=f"clamp(signals.meanWristDisplacement / {DISPLACEMENT_NORMALIZE}, 0..1) × 100",
            breakdown={
                "signals": {"meanWristDisplacement": round(mean_disp, 5)},
                "perHand": {
                    h: {"meanDisplacement": round(v[0] / v[1], 5) if v[1] else 0.0, "samples": v[1]}
                    for h, v in per_hand.items()
                },
                "counts": {
                    "frames": frames, "framesWithHand": frames_with_hand,
                    "displacementSamples": total_n, "gapResets": gap_resets,
                },
                "handFrameRatio": clamp01(frames_with_hand / frames) if frames else 0.0,
                "thresholds": {"displacementNormalize": DISPLACEMENT_NORMALIZE},
                # 旧スキーマ (hand_landmarks) を踏むと hands が空で score 0 になる。 silent 0 を避けるため明示。
                **({"schemaWarning": f"legacy 'hand_landmarks' schema in {legacy_rows} rows; expected 'hands'"} if legacy_rows else {}),
            },
        )
