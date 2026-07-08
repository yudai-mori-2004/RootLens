"""
RootLens Pipeline 2 ラベリング層: dense narration + 自動分類 (Modal CPU 関数)。

⚠ この層は「ラベリング (観測)」専任。 品質スコアリングは行わない。
   スコアリングはタスク定義に依存する別概念であり、 ラベル (semantic.jsonl) を入力にした
   別フローで後段に行う設計。 ここでスコアを混ぜない (= 関心の分離)。

ラベリングは labeling/ のプラガブル Labeler (= プロバイダ+手法単位、 既定 gemini-video-dense、
他に claude-diffsw / claude-single-pass) に委譲する。 labeler は LabelResult
(segments=説明文のみ / summary / objects) を返す。 autoCategory は要約から派生する。

入力: signature_hash, labeler (既定 gemini-video-dense)。
出力: ラベリング結果 (camelCase) + processed/<signature_hash>/semantic.jsonl。
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
        return 1.0 if not segments else 0.5
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
def score_layer3(signature_hash: str, labeler: str = ""):
    """Pipeline 2 ラベリング層。 labeler 既定 = gemini-video-dense。 採点はしない (= 別フロー)。
    (endpoint 名は互換のため score_layer3 のまま。 実体はラベリング専任。)
    未宣言の query param (= 旧 client の prior_scores / vlm_interval_sec) は FastAPI が無視する。"""
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

    # ラベリング結果のみ (= 採点しない)。 autoCategory は要約から派生 (= 観測の分類)。
    # idleRatio はセグメント被覆から算出する観測由来の統計 (= 採点ではない。 後段スコアリングの素材)。
    auto_cat, auto_conf = _derive_category(result.summary)
    frame_labels = [
        {"frameIdx": int(s.start_s * fps), "tsSec": round(s.start_s, 3), "description": s.description}
        for s in result.segments
    ]
    response = {
        "autoCategory": auto_cat,
        "autoCategoryConfidence": auto_conf,
        "idleRatio": round(_idle_ratio(result.segments, duration), 4),
        "summary": result.summary,
        "frameLabels": frame_labels,
    }

    try:
        sem_key = _write_semantic(s3, bucket_processed, signature_hash, result, duration, impl.name, impl.output_format, work_dir)
        print(f"[layer3] wrote {sem_key} ({len(result.segments)} segments, {impl.output_format})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[layer3] WARNING semantic.jsonl write failed: {type(e).__name__}: {e}", flush=True)

    try:
        os.remove(rgb)
    except OSError:
        pass

    print(f"[layer3] done {signature_hash} segments={len(result.segments)} "
          f"cat={auto_cat} labeler={impl.name} elapsed={time.time()-t_start:.1f}s", flush=True)
    return response


@app.local_entrypoint()
def main():
    print(f"rootlens-layer3-vlm. labelers={available_labelers()}. deploy: modal deploy tools/modal/layer3_vlm.py")
