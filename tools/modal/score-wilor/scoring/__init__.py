"""採点 (scoring) ステージ: 1 軸 = 0-100 で独立採点する Scorer 群。 合算しない (= 重みは buyer)。"""

from __future__ import annotations

from scoring.base import AxisScore, Scorer, clamp01, clamp100
from scoring.registry import DEFAULT_SCORERS, available_scorers, get_scorer

__all__ = ["Scorer", "AxisScore", "clamp01", "clamp100", "get_scorer", "available_scorers", "DEFAULT_SCORERS"]
