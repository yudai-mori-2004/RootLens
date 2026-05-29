"""Scorer registry: name (= 軸 + 手法) → Scorer。 軸追加は1行。 同軸別手法も name 違いで併存可。"""

from __future__ import annotations

from scoring.base import Scorer
from scoring.label_quality import LabelQualityScorer
from scoring.motion_content import MotionContentScorer
from scoring.video_technical import VideoTechnicalScorer

_SCORERS: dict[str, type[Scorer]] = {
    VideoTechnicalScorer.name: VideoTechnicalScorer,
    MotionContentScorer.name: MotionContentScorer,
    LabelQualityScorer.name: LabelQualityScorer,
}

# 既定で走らせる採点軸 (= 現状の3軸)。 将来 arkit_tracking 等を足したらここに追加。
DEFAULT_SCORERS = [VideoTechnicalScorer.name, MotionContentScorer.name, LabelQualityScorer.name]


def get_scorer(name: str) -> Scorer:
    cls = _SCORERS.get((name or "").strip().lower())
    if cls is None:
        raise ValueError(f"unknown scorer '{name}'. available: {sorted(_SCORERS)}")
    return cls()


def available_scorers() -> list[str]:
    return sorted(_SCORERS)
