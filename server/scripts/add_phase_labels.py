"""
既存 LeRobot v3 dataset の各 episode に対し、 VLM (= Claude Haiku) を使って
phase 単位の自然言語ナレーションを生成し、 dataset に焼き直す後処理スクリプト。

入力: build_lp_sample.py が出した dataset (= web/public/lp/sample/dataset/)
処理:
  1. 各 episode 動画から 3 秒間隔で frame を抽出 (= ffmpeg)
  2. Claude Haiku 4.5 に渡して (start_sec, end_sec, phase_text) のリストを生成
  3. meta/tasks.jsonl に既存 task + 各 phase 文を統合登録 (= dedupe)
  4. data parquet の task_index を frame ごとに「現在の phase」 へ書き換え
  5. meta/episodes/.../tasks 列を episode に含まれる全 phase 文の list に更新
  6. meta/info.json::rootlens に phase_labeler を追記

「LeRobot に合わせるナレーション形式」 = tasks.jsonl + task_index の枠内で表現
(= DATASET_CARD.md 「Phase labels」 セクション参照)。

使い方:
  python server/scripts/add_phase_labels.py
    --dataset-dir web/public/lp/sample/dataset

env: ANTHROPIC_API_KEY (= web/.env から自動 load)
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from anthropic import Anthropic
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET_DIR = REPO_ROOT / "web" / "public" / "lp" / "sample" / "dataset"

# Claude Haiku 4.5 で 1 episode あたり ~ 10 frame、 phase 3-8 個生成 = ~$0.005/episode 程度
CLAUDE_MODEL = "claude-haiku-4-5"
FRAME_INTERVAL_SEC = 3.0  # 抽出間隔
MAX_FRAMES_PER_REQUEST = 16  # Claude に同時に送る最大画像数 (= 短い episode は密、 長いは疎)
TEMPERATURE = 0.0  # 再現性目的


def load_env() -> str:
    """ANTHROPIC_API_KEY を web/.env から取得 (= 既存配置に合わせる)。
    override=True で shell に空文字の ANTHROPIC_API_KEY が居る場合も上書き。"""
    web_env = REPO_ROOT / "web" / ".env"
    load_dotenv(web_env, override=True)
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("ANTHROPIC_API_KEY not set. web/.env か環境変数で渡してください。")
    return key


# ─── frame 抽出 ────────────────────────────────────────────────────────

def extract_frames(video_path: Path, out_dir: Path, interval_sec: float, max_frames: int) -> list[dict]:
    """ffmpeg で動画から interval_sec ごとに 1 frame を JPEG で抽出。
    max_frames を超える場合は間隔を伸ばして上限に収める。
    戻り値: [{"path": Path, "ts_sec": float}, ...]
    """
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip())

    # interval を上限に合わせて伸ばす (= max_frames 制約)
    est_frames = int(duration / interval_sec) + 1
    if est_frames > max_frames:
        interval_sec = duration / max_frames

    out_dir.mkdir(parents=True, exist_ok=True)
    out_pattern = out_dir / "frame_%04d.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-i", str(video_path),
         "-vf", f"fps=1/{interval_sec}",
         "-q:v", "5",
         str(out_pattern)],
        check=True,
    )

    frames = sorted(out_dir.glob("frame_*.jpg"))
    return [
        {"path": f, "ts_sec": i * interval_sec}
        for i, f in enumerate(frames)
    ]


# ─── Claude にナレーション要求 ──────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a video understanding assistant labeling first-person (egocentric) "
    "household-task videos for a robotics dataset.\n"
    "\n"
    "You will receive a few JPEG frames sampled at uniform intervals from a single "
    "short clip, along with the timestamp (in seconds) of each frame. Your job is to "
    "segment the clip into 3-8 semantically distinct phases of the action and "
    "describe each phase in a single short English sentence in the present tense, "
    "in the style of Ego4D narrations.\n"
    "\n"
    "Phase rules:\n"
    "- Each phase covers a contiguous time range. Phases together cover the whole clip "
    "  from 0.0 to the last frame timestamp (= no gaps, no overlap).\n"
    "- Phase boundaries should fall on semantic transitions (e.g. when the hand starts "
    "  to reach for a new object, when an object is grasped, when an object is released, etc.).\n"
    "- Phase text describes what is physically happening from the wearer's point of view, "
    "  focusing on hand actions and objects (e.g. \"Right hand reaches for the kettle handle.\", "
    "  \"Both hands pour tea into the cup.\", \"Right hand sets the kettle back on the counter.\").\n"
    "- Use literal observable actions, no inferred intentions, no aesthetic judgments.\n"
    "\n"
    "Output JSON only, no prose, no markdown:\n"
    "{\n"
    "  \"phases\": [\n"
    "    {\"start_time_sec\": 0.0, \"end_time_sec\": 1.5, \"phase_text\": \"...\"},\n"
    "    ...\n"
    "  ]\n"
    "}"
)


def claude_segment(client: Anthropic, task_hint: str, frames: list[dict]) -> list[dict]:
    """Claude に frame list を投げて phase segmentation を返してもらう。
    frames: [{path, ts_sec}, ...]
    戻り値: [{"start_time_sec": float, "end_time_sec": float, "phase_text": str}, ...]
    """
    content = []
    for fr in frames:
        with open(fr["path"], "rb") as f:
            b64 = base64.standard_b64encode(f.read()).decode("ascii")
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
        })
        content.append({
            "type": "text",
            "text": f"[frame at t={fr['ts_sec']:.2f}s]",
        })
    content.append({
        "type": "text",
        "text": (
            f"Episode-level task hint (from the contributor): \"{task_hint}\"\n\n"
            f"The total clip length is approximately {frames[-1]['ts_sec']:.2f} seconds.\n"
            "Return JSON only as specified."
        ),
    })

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        temperature=TEMPERATURE,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    raw_text = "".join(b.text for b in resp.content if b.type == "text").strip()

    # JSON parse (= モデルが ```json で囲った場合の剥がし)
    if raw_text.startswith("```"):
        # 最初の改行までを捨て、 末尾の ``` も捨てる
        raw_text = raw_text.split("\n", 1)[1] if "\n" in raw_text else raw_text
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
        raw_text = raw_text.strip()
    if raw_text.startswith("json"):
        raw_text = raw_text[4:].strip()

    parsed = json.loads(raw_text)
    phases = parsed.get("phases", [])
    if not isinstance(phases, list) or not phases:
        raise RuntimeError(f"VLM returned no phases. raw={raw_text[:200]}")
    out = []
    for p in phases:
        try:
            out.append({
                "start_time_sec": float(p["start_time_sec"]),
                "end_time_sec": float(p["end_time_sec"]),
                "phase_text": str(p["phase_text"]).strip(),
            })
        except (KeyError, TypeError, ValueError) as e:
            raise RuntimeError(f"phase entry missing required fields: {p} ({e})")
    return out


# ─── 1 episode 処理 ────────────────────────────────────────────────────

def label_one_episode(
    client: Anthropic,
    ep_idx: int,
    video_path: Path,
    task_hint: str,
    fps: float,
    nb_frames: int,
) -> dict:
    """1 episode について phase segmentation を返す。
    戻り値:
      {
        "episode_index": int,
        "phases": [{start_time_sec, end_time_sec, phase_text}, ...],
        "frame_to_phase_text": [phase_text per frame_index] (= nb_frames 件)
      }
    """
    with tempfile.TemporaryDirectory(prefix=f"phase_ep{ep_idx:03d}_") as td:
        frames = extract_frames(video_path, Path(td), FRAME_INTERVAL_SEC, MAX_FRAMES_PER_REQUEST)
        if not frames:
            raise RuntimeError(f"no frames extracted from {video_path}")
        t0 = time.time()
        phases = claude_segment(client, task_hint, frames)
        print(f"[ep{ep_idx:03d}] {len(phases)} phases, elapsed={time.time() - t0:.1f}s")

    # frame_index → phase_text マッピングを構築
    # phases の time range をフレーム index に対応付け
    frame_to_phase: list[str] = [""] * nb_frames
    for fi in range(nb_frames):
        ts = fi / fps
        chosen = phases[0]["phase_text"]  # 最初の phase をデフォルト
        for ph in phases:
            if ph["start_time_sec"] <= ts < ph["end_time_sec"]:
                chosen = ph["phase_text"]
                break
        else:
            # 末尾 frame は end_time_sec >= ts の最後の phase
            for ph in reversed(phases):
                if ph["start_time_sec"] <= ts:
                    chosen = ph["phase_text"]
                    break
        frame_to_phase[fi] = chosen

    return {
        "episode_index": ep_idx,
        "phases": phases,
        "frame_to_phase_text": frame_to_phase,
    }


# ─── dataset 全体への適用 ──────────────────────────────────────────────

def apply_phase_labels(dataset_dir: Path, concurrency: int) -> None:
    api_key = load_env()
    client = Anthropic(api_key=api_key)

    info_path = dataset_dir / "meta" / "info.json"
    if not info_path.exists():
        sys.exit(f"info.json not found: {info_path}")
    info = json.loads(info_path.read_text())
    fps = float(info["fps"])
    total_episodes = int(info["total_episodes"])

    # 既存 tasks.jsonl を読み (= contributor が付けた episode-level task)
    tasks_path = dataset_dir / "meta" / "tasks.jsonl"
    existing_tasks: list[dict] = []
    with open(tasks_path) as f:
        for line in f:
            if line.strip():
                existing_tasks.append(json.loads(line))

    # 既存 episodes parquet を読んで episode → episode-level task name の対応を取る
    episodes_pq_path = dataset_dir / "meta" / "episodes" / "chunk-000" / "file-000.parquet"
    episodes_table = pq.read_table(episodes_pq_path).to_pydict()
    episode_task_hint: dict[int, str] = {}
    episode_length: dict[int, int] = {}
    for ei, ep_idx in enumerate(episodes_table["episode_index"]):
        ep_idx = int(ep_idx)
        tasks_list = episodes_table["tasks"][ei]
        episode_task_hint[ep_idx] = tasks_list[0] if tasks_list else ""
        episode_length[ep_idx] = int(episodes_table["length"][ei])

    # 各 episode の video を Claude に投げて phase segmentation 取得
    print(f"labeling {total_episodes} episodes with {CLAUDE_MODEL} (concurrency={concurrency}) ...")

    def worker(ep_idx: int) -> dict:
        video_path = (
            dataset_dir / "videos" / "observation.images.ego_cam" / "chunk-000"
            / f"episode_{ep_idx:03d}.mp4"
        )
        if not video_path.exists():
            raise FileNotFoundError(f"episode video missing: {video_path}")
        return label_one_episode(
            client, ep_idx, video_path,
            episode_task_hint.get(ep_idx, ""),
            fps,
            episode_length[ep_idx],
        )

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(worker, ep): ep for ep in range(total_episodes)}
        for fut in as_completed(futures):
            ep = futures[fut]
            try:
                results.append(fut.result())
            except Exception as e:
                print(f"[ep{ep:03d}] FAILED: {e}", file=sys.stderr)
                raise
    results.sort(key=lambda r: r["episode_index"])

    # ─── tasks.jsonl 再構築 (= phase 文のみ。episode-level タスクはフレームから参照されないので含めない) ───
    all_phase_texts: list[str] = []
    seen: set[str] = set()
    for res in results:
        for ph in res["phases"]:
            s = ph["phase_text"]
            if s not in seen:
                seen.add(s)
                all_phase_texts.append(s)

    text_to_index: dict[str, int] = {s: i for i, s in enumerate(all_phase_texts)}

    # ─── data parquet を読んで task_index を frame ごとに書き換え ───
    data_pq_path = dataset_dir / "data" / "chunk-000" / "file-000.parquet"
    data_table = pq.read_table(data_pq_path).to_pydict()
    new_task_index: list[int] = []
    for global_idx, ep_idx in enumerate(data_table["episode_index"]):
        ep_idx = int(ep_idx)
        fi = int(data_table["frame_index"][global_idx])
        # results は episode_index 順に並んでいる
        res = results[ep_idx]
        phase_text = res["frame_to_phase_text"][fi] if fi < len(res["frame_to_phase_text"]) else res["frame_to_phase_text"][-1]
        new_task_index.append(text_to_index[phase_text])
    data_table["task_index"] = new_task_index

    # ─── episodes parquet の tasks 列を episode の全 phase 文 list で更新 ───
    new_episode_tasks: list[list[str]] = []
    for ei, ep_idx in enumerate(episodes_table["episode_index"]):
        ep_idx = int(ep_idx)
        res = results[ep_idx]
        ep_strings: list[str] = []
        ep_seen: set[str] = set()
        for ph in res["phases"]:
            if ph["phase_text"] not in ep_seen:
                ep_seen.add(ph["phase_text"])
                ep_strings.append(ph["phase_text"])
        new_episode_tasks.append(ep_strings)
    episodes_table["tasks"] = new_episode_tasks

    # ─── ファイル書き戻し ───
    # tasks.jsonl
    with open(tasks_path, "w") as f:
        for i, s in enumerate(all_phase_texts):
            f.write(json.dumps({"task_index": i, "task": s}) + "\n")

    # tasks.parquet (lerobot v0.5 expects parquet)
    import pandas as pd
    tasks_df = pd.DataFrame({"task": all_phase_texts})
    tasks_df.index.name = "task_index"
    tasks_df.to_parquet(dataset_dir / "meta" / "tasks.parquet")

    # data parquet (schema 維持しつつ task_index 列だけ書き換え)
    orig_schema = pq.read_schema(data_pq_path)
    new_arrays = []
    for field in orig_schema:
        if field.name == "task_index":
            new_arrays.append(pa.array(data_table["task_index"], type=pa.int64()))
        else:
            new_arrays.append(pa.array(data_table[field.name], type=field.type))
    new_data_table = pa.Table.from_arrays(new_arrays, schema=orig_schema)
    pq.write_table(new_data_table, data_pq_path)

    # episodes parquet (schema 維持しつつ tasks 列だけ書き換え)
    orig_ep_schema = pq.read_schema(episodes_pq_path)
    new_ep_arrays = []
    for field in orig_ep_schema:
        if field.name == "tasks":
            new_ep_arrays.append(pa.array(episodes_table["tasks"], type=pa.list_(pa.string())))
        else:
            new_ep_arrays.append(pa.array(episodes_table[field.name], type=field.type))
    new_ep_table = pa.Table.from_arrays(new_ep_arrays, schema=orig_ep_schema)
    pq.write_table(new_ep_table, episodes_pq_path)

    # info.json に phase_labeler + total_tasks 更新
    info["total_tasks"] = len(all_phase_texts)
    info["rootlens"]["phase_labeler"] = CLAUDE_MODEL
    with open(info_path, "w") as f:
        json.dump(info, f, indent=2)

    print(f"\ndone. tasks.jsonl now has {len(all_phase_texts)} phase-level entries.")


# ─── main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    if not args.dataset_dir.exists():
        sys.exit(f"dataset not found: {args.dataset_dir}")

    apply_phase_labels(args.dataset_dir, args.concurrency)


if __name__ == "__main__":
    main()
