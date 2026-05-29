"""Claude フレーム系 Labeler。 動画を内部でフレームサンプルし画像として投げる。 出力は segments (説明文のみ)。
採点はしない (= ラベリングは観測のみ)。 ANTHROPIC_API_KEY を env から読む。

  claude-single-pass : 各フレーム独立にキャプション。
  claude-diffsw      : 前フレーム画像 + 現フレームで差分記述。
"""

from __future__ import annotations

import os

from .base import GROUNDING_RULES, LabelResult, Labeler, SampledFrame, Segment, extract_json, sample_frames

MODEL = "claude-haiku-4-5"
INTERVAL_S = 10.0
RESIZE_WIDTH = 1024

_SYS = (
    "You are an annotator for first-person (egocentric) home-activity video. Describe the camera wearer's hand actions.\n"
    + GROUNDING_RULES
    + 'Output JSON only. For each frame return {"frame_idx": int, "description": str}. Do not add categories.'
)


def _client():
    from anthropic import Anthropic  # type: ignore

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set.")
    return Anthropic(api_key=key)


def _segments_from_descs(frames: list[SampledFrame], desc_by_idx: dict[int, str], duration_s: float) -> list[Segment]:
    """各サンプル frame の description を、 [そのフレーム時刻 .. 次フレーム時刻) の区間にする。 空 desc は捨てる。"""
    segs: list[Segment] = []
    for i, fr in enumerate(frames):
        d = (desc_by_idx.get(fr.frame_idx) or "").strip()
        if not d:
            continue
        end = frames[i + 1].ts_sec if i + 1 < len(frames) else duration_s
        segs.append(Segment(start_s=round(fr.ts_sec, 2), end_s=round(end, 2), description=d))
    return segs


class ClaudeSinglePassLabeler(Labeler):
    name = "claude-single-pass"

    def label(self, video_path: str, duration_s: float, fps: float) -> LabelResult:
        frames = sample_frames(video_path, INTERVAL_S, RESIZE_WIDTH)
        client = _client()
        desc: dict[int, str] = {}
        for i in range(0, len(frames), 16):
            batch = frames[i : i + 16]
            content: list[dict] = []
            for fr in batch:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": fr.b64}})
                content.append({"type": "text", "text": f"[frame_idx={fr.frame_idx}]"})
            content.append({"type": "text", "text": f"Return JSON with a description for each of the above {len(batch)} frames."})
            try:
                resp = client.messages.create(model=MODEL, max_tokens=4096, temperature=0.0, system=_SYS,
                                              messages=[{"role": "user", "content": content}])
                d = extract_json("".join(b.text for b in resp.content if getattr(b, "type", None) == "text"))
            except Exception as e:  # noqa: BLE001
                print(f"[claude-single-pass] batch fail: {e}", flush=True)
                d = None
            for e in (d or {}).get("frames", []):
                try:
                    desc[int(e.get("frame_idx", -1))] = str(e.get("description", "")).strip()
                except (TypeError, ValueError):
                    pass
        return LabelResult(segments=_segments_from_descs(frames, desc, duration_s))


class ClaudeDiffSWLabeler(Labeler):
    name = "claude-diffsw"

    _SYS_DIFF = (
        "You are an annotator labeling first-person video over time. Looking at the previous-frame image and the\n"
        "current-frame image, describe the hand action the camera wearer is doing in the current frame.\n"
        + GROUNDING_RULES
        + 'Output JSON only: {"description": str}'
    )

    def label(self, video_path: str, duration_s: float, fps: float) -> LabelResult:
        frames = sample_frames(video_path, INTERVAL_S, RESIZE_WIDTH)
        client = _client()
        desc: dict[int, str] = {}
        prev: SampledFrame | None = None
        for fr in frames:
            content: list[dict] = []
            if prev is not None:
                content.append({"type": "text", "text": "[previous frame]"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": prev.b64}})
            content.append({"type": "text", "text": "[current frame] describe this:"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": fr.b64}})
            try:
                resp = client.messages.create(model=MODEL, max_tokens=512, temperature=0.0, system=self._SYS_DIFF,
                                              messages=[{"role": "user", "content": content}])
                d = extract_json("".join(b.text for b in resp.content if getattr(b, "type", None) == "text"))
            except Exception as e:  # noqa: BLE001
                print(f"[claude-diffsw] frame {fr.frame_idx} fail: {e}", flush=True)
                d = None
            desc[fr.frame_idx] = str((d or {}).get("description", "")).strip()
            prev = fr
        return LabelResult(segments=_segments_from_descs(frames, desc, duration_s))
