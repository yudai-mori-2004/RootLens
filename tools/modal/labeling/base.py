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

# 全 Labeler が共有する接地原則 (= hallucination を防ぐルール)。 モデルに送る文字列は英語で統一
# する (= プロンプトに日本語が混ざると出力言語が日英で揺れるため)。
GROUNDING_RULES = (
    "Grounding rules (strict; do NOT hallucinate — fabrication ruins the training data):\n"
    "- Describe ONLY what the camera wearer's own hands are actually grasping or manipulating.\n"
    "  An object, tool, or screen being visible in frame is NOT the same as it being manipulated.\n"
    "- Do not infer or invent actions or objects you cannot clearly see.\n"
    "- For spans where no hands are visible or nothing is being manipulated, produce no segment (leave it empty).\n"
    "- Keep each description concise: which hand, what object, what action. Do not add category words.\n"
    "- Write all descriptions in English.\n"
)


@dataclass
class Segment:
    """時系列の1区間ラベル。 description のみ (カテゴリ無し)。 start_s/end_s は動画先頭からの絶対秒。"""

    start_s: float
    end_s: float
    description: str


@dataclass
class LabelResult:
    """Labeler の出力。 全プロバイダ共通の契約。 ラベル (観測) のみ。 採点 (品質) は持たない
    (= スコアリングはラベリングと別概念・別フロー。 タスク定義に依存するためここでは行わない)。"""

    segments: list[Segment] = field(default_factory=list)
    summary: str = ""                       # クリップ全体の1文要約 (= 事後カテゴリ派生に使う)
    objects: list[str] = field(default_factory=list)  # 実在物体インベントリ


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
    # 出力ファイル形式の識別子。 layer3 の writer がこれを見て serialize する。 実装ごとに変えられる
    # (= interface は同じでも、 この実装はこの形式で出す、 が表現できる)。 既定 = dense video captioning
    # (ActivityNet Captions と format-compatible な区間 {start_s, end_s, description})。
    output_format: str = "dense_captions"

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
