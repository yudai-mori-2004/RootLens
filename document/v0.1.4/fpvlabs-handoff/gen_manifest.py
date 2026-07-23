#!/usr/bin/env python3
"""fpvlabs バケットの meta.json サイドカーと manifest.jsonl を補修する。

通常運用では fpvlabs.py が処理のたびにサイドカーを書き manifest を再生成するので、
このツールの出番は (a) 機構導入前に納品済みのセッションのバックフィル、
(b) 並列実行の last-writer-wins で manifest が一時的に欠けたときの再収束、 の 2 つ。

サイドカーが無いセッションだけ埋める。 --rebuild で全サイドカーを作り直す。
スキーマは fpvlabs.py の build_session_meta と同一に保つ (変えるときは両方 + README-for-fpv.md)。

実行 (リポジトリ直下):
  set -a; source web/.env.local; set +a
  python document/v0.1.4/fpvlabs-handoff/gen_manifest.py [--rebuild] [--bucket <name>]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

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


def db_rows(hashes: list[str]) -> dict[str, dict]:
    import psycopg2

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select content_hash, account_id, duration_ms from clips where content_hash = any(%s)",
                (hashes,),
            )
            return {h: {"account_id": str(a), "duration_ms": d} for h, a, d in cur.fetchall()}
    finally:
        conn.close()


def build_session_meta(content_hash: str, meta: dict, db_row: dict | None,
                       recorded_at_iso: str | None, mcap_bytes: int) -> dict:
    """fpvlabs.py の build_session_meta と同スキーマ。 補修ツールなので DB 未登録や
    未知アカウントでは止めず、 domain/site を null にして警告に留める。"""
    dom = None
    if db_row:
        dom = ACCOUNT_DOMAINS.get(db_row["account_id"])
        if dom is None:
            print(f"  ⚠ {content_hash[:8]}: account {db_row['account_id']} not in ACCOUNT_DOMAINS")
    else:
        print(f"  ⚠ {content_hash[:8]}: clips テーブルに未登録")
    camera = meta.get("camera") or {}
    settings = meta.get("capture_settings") or {}
    return {
        "contentHash": content_hash,
        "domain": dom["domain"] if dom else None,
        "site": dom["site"] if dom else None,
        "recordedAt": recorded_at_iso,
        "durationSec": round((db_row["duration_ms"] or 0) / 1000.0, 3) if db_row else None,
        "fps": settings.get("recording_rate_hz"),
        "resolution": (f"{camera.get('width')}x{camera.get('height')}"
                       if camera.get("width") else None),
        "device": meta.get("device_model"),
        "osVersion": meta.get("os_version"),
        # 補修対象は全部 fpvlabs.py (EgoBlur 既定) 経由の納品済みセッション。
        "blurred": True,
        "faceDetector": "egoblur",
        "mcapBytes": mcap_bytes,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", default=os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs"))
    ap.add_argument("--rebuild", action="store_true", help="既存サイドカーも作り直す")
    args = ap.parse_args()

    s3 = r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")

    # セッション一覧 (= <hash>/session.mcap を持つ prefix) と既存サイドカーを 1 回の走査で拾う。
    sessions: dict[str, int] = {}
    have_meta: set[str] = set()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=args.bucket):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/session.mcap") and key.count("/") == 1:
                sessions[key.split("/")[0]] = obj["Size"]
            elif key.endswith("/meta.json") and key.count("/") == 1:
                have_meta.add(key.split("/")[0])

    todo = sorted(h for h in sessions if args.rebuild or h not in have_meta)
    print(f"セッション {len(sessions)} 件 / サイドカー補修対象 {len(todo)} 件")
    rows = db_rows(list(sessions)) if todo else {}

    for h in todo:
        try:
            body = s3.get_object(Bucket=bucket_raw, Key=f"raw/{h}/metadata.json")["Body"].read()
            meta = json.loads(body)
        except Exception as e:
            print(f"  ⚠ {h[:8]}: raw metadata.json が読めない ({e}); スキップ")
            continue
        try:
            head = s3.head_object(Bucket=bucket_raw, Key=f"raw/{h}/rgb.mp4")
            recorded_at = head["LastModified"].isoformat()
        except Exception:
            recorded_at = None
        entry = build_session_meta(h, meta, rows.get(h), recorded_at, sessions[h])
        s3.put_object(Bucket=args.bucket, Key=f"{h}/meta.json",
                      Body=json.dumps(entry, ensure_ascii=False, indent=2).encode("utf-8"),
                      ContentType="application/json")
        print(f"  ✓ {h[:8]}  {entry['domain']}  {entry['durationSec']}s")

    # manifest 再生成 (fpvlabs.py の regenerate_manifest と同じ集約)。
    entries = []
    for page in paginator.paginate(Bucket=args.bucket):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/meta.json") and key.count("/") == 1:
                entries.append(json.loads(s3.get_object(Bucket=args.bucket, Key=key)["Body"].read()))
    entries.sort(key=lambda e: (e.get("recordedAt") or "", e["contentHash"]))
    lines = "".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "\n" for e in entries)
    s3.put_object(Bucket=args.bucket, Key="manifest.jsonl", Body=lines.encode("utf-8"),
                  ContentType="application/x-ndjson")
    print(f"manifest.jsonl 再生成: {len(entries)} 行")
    if len(entries) != len(sessions):
        print(f"⚠ manifest {len(entries)} 行 != セッション {len(sessions)} 件 (スキップ分を確認)")
        sys.exit(1)


if __name__ == "__main__":
    main()
