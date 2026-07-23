#!/usr/bin/env python3
"""fpvlabs バケットの manifest.jsonl を手動で再生成する。

manifest は fpvlabs.py が処理のたびに DB + R2 の実状態から作り直す派生物で、
どこにもメモを持たない。 このツールは同じ再生成をパイプラインを回さずに行うためのもの
(= セッションをバケットから消した直後や、 スキーマ変更を反映したいとき用)。

スキーマは fpvlabs.py の regenerate_manifest と同一に保つ (変えるときは両方 + README-for-fpv.md)。

実行 (リポジトリ直下):
  set -a; source web/.env.local; set +a
  python document/v0.1.4/fpvlabs-handoff/gen_manifest.py [--bucket <name>]
"""
from __future__ import annotations

import argparse
import json
import os

# fpvlabs.py の ACCOUNT_DOMAINS と揃える (新しい現場のアカウントは両方に足す)。
ACCOUNT_DOMAINS = {
    "936e39a7-6afb-418e-9b9a-b300258497df": {"domain": "home", "site": "home-01"},
    "5e195f17-6413-4b82-825d-da314fcb6a33": {"domain": "bakery", "site": "bakery-01"},
}


def r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", default=os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs"))
    args = ap.parse_args()

    import psycopg2

    s3 = r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")

    sessions: dict[str, int] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=args.bucket):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/session.mcap") and key.count("/") == 1:
                sessions[key.split("/")[0]] = obj["Size"]

    rows: dict[str, dict] = {}
    if sessions:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select content_hash, account_id, duration_ms, created_at from clips"
                    " where content_hash = any(%s)",
                    (list(sessions),),
                )
                rows = {h: {"account_id": str(a), "duration_ms": d, "created_at": c}
                        for h, a, d, c in cur.fetchall()}
        finally:
            conn.close()

    entries = []
    for h, mcap_bytes in sessions.items():
        db_row = rows.get(h)
        if not db_row:
            print(f"  ⚠ {h[:8]}: clips テーブルに未登録 (欠損フィールドは null)")
        try:
            body = s3.get_object(Bucket=bucket_raw, Key=f"raw/{h}/metadata.json")["Body"].read()
            meta = json.loads(body)
        except Exception:
            print(f"  ⚠ {h[:8]}: raw metadata.json が読めない (欠損フィールドは null)")
            meta = {}
        dom = ACCOUNT_DOMAINS.get(db_row["account_id"]) if db_row else None
        if db_row and dom is None:
            print(f"  ⚠ {h[:8]}: account {db_row['account_id']} not in ACCOUNT_DOMAINS")
        camera = meta.get("camera") or {}
        settings = meta.get("capture_settings") or {}
        entries.append({
            "contentHash": h,
            "domain": dom["domain"] if dom else None,
            "site": dom["site"] if dom else None,
            "recordedAt": db_row["created_at"].isoformat() if db_row else None,
            "durationSec": round((db_row["duration_ms"] or 0) / 1000.0, 3) if db_row else None,
            "fps": settings.get("recording_rate_hz"),
            "resolution": (f"{camera.get('width')}x{camera.get('height')}"
                           if camera.get("width") else None),
            "device": meta.get("device_model"),
            "osVersion": meta.get("os_version"),
            "blurred": True,
            "mcapBytes": mcap_bytes,
        })
    entries.sort(key=lambda e: (e.get("recordedAt") or "", e["contentHash"]))
    lines = "".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "\n" for e in entries)
    s3.put_object(Bucket=args.bucket, Key="manifest.jsonl", Body=lines.encode("utf-8"),
                  ContentType="application/x-ndjson")
    by_domain: dict[str, int] = {}
    for e in entries:
        by_domain[str(e["domain"])] = by_domain.get(str(e["domain"]), 0) + 1
    print(f"manifest.jsonl 再生成: {len(entries)} 行 {by_domain}")


if __name__ == "__main__":
    main()
