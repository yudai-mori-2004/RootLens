"""
LP 第一弾サンプル dataset を R2 の rootlens-public バケットにアップロード。

upload key 構造:
  lp-sample/v0.1/README.md
  lp-sample/v0.1/meta/info.json
  lp-sample/v0.1/meta/tasks.jsonl
  lp-sample/v0.1/meta/stats.json
  lp-sample/v0.1/meta/episodes/chunk-000/file-000.parquet
  lp-sample/v0.1/data/chunk-000/file-000.parquet
  lp-sample/v0.1/videos/observation.images.ego_cam/chunk-000/episode_XXX.mp4

R2 bucket の public 化 (= r2.dev subdomain 有効化や custom domain 設定) は
Cloudflare dashboard 側の作業。 本スクリプトは upload のみ担当。

使い方:
  python tools/lp-sample/upload_lp_sample_to_r2_public.py
"""

import argparse
import mimetypes
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET_DIR = REPO_ROOT / "web" / "public" / "lp" / "sample" / "dataset"
DEFAULT_BUCKET = "rootlens-public"
DEFAULT_PREFIX = "lp-sample/v0.1"

CONTENT_TYPES = {
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".parquet": "application/vnd.apache.parquet",
    ".mp4": "video/mp4",
    ".md": "text/markdown; charset=utf-8",
}


def load_env() -> None:
    load_dotenv(REPO_ROOT / "server" / ".env", override=True)
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        if not os.environ.get(k):
            sys.exit(f"{k} is not set.")


def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def content_type_for(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in CONTENT_TYPES:
        return CONTENT_TYPES[ext]
    mt, _ = mimetypes.guess_type(str(path))
    return mt or "application/octet-stream"


def collect_files(dataset_dir: Path) -> list[tuple[Path, str]]:
    """dataset_dir 配下の全ファイルを集めて (ローカルパス, アップロード key suffix) リストを返す。"""
    out: list[tuple[Path, str]] = []
    for p in dataset_dir.rglob("*"):
        if p.is_file():
            rel = p.relative_to(dataset_dir).as_posix()
            out.append((p, rel))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env()
    s3 = r2_client()

    files = collect_files(args.dataset_dir)
    if not files:
        sys.exit(f"no files under {args.dataset_dir}")

    total_bytes = sum(p.stat().st_size for p, _ in files)
    print(f"uploading {len(files)} files ({total_bytes / 1e6:.1f} MB) → s3://{args.bucket}/{args.prefix}/")
    if args.dry_run:
        for p, rel in files:
            print(f"  {args.prefix}/{rel}  ({p.stat().st_size / 1e3:.1f} KB)")
        return

    t0 = time.time()
    done_bytes = [0]
    done_count = [0]

    def upload_one(local_path: Path, rel_key: str) -> None:
        key = f"{args.prefix}/{rel_key}"
        ct = content_type_for(local_path)
        s3.upload_file(
            str(local_path),
            args.bucket,
            key,
            ExtraArgs={
                "ContentType": ct,
                # 公開アセットなので Cache-Control を 1 日にしておく。
                # dataset は immutable な version 設計 (v0.1) なので、 本当は immutable + 長期 cache で OK。
                "CacheControl": "public, max-age=86400",
            },
        )
        done_count[0] += 1
        done_bytes[0] += local_path.stat().st_size
        print(f"  [{done_count[0]:>3}/{len(files)}] {key}  ({local_path.stat().st_size / 1e6:.1f} MB)")

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(upload_one, p, rel): rel for p, rel in files}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"  FAILED: {futures[fut]} → {e}", file=sys.stderr)
                raise

    elapsed = time.time() - t0
    mbps = (done_bytes[0] / 1e6) / max(elapsed, 0.001)
    print(f"\ndone. {done_bytes[0] / 1e6:.1f} MB in {elapsed:.1f}s ({mbps:.1f} MB/s)")
    print(f"\nObject key prefix: s3://{args.bucket}/{args.prefix}/")
    print("Public URL depends on Cloudflare R2 bucket settings (r2.dev or custom domain).")


if __name__ == "__main__":
    main()
