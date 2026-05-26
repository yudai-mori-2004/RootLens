"""
RootLens v0.1.3 Pipeline 2 第 3 層 (= VLM セマンティック解析、 55 点) を Modal の
CPU 関数として実装。

入力: content_id + task_id + vlm_interval_sec (= 既定 30s)
処理:
  1. R2 から raw/<content_id>/rgb.mp4 を download
  2. cv2 で int(fps * vlm_interval_sec) フレーム間隔でサンプリング、 1024px 幅に
     リサイズ + JPEG quality 70 で base64 エンコード
  3. Claude Haiku 4.5 (= claude-haiku-4-5) の messages API に N=16 枚バッチで送信、
     N を超えたら複数リクエストに分割
  4. 各フレームの 4 基準 (task_activity / object_interaction / authenticity /
     scene_match) を 0-5 で採点 → 全フレーム平均 → 配点で按分 (= 20 / 15 / 10 / 10)
  5. task_activity == 0 のフレーム割合を idle_ratio として算出
出力 JSON (= camelCase):
  {score: 0..55 整数, taskActivityAvg, objectInteractionAvg, authenticityAvg,
   sceneMatchAvg, idleRatio}

冪等性: VLM 呼び出しは非決定的 (= temperature > 0)。 スコアは再採点時に微小変動
しうる。 同一 content_id での再呼び出し抑止は Pipeline 2 orchestrator 側で扱う。

詳細: document/v0.1.3/tasks/06-pipeline-2-layer-3-vlm/README.md 参照。
"""

import base64
import io
import json
import os
import sys
import time

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

# 配点 (= DATA_SPECS_JA.md §3.2.4 第 3 層内訳)
WEIGHT_TASK_ACTIVITY = 20
WEIGHT_OBJECT_INTERACTION = 15
WEIGHT_AUTHENTICITY = 10
WEIGHT_SCENE_MATCH = 10
LAYER3_MAX_SCORE = (
    WEIGHT_TASK_ACTIVITY
    + WEIGHT_OBJECT_INTERACTION
    + WEIGHT_AUTHENTICITY
    + WEIGHT_SCENE_MATCH
)  # = 55

# フォールバック中央値 (= 各 metric を 2.5、 idle_ratio を 0.5 にして fail-soft で進む)
FALLBACK_METRIC = 2.5
FALLBACK_IDLE_RATIO = 0.5


# ─── タスク定義 (= hard-coded、 本フェーズでは 1-2 タスクで十分) ─────────

# 後続フェーズでタスクカタログとして DB に展開する。 現段階では README の例 (= dishes)
# + generic を定義する。 未知 task_id は generic にフォールバック。
TASK_CATALOG: dict[str, dict[str, str]] = {
    "dishes": {
        "name": "シンクで食器を洗う",
        "start_condition": "シンクの前に立ち、 洗う対象の食器が視界に入っている。",
        "end_condition": "全ての食器が洗い終わり、 水切りカゴまたは乾燥棚に置かれている。",
        "scene_description": (
            "家庭のキッチンのシンク周辺。 蛇口、 水、 スポンジ、 洗剤、 皿 / コップ / "
            "カトラリー等の食器、 水切りカゴが映ることが多い。"
        ),
    },
    "generic": {
        "name": "家庭内の日常タスク",
        "start_condition": "撮影者が何らかの家庭内タスクを開始している。",
        "end_condition": "そのタスクが完了している。",
        "scene_description": "家庭内 (= キッチン / リビング / 浴室 / 寝室 等) の典型的な環境。",
    },
}


def get_task_definition(task_id: str) -> dict[str, str]:
    """task_id に対応するタスク定義を返す。 未知なら generic にフォールバック。"""
    return TASK_CATALOG.get(task_id, TASK_CATALOG["generic"])


# ─── システムプロンプト ─────────────────────────────────────────────

