"""
RootLens v0.1.3 Pipeline 2 第 3 層 (= VLM セマンティック解析 + 自動分類、 65 点) を
Modal の CPU 関数として実装。

2026-05-27 大方針転換に対応:
  - 配点を 55 → 65 点に再分配 (= GTSAM 撤去分を吸収)。 task_activity 22 / object_interaction 18 /
    authenticity 15 / scene_match 10
  - 撮影前タスク選択を撤去 (= task_id 不要)。 system prompt は事前にタスクを絞らない
    「家事 / 学習 / 工作等 egocentric 活動を判定 + 分類」 の汎用評価に切替
  - VLM が事後分類するカテゴリ (= cleaning / laundry / cooking / studying / crafting /
    organizing / meal_prep / other) を per-frame で生成、 クリップ全体で多数決して
    主カテゴリ + 信頼度を返す
  - per-frame の短い行動説明文も生成 (= 後段 Pipeline 3 のエピソードラベル集約で再利用)

入力: signature_hash + vlm_interval_sec (= 既定 30s)
処理:
  1. R2 から raw/<signature_hash>/rgb.mp4 を download
  2. cv2 で int(fps * vlm_interval_sec) フレーム間隔でサンプリング、 1024px 幅に
     リサイズ + JPEG quality 70 で base64 エンコード
  3. Claude Haiku 4.5 の messages API に N=16 枚バッチで送信 (= 超過は分割)
  4. 各フレームの 4 基準 (= 0-5) + カテゴリ (= 8 値) + 行動説明文を取得
  5. 4 基準を平均 → 配点で按分 (= 22 / 18 / 15 / 10)、 カテゴリは多数決
出力 JSON (= camelCase、 server shared/api-types Layer3Score と整合):
  {
    score: 0..65 整数,
    taskActivityAvg, objectInteractionAvg, authenticityAvg, sceneMatchAvg,
    idleRatio,
    autoCategory: "cleaning" | ... | "other",
    autoCategoryConfidence: 0..1,
    frameLabels: [{frameIdx, tsSec, category, description}]
  }

冪等性: VLM 呼び出しは非決定的 (= temperature > 0 でも内部揺らぎあり)。
スコアとカテゴリは再採点時に微小変動しうる。 同一 signature_hash での再呼び出し抑止は
Pipeline 2 orchestrator 側で扱う。

詳細: document/v0.1.3/tasks/06-pipeline-2-layer-3-vlm/README.md 参照。
"""

import base64
import io
import json
import os
import sys
import time
from collections import Counter

import modal


# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        # 古い anthropic SDK は新 httpx に渡せない 'proxies' kwarg を投げて死ぬので 0.50+ を使う。
        "anthropic>=0.50,<1",
        "opencv-python-headless==4.10.0.84",
        "numpy<2",
        "boto3==1.35.50",
        "Pillow==10.4.0",
        "fastapi[standard]",
    )
)

app = modal.App("rootlens-layer3-vlm", image=image)


# ─── 定数 ───────────────────────────────────────────────────────────

CLAUDE_MODEL = "claude-haiku-4-5"
MAX_FRAMES_PER_REQUEST = 16  # 1 リクエスト最大 (= context size 配慮)
MAX_OUTPUT_TOKENS = 4096
TEMPERATURE = 0.0  # 再現性目的 (= とはいえ Claude 側に揺らぎは残る)
RESIZE_WIDTH = 1024  # JPEG エンコード時の最大幅
JPEG_QUALITY = 70

# 配点 (= DATA_SPECS_JA.md §3.2.4 第 3 層内訳、 2026-05-27 GTSAM 撤去後)
WEIGHT_TASK_ACTIVITY = 22
WEIGHT_OBJECT_INTERACTION = 18
WEIGHT_AUTHENTICITY = 15
WEIGHT_SCENE_MATCH = 10
LAYER3_MAX_SCORE = (
    WEIGHT_TASK_ACTIVITY
    + WEIGHT_OBJECT_INTERACTION
    + WEIGHT_AUTHENTICITY
    + WEIGHT_SCENE_MATCH
)  # = 65

# 自動分類カテゴリ (= shared/api-types.ts AutoCategory と完全一致)
VALID_CATEGORIES = {
    "cleaning", "laundry", "cooking", "studying",
    "crafting", "organizing", "meal_prep", "other",
}

