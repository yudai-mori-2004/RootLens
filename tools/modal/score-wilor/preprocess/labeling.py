"""labeling 前処理: 動画 → dense narration (semantic.jsonl) を processed/ に書き出す。

既存の labeling/ ツリー (gemini-video-dense / claude-* のプラガブル Labeler) をそのまま使う。
これが「動画 → ラベル」フロー。 採点ステージの label_quality はこの semantic.jsonl を読む。
"""

from __future__ import annotations

import json

from labeling import get_labeler
from preprocess.base import Preprocessor, PreprocessResult
from r2ctx import Ctx


def _probe(path: str) -> tuple[int, float, float]:
    import cv2  # type: ignore

    cap = cv2.VideoCapture(path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    return total, fps, (total / fps if fps > 0 else 0.0)


class LabelingPreprocessor(Preprocessor):
    name = "labeling"

    def run(self, ctx: Ctx, options: dict | None = None) -> PreprocessResult:
        labeler_name = (options or {}).get("labeler", "")
        rgb = ctx.download_raw("rgb.mp4")
        _total, fps, duration = _probe(rgb)
        impl = get_labeler(labeler_name)
        result = impl.label(rgb, duration, fps)

        # semantic.jsonl = ActivityNet Captions スキーマ。 1 行目ヘッダー (provenance + summary) +
        # 2 行目以降が時系列イベント {timestamp:[start,end], sentence}。 自動生成・未検証を明示。
        segs = sorted(result.segments, key=lambda s: s.start_s)
        lines = [
            json.dumps(
                {
                    "format": "activitynet_dense_captions",
                    "labeler": impl.name,
                    "signature_hash": ctx.signature_hash,
                    "duration": round(duration, 3),
                    "summary": result.summary,
                    "annotation": "auto_generated_unverified",
                    "fields": ["timestamp", "sentence"],
                },
                ensure_ascii=False,
            )
        ]
        for s in segs:
            lines.append(json.dumps({"timestamp": [s.start_s, s.end_s], "sentence": s.description}, ensure_ascii=False))
        ctx.put_processed_text("semantic.jsonl", "\n".join(lines) + "\n", "application/x-ndjson")

        return PreprocessResult(
            name=self.name,
            artifacts=["semantic.jsonl"],
            meta={"labeler": impl.name, "segments": len(segs), "summary": result.summary, "duration": round(duration, 3)},
        )
