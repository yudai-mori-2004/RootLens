#!/usr/bin/env python3
"""Pipeline 3 (WiLoR) を並列 4 で実行。 cached のものは Modal 側で即返り、 新規は GPU で処理。

過去 webhook 経由で並列 4/8 が cancel された (= 同時 endpoint quota 超過) 件は、 ここでは
RPC `.remote()` 経路なので queue 吸収される設計。 失敗パターン (= 数本まとめて FAIL) が出たら
kill + 並列度を下げて再起動。
"""
import modal
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

MAX_WORKERS = 4

fn = modal.Function.from_name("rootlens-wilor", "wilor_rpc")

HASH_RE = re.compile(r"^[0-9a-f]{64}$")
hashes = [h for h in os.listdir("recovered/raw") if HASH_RE.match(h)]


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


hashes_sorted = sorted(hashes, key=get_duration)
total = len(hashes_sorted)
print(f"対象: {total} 本 (= duration 短い順、 並列 {MAX_WORKERS})", flush=True)


def run_one(idx_h):
    i, h = idx_h
    t0 = time.time()
    try:
        r = fn.remote(signature_hash=h)
        dt = int(time.time() - t0)
        cached = r.get("cached", "?")
        frames = r.get("totalFrames", "?")
        print(f"[OK {dt}s {i}/{total}] {h[:12]}  frames={frames} cached={cached}", flush=True)
        return True
    except Exception as e:  # noqa: BLE001
        dt = int(time.time() - t0)
        print(f"[FAIL {dt}s {i}/{total}] {h[:12]}  {str(e)[:200]}", flush=True)
        return False


ok = 0
fail = 0
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
    futures = [ex.submit(run_one, (i, h)) for i, h in enumerate(hashes_sorted, 1)]
    for fut in as_completed(futures):
        if fut.result():
            ok += 1
        else:
            fail += 1

print(f"════ 完了: {ok}/{total} 成功, {fail} 失敗 ════", flush=True)