# フォールバック (= 各 metric を 2.5、 idle_ratio を 0.5、 category は "other" 信頼度 0)
FALLBACK_METRIC = 2.5
FALLBACK_IDLE_RATIO = 0.5
FALLBACK_CATEGORY = "other"


# ─── システムプロンプト ─────────────────────────────────────────────

SYSTEM_PROMPT = (
    "あなたは一人称視点 (= エゴセントリック) の家庭内活動映像を評価する評価者です。\n"
    "撮影者は事前にタスクを申告していません。 映像内容から自律的に活動を判定して\n"
    "ください。\n"
    "\n"
    "対象とする活動カテゴリ (= 8 値、 必ずいずれか 1 つに分類):\n"
    "- cleaning   (= 掃除: 床 / 棚 / 浴室 / トイレ等の清掃)\n"
    "- laundry    (= 洗濯: 洗濯物の畳み / 干し / 取り込み)\n"
    "- cooking    (= 料理: 調理 / 食材処理 / 加熱 / 盛り付け)\n"
    "- studying   (= 勉強: 読書 / ノート / 計算 / 学習作業)\n"
    "- crafting   (= 工作: DIY / 手芸 / 修理 / 組み立て)\n"
    "- organizing (= 整理整頓: 物の片付け / 収納 / 分類)\n"
    "- meal_prep  (= 食事の支度: 配膳 / 食器並べ / 食卓準備)\n"
    "- other      (= 上記いずれにも該当しない or 活動が不明瞭)\n"
    "\n"
    "ユーザーは複数の JPEG フレームを送ります。 各フレームは時系列順にサンプリング\n"
    "されています。 各フレームに対して以下 4 基準を 0-5 (= 整数) で採点 + カテゴリを\n"
    "1 つ選択 + 短い行動説明文 (= 1 文程度、 30 字以内) を生成し、 JSON で返してください。\n"
    "\n"
    "4 基準:\n"
    "- task_activity (0-5): 何らかの目的的活動を遂行しているか。\n"
    "    0 = ぼーっとしている / 何もしていない、 3 = 部分的に活動、 5 = 明確に手作業中。\n"
    "- object_interaction (0-5): 手が物体を操作しているか。\n"
    "    0 = 何にも触れていない、 3 = 軽く触れている、 5 = 道具 / 対象物を能動的に操作。\n"
    "- authenticity (0-5): 本物の人間の手による実際の動作に見えるか。\n"
    "    0 = 明らかに偽造 / 画面の再撮影 / マネキン、 5 = 自然な人間の手と動作。\n"
    "- scene_match (0-5): 環境が活動と合致しているか。\n"
    "    0 = 不自然な状況、 5 = 典型的な家事 / 作業環境。\n"
    "\n"
    "出力 JSON 形式 (= JSON 以外の prose / markdown は禁止):\n"
    "{\n"
    '  "frames": [\n'
    "    {\n"
    '      "frame_idx": 0,\n'
    '      "task_activity": 4,\n'
    '      "object_interaction": 4,\n'
    '      "authenticity": 5,\n'
    '      "scene_match": 5,\n'
    '      "category": "cleaning",\n'
    '      "description": "床にモップをかけている"\n'
    "    },\n"
    "    ...\n"
    "  ]\n"
    "}\n"
    "\n"
    "frame_idx はユーザーが各画像と共に提示する番号をそのまま使ってください。\n"
    "category は必ず上記 8 値のいずれかを使用してください (= 未知値は禁止、 不明なら other)。"
)


# ─── フレームサンプリング + エンコード ─────────────────────────────────

