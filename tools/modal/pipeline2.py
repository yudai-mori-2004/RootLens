"""
RootLens Pipeline 2 オーケストレータ (Modal CPU 関数)。

Pipeline 2 のゴールは「品質の定量化（採点）」。 ラベリング等はその前準備。 構造は対称な2ステージ:

  1. 前処理 (preprocess): 採点に必要な中間データを R2 processed/ に書き出す (= labeling 等、 後付け可)
  2. 採点 (scoring):     R2 (raw + processed) を stateless に読み、 軸ごと 0-100 で独立採点する
                        (= video_technical / motion_content / label_quality、 後付け可)

リクエストで「どの前処理・どの採点を走らせるか」を選ぶ → Pipeline 2 全体が純関数的になる:
  入力 = signature_hash + 選択した preprocess/score、 副作用 = processed/ への書き出し、 出力 = スコアベクトル。
採点が R2 を読む設計なので、 採点対象データがストレージに在ることが保証され、 採点だけ後で再実行もできる。

⚠ スコアは軸ごとに 0-100 で独立。 合計 (= 重み付け合算) は出さない。 重みは買い手が用途に応じて決める
   (= 異種の品質軸を売り手が混ぜない)。 quality_scores.json は合計なしのベクトルで出荷する。
"""

import json
import os
import time

import modal

from preprocess import available_preprocessors, get_preprocessor, DEFAULT_PREPROCESSORS
from scoring import available_scorers, get_scorer, DEFAULT_SCORERS
from r2ctx import Ctx

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "google-genai>=1.0",          # labeling: gemini-video-dense
        "anthropic>=0.50,<1",         # labeling: claude-*, scoring: label_quality
        "opencv-python-headless==4.10.0.84",
        "numpy<2",
        "boto3==1.35.50",
        "Pillow==10.4.0",
        "fastapi[standard]",
    )
    # 前処理・採点・ラベリングの各パッケージ + R2 ctx を container に同梱。
    .add_local_python_source("r2ctx", "labeling", "preprocess", "scoring")
)

app = modal.App("rootlens-pipeline2", image=image)


def _csv(s: str, default: list[str]) -> list[str]:
    items = [x.strip() for x in (s or "").split(",") if x.strip()]
    return items or list(default)


@app.function(
    cpu=2.0,
    memory=2048,
    timeout=900,
    secrets=[
        modal.Secret.from_name("r2-creds"),
        modal.Secret.from_name("anthropic-api-key"),
        modal.Secret.from_name("gemini-api-key"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def process(signature_hash: str, preprocess: str = "", score: str = "", labeler: str = ""):
    """Pipeline 2 本体。

    Args (query string):
      signature_hash : R2 raw/<hash>/ のクリップ
      preprocess     : 走らせる前処理名の csv (既定 = labeling)
      score          : 走らせる採点軸名の csv (既定 = video_technical,motion_content,label_quality)
      labeler        : labeling 前処理が使う Labeler 名 (既定 = gemini-video-dense)

    Returns: {signature_hash, preprocessed:[...], scores:{name:{axis,score,breakdown}}}
    """
    import boto3  # type: ignore

    t0 = time.time()
    account_id = os.environ["R2_ACCOUNT_ID"]
    s3 = boto3.client(
        "s3", endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    work_dir = "/tmp/pipeline2_work"
    os.makedirs(work_dir, exist_ok=True)
    ctx = Ctx(
        signature_hash=signature_hash,
        s3=s3,
        bucket_raw=os.environ.get("R2_BUCKET_RAW", "rootlens-raw"),
        bucket_processed=os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed"),
        work_dir=work_dir,
    )

    pre_names = _csv(preprocess, DEFAULT_PREPROCESSORS)
    score_names = _csv(score, DEFAULT_SCORERS)
    print(f"[pipeline2] {signature_hash} preprocess={pre_names} score={score_names} "
          f"(avail pre={available_preprocessors()} score={available_scorers()})", flush=True)

    # ─── ステージ 1: 前処理 (= processed/ に中間データを書く) ───
    preprocessed = []
    for name in pre_names:
        t = time.time()
        res = get_preprocessor(name).run(ctx, {"labeler": labeler})
        preprocessed.append({"name": res.name, "artifacts": res.artifacts, "meta": res.meta})
        print(f"[pipeline2] preprocess {name}: {res.artifacts} ({time.time()-t:.1f}s)", flush=True)

    # ─── ステージ 2: 採点 (= R2 を stateless に読み、 軸ごと 0-100) ───
    scores = {}
    for name in score_names:
        t = time.time()
        axis = get_scorer(name).score(ctx)
        scores[name] = {"axis": axis.axis, "score": axis.score, "method": axis.method, "breakdown": axis.breakdown}
        print(f"[pipeline2] score {name}: {axis.score}/100 ({time.time()-t:.1f}s)", flush=True)

    # ─── 出力: 合計なしの軸ベクトルを processed/ に書き出し + 返す ───
    doc = {"signature_hash": signature_hash, "axes": scores, "preprocessed": preprocessed}
    ctx.put_processed_text("quality_scores.json", json.dumps(doc, ensure_ascii=False, indent=2), "application/json")

    print(f"[pipeline2] done {signature_hash} axes={ {k: v['score'] for k, v in scores.items()} } "
          f"elapsed={time.time()-t0:.1f}s", flush=True)
    return {"signature_hash": signature_hash, "preprocessed": preprocessed, "scores": scores}


@app.local_entrypoint()
def main():
    print(f"rootlens-pipeline2. preprocess={available_preprocessors()} score={available_scorers()}. "
          "deploy: modal deploy tools/modal/pipeline2.py")
