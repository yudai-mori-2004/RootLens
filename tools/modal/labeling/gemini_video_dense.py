"""Gemini の動画ネイティブ取り込みで dense narration を生成する Labeler。

  Pass1 (全体): 動画全体を渡し {summary, objects(物体インベントリ), scene, scores(4基準0-5)} を得る。
  Pass2 (チャンク): videoMetadata の start/end offset で動画を CHUNK_S 秒窓に分割し、 各窓を fps=2 /
                    media LOW で個別に渡す。 全体要約 + 物体インベントリ + 時間アンカーを与え、 窓内相対秒の
                    説明文セグメントを得る。 窓が空を返したら半分に分割して再試行する。
  整合: 相対秒 → 絶対秒に変換し尺に clamp、 空 description を除去。

認証は GEMINI_API_KEY を env から読む。 503/429 は backoff + モデルフォールバックで吸収する。
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor

from .base import GROUNDING_RULES, LabelResult, Labeler, Segment, extract_json

MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-001"]
CHUNK_S = 10.0       # 1 窓の秒数。 大きすぎると Gemini が空を返すことがあるため小さめ。
MIN_SPLIT_S = 4.0    # これ以下の窓は分割しない。
FPS = 2

_GLOBAL_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "objects": {"type": "array", "items": {"type": "string"}},
        "scene": {"type": "string"},
        "scores": {
            "type": "object",
            "properties": {
                "task_activity": {"type": "integer"},
                "object_interaction": {"type": "integer"},
                "authenticity": {"type": "integer"},
                "scene_match": {"type": "integer"},
            },
            "required": ["task_activity", "object_interaction", "authenticity", "scene_match"],
        },
    },
    "required": ["summary", "objects", "scene", "scores"],
}

_SEG_SCHEMA = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_s": {"type": "number"},
                    "end_s": {"type": "number"},
                    "description": {"type": "string"},
                },
                "required": ["start_s", "end_s", "description"],
            },
        }
    },
    "required": ["segments"],
}


class GeminiVideoDenseLabeler(Labeler):
    name = "gemini-video-dense"

    def label(self, video_path: str, duration_s: float, fps: float) -> LabelResult:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY not set.")
        client = genai.Client(api_key=key)

        def gen(contents, config):
            last = None
            for model in MODELS:
                delay = 4.0
                for _ in range(4):
                    try:
                        return client.models.generate_content(model=model, contents=contents, config=config)
                    except Exception as e:  # noqa: BLE001
                        last = e
                        if any(x in str(e) for x in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "overloaded")):
                            time.sleep(delay)
                            delay = min(delay * 1.7, 30)
                            continue
                        raise
            raise last

        f = client.files.upload(file=video_path)
        while f.state.name == "PROCESSING":
            time.sleep(2)
            f = client.files.get(name=f.name)
        if f.state.name != "ACTIVE":
            raise RuntimeError(f"gemini file upload failed: {f.state}")

        try:
            g_prompt = (
                "この一人称視点動画全体を見て、 撮影者の作業の1文要約(summary)、 実際に映っている主要物体"
                "(objects)、 場所(scene)、 4基準スコア(scores, 各0-5)を JSON で返す。\n"
                "scores: task_activity(目的的手作業をしているか), object_interaction(手が物体を操作しているか), "
                "authenticity(本物の人間の手の動作か), scene_match(環境が家事/作業と合致するか)。\n"
                + GROUNDING_RULES
            )
            gr = gen([f, g_prompt], types.GenerateContentConfig(
                temperature=0.0, response_mime_type="application/json",
                response_json_schema=_GLOBAL_SCHEMA, max_output_tokens=1024))
            glob = extract_json(gr.text) or {}
            summary = str(glob.get("summary", ""))
            objects = [str(o) for o in (glob.get("objects") or [])]
            scores = glob.get("scores") if isinstance(glob.get("scores"), dict) else None

            def label_window(a: float, b: float) -> list[Segment]:
                """[a,b] 窓を Gemini で記述。 空が返ったら半分に分割して再試行。 返値は絶対秒・clamp 済。"""
                part = types.Part(
                    file_data=types.FileData(file_uri=f.uri, mime_type="video/mp4"),
                    video_metadata=types.VideoMetadata(start_offset=f"{a:.1f}s", end_offset=f"{b:.1f}s", fps=FPS),
                )
                p = (
                    f"この区間は動画の {a:.0f}〜{b:.0f}秒。 撮影者の手作業を ~1-2秒粒度で時系列に区切り、"
                    f" start_s/end_s は【この区間内の相対秒 0〜{b - a:.0f}】、 description は説明文のみで JSON 返す。\n"
                    f"全体の作業: {summary}\n許可物体: {', '.join(objects)}\n" + GROUNDING_RULES
                )
                try:
                    r = gen(types.Content(parts=[part, types.Part(text=p)]), types.GenerateContentConfig(
                        temperature=0.0, response_mime_type="application/json", response_json_schema=_SEG_SCHEMA,
                        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW, max_output_tokens=8192))
                    raw = extract_json(r.text or "{}").get("segments", []) if r.text else []
                except Exception as e:  # noqa: BLE001
                    print(f"[gemini-video-dense] window {a:.0f}-{b:.0f}s failed: {type(e).__name__}: {e}", flush=True)
                    raw = []
                if not raw and (b - a) > MIN_SPLIT_S:
                    mid = (a + b) / 2.0
                    return label_window(a, mid) + label_window(mid, b)
                out: list[Segment] = []
                for s in raw:
                    try:
                        st = max(0.0, min(b - a, float(s["start_s"]))) + a
                        en = max(0.0, min(b - a, float(s["end_s"]))) + a
                    except (TypeError, ValueError, KeyError):
                        continue
                    desc = str(s.get("description", "")).strip()
                    if desc:
                        out.append(Segment(start_s=round(st, 2), end_s=round(en, 2), description=desc))
                return out

            # チャンクは全体コンテキストにのみ依存し相互独立なので並列実行する
            # (= 逐次だと窓数 × API レイテンシで Modal web エンドポイントの同期 HTTP 上限を超える)。
            windows = []
            t = 0.0
            while t < duration_s:
                b = min(t + CHUNK_S, duration_s)
                windows.append((t, b))
                t = b
            segments: list[Segment] = []
            with ThreadPoolExecutor(max_workers=5) as ex:
                for res in ex.map(lambda ab: label_window(*ab), windows):
                    segments.extend(res)
            segments.sort(key=lambda s: s.start_s)
            return LabelResult(segments=segments, summary=summary, objects=objects, scores=scores)
        finally:
            try:
                client.files.delete(name=f.name)
            except Exception:  # noqa: BLE001
                pass
