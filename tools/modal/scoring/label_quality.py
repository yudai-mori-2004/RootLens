"""LabelQuality 軸: 生成された dense narration ラベルの質 (0-100)。 内在・タスク非依存・LLM 由来。

processed/<hash>/semantic.jsonl (= labeling 前処理の出力) を読み、 ラベルテキストを LLM に通して
具体性 (verb+noun の明確さ) を評価する。 密度・被覆はテキストから決定的に算出して breakdown に載せる。

⚠ semantic.jsonl が無ければ fail-loud (= 先に labeling 前処理が必要)。 これが「ラベル → 採点」フロー。
   採点基準は発展途上 (= 具体性/密度を暫定採用)。 Scorer interface 越しに手法を差し替えられる。
"""

from __future__ import annotations

import json
import os

from scoring.base import AxisScore, Scorer, clamp100
from r2ctx import Ctx

MODEL = "claude-haiku-4-5"

_PROMPT = (
    "You are evaluating the QUALITY of auto-generated dense-narration labels for a first-person"
    " home-activity video clip (training data). You are NOT re-watching the video; judge only the"
    " label TEXT. Score 0-100 on SPECIFICITY: do the descriptions concretely state which hand, what"
    " object, and what action (verb+noun), vs vague/generic/empty text. Penalize hallucinated-sounding"
    " or boilerplate text. Return JSON only: {\"specificity\": int 0-100, \"notes\": str}."
)


def _parse(text: str) -> tuple[float, list[tuple[float, float, str]]]:
    """semantic.jsonl → (duration, [(start, end, sentence), ...])。 1 行目はヘッダー。"""
    duration = 0.0
    segs: list[tuple[float, float, str]] = []
    for i, line in enumerate(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if i == 0 and "duration" in obj:  # ヘッダー行
            duration = float(obj.get("duration", 0.0) or 0.0)
            continue
        s = str(obj.get("sentence", "")).strip()
        ts = obj.get("timestamp") or [0.0, 0.0]
        if s:
            try:
                segs.append((float(ts[0]), float(ts[1]), s))
            except (TypeError, ValueError, IndexError):
                segs.append((0.0, 0.0, s))
    return duration, segs


def _coverage(segs: list[tuple[float, float, str]], duration: float) -> float:
    """セグメントが覆う時間の割合 (0-1)。 重複は結合。"""
    if duration <= 0 or not segs:
        return 0.0
    iv = sorted((max(0.0, a), min(duration, b)) for a, b, _ in segs)
    covered = 0.0
    ca = cb = None
    for a, b in iv:
        if b <= a:
            continue
        if ca is None:
            ca, cb = a, b
        elif a <= cb:
            cb = max(cb, b)
        else:
            covered += cb - ca
            ca, cb = a, b
    if ca is not None:
        covered += cb - ca
    return min(1.0, covered / duration)


class LabelQualityScorer(Scorer):
    name = "label_quality"
    axis = "label_quality"

    def score(self, ctx: Ctx) -> AxisScore:
        text = ctx.read_processed_text("semantic.jsonl")
        if text is None:
            raise RuntimeError("semantic.jsonl not found; run the 'labeling' preprocessor first")
        duration, segs = _parse(text)
        sentences = [s for _, _, s in segs]

        # 決定的な根拠データ (= 動画を見ずに再計算できる)。
        density_per_min = (len(sentences) / (duration / 60.0)) if duration > 0 else 0.0
        coverage = _coverage(segs, duration)

        specificity = 0.0
        notes = ""
        if sentences:
            from anthropic import Anthropic  # type: ignore

            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY not set.")
            client = Anthropic(api_key=key)
            joined = "\n".join(f"- {s}" for s in sentences[:200])
            try:
                resp = client.messages.create(
                    model=MODEL, max_tokens=512, temperature=0.0, system=_PROMPT,
                    messages=[{"role": "user", "content": f"{len(sentences)} segment descriptions:\n{joined}"}],
                )
                raw = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                    if raw.startswith("json"):
                        raw = raw[4:].strip()
                d = json.loads(raw)
                specificity = clamp100(float(d.get("specificity", 0)))
                notes = str(d.get("notes", ""))[:300]
            except Exception as e:  # noqa: BLE001
                # LLM エラーは「文がない (= 正当な 0)」と区別できるよう breakdown に明示する (= silent 0 を避ける)。
                print(f"[label_quality] LLM scoring failed: {type(e).__name__}: {e}", flush=True)
                notes = f"LLM_ERROR: {type(e).__name__}: {e}"[:300]

        # 軸スコア = LLM の具体性判定。 coverage / density / 件数 は決定的な文脈で、 買い手が
        # 軸内を独自に再重み付けする素材として breakdown に載せる (= 重みは売り手が固定しない)。
        return AxisScore(
            axis=self.axis,
            score=round(specificity, 2),
            method="score = signals.specificity (LLM judges verb+noun concreteness of labels). "
                   "coverage / densityPerMin are deterministic context.",
            breakdown={
                "signals": {"specificity": round(specificity, 2)},
                "coverage": round(coverage, 4),
                "densityPerMin": round(density_per_min, 2),
                "segmentCount": len(sentences),
                "durationSec": round(duration, 2),
                "model": MODEL,
                "notes": notes,
            },
        )
