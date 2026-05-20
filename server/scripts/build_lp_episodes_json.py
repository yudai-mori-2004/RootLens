"""
LP /sample ページが表示する episode + phase の一覧を 1 つの JSON にまとめる。

抽出元:
  web/public/lp/sample/dataset/  (= build_lp_sample.py + add_phase_labels.py の出力)
    meta/info.json           → fps
    meta/tasks.jsonl         → task_index → 自然文ラベル
    meta/episodes/.../parquet → episode の length + tasks + video_id + category + region
    data/.../parquet         → 各 frame の (episode_index, frame_index, task_index)
                               → episode 内で task_index が切り替わる frame を phase boundary に

出力: web/public/lp/sample/json/dataset_episodes.json
  {
    "fps": 30.0,
    "total_episodes": 48,
    "episodes": [
      {
        "index": 0,
        "video_id": "sample_0001",
        "category": "kitchen",
        "region": "Japan",
        "duration_sec": 16.8,
        "length_frames": 504,
        "task": "pour tea into a cup",
        "phases": [
          {"start_sec": 0.00, "end_sec": 2.50, "text": "Right hand reaches for ..."},
          ...
        ]
      },
      ...
    ]
  }

LP の Server Component が build 時に fs で読み込んで全 48 episode を render する。
"""
import json
from pathlib import Path

import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]
DS = REPO / "web" / "public" / "lp" / "sample" / "dataset"
OUT = REPO / "web" / "public" / "lp" / "sample" / "json" / "dataset_episodes.json"


def main():
    info = json.loads((DS / "meta" / "info.json").read_text())
    fps = float(info["fps"])

    # tasks.jsonl: task_index → text
    tasks: dict[int, str] = {}
    with open(DS / "meta" / "tasks.jsonl") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            tasks[int(obj["task_index"])] = str(obj["task"])

    # episodes parquet: episode_index, length, tasks, video_id, category, region
    ep_pq = pq.read_table(DS / "meta" / "episodes" / "chunk-000" / "file-000.parquet").to_pydict()

    # data parquet: per-frame task_index (= 現在 phase の参照)
    data_pq = pq.read_table(DS / "data" / "chunk-000" / "file-000.parquet").to_pydict()

    # episode_index → list of (frame_index, task_index) in order
    by_ep: dict[int, list[tuple[int, int]]] = {}
    for i in range(len(data_pq["episode_index"])):
        ep = int(data_pq["episode_index"][i])
        fi = int(data_pq["frame_index"][i])
        ti = int(data_pq["task_index"][i])
        by_ep.setdefault(ep, []).append((fi, ti))

    # 各 episode で task_index が切り替わる frame を phase boundary に
    def extract_phases(rows: list[tuple[int, int]], total_frames: int) -> list[dict]:
        if not rows:
            return []
        rows.sort()
        phases: list[dict] = []
        cur_ti = rows[0][1]
        cur_start_frame = rows[0][0]
        for fi, ti in rows[1:]:
            if ti != cur_ti:
                phases.append({
                    "start_sec": round(cur_start_frame / fps, 2),
                    "end_sec": round(fi / fps, 2),
                    "text": tasks.get(cur_ti, ""),
                })
                cur_ti = ti
                cur_start_frame = fi
        # 最後の phase は episode 終端まで
        phases.append({
            "start_sec": round(cur_start_frame / fps, 2),
            "end_sec": round(total_frames / fps, 2),
            "text": tasks.get(cur_ti, ""),
        })
        return phases

    episodes_out: list[dict] = []
    for idx, ep_idx in enumerate(ep_pq["episode_index"]):
        ep_idx = int(ep_idx)
        length = int(ep_pq["length"][idx])
        ep_tasks = list(ep_pq["tasks"][idx])
        # 第 1 entry が contributor 設定の主タスク (= build_lp_sample.py の挙動)
        main_task = ep_tasks[0] if ep_tasks else ""
        video_id = str(ep_pq["video_id"][idx])
        category = str(ep_pq["category"][idx])
        region = str(ep_pq["region"][idx])

        phases = extract_phases(by_ep.get(ep_idx, []), length)

        episodes_out.append({
            "index": ep_idx,
            "video_id": video_id,
            "category": category,
            "region": region,
            "duration_sec": round(length / fps, 1),
            "length_frames": length,
            "task": main_task,
            "phases": phases,
        })

    episodes_out.sort(key=lambda e: e["index"])

    out_doc = {
        "fps": fps,
        "total_episodes": len(episodes_out),
        "episodes": episodes_out,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out_doc, ensure_ascii=False, indent=2))
    total_phases = sum(len(e["phases"]) for e in episodes_out)
    print(f"wrote {OUT}")
    print(f"  total_episodes={len(episodes_out)} total_phases={total_phases}")


if __name__ == "__main__":
    main()
