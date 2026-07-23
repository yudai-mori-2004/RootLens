#!/usr/bin/env python3
"""fpvlabs バケットの manifest.jsonl を手動で再生成する。

manifest は fpvlabs.py が処理のたびに DB + R2 の実状態から作り直す派生物で、
どこにもメモを持たない。 このツールは同じ再生成をパイプラインを回さずに行うためのもの
(= セッションをバケットから消した直後や、 スキーマ変更を反映したいとき用)。

スキーマは fpvlabs.py の regenerate_manifest と同一に保つ (変えるときは両方 + README-for-fpv.md)。
domain / site の正は DB の accounts テーブル。

実行 (リポジトリ直下):
  set -a; source web/.env.local; set +a
  python document/v0.1.4/fpvlabs-handoff/gen_manifest.py [--bucket <name>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os


def r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


QT_EPOCH = dt.datetime(1904, 1, 1, tzinfo=dt.timezone.utc)


def mp4_creation_time_from_r2(s3, bucket: str, key: str) -> dt.datetime | None:
    """raw rgb.mp4 の mvhd creation_time (= 録画開始の壁時計 UTC) を末尾 16MB の
    レンジ読みで取り出す (fpvlabs.py の _mp4_creation_time と同じ規則)。"""
    import struct

    size = s3.head_object(Bucket=bucket, Key=key)["ContentLength"]
    buf = s3.get_object(Bucket=bucket, Key=key,
                        Range=f"bytes={max(0, size - 16_000_000)}-")["Body"].read()
    i = buf.rfind(b"mvhd")
    if i < 0:
        # 一部の録画は moov が先頭側にある (中断復旧などで書き直された個体)。
        buf = s3.get_object(Bucket=bucket, Key=key, Range="bytes=0-15999999")["Body"].read()
        i = buf.rfind(b"mvhd")
    if i < 0:
        return None
    version = buf[i + 4]
    if version == 0:
        secs = struct.unpack(">I", buf[i + 8:i + 12])[0]
    else:
        secs = struct.unpack(">Q", buf[i + 8:i + 16])[0]
    ts = QT_EPOCH + dt.timedelta(seconds=secs)
    return ts if 2020 <= ts.year <= 2035 else None


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
                    "select c.content_hash, c.duration_ms, c.created_at, c.recorded_at,"
                    " a.domain, a.site"
                    " from clips c left join accounts a on a.id = c.account_id"
                    " where c.content_hash = any(%s)",
                    (list(sessions),),
                )
                rows = {h: {"duration_ms": d, "created_at": c, "recorded_at": r,
                            "domain": dom, "site": site}
                        for h, d, c, r, dom, site in cur.fetchall()}

            # clips.recorded_at が未記録のセッションは raw の mvhd から読んで埋める
            # (通常はパイプラインが埋めるので、 ここに来るのは導入前の在庫だけ)。
            for h, row in rows.items():
                if row["recorded_at"] is not None:
                    continue
                rec = mp4_creation_time_from_r2(s3, bucket_raw, f"raw/{h}/rgb.mp4")
                if rec is None:
                    print(f"  ⚠ {h[:8]}: mvhd が読めない (recordedAt は推定値になる)")
                    continue
                with conn.cursor() as cur:
                    cur.execute(
                        "update clips set recorded_at = %s"
                        " where content_hash = %s and recorded_at is null",
                        (rec, h),
                    )
                conn.commit()
                row["recorded_at"] = rec
                print(f"  ✓ {h[:8]}: recorded_at = {rec.isoformat()}")
        finally:
            conn.close()

    entries = []
    for h, mcap_bytes in sessions.items():
        db_row = rows.get(h)
        if not db_row:
            print(f"  ⚠ {h[:8]}: clips テーブルに未登録 (欠損フィールドは null)")
        elif db_row["domain"] is None:
            print(f"  ⚠ {h[:8]}: accounts に現場属性の行が無い (domain/site は null)")
        try:
            body = s3.get_object(Bucket=bucket_raw, Key=f"raw/{h}/metadata.json")["Body"].read()
            meta = json.loads(body)
        except Exception:
            print(f"  ⚠ {h[:8]}: raw metadata.json が読めない (欠損フィールドは null)")
            meta = {}
        camera = meta.get("camera") or {}
        settings = meta.get("capture_settings") or {}
        uploaded = db_row["created_at"] if db_row else None
        # recordedAt の正は clips.recorded_at (= mvhd 由来)。 読めなかった行だけ
        # 「アップロード時刻 − 尺」で録画開始を近似 (fpvlabs.py と同じ規則)。
        recorded = db_row["recorded_at"] if db_row else None
        if recorded is not None:
            recorded = recorded.isoformat()
        elif uploaded is not None:
            recorded = (uploaded - dt.timedelta(
                milliseconds=(db_row["duration_ms"] or 0))).isoformat()
        entries.append({
            "contentHash": h,
            "domain": db_row["domain"] if db_row else None,
            "site": db_row["site"] if db_row else None,
            "recordedAt": recorded,
            "uploadedAt": uploaded.isoformat() if uploaded else None,
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