def sample_and_encode_frames(
    video_path: str, vlm_interval_sec: float
) -> list[dict]:
    """cv2 で int(fps * vlm_interval_sec) 間隔でフレームをサンプリング、 1024px 幅に
    リサイズ + JPEG quality 70 で base64 エンコード。

    Returns:
      [{"frame_idx": int (= 0 起点)、 "ts_sec": float、 "b64": str}, ...]
    """
    import cv2  # type: ignore
    from PIL import Image  # type: ignore

    cap = cv2.VideoCapture(video_path)
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0.0 or total_frames <= 0:
            raise RuntimeError(
                f"invalid video metadata: fps={fps} total_frames={total_frames}"
            )

        # サンプリング間隔 (= フレーム単位)
        step = max(1, int(round(fps * vlm_interval_sec)))

        sampled: list[dict] = []
        sample_idx = 0
        # 短いサンプル MP4 (= step が total_frames を超える) でも先頭 1 枚を必ず取る
        for src_idx in range(0, total_frames, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, src_idx)
            ok, frame_bgr = cap.read()
            if not ok or frame_bgr is None:
                # 末尾近くで read 失敗することがある。 黙ってスキップ。
                continue

            # BGR → RGB
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            h, w = frame_rgb.shape[:2]
            if w > RESIZE_WIDTH:
                new_w = RESIZE_WIDTH
                new_h = int(round(h * (RESIZE_WIDTH / w)))
                frame_rgb = cv2.resize(
                    frame_rgb, (new_w, new_h), interpolation=cv2.INTER_AREA
                )

            # JPEG エンコード (= Pillow で quality 制御)
            pil_img = Image.fromarray(frame_rgb)
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=JPEG_QUALITY)
            b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")

            sampled.append(
                {
                    "frame_idx": sample_idx,
                    "ts_sec": src_idx / fps,
                    "b64": b64,
                }
            )
            sample_idx += 1
    finally:
        cap.release()

    if not sampled:
        raise RuntimeError(f"no frames sampled from {video_path}")
    return sampled


# ─── Claude Haiku 呼び出し ──────────────────────────────────────────

def call_claude_for_batch(client, batch: list[dict]) -> list[dict]:
    """1 バッチ (= 最大 MAX_FRAMES_PER_REQUEST 枚) を Claude Haiku に投げて
    per-frame スコア + カテゴリ + 説明文の list を返す。

    JSON parse 失敗時は空 list を返す (= caller でフォールバック扱い)。 stdout に
    warning を吐く。
    """
    content: list[dict] = []
    for fr in batch:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": fr["b64"],
                },
            }
        )
        content.append(
            {
                "type": "text",
                "text": f"[frame_idx={fr['frame_idx']} t={fr['ts_sec']:.2f}s]",
            }
        )
    content.append(
        {
            "type": "text",
            "text": (
                f"上記 {len(batch)} 枚のフレームを 4 基準で採点 + カテゴリ判定 + 行動説明文\n"
                "を生成して、 指定 JSON 形式で返してください。 JSON 以外の prose / markdown は\n"
                "出力しないでください。"
            ),
        }
    )

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        temperature=TEMPERATURE,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    raw_text = "".join(
        b.text for b in resp.content if getattr(b, "type", None) == "text"
    ).strip()

    # ```json ... ``` 包みを剥がす
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1] if "\n" in raw_text else raw_text
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
        raw_text = raw_text.strip()
    if raw_text.startswith("json"):
        raw_text = raw_text[4:].strip()

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(
            f"[layer3_vlm] WARNING: VLM JSON parse failed: {e}. "
            f"raw_text[:300]={raw_text[:300]!r}",
            file=sys.stdout,
            flush=True,
        )
        return []

    frames = parsed.get("frames", []) if isinstance(parsed, dict) else []
    if not isinstance(frames, list):
        print(
            "[layer3_vlm] WARNING: VLM JSON missing 'frames' list. "
            f"raw_text[:300]={raw_text[:300]!r}",
            file=sys.stdout,
            flush=True,
        )
        return []

    cleaned: list[dict] = []
    for entry in frames:
        if not isinstance(entry, dict):
            continue
        try:
            cat = str(entry.get("category", "")).strip().lower()
            if cat not in VALID_CATEGORIES:
                cat = FALLBACK_CATEGORY
            desc = str(entry.get("description", "")).strip()
            cleaned.append(
                {
                    "frame_idx": int(entry.get("frame_idx", -1)),
                    "task_activity": _clamp_0_5(entry.get("task_activity")),
                    "object_interaction": _clamp_0_5(entry.get("object_interaction")),
                    "authenticity": _clamp_0_5(entry.get("authenticity")),
                    "scene_match": _clamp_0_5(entry.get("scene_match")),
                    "category": cat,
                    "description": desc,
                }
            )
        except (TypeError, ValueError):
            continue

    return cleaned


def _clamp_0_5(v) -> float:
    """0-5 範囲に clamp。 None / 非数値は ValueError。"""
    if v is None:
        raise ValueError("missing score field")
    f = float(v)
    if f < 0.0:
        return 0.0
    if f > 5.0:
        return 5.0
    return f


