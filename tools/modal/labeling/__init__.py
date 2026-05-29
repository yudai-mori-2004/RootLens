"""ラベリング手法のプラガブル抽象 (= RootLens Pipeline 2 の dense narration)。

抽象境界 = Labeler interface (動画 → LabelResult) + 出力スキーマ。 実装は「プロバイダ+手法」単位
(gemini-video-dense / claude-diffsw / claude-single-pass / 将来 qwen-video-dense)。
"""

from __future__ import annotations

from .base import GROUNDING_RULES, Labeler, LabelResult, SampledFrame, Segment, sample_frames
from .registry import DEFAULT_LABELER, available_labelers, get_labeler

__all__ = [
    "Labeler",
    "LabelResult",
    "Segment",
    "SampledFrame",
    "GROUNDING_RULES",
    "sample_frames",
    "get_labeler",
    "available_labelers",
    "DEFAULT_LABELER",
]
