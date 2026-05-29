"""採点 (scoring) ステージのプラガブル interface。

各 Scorer は「1 つの品質軸」を 0-100 で独立に採点する。 軸どうしを合算しない (= 異種の品質を
混ぜない / 重みは買い手が決める)。 採点は R2 を stateless に読む純粋処理: raw (端末アップロード) +
processed (前処理の出力) を入力に、 AxisScore を返す。 必要な入力が R2 に無ければ fail-loud。

軸の追加は Scorer を実装して registry に1行足すだけ (= n 軸に拡張可)。 同じ軸でも手法違いの
複数実装を登録できる (= 手法はプラガブル、 labeling と対称)。

⚠ 純粋計算: R2 入出力は Ctx 経由。 採点ロジックに DB / web 依存を持ち込まない。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from r2ctx import Ctx


@dataclass
class AxisScore:
    """1 軸の採点結果。

    score は 0-100。 method は「breakdown からどう score を導くか」の式 (= 監査・再計算用)。
    breakdown はスコアの根拠となる詳細: 独立サブ信号 + 生カウント + 使った閾値。 これを元に
    score を再計算でき、 買い手が独自の重み付けで軸内を再集約することもできる。
    """

    axis: str
    score: float                          # 0-100
    method: str = ""                      # score = f(breakdown) の説明 (= 再計算可能にする)
    breakdown: dict = field(default_factory=dict)


class Scorer(ABC):
    """1 品質軸の採点手法。 name で registry 登録、 axis が出力軸名。

    score() は Ctx (R2) から必要なオブジェクトを読み AxisScore を返す。 入力欠落は例外で fail-loud
    (= 前処理が済んでいない採点は明示的に失敗させる)。
    """

    name: str = "base"   # registry キー (= 手法込み。 例: motion_content / motion_content_v2)
    axis: str = "base"   # 出力軸名 (= 同軸の別手法は name 違い・axis 同じ)

    @abstractmethod
    def score(self, ctx: Ctx) -> AxisScore:
        raise NotImplementedError


def clamp01(x: float) -> float:
    if x != x:  # NaN
        return 0.0
    return max(0.0, min(1.0, float(x)))


def clamp100(x: float) -> float:
    if x != x:
        return 0.0
    return max(0.0, min(100.0, float(x)))
