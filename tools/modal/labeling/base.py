"""dense narration ラベリング手法のプラガブル interface。

各 Labeler は「プロバイダ + 手法」を1単位として実装し (gemini-video-dense / claude-diffsw /
claude-single-pass)、 自前の SDK / 認証 (env の key) / リクエスト構造を持つ。 共通の契約は
「動画 → LabelResult」 のみで、 registry で差し替える。

ラベルは説明文のみ (= 固定カテゴリは付けない)。 Labeler は純粋計算で R2/DB/Modal に依存しない
(永続化は呼び出し側の責務)。
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

# 全 Labeler が共有する接地原則 (= hallucination を防ぐ最重要ルール。 Ego4D #C / EgoHOIBench 知見)。
GROUNDING_RULES = (
    "接地原則 (= 厳守。 ハルシネーション禁止。 訓練データの品質を壊す):\n"
    "- 記述は『撮影者(カメラ装着者)本人の手が実際に把持・操作している事』だけ。\n"
    "  物・道具・画面が視界に映っていることと、 操作していることは別 (= 在る ≠ している)。\n"
    "- 見えていない動作・道具を推測/捏造しない。 与えられた物体インベントリに無い物を新規に登場させない。\n"
    "- 手が映っていない / 何も操作していない区間は、 区間を作らない (= 空にする)。\n"
    "- description は『どの手で・何を・どう操作しているか』を簡潔に。 カテゴリ語は付けない。\n"
)


@dataclass
class Segment:
    """時系列の1区間ラベル。 description のみ (カテゴリ無し)。 start_s/end_s は動画先頭からの絶対秒。"""

    start_s: float
    end_s: float
    description: str


@dataclass
class LabelResult:
    """Labeler の出力。 全プロバイダ共通の契約。"""

    segments: list[Segment] = field(default_factory=list)
    summary: str = ""                       # クリップ全体の1文要約 (= 事後カテゴリ派生に使う)
    objects: list[str] = field(default_factory=list)  # 実在物体インベントリ
    # 4 基準スコア (0-5)。 出せる実装だけ付与 (= Gemini は global パスで返す)。 None なら呼び出し側でフォールバック。
    scores: dict | None = None


@dataclass
class SampledFrame:
    """フレーム系 Labeler (= Claude) が動画から内部サンプルした1枚。 frame_idx は動画内の実フレーム番号。"""

    frame_idx: int
    ts_sec: float
    b64: str  # JPEG base64


class Labeler(ABC):
    """「動画 → dense narration」手法の interface。 name で registry 登録。

    label() は純粋計算: 動画パス + 尺/fps を受けて LabelResult を返す。 認証 key は実装が自分の env から読む。
    個別の失敗は握りつぶして部分結果を返してよい (= 例外で全体を落とさない)。
    """

    name: str = "base"

    @abstractmethod
    def label(self, video_path: str, duration_s: float, fps: float) -> LabelResult:
        raise NotImplementedError


# ─── 共通ヘルパ ─────────────────────────────────────────────────────


def extract_json(raw_text: str) -> dict | None:
    """応答テキストから JSON dict を取り出す (= ```json 包み剥がし込み)。 失敗時 None。"""
    t = (raw_text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t[:-3]
        t = t.strip()
    if t.startswith("json"):
        t = t[4:].strip()
    try:
        d = json.loads(t)
    except json.JSONDecodeError:
        return None
    return d if isinstance(d, dict) else None


def sample_frames(video_path: str, interval_sec: float, resize_width: int = 1024) -> list[SampledFrame]:
    """フレーム系 Labeler 用: cv2 で interval 間隔サンプリング + resize_width 幅に縮小 + JPEG base64。
    frame_idx は動画内の実フレーム番号。 cv2/PIL は Modal image にのみある (= lazy import)。"""
    import base64
    import io

    import cv2  # type: ignore
    from PIL import Image  # type: ignore

    cap = cv2.VideoCapture(video_path)
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0.0 or total <= 0:
            raise RuntimeError(f"invalid video metadata fps={fps} total={total}")
        step = max(1, int(round(fps * interval_sec)))
        out: list[SampledFrame] = []
        for src in range(0, total, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, src)
            ok, bgr = cap.read()
            if not ok or bgr is None:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            h, w = rgb.shape[:2]
            if w > resize_width:
                rgb = cv2.resize(rgb, (resize_width, int(round(h * resize_width / w))), interpolation=cv2.INTER_AREA)
            buf = io.BytesIO()
            Image.fromarray(rgb).save(buf, format="JPEG", quality=70)
            out.append(SampledFrame(frame_idx=src, ts_sec=src / fps, b64=base64.standard_b64encode(buf.getvalue()).decode("ascii")))
    finally:
        cap.release()
    if not out:
        raise RuntimeError(f"no frames sampled from {video_path}")
    return out