# ─── スコア集計 + カテゴリ多数決 ──────────────────────────────────────

def aggregate_scores(
    per_frame: list[dict], frame_ts_map: dict[int, float]
) -> dict:
    """per-frame の 4 基準スコア + カテゴリ + 説明文を集約。

    per_frame: [{frame_idx, task_activity, object_interaction, authenticity,
                 scene_match, category, description}, ...]
    frame_ts_map: frame_idx → ts_sec の対応表 (= frameLabels に含める用)

    フォールバック条件: per_frame が空 → 全 metric 2.5、 idle_ratio 0.5、
                       category "other" 信頼度 0.0、 frameLabels 空。
    """
    if not per_frame:
        print(
            "[layer3_vlm] WARNING: no per-frame scores available, "
            "falling back to median metrics.",
            file=sys.stdout,
            flush=True,
        )
        return {
            "score": int(round(
                (FALLBACK_METRIC / 5.0) * (
                    WEIGHT_TASK_ACTIVITY + WEIGHT_OBJECT_INTERACTION
                    + WEIGHT_AUTHENTICITY + WEIGHT_SCENE_MATCH
                )
            )),
            "taskActivityAvg": FALLBACK_METRIC,
            "objectInteractionAvg": FALLBACK_METRIC,
            "authenticityAvg": FALLBACK_METRIC,
            "sceneMatchAvg": FALLBACK_METRIC,
            "idleRatio": FALLBACK_IDLE_RATIO,
            "autoCategory": FALLBACK_CATEGORY,
            "autoCategoryConfidence": 0.0,
            "frameLabels": [],
        }

    n = len(per_frame)
    task_activity_avg = sum(f["task_activity"] for f in per_frame) / n
    object_interaction_avg = sum(f["object_interaction"] for f in per_frame) / n
    authenticity_avg = sum(f["authenticity"] for f in per_frame) / n
    scene_match_avg = sum(f["scene_match"] for f in per_frame) / n
    idle_frames = sum(1 for f in per_frame if f["task_activity"] == 0)
    idle_ratio = idle_frames / n

    # 配点按分 (= 各基準の平均 / 5 × 配点)
    score_float = (
        (task_activity_avg / 5.0) * WEIGHT_TASK_ACTIVITY
        + (object_interaction_avg / 5.0) * WEIGHT_OBJECT_INTERACTION
        + (authenticity_avg / 5.0) * WEIGHT_AUTHENTICITY
        + (scene_match_avg / 5.0) * WEIGHT_SCENE_MATCH
    )
    # 四捨五入で整数化、 0..65 範囲に clamp
    score = int(round(score_float))
    if score < 0:
        score = 0
    if score > LAYER3_MAX_SCORE:
        score = LAYER3_MAX_SCORE

    # カテゴリ多数決 + 信頼度 (= 主カテゴリ占有率)
    cat_counter = Counter(f["category"] for f in per_frame)
    most_common_cat, most_common_count = cat_counter.most_common(1)[0]
    auto_category_confidence = most_common_count / n

    # frameLabels: Pipeline 3 のエピソードラベル集約で再利用
    frame_labels = [
        {
            "frameIdx": f["frame_idx"],
            "tsSec": round(frame_ts_map.get(f["frame_idx"], 0.0), 3),
            "category": f["category"],
            "description": f["description"],
        }
        for f in per_frame
    ]

    def _clamp(v: float) -> float:
        if v < 0.0:
            return 0.0
        if v > 5.0:
            return 5.0
        return v

    def _clamp01(v: float) -> float:
        if v < 0.0:
            return 0.0
        if v > 1.0:
            return 1.0
        return v

    return {
        "score": score,
        "taskActivityAvg": round(_clamp(task_activity_avg), 4),
        "objectInteractionAvg": round(_clamp(object_interaction_avg), 4),
        "authenticityAvg": round(_clamp(authenticity_avg), 4),
        "sceneMatchAvg": round(_clamp(scene_match_avg), 4),
        "idleRatio": round(_clamp01(idle_ratio), 4),
        "autoCategory": most_common_cat,
        "autoCategoryConfidence": round(_clamp01(auto_category_confidence), 4),
        "frameLabels": frame_labels,
    }


# ─── semantic.jsonl 書き出し (DATA_SPECS §3.3) ──────────────────────────

