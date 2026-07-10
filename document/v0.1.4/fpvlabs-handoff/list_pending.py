"""未処理クリップを一覧する。

rootlens-raw-arkit に上がっているが、 まだ rootlens-fpvlabs に session.mcap が無い
content_hash を表示する (= これから modal で処理すべきもの)。

  python document/v0.1.4/fpvlabs-handoff/list_pending.py

R2 認証は web/.env / web/.env.local から読む (= ローカル実行のみ。 modal run 側は不要)。
"""
import os, boto3
from botocore.config import Config


def load_env(path):
    d = {}
    if not os.path.exists(path):
        return d
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    return d


here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, "..", "..", ".."))
env = {}
env.update(load_env(os.path.join(root, "web/.env")))
env.update(load_env(os.path.join(root, "web/.env.local")))

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=env["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

RAW = "rootlens-raw-arkit"
OUT = "rootlens-fpvlabs"


def hashes_in(bucket, prefix=""):
    """bucket 直下 (prefix 配下) の第1階層フォルダ名 = content_hash 集合。"""
    got, sizes = {}, {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for o in page.get("Contents", []):
            key = o["Key"][len(prefix):]
            h = key.split("/")[0]
            if h:
                got.setdefault(h, 0)
                got[h] += o["Size"]
    return got


# 本命候補と小物 (= 中断/テスト録画) を分ける閾値 (GB)。 raw がこの未満は通常スキップ。
MIN_REAL_GB = 0.3

raw = hashes_in(RAW, "raw/")
done = hashes_in(OUT, "")
pending = {h: sz for h, sz in raw.items() if h not in done}


def gb(n):
    return f"{n/1024**3:.2f}GB"


def has_depth(h):
    """raw/<hash>/depth.tar が存在し空でないか (= LiDAR 端末で撮れているか)。"""
    try:
        o = s3.head_object(Bucket=RAW, Key=f"raw/{h}/depth.tar")
        return o["ContentLength"] > 0
    except Exception:
        return False


real = {h: sz for h, sz in pending.items() if sz >= MIN_REAL_GB * 1024**3}
small = {h: sz for h, sz in pending.items() if sz < MIN_REAL_GB * 1024**3}

print(f"raw-arkit: {len(raw)} 本 / fpvlabs 済: {len(done)} 本 / 未処理: {len(pending)} 本\n")

if real:
    print(f"=== 本命候補 {len(real)} 本 (raw >= {MIN_REAL_GB}GB) ===")
    depth_ok = {}
    for h in sorted(real, key=lambda x: raw[x]):
        depth_ok[h] = has_depth(h)
        mark = "depth あり" if depth_ok[h] else "depth なし ⚠ (非LiDAR端末?)"
        print(f"  {h}  raw {gb(real[h])}  [{mark}]")
    print("\n処理コマンド:")
    for h in sorted(real, key=lambda x: raw[x]):
        note = "" if depth_ok[h] else "   # ⚠ depth なし"
        print(f"  modal run tools/modal/fpvlabs/fpvlabs.py --content-hash {h}{note}")
else:
    print("本命候補なし (= 未処理の大物なし)")

if small:
    print(f"\n--- 小さい {len(small)} 本 (raw < {MIN_REAL_GB}GB、 中断/テスト録画の可能性。 通常スキップ) ---")
    for h in sorted(small, key=lambda x: raw[x]):
        print(f"  {h[:12]}…  raw {gb(small[h])}")
