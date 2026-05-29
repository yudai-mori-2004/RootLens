"""
RootLens Pipeline 2 第 3 層: dense narration + 採点 + 自動分類 (Modal CPU 関数)。

ラベリングは labeling/ のプラガブル Labeler (= プロバイダ+手法単位、 既定 gemini-video-dense、
他に claude-diffsw / claude-single-pass) に委譲する。 labeler は LabelResult
(segments=説明文のみ / summary / objects / scores) を返す。

- semantic.jsonl は説明文のみ (= フレームごとに category は付けない)。 クリップ単位の autoCategory は
  要約から派生する。
- 採点 (4基準) は labeler の scores を使い、 無い場合は中央値フォールバックする。

入力: signature_hash, labeler (既定 gemini-video-dense), prior_scores。
出力: VlmScoreResult (camelCase) + processed/<signature_hash>/{semantic.jsonl, quality_scores.json}。
"""

import json
import os
import time

import modal

from labeling import get_labeler, available_labelers


# ─── Modal Image ──────────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "google-genai>=1.0",          # gemini-video-dense (= 既定、 動画ネイティブ)
        "anthropic>=0.50,<1",         # claude-* fallback labeler
        "opencv-python-headless==4.10.0.84",  # 動画 probe + Claude フレームサンプル
        "numpy<2",
        "boto3==1.35.50",
        "Pillow==10.4.0",
        "fastapi[standard]",
    )
    .add_local_python_source("labeling")  # labeling パッケージを container に同梱
)

app = modal.App("rootlens-layer3-vlm", image=image)


# ─── 配点 (DATA_SPECS §3.2.4) ───────────────────────────────────────────

WEIGHT_TASK_ACTIVITY = 22
WEIGHT_OBJECT_INTERACTION = 18
WEIGHT_AUTHENTICITY = 15
WEIGHT_SCENE_MATCH = 10
LAYER3_MAX_SCORE = WEIGHT_TASK_ACTIVITY + WEIGHT_OBJECT_INTERACTION + WEIGHT_AUTHENTICITY + WEIGHT_SCENE_MATCH

FALLBACK_METRIC = 2.5
FALLBACK_IDLE_RATIO = 0.5

# クリップ単位カテゴリを要約のキーワードから派生する (web/shared/api-types AutoCategory と一致)。
CATEGORY_KEYWORDS = {
    "laundry": ["洗濯", "畳", "たた", "fold", "laundry", "衣類", "靴下", "sock", "garment", "shirt", "clothe", "干"],
    "cooking": ["料理", "調理", "cook", "切っ", "焼", "煮", "食材", "包丁", "knife"],
    "cleaning": ["掃除", "拭", "clean", "モップ", "mop", "sweep", "wipe", "vacuum"],
    "studying": ["勉強", "読書", "study", "read", "ノート", "書い", "計算"],
    "crafting": ["工作", "diy", "craft", "修理", "repair", "組立", "assemble", "手芸"],
    "organizing": ["整理", "片付", "organiz", "収納", "store", "tidy", "並べ"],
    "meal_prep": ["配膳", "食卓", "盛り付", "meal", "serve", "plate"],
}


def _probe(path: str) -> tuple[int, float, float]:
    """(total_frames, fps, duration_s)。"""
    import cv2  # type: ignore

    cap = cv2.VideoCapture(path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    dur = total / fps if fps > 0 else 0.0
    return total, fps, dur


def _derive_category(summary: str) -> tuple[str, float]:
    s = (summary or "").lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k.lower() in s for k in kws):
            return cat, 1.0
    return "other", 0.0


def _idle_ratio(segments, duration_s: float) -> float:
    """セグメントが覆っていない時間の割合 (= 何も手作業していない区間)。"""
    if duration_s <= 0 or not segments:
        return 1.0 if not segments else FALLBACK_IDLE_RATIO
    iv = sorted((max(0.0, s.start_s), min(duration_s, s.end_s)) for s in segments)
    covered, cur_a, cur_b = 0.0, None, None
    for a, b in iv:
        if b <= a:
            continue
        if cur_a is None:
            cur_a, cur_b = a, b
        elif a <= cur_b:
            cur_b = max(cur_b, b)
        else:
            covered += cur_b - cur_a
            cur_a, cur_b = a, b
    if cur_a is not None:
        covered += cur_b - cur_a
    return max(0.0, min(1.0, 1.0 - covered / duration_s))


def _scoring(result, duration_s: float) -> dict:
    """LabelResult.scores (0-5) → layer3 スコア。 None なら中央値フォールバック。 idleRatio は segments から。"""
    sc = result.scores
    if not sc:
        return {
            "score": int(round((FALLBACK_METRIC / 5.0) * LAYER3_MAX_SCORE)),
            "taskActivityAvg": FALLBACK_METRIC, "objectInteractionAvg": FALLBACK_METRIC,
            "authenticityAvg": FALLBACK_METRIC, "sceneMatchAvg": FALLBACK_METRIC,
            "idleRatio": round(_idle_ratio(result.segments, duration_s), 4),
        }

    def c(v):
        return max(0.0, min(5.0, float(v)))

    ta, oi, au, sm = c(sc.get("task_activity", 0)), c(sc.get("object_interaction", 0)), c(sc.get("authenticity", 0)), c(sc.get("scene_match", 0))
    score = int(round(ta / 5 * WEIGHT_TASK_ACTIVITY + oi / 5 * WEIGHT_OBJECT_INTERACTION + au / 5 * WEIGHT_AUTHENTICITY + sm / 5 * WEIGHT_SCENE_MATCH))
    return {
        "score": max(0, min(LAYER3_MAX_SCORE, score)),
        "taskActivityAvg": round(ta, 4), "objectInteractionAvg": round(oi, 4),
        "authenticityAvg": round(au, 4), "sceneMatchAvg": round(sm, 4),
        "idleRatio": round(_idle_ratio(result.segments, duration_s), 4),
    }