def _build_semantic_rows(frame_labels: list[dict], total_frames: int, fps: float) -> list[dict]:
    """sparse な frameLabels (= VLM サンプル点) を全フレームに展開する。
    各フレームは直近のサンプル点のラベルを継承する (= n〜n+step は同一ラベル)。"""
    if total_frames <= 0:
        return []
    pts = sorted(frame_labels, key=lambda x: x.get("frameIdx", 0))
    rows: list[dict] = []
    cur: dict | None = None
    pi = 0
    for i in range(total_frames):
        while pi < len(pts) and pts[pi].get("frameIdx", 0) <= i:
            cur = pts[pi]
            pi += 1
        rows.append({
            "frame_index": i,
            "ts_sec": round(i / fps, 4) if fps > 0 else 0.0,
            "category": (cur or {}).get("category", "other"),
            "description": (cur or {}).get("description", ""),
        })
    return rows


def _write_and_upload_semantic(
    s3, bucket_processed: str, signature_hash: str,
    frame_labels: list[dict], total_frames: int, fps: float, work_dir: str,
) -> str:
    """semantic.jsonl を組み立てて processed/<signature_hash>/semantic.jsonl に upload。
    1 行目はヘッダー (= モデル名 / fps / total_frames)、 2 行目以降が全フレーム分のラベル。"""
    rows = _build_semantic_rows(frame_labels, total_frames, fps)
    path = f"{work_dir}/semantic.jsonl"
    with open(path, "w") as f:
        f.write(json.dumps({
            "model": CLAUDE_MODEL,
            "signature_hash": signature_hash,
            "fps": fps,
            "total_frames": total_frames,
            "fields": ["frame_index", "ts_sec", "category", "description"],
        }) + "\n")
        for r in rows:
            f.write(json.dumps(r) + "\n")
    key = f"processed/{signature_hash}/semantic.jsonl"
    s3.upload_file(path, bucket_processed, key, ExtraArgs={"ContentType": "application/x-ndjson"})
    return key


