#!/usr/bin/env python3
"""1 本だけ再ラベリングして labelreview/<short>/label_<ver>.jsonl に保存する。

  python3 relabel.py <hash_prefix> [version]

  例: python3 relabel.py 565d2608 v2
      → recovered/raw/565d2608...c9e4287522.../rgb.mp4 を Modal pipeline2 に投げ、
        labelreview/565d2608c9e4/label_v2.jsonl に semantic.jsonl を取得保存。
        R2 (= processed/<hash>/semantic.jsonl) も上書きされる (= pipeline2.py に冪等性チェックなし)。

  version 未指定なら次の空き番号 (v2, v3, ...) を自動採番。
"""
import os
import re
import sys

import boto3  # type: ignore
import modal


def main():
    if len(sys.argv) < 2:
        print("usage: relabel.py <hash_prefix> [version]", file=sys.stderr)
        sys.exit(2)
    prefix = sys.argv[1]
    version = sys.argv[2] if len(sys.argv) > 2 else None

    matches = [d for d in os.listdir("recovered/raw") if d.startswith(prefix)]
    if not matches:
        print(f"no hash starts with {prefix}", file=sys.stderr)
        sys.exit(1)
    if len(matches) > 1:
        print(f"ambiguous prefix {prefix}: {matches}", file=sys.stderr)
        sys.exit(1)
    full_hash = matches[0]
    short = full_hash[:12]

    review_dir = f"labelreview/{short}"
    os.makedirs(review_dir, exist_ok=True)

    if version is None:
        existing = [f for f in os.listdir(review_dir) if re.match(r"^label_v\d+\.jsonl$", f)]
        nums = sorted(int(re.match(r"^label_v(\d+)\.jsonl$", f).group(1)) for f in existing)
        version = f"v{(nums[-1] + 1) if nums else 1}"
        # 既存 v1 が無いなら v1 から (= 普通は label_v1.jsonl ベースラインが既にあるはず)
        if version == "v1" and os.path.exists(f"{review_dir}/label_v1.jsonl"):
            version = "v2"

    out_path = f"{review_dir}/label_{version}.jsonl"
    print(f"hash={full_hash}", flush=True)
    print(f"out ={out_path}", flush=True)

    fn = modal.Function.from_name("rootlens-pipeline2", "process_rpc")
    print("Modal pipeline2 (score=none) 実行中…", flush=True)
    import time as _t
    t0 = _t.time()
    result = fn.remote(signature_hash=full_hash, score="none")
    dt = int(_t.time() - t0)
    meta = (result.get("preprocessed") or [{}])[0].get("meta", {})
    print(f"完了 ({dt}s) segs={meta.get('segments', '?')} dur={meta.get('duration', '?')}s "
          f"summary={meta.get('summary', '')[:80]!r}", flush=True)

    # R2 から落として保存 (= 上書きされた最新 semantic.jsonl)
    account_id = os.environ["R2_ACCOUNT_ID"]
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    bucket = os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed")
    s3.download_file(bucket, f"processed/{full_hash}/semantic.jsonl", out_path)
    print(f"saved {out_path}", flush=True)


if __name__ == "__main__":
    main()
