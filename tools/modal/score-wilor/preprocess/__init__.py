"""前処理 (preprocess) ステージ: 採点に必要な中間データを processed/ に書き出す Preprocessor 群。"""

from __future__ import annotations

from preprocess.base import Preprocessor, PreprocessResult
from preprocess.registry import DEFAULT_PREPROCESSORS, available_preprocessors, get_preprocessor

__all__ = [
    "Preprocessor",
    "PreprocessResult",
    "get_preprocessor",
    "available_preprocessors",
    "DEFAULT_PREPROCESSORS",
]
