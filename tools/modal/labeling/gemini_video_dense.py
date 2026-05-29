"""Gemini の動画ネイティブ取り込みで dense narration を生成する Labeler。

  Pass1 (全体): 動画全体から summary (= クリップ単位の1文要約) を得る。 採点はしない (= 採点は別フロー)。
  Pass2 (窓):   動画を CHUNK_S 秒窓に分割し、 各窓を WINDOW_FPS / media MEDIUM で個別に渡して
                窓内相対秒の説明文セグメントを得る。 窓内相対秒 → 絶対秒に変換し尺に clamp する。
                窓分割は長尺クリップを 1 回の呼び出しで密に出せない (= 出力トークン上限) ための
                機械的分割で、 各窓は相互独立なので並列実行する。

窓は WINDOW_FPS / media MEDIUM で渡す: 手の動作を捉えるには低 fps・低解像度では動き情報が落ちるため。
認証は GEMINI_API_KEY を env から読む。 503/429 は backoff + モデルフォールバックで吸収する。
"""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .base import GROUNDING_RULES, LabelResult, Labeler, Segment, extract_json

MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-001"]
CHUNK_S = 10.0       # 1 窓の秒数。
WINDOW_FPS = 4       # 窓を渡す fps。 手の動作を捉えるため (= 低 fps では動作信号が落ちる)。
MAX_WORKERS = 5      # 窓の並列度。

_GLOBAL_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
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

        # トークン使用量をスレッド安全に集計 (= コスト可観測性)。
        usage = {"in": 0, "out": 0}
        usage_lock = threading.Lock()

        def gen(contents, config):
            last = None
            for model in MODELS:
                delay = 4.0
                for _ in range(4):
                    try:
                        resp = client.models.generate_content(model=model, contents=contents, config=config)
                        um = getattr(resp, "usage_metadata", None)
                        if um is not None:
                            with usage_lock:
                                usage["in"] += int(getattr(um, "prompt_token_count", 0) or 0)
                                usage["out"] += int(getattr(um, "candidates_token_count", 0) or 0)
                        return resp
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
            # Pass1 (全体): クリップ要約のみ (= 事後カテゴリ派生 + クリップ単位ラベル)。 採点はしない。
            g_prompt = (
                "Watch this entire first-person (egocentric) video and return JSON with a one-sentence summary"
                " of the camera wearer's activity (summary).\n"
                + GROUNDING_RULES
            )
            gr = gen([f, g_prompt], types.GenerateContentConfig(
                temperature=0.0, response_mime_type="application/json",
                response_json_schema=_GLOBAL_SCHEMA, max_output_tokens=512))
            summary = str((extract_json(gr.text) or {}).get("summary", ""))

            # Pass2 (窓): 各窓を独立に密記述。 空窓はそのまま空 (= idle、 区間を作らない)。
            def label_window(a: float, b: float) -> list[Segment]:
                part = types.Part(
                    file_data=types.FileData(file_uri=f.uri, mime_type="video/mp4"),
                    video_metadata=types.VideoMetadata(start_offset=f"{a:.1f}s", end_offset=f"{b:.1f}s", fps=WINDOW_FPS),
                )
                p = (
                    f"This clip is seconds {a:.0f}-{b:.0f} of the video. Segment the wearer's hand actions"
                    f" chronologically at ~1-2 second granularity. start_s/end_s are RELATIVE seconds within this"
                    f" clip (0 to {b - a:.0f}); description is the narration text only. Return JSON.\n"
                    + GROUNDING_RULES
                )
                try:
                    r = gen(types.Content(parts=[part, types.Part(text=p)]), types.GenerateContentConfig(
                        temperature=0.0, response_mime_type="application/json", response_json_schema=_SEG_SCHEMA,
                        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_MEDIUM, max_output_tokens=8192))
                    raw = extract_json(r.text or "{}").get("segments", []) if r.text else []
                except Exception as e:  # noqa: BLE001
                    print(f"[gemini-video-dense] window {a:.0f}-{b:.0f}s failed: {type(e).__name__}: {e}", flush=True)
                    raw = []
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

            windows = []
            t = 0.0
            while t < duration_s:
                b = min(t + CHUNK_S, duration_s)
                windows.append((t, b))
                t = b
            segments: list[Segment] = []
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
                for res in ex.map(lambda ab: label_window(*ab), windows):
                    segments.extend(res)
            segments.sort(key=lambda s: s.start_s)
            print(f"[gemini-video-dense] tokens input={usage['in']} output={usage['out']} (clip {duration_s:.0f}s)", flush=True)
            return LabelResult(segments=segments, summary=summary)
        finally:
            try:
                client.files.delete(name=f.name)
            except Exception:  # noqa: BLE001
                pass
