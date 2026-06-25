#!/usr/bin/env python3
"""Pipeline 2 (labeling のみ、 scoring skip) を recovered/raw の hash に対して順次実行する。

semantic.jsonl が R2 processed/<hash>/ に既に存在する hash はスキップ (= 冪等性をクライアント側で保証)。
score="none" sentinel で Modal 側の scoring 全 skip → Gemini ラベリングだけ叩く。
"""
import modal
import os
import re
import subprocess
import time

import boto3  # type: ignore

# ── R2 client (= semantic.jsonl 存在チェック用) ──
account_id = os.environ["R2_ACCOUNT_ID"]
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
)
processed_bucket = os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed")


def has_semantic(h: str) -> bool:
    try:
        s3.head_object(Bucket=processed_bucket, Key=f"processed/{h}/semantic.jsonl")
        return True
    except Exception:  # noqa: BLE001
        return False


def get_duration(h: str) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", f"recovered/raw/{h}/rgb.mp4"],
            capture_output=True, text=True, check=True,
        )
        return float(r.stdout.strip())
    except Exception:  # noqa: BLE001
        return 9999.0


fn = modal.Function.from_name("rootlens-pipeline2", "process_rpc")

HASH_RE = re.compile(r"^[0-9a-f]{64}$")
all_hashes = [h for h in os.listdir("recovered/raw") if HASH_RE.match(h)]
todo = [h for h in all_hashes if not has_semantic(h)]
todo_sorted = sorted(todo, key=get_duration)
total = len(todo_sorted)
print(f"対象: {total} 本 (= semantic 未生成、 duration 短い順、 score=none で scoring skip)", flush=True)

ok = 0
fail = 0
for i, h in enumerate(todo_sorted, 1):
    t0 = time.time()
    try:
        r = fn.remote(signature_hash=h, score="none")
        dt = int(time.time() - t0)
        meta = (r.get("preprocessed") or [{}])[0].get("meta", {})
        segs = meta.get("segments", "?")
        dur = meta.get("duration", "?")
        print(f"[OK {dt}s {i}/{total}] {h[:12]}  segs={segs} dur={dur}s", flush=True)
        ok += 1
    except Exception as e:  # noqa: BLE001
        dt = int(time.time() - t0)
        print(f"[FAIL {dt}s {i}/{total}] {h[:12]}  {str(e)[:200]}", flush=True)
        fail += 1

print(f"════ 完了: {ok}/{total} 成功, {fail} 失敗 ════", flush=True)
