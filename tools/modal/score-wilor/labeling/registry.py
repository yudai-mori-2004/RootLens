"""Labeler registry: name (= プロバイダ+手法) → Labeler。"""

from __future__ import annotations

from .base import Labeler
from .claude_frames import ClaudeDiffSWLabeler, ClaudeSinglePassLabeler
from .gemini_video_dense import GeminiVideoDenseLabeler

_LABELERS: dict[str, type[Labeler]] = {
    GeminiVideoDenseLabeler.name: GeminiVideoDenseLabeler,
    ClaudeDiffSWLabeler.name: ClaudeDiffSWLabeler,
    ClaudeSinglePassLabeler.name: ClaudeSinglePassLabeler,
}

DEFAULT_LABELER = GeminiVideoDenseLabeler.name


def get_labeler(name: str | None) -> Labeler:
    key = (name or DEFAULT_LABELER).strip().lower()
    cls = _LABELERS.get(key)
    if cls is None:
        raise ValueError(f"unknown labeler '{name}'. available: {sorted(_LABELERS)}")
    return cls()


def available_labelers() -> list[str]:
    return sorted(_LABELERS)
