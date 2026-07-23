# Modal 上で複数セッションの frames.jsonl を読み、 サンプル選定の指標を返す。
#
# 目的: showcase.py で丸ごと素材を作る前に、 手検出率・軌跡距離・カバー面積・トラッキング品質を
# 素早く見て、 LP のショーケースにいちばん映える 1 本を選ぶ。 IO も CPU も Modal 側で完結する
# ので、 装着端末側の回線を消費しない (= フィールドから触れる)。
#
# 実行:
#   modal run tools/modal/session-stats/session_stats.py --hashes hashA,hashB,hashC

from __future__ import annotations

import json
import os
import tempfile

try:
    import modal

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install("numpy<2", "boto3")
    )
    app = modal.App("rootlens-session-stats")

    @app.function(
        image=image,
        timeout=1200,
        memory=4096,
        cpu=2.0,
        secrets=[modal.Secret.from_name("r2-creds")],
    )
    def score_one(content_hash: str) -> dict:
        import boto3
        import numpy as np

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        bucket = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")

        with tempfile.TemporaryDirectory() as tmp:
            fp = os.path.join(tmp, "frames.jsonl")
            mp = os.path.join(tmp, "metadata.json")
            # 旧録画は frames.jsonl の代わりに realtime_handpose.jsonl。 まず新名で試して、
            # 404 なら旧名にフォールバック (fpvlabs.py と同じ扱い)。 どちらも欠けている
            # 半端な収録は "missing" マークで返し、 バッチ .map() を落とさない。
            try:
                s3.download_file(bucket, f"raw/{content_hash}/frames.jsonl", fp)
            except Exception:
                try:
                    s3.download_file(bucket, f"raw/{content_hash}/realtime_handpose.jsonl", fp)
                except Exception:
                    return {"contentHash": content_hash, "missing": "frames.jsonl"}
            try:
                s3.download_file(bucket, f"raw/{content_hash}/metadata.json", mp)
            except Exception:
                return {"contentHash": content_hash, "missing": "metadata.json"}

            frames_ts, hands_present, tracking_normal, xyz = [], 0, 0, []
            with open(fp) as f:
                for line in f:
                    row = json.loads(line)
                    frames_ts.append(row["timestamp_ns"])
                    if row.get("hands"):
                        hands_present += 1
                    if int(row.get("tracking_state", 0)) == 2:
                        tracking_normal += 1
                    M = row.get("camera_transform")
                    if M:
                        xyz.append([M[0][3], M[1][3], M[2][3]])
            with open(mp) as f:
                meta = json.load(f)

        n = len(frames_ts)
        dur_s = (frames_ts[-1] - frames_ts[0]) / 1e9 if n > 1 else 0.0
        arr = np.array(xyz, dtype=np.float32) if xyz else np.zeros((0, 3), dtype=np.float32)
        if len(arr) > 1:
            path_m = float(np.linalg.norm(np.diff(arr, axis=0), axis=1).sum())
        else:
            path_m = 0.0
        if len(arr) > 0:
            bb_min = arr.min(axis=0).tolist()
            bb_max = arr.max(axis=0).tolist()
            area_m2 = float((bb_max[0] - bb_min[0]) * (bb_max[2] - bb_min[2]))
            y_range = float(bb_max[1] - bb_min[1])
        else:
            bb_min = bb_max = [0.0, 0.0, 0.0]
            area_m2 = 0.0
            y_range = 0.0

        return {
            "contentHash": content_hash,
            "device": meta.get("device_model"),
            "durationSec": dur_s,
            "durationMin": dur_s / 60,
            "frames": n,
            "handDetectionRate": hands_present / n if n else 0.0,
            "trackingNormalRate": tracking_normal / n if n else 0.0,
            "pathLengthM": path_m,
            "areaM2": area_m2,
            "yRangeM": y_range,
            "bboxMin": bb_min,
            "bboxMax": bb_max,
        }

    @app.local_entrypoint()
    def main(hashes: str):
        """--hashes hashA,hashB,hashC"""
        hs = [h.strip() for h in hashes.split(",") if h.strip()]
        results = list(score_one.map(hs))
        print(json.dumps(results, indent=2))

except ImportError:
    modal = None
