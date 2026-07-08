"""前処理 (preprocess) ステージのプラガブル interface。

各 Preprocessor は「採点に必要な中間データ」を R2 processed/ に書き出す純粋処理。 raw を読み、
派生データ (= 例: ラベリングなら semantic.jsonl) を processed/<hash>/ に置く。 採点ステージは
その processed/ を stateless に読む (= 前処理と採点が疎結合)。

前処理の追加は Preprocessor を実装して registry に1行足すだけ (= 任意の独立前処理を後付けできる)。
採点ステージと同じ構造 (registry + 名前選択 + stateless R2)。

⚠ 純粋計算: R2 入出力は Ctx 経由。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from r2ctx import Ctx


@dataclass
class PreprocessResult:
    """前処理の結果メタ (= 何を processed/ に書いたか + 任意の軽量メタ)。"""

    name: str
    artifacts: list[str] = field(default_factory=list)  # 書き出した processed/<hash>/ 配下のファイル名
    meta: dict = field(default_factory=dict)


class Preprocessor(ABC):
    """採点前処理手法。 name で registry 登録。 run() は Ctx (R2) に対し中間データを書き出す。"""

    name: str = "base"

    @abstractmethod
    def run(self, ctx: Ctx, options: dict | None = None) -> PreprocessResult:
        raise NotImplementedError
