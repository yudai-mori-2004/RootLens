# 動画のサムネイルを 4 枚抜き出して rootlens-public/lp-sample/preview/ に上げる。
# サンプルクリップ候補を目視で比較するためのだけの道具。
#
# 実行:
#   modal run tools/sample-select/thumbs.py --content-hash <hash>

from __future__ import annotations

import json
import os
import subprocess
import tempfile

try:
    import modal

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg")
        .pip_install("boto3")
    )
    app = modal.App("rootlens-sample-select-thumbs")

    @app.function(
        image=image,
        timeout=900,
        memory=4096,
        cpu=2.0,
        secrets=[modal.Secret.from_name("r2-creds")],
    )
    def extract(content_hash: str) -> dict:
        import boto3

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
        bucket_pub = os.environ.get("R2_BUCKET_PUBLIC", "rootlens-public")

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "rgb.mp4")
            s3.download_file(bucket_raw, f"raw/{content_hash}/rgb.mp4", src)

            # 尺を取得。 ffprobe で JSON 出力。
            probe = subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "format=duration",
                "-of", "json", src,
            ])
            dur = float(json.loads(probe)["format"]["duration"])

            uploaded = []
            # 尺の 15% / 35% / 55% / 75% / 95% の 5 点でサンプリング。
            # (0% と 100% は装着直後・停止直前で作業らしい絵が出にくいので避ける)
            fractions = [0.15, 0.35, 0.55, 0.75, 0.95]
            for i, frac in enumerate(fractions):
                t = dur * frac
                out = os.path.join(tmp, f"thumb_{i}.jpg")
                # -ss を -i より先に置くと keyframe fast seek。 質を落とさず 640px 幅へ縮小。
                subprocess.check_call([
                    "ffmpeg", "-y", "-v", "error",
                    "-ss", f"{t:.3f}",
                    "-i", src,
                    "-frames:v", "1",
                    "-vf", "scale=640:-2",
                    "-q:v", "3",
                    out,
                ])
                key = f"lp-sample/preview/{content_hash}_{i:02d}.jpg"
                s3.upload_file(out, bucket_pub, key, ExtraArgs={"ContentType": "image/jpeg"})
                uploaded.append({
                    "t": round(t, 1),
                    "frac": frac,
                    "key": key,
                })

            return {
                "contentHash": content_hash,
                "durationSec": dur,
                "thumbnails": uploaded,
            }

    @app.local_entrypoint()
    def main(content_hash: str):
        print(json.dumps(extract.remote(content_hash), indent=2))

except ImportError:
    modal = None
