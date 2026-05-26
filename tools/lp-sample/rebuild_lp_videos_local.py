"""
LP 第一弾 dataset の videos/ 配下を Mac local で全部再生成して R2 に上書き。

経路:
  web/public/lp/sample/sample_NNNN.mp4 (= contributor 提供の生 mp4)
    → Swift CLI (macos-blur, Apple Vision 顔ぼかし + HEVC encode)
    → c2pa-python で C2PA 「署名 S」 を埋め込み
    → R2 (rootlens-public/lp-sample/v0.1/videos/...) に episode_XXX.mp4 として上書き

YuNet の拳誤検出 (= 12-51 % frame) を Apple Vision に置き換えて品質改善。
data parquet / tasks.jsonl は WiLoR / phase narration がそのまま使えるので更新不要。

使い方:
  python tools/lp-sample/rebuild_lp_videos_local.py --concurrency 4
"""
import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
SAMPLE_DIR = REPO / "web" / "public" / "lp" / "sample"
META_JSON = SAMPLE_DIR / "json" / "rootlens_sample_videos.json"
WORK_DIR = Path("/tmp/lp_apple_blurred")
CLI = REPO / "tools" / "macos-blur" / ".build" / "arm64-apple-macosx" / "release" / "MacOsBlur"

R2_BUCKET = "rootlens-public"
R2_PREFIX = "lp-sample/v0.1/videos/observation.images.ego_cam/chunk-000"

CERT_CHAIN_PATH = REPO / "certs" / "dev" / "server-c2pa-chain.pem"
PRIVATE_KEY_PATH = REPO / "certs" / "dev" / "server-c2pa-key.pem"


def load_env():
    load_dotenv(REPO / "server" / ".env", override=True)
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        if not os.environ.get(k):
            sys.exit(f"{k} not set")


def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def sign_c2pa(mp4_path: Path, faces_total: int, cert_chain_pem: str, key_pem: str) -> None:
    """tools/modal/blur.py::sign_c2pa と同じロジックで C2PA 「署名 S」 を in-place で埋め込む。"""
    import c2pa
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend

    manifest = {
        "claim_generator_info": [{"name": "rootlens-server", "version": "0.1"}],
        "format": "video/mp4",
        "title": "RootLens blurred clip",
        "ingredients": [],
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.placed",
                            "softwareAgent": {"name": "Apple Vision (VNDetectFaceRectanglesRequest revision 3)"},
                            "parameters": {"description": f"face blur applied to {faces_total} regions"},
                        },
                    ],
                },
            },
        ],
    }

    private_key = serialization.load_pem_private_key(
        key_pem.encode(), password=None, backend=default_backend(),
    )

    def sign_callback(data: bytes) -> bytes:
        return private_key.sign(data, ec.ECDSA(hashes.SHA256()))

    settings = c2pa.Settings()
    settings.set("verify.verify_after_sign", "false")

    tmp = str(mp4_path) + ".signed.mp4"
    with c2pa.Context(settings) as ctx:
        with c2pa.Signer.from_callback(
            sign_callback, c2pa.C2paSigningAlg.ES256, cert_chain_pem, None,
        ) as signer:
            with c2pa.Builder(manifest, ctx) as builder:
                builder.sign_file(str(mp4_path), tmp, signer)
    os.replace(tmp, str(mp4_path))


def process_one(ep_idx: int, video_id: str, source_mp4: Path, cert_chain: str, key_pem: str, s3) -> dict:
    out_local = WORK_DIR / f"episode_{ep_idx:03d}.mp4"
    if out_local.exists():
        out_local.unlink()

    # 1. Swift CLI で顔ぼかし
    t0 = time.time()
    proc = subprocess.run(
        [str(CLI), "--input", str(source_mp4), "--output", str(out_local), "--quiet"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"macos-blur failed for {video_id}: rc={proc.returncode} stderr={proc.stderr[:200]}")
    blur_meta = json.loads(proc.stdout.strip())
    faces = int(blur_meta.get("facesBlurred", 0))
    blur_sec = time.time() - t0

    # 2. C2PA 「署名 S」 を埋める
    t0 = time.time()
    sign_c2pa(out_local, faces_total=faces, cert_chain_pem=cert_chain, key_pem=key_pem)
    sign_sec = time.time() - t0

    # 3. R2 アップロード上書き
    t0 = time.time()
    r2_key = f"{R2_PREFIX}/episode_{ep_idx:03d}.mp4"
    s3.upload_file(
        str(out_local), R2_BUCKET, r2_key,
        ExtraArgs={"ContentType": "video/mp4", "CacheControl": "public, max-age=86400"},
    )
    upload_sec = time.time() - t0

    print(f"[ep{ep_idx:03d}] {video_id}  faces={faces}  blur={blur_sec:.1f}s sign={sign_sec:.1f}s upload={upload_sec:.1f}s")
    return {"episode_index": ep_idx, "faces": faces, "blur_sec": blur_sec, "sign_sec": sign_sec}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--only", type=int, default=None, help="single episode_index for smoke test")
    args = p.parse_args()

    if not CLI.exists():
        sys.exit(f"CLI not built: {CLI}\nRun: cd tools/macos-blur && swift build -c release")
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    load_env()
    s3 = r2_client()

    cert_chain = CERT_CHAIN_PATH.read_text()
    key_pem = PRIVATE_KEY_PATH.read_text()
    if not cert_chain or not key_pem:
        sys.exit("cert chain / key missing under certs/dev/")

    meta = json.load(open(META_JSON))
    videos = meta["videos"]
    targets = [(i, v["video_id"], SAMPLE_DIR / v["file_name"]) for i, v in enumerate(videos)]
    if args.only is not None:
        targets = [t for t in targets if t[0] == args.only]

    print(f"processing {len(targets)} clip(s) with concurrency={args.concurrency}")
    t_all = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {
            ex.submit(process_one, ep, vid, mp4, cert_chain, key_pem, s3): (ep, vid)
            for ep, vid, mp4 in targets
        }
        for fut in as_completed(futures):
            ep, vid = futures[fut]
            try:
                fut.result()
            except Exception as e:
                print(f"[ep{ep:03d}] FAILED: {e}", file=sys.stderr)
                raise

    print(f"\ndone in {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
