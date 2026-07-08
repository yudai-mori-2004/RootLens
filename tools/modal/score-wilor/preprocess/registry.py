"""Preprocessor registry: name → Preprocessor。 任意の独立前処理を後付けできる (= scoring と対称)。"""

from __future__ import annotations

from preprocess.base import Preprocessor
from preprocess.labeling import LabelingPreprocessor

_PREPROCESSORS: dict[str, type[Preprocessor]] = {
    LabelingPreprocessor.name: LabelingPreprocessor,
}

DEFAULT_PREPROCESSORS = [LabelingPreprocessor.name]


def get_preprocessor(name: str) -> Preprocessor:
    cls = _PREPROCESSORS.get((name or "").strip().lower())
    if cls is None:
        raise ValueError(f"unknown preprocessor '{name}'. available: {sorted(_PREPROCESSORS)}")
    return cls()


def available_preprocessors() -> list[str]:
    return sorted(_PREPROCESSORS)