def _write_semantic(s3, bucket, h, result, duration_s, labeler_name, output_format, work_dir) -> str:
    """labeler の宣言した output_format で semantic.jsonl を書く。
    dense_captions = ActivityNet Captions のイベントスキーマ: 1 行目ヘッダー (duration + provenance) +
    2 行目以降が時系列イベント {timestamp: [start, end], sentence}。"""
    path = f"{work_dir}/semantic.jsonl"
    if output_format != "dense_captions":
        raise ValueError(f"unknown output_format: {output_format}")
    segs = sorted(result.segments, key=lambda s: s.start_s)
    with open(path, "w") as f:
        f.write(json.dumps({
            "format": "activitynet_dense_captions", "labeler": labeler_name, "signature_hash": h,
            "duration": round(duration_s, 3),
            "annotation": "auto_generated_unverified",   # 自動生成・未検証 (= 人手アノテーションではない)
            "fields": ["timestamp", "sentence"],
        }, ensure_ascii=False) + "\n")
        for s in segs:
            f.write(json.dumps({"timestamp": [s.start_s, s.end_s], "sentence": s.description}, ensure_ascii=False) + "\n")
    key = f"processed/{h}/semantic.jsonl"
    s3.upload_file(path, bucket, key, ExtraArgs={"ContentType": "application/x-ndjson"})
    return key


def _write_quality_scores(s3, bucket, h, prior_json, layer3) -> str:
    prior = json.loads(prior_json)
    l1, l2 = prior["layer1"], prior["layer2"]
    total = int(round(float(l1.get("score", 0)) + float(l2.get("score", 0)) + float(layer3.get("score", 0))))
    doc = {"total": total, "layer1": l1, "layer2": l2, "layer3": layer3}
    key = f"processed/{h}/quality_scores.json"
    s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"), ContentType="application/json")
    return key


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
def score_layer3(signature_hash: str, labeler: str = "", prior_scores: str = "", vlm_interval_sec: float = 0.0):
    """Pipeline 2 第 3 層。 labeler 既定 = gemini-video-dense。 vlm_interval_sec は legacy 互換で受けるが未使用。"""
    import boto3  # type: ignore

    t_start = time.time()
    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")
    bucket_processed = os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed")
    s3 = boto3.client(
        "s3", endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    impl = get_labeler(labeler)
    print(f"[layer3] labeler={impl.name} (available={available_labelers()})", flush=True)

    work_dir = "/tmp/layer3_work"
    os.makedirs(work_dir, exist_ok=True)
    rgb = f"{work_dir}/{signature_hash}_rgb.mp4"
    s3.download_file(bucket_raw, f"raw/{signature_hash}/rgb.mp4", rgb)
    total_frames, fps, duration = _probe(rgb)
    print(f"[layer3] video: {total_frames} frames @ {fps:.2f}fps = {duration:.1f}s", flush=True)

    t_lab = time.time()
    result = impl.label(rgb, duration, fps)
    print(f"[layer3] labeled: {len(result.segments)} segments summary={result.summary[:60]!r} ({time.time()-t_lab:.1f}s)", flush=True)

    layer3 = _scoring(result, duration)
    auto_cat, auto_conf = _derive_category(result.summary)
    layer3["autoCategory"] = auto_cat
    layer3["autoCategoryConfidence"] = auto_conf

    # web 互換 frameLabels (= segments を {frameIdx, tsSec, category, description} に。 category は空 = 派生は別)
    frame_labels = [
        {"frameIdx": int(s.start_s * fps), "tsSec": round(s.start_s, 3), "category": "", "description": s.description}
        for s in result.segments
    ]
    response = {**layer3, "frameLabels": frame_labels}

    try:
        sem_key = _write_semantic(s3, bucket_processed, signature_hash, result, duration, impl.name, impl.output_format, work_dir)
        print(f"[layer3] wrote {sem_key} ({len(result.segments)} segments, {impl.output_format})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[layer3] WARNING semantic.jsonl write failed: {type(e).__name__}: {e}", flush=True)

    if prior_scores:
        try:
            q_key = _write_quality_scores(s3, bucket_processed, signature_hash, prior_scores, layer3)
            print(f"[layer3] wrote {q_key}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[layer3] WARNING quality_scores.json write failed: {type(e).__name__}: {e}", flush=True)

    try:
        os.remove(rgb)
    except OSError:
        pass

    print(f"[layer3] done {signature_hash} score={layer3['score']}/{LAYER3_MAX_SCORE} "
          f"cat={auto_cat} labeler={impl.name} elapsed={time.time()-t_start:.1f}s", flush=True)
    return response


@app.local_entrypoint()
def main():
    print(f"rootlens-layer3-vlm. labelers={available_labelers()}. deploy: modal deploy tools/modal/layer3_vlm.py")