def build_system_prompt(task_id: str) -> str:
    """タスク定義を埋め込んだ system prompt を生成。"""
    td = get_task_definition(task_id)
    return (
        "あなたは一人称視点 (= エゴセントリック) のタスク遂行映像を評価する評価者です。\n"
        "\n"
        f"評価対象タスク: 「{td['name']}」 (task_id={task_id})\n"
        f"- 開始条件: {td['start_condition']}\n"
        f"- 終了条件: {td['end_condition']}\n"
        f"- 典型的な環境: {td['scene_description']}\n"
        "\n"
        "ユーザーは複数の JPEG フレームを送ります。 各フレームは時系列順にサンプリング\n"
        "されています。 各フレームに対して以下 4 基準を 0-5 (= 整数) で採点し、 短い\n"
        "根拠テキスト (= 1 文程度) を添えて JSON で返してください。\n"
        "\n"
        "4 基準:\n"
        "- task_activity (0-5): タスクに関連する動作を行っているか。\n"
        "    0 = 完全に無関係、 3 = 部分的に関連、 5 = タスクを明確に遂行中。\n"
        "- object_interaction (0-5): 手が物体を操作しているか。\n"
        "    0 = 何にも触れていない、 3 = 軽く触れている、 5 = 道具 / 対象物を能動的に操作。\n"
        "- authenticity (0-5): 本物の人間の手による実際の動作に見えるか。\n"
        "    0 = 明らかに偽造 / 画面の再撮影 / マネキン、 5 = 自然な人間の手と動作。\n"
        "- scene_match (0-5): 環境がタスクに適合しているか。\n"
        "    0 = 完全に不一致 (= 例: 「洗い物」 タスクで草原)、 5 = 典型的な環境。\n"
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
        '      "rationale": "右手がスポンジを持ち皿をこすっている"\n'
        "    },\n"
        "    ...\n"
        "  ]\n"
        "}\n"
        "\n"
        "frame_idx はユーザーが各画像と共に提示する番号をそのまま使ってください。"
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
        # 5 秒サンプル MP4 (= step が total_frames を超える) でも先頭 1 枚を必ず取る
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

def call_claude_for_batch(
    client, system_prompt: str, batch: list[dict]
) -> list[dict]:
    """1 バッチ (= 最大 MAX_FRAMES_PER_REQUEST 枚) を Claude Haiku に投げて
    per-frame スコアの list を返す。

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
                f"上記 {len(batch)} 枚のフレームを 4 基準で採点し、 指定 JSON 形式で\n"
                "返してください。 JSON 以外の prose / markdown は出力しないでください。"
            ),
        }
    )

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        temperature=TEMPERATURE,
        system=system_prompt,
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
            cleaned.append(
                {
                    "frame_idx": int(entry.get("frame_idx", -1)),
                    "task_activity": _clamp_0_5(entry.get("task_activity")),
                    "object_interaction": _clamp_0_5(
                        entry.get("object_interaction")
                    ),
                    "authenticity": _clamp_0_5(entry.get("authenticity")),
                    "scene_match": _clamp_0_5(entry.get("scene_match")),
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


# ─── スコア集計 ─────────────────────────────────────────────────────

def aggregate_scores(per_frame: list[dict], total_sampled: int) -> dict:
    """per-frame の 4 基準スコア list を平均 + 配点按分 + idle_ratio に集約。

    per_frame: [{frame_idx, task_activity, object_interaction, authenticity, scene_match}, ...]
    total_sampled: cv2 でサンプリングしたフレーム総数 (= VLM が一部 frame を落として
                   返した場合の分母として使う)。

    フォールバック条件: per_frame が空 → 全 metric 2.5、 idle_ratio 0.5。
    """
    if not per_frame:
        print(
            "[layer3_vlm] WARNING: no per-frame scores available, "
            "falling back to median metrics.",
            file=sys.stdout,
            flush=True,
        )
        task_activity_avg = FALLBACK_METRIC
        object_interaction_avg = FALLBACK_METRIC
        authenticity_avg = FALLBACK_METRIC
        scene_match_avg = FALLBACK_METRIC
        idle_ratio = FALLBACK_IDLE_RATIO
    else:
        n = len(per_frame)
        task_activity_avg = sum(f["task_activity"] for f in per_frame) / n
        object_interaction_avg = (
            sum(f["object_interaction"] for f in per_frame) / n
        )
        authenticity_avg = sum(f["authenticity"] for f in per_frame) / n
        scene_match_avg = sum(f["scene_match"] for f in per_frame) / n
        # idle_ratio は cv2 サンプリング側の分母を使う (= VLM が落としたフレームは
        # 「不明」 なので idle 扱いせず分子からも分母からも除外、 という選択肢も
        # あるが、 ここでは VLM の返した frame 集合のみで計算する。 total_sampled
        # との乖離はメトリクス検査で別途見る。)
        idle_frames = sum(1 for f in per_frame if f["task_activity"] == 0)
        idle_ratio = idle_frames / n if n > 0 else FALLBACK_IDLE_RATIO

    # 配点按分 (= 各基準の平均 / 5 × 配点)
    score_float = (
        (task_activity_avg / 5.0) * WEIGHT_TASK_ACTIVITY
        + (object_interaction_avg / 5.0) * WEIGHT_OBJECT_INTERACTION
        + (authenticity_avg / 5.0) * WEIGHT_AUTHENTICITY
        + (scene_match_avg / 5.0) * WEIGHT_SCENE_MATCH
    )
    # 四捨五入で整数化、 0..55 範囲に clamp
    score = int(round(score_float))
    if score < 0:
        score = 0
    if score > LAYER3_MAX_SCORE:
        score = LAYER3_MAX_SCORE

    # 平均値は 0..5 範囲に clamp (= 念のため)
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
    }


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
    content_id: str,
    task_id: str,
    vlm_interval_sec: float = 30.0,
):
    """
    Pipeline 2 第 3 層 (= VLM セマンティック解析) のエントリポイント。

    Args (query string):
        content_id:       生データ R2 prefix 末尾 (= raw/<content_id>/rgb.mp4)
        task_id:          評価対象タスクの ID (= 例: "dishes"、 未知なら generic)
        vlm_interval_sec: フレームサンプリング間隔 (= 既定 30 秒、 30 分動画で
                          ~60 フレーム → 1 クリップ ~$0.18)
    Returns:
        camelCase JSON: {score, taskActivityAvg, objectInteractionAvg,
                         authenticityAvg, sceneMatchAvg, idleRatio}
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
    rgb_path = f"{work_dir}/{content_id}_rgb.mp4"
    key = f"raw/{content_id}/rgb.mp4"
    s3.download_file(bucket_raw, key, rgb_path)

    # 2. フレームサンプリング + JPEG エンコード
    sampled = sample_and_encode_frames(rgb_path, vlm_interval_sec)
    total_sampled = len(sampled)
    print(
        f"[layer3_vlm] sampled {total_sampled} frames "
        f"(interval={vlm_interval_sec}s) for content_id={content_id}",
        flush=True,
    )

    # 3. Claude Haiku で N=16 バッチで採点
    client = Anthropic(api_key=anthropic_key)
    system_prompt = build_system_prompt(task_id)
    per_frame_all: list[dict] = []
    for i in range(0, total_sampled, MAX_FRAMES_PER_REQUEST):
        batch = sampled[i : i + MAX_FRAMES_PER_REQUEST]
        t_batch = time.time()
        try:
            per_frame = call_claude_for_batch(client, system_prompt, batch)
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
    result = aggregate_scores(per_frame_all, total_sampled)

    # 後片付け (= MP4 を消す。 同 container 再利用で /tmp が太るのを避ける)
    try:
        os.remove(rgb_path)
    except OSError:
        pass

    print(
        f"[layer3_vlm] done content_id={content_id} task_id={task_id} "
        f"score={result['score']}/{LAYER3_MAX_SCORE} "
        f"elapsed={time.time() - t_start:.1f}s",
        flush=True,
    )
    return result


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print(
        "Modal app rootlens-layer3-vlm defined. "
        "Deploy with `modal deploy v0.1.3/server/modal/layer3_vlm.py`."
    )