def _write_quality_scores(
    s3, bucket_processed: str, signature_hash: str,
    prior_scores_json: str, layer3_result: dict,
) -> str:
    """processed/<signature_hash>/quality_scores.json を書き出す (DATA_SPECS §3.3)。
    DB の quality_breakdown と同じ「総合スコア + 全サブ指標」のバックアップ。
    prior_scores_json は workflow が渡す {"layer1": Layer1Score, "layer2": Layer2Score} (= JSON 文字列)。
    layer3 は frameLabels を除いた score + サブ指標のみ載せる (= フレームラベルは semantic.jsonl にある)。"""
    prior = json.loads(prior_scores_json)
    l1 = prior["layer1"]
    l2 = prior["layer2"]
    layer3 = {k: v for k, v in layer3_result.items() if k != "frameLabels"}
    total = int(round(
        float(l1.get("score", 0)) + float(l2.get("score", 0)) + float(layer3_result.get("score", 0))
    ))
    doc = {"total": total, "layer1": l1, "layer2": l2, "layer3": layer3}
    key = f"processed/{signature_hash}/quality_scores.json"
    s3.put_object(
        Bucket=bucket_processed, Key=key,
        Body=json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return key


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    cpu=2.0,
    memory=1024,
    timeout=600,
    secrets=[
        modal.Secret.from_name("r2-creds"),
        modal.Secret.from_name("anthropic-api-key"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def score_layer3(
    signature_hash: str,
    vlm_interval_sec: float = 30.0,
    prior_scores: str = "",
):
    """
    Pipeline 2 第 3 層 (= VLM セマンティック解析 + 自動分類) のエントリポイント。

    Args (query string):
        signature_hash:       生データ R2 prefix 末尾 (= raw/<signature_hash>/rgb.mp4)
        vlm_interval_sec: フレームサンプリング間隔 (= 既定 30 秒、 30 分動画で
                          ~60 フレーム → 1 クリップ ~$0.20)

    Returns:
        camelCase JSON: {
          score, taskActivityAvg, objectInteractionAvg, authenticityAvg,
          sceneMatchAvg, idleRatio, autoCategory, autoCategoryConfidence,
          frameLabels
        }
    """
    import boto3  # type: ignore
    from anthropic import Anthropic  # type: ignore

    t_start = time.time()

    # fail-loud: ANTHROPIC_API_KEY が無ければ即時失敗 (= 黙ってモック値を返さない)
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set on this Modal environment. "
            "Set the 'anthropic-api-key' Modal Secret with ANTHROPIC_API_KEY=<key>."
        )

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")
    bucket_processed = os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # 1. R2 から rgb.mp4 を download
    work_dir = "/tmp/layer3_work"
    os.makedirs(work_dir, exist_ok=True)
    rgb_path = f"{work_dir}/{signature_hash}_rgb.mp4"
    key = f"raw/{signature_hash}/rgb.mp4"
    s3.download_file(bucket_raw, key, rgb_path)

    # 2. フレームサンプリング + JPEG エンコード
    sampled = sample_and_encode_frames(rgb_path, vlm_interval_sec)
    total_sampled = len(sampled)
    frame_ts_map = {fr["frame_idx"]: fr["ts_sec"] for fr in sampled}
    print(
        f"[layer3_vlm] sampled {total_sampled} frames "
        f"(interval={vlm_interval_sec}s) for signature_hash={signature_hash}",
        flush=True,
    )

    # 3. Claude Haiku で N=16 バッチで採点 + 分類
    client = Anthropic(api_key=anthropic_key)
    per_frame_all: list[dict] = []
    for i in range(0, total_sampled, MAX_FRAMES_PER_REQUEST):
        batch = sampled[i : i + MAX_FRAMES_PER_REQUEST]
        t_batch = time.time()
        try:
            per_frame = call_claude_for_batch(client, batch)
        except Exception as e:
            # 1 バッチが転んでも他バッチで継続する (= 部分的成功)。 全バッチが転んだら
            # per_frame_all が空のまま aggregate_scores 側でフォールバックに落ちる。
            print(
                f"[layer3_vlm] WARNING: batch {i // MAX_FRAMES_PER_REQUEST} "
                f"failed: {type(e).__name__}: {e}",
                flush=True,
            )
            per_frame = []
        print(
            f"[layer3_vlm] batch {i // MAX_FRAMES_PER_REQUEST}: "
            f"{len(batch)} frames sent → {len(per_frame)} scored "
            f"({time.time() - t_batch:.1f}s)",
            flush=True,
        )
        per_frame_all.extend(per_frame)

    # 4. 集計
    result = aggregate_scores(per_frame_all, frame_ts_map)

    # 5. semantic.jsonl を processed/<signature_hash>/ に書き出す (= DATA_SPECS §3.3)。
    #    scoring は成功しているので、 書き出し失敗で全体を落とさず warning に留める。
    try:
        import cv2  # type: ignore
        _cap = cv2.VideoCapture(rgb_path)
        _total = int(_cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        _fps = float(_cap.get(cv2.CAP_PROP_FPS) or 0.0)
        _cap.release()
        sem_key = _write_and_upload_semantic(
            s3, bucket_processed, signature_hash,
            result.get("frameLabels", []), _total, _fps, work_dir,
        )
        print(f"[layer3_vlm] wrote {sem_key} ({_total} frames)", flush=True)
    except Exception as e:
        print(
            f"[layer3_vlm] WARNING: semantic.jsonl write failed: {type(e).__name__}: {e}",
            flush=True,
        )

    # 6. quality_scores.json を processed/ に書き出す (= DATA_SPECS §3.3、 DB のバックアップ)。
    #    workflow が layer1 + layer2 のスコアを prior_scores で渡してきた場合のみ。
    if prior_scores:
        try:
            q_key = _write_quality_scores(s3, bucket_processed, signature_hash, prior_scores, result)
            print(f"[layer3_vlm] wrote {q_key}", flush=True)
        except Exception as e:
            print(
                f"[layer3_vlm] WARNING: quality_scores.json write failed: {type(e).__name__}: {e}",
                flush=True,
            )

    # 後片付け (= MP4 を消す。 同 container 再利用で /tmp が太るのを避ける)
    try:
        os.remove(rgb_path)
    except OSError:
        pass

    print(
        f"[layer3_vlm] done signature_hash={signature_hash} "
        f"score={result['score']}/{LAYER3_MAX_SCORE} "
        f"category={result['autoCategory']} ({result['autoCategoryConfidence']:.2f}) "
        f"elapsed={time.time() - t_start:.1f}s",
        flush=True,
    )
    return result


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print(
        "Modal app rootlens-layer3-vlm defined. "
        "Deploy with `modal deploy tools/modal/layer3_vlm.py`."
    )
