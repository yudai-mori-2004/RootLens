"""
各エピソードの observation.hand_keypoints_3d + action から
カメラ空間のスケルトンアニメーションを MP4 に書き出す (LP プレビュー用)。

pred_keypoints_3d (MANO forward pass 出力、global_orient 適用済み) に
pred_cam_t_full を加算してカメラ空間座標を得て、透視投影で 2D 描画する。

出力: web/public/lp/sample/skeleton/ に episode_XXX_skeleton.mp4
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]
DS = REPO / "web" / "public" / "lp" / "sample" / "dataset"
OUT_DIR = REPO / "web" / "public" / "lp" / "sample" / "skeleton"

MANO_BONES = [
    (0, 1), (1, 2), (2, 3), (3, 4),       # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),       # index
    (0, 9), (9, 10), (10, 11), (11, 12),   # middle
    (0, 13), (13, 14), (14, 15), (15, 16), # ring
    (0, 17), (17, 18), (18, 19), (19, 20), # pinky
]

LEFT_COLOR = "#4a9eff"
RIGHT_COLOR = "#ff6b6b"
BG_COLOR = "#1a1d22"
JOINT_SIZE = 40
BONE_WIDTH = 4.0
SUBSAMPLE = 2  # render every Nth frame to reduce file size

# 出力サイズ (RGB 動画と同一)
OUT_W = 1920
OUT_H = 1080


def camera_to_2d(pts_cam: np.ndarray, img_w: int, img_h: int) -> np.ndarray:
    """カメラ空間の 3D 点を透視投影で 2D ピクセル座標に変換。
    WiLoR の pred_cam_t_full は cam_crop_to_full() で元画像座標系に変換済み。
    focal_length は WiLoR の scaled_focal_length と同じ計算:
      scaled_focal_length = FOCAL_LENGTH / IMAGE_SIZE * max(img_w, img_h)
    FOCAL_LENGTH=5000, IMAGE_SIZE=256 (WiLoR デフォルト)。
    """
    focal = 5000.0 / 256.0 * max(img_w, img_h)
    cx, cy = img_w / 2.0, img_h / 2.0
    z = pts_cam[:, 2].clip(min=0.1)
    x_2d = pts_cam[:, 0] / z * focal + cx
    y_2d = pts_cam[:, 1] / z * focal + cy
    return np.stack([x_2d, y_2d], axis=1)


def project_hands(frame: dict, img_w: int, img_h: int) -> list[tuple[np.ndarray, str]]:
    """1 フレームの両手をカメラ空間 → 2D 投影。[(joints_2d, color), ...] を返す。

    pred_keypoints_3d は MANO forward pass の出力なので global_orient 回転は
    適用済み。ここでは pred_cam_t_full (wrist_pos) による平行移動のみ行う。
    """
    results = []
    present = frame["present"]
    kp = frame["kp"]
    action = frame["action"]

    for h, (color, is_present) in enumerate(
        zip([LEFT_COLOR, RIGHT_COLOR], present)
    ):
        if not is_present:
            continue
        offset = h * 7
        wrist_pos = action[offset:offset + 3]
        # global_orient (action[offset+3:offset+7]) は使わない:
        # pred_keypoints_3d に既に適用済みのため
        joints_cam = kp[h] + wrist_pos
        joints_2d = camera_to_2d(joints_cam, img_w, img_h)
        results.append((joints_2d, color))
    return results


def render_episode(ep_idx: int, frames: list[dict], fps: float, out_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    frames_to_render = frames[::SUBSAMPLE]
    render_fps = fps / SUBSAMPLE

    tmp_dir = out_path.parent / f"_tmp_ep{ep_idx:03d}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # DPI を調整して 1920x1080 のフレームを出力
    dpi = 150
    fig_w = OUT_W / dpi
    fig_h = OUT_H / dpi

    for i, frame in enumerate(frames_to_render):
        fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi, facecolor=BG_COLOR)
        ax.set_facecolor(BG_COLOR)
        ax.set_xlim(0, OUT_W)
        ax.set_ylim(OUT_H, 0)  # y 軸反転 (画像座標系)
        ax.set_aspect("equal")
        ax.set_axis_off()
        fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

        for joints_2d, color in project_hands(frame, OUT_W, OUT_H):
            ax.scatter(
                joints_2d[:, 0], joints_2d[:, 1],
                c=color, s=JOINT_SIZE, zorder=3, alpha=0.9,
            )
            for a, b in MANO_BONES:
                ax.plot(
                    [joints_2d[a, 0], joints_2d[b, 0]],
                    [joints_2d[a, 1], joints_2d[b, 1]],
                    color=color, linewidth=BONE_WIDTH, alpha=0.7, zorder=2,
                )

        fig.savefig(tmp_dir / f"{i:06d}.png", facecolor=BG_COLOR, dpi=dpi)
        plt.close(fig)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(render_fps),
        "-i", str(tmp_dir / "%06d.png"),
        "-c:v", "libx264", "-preset", "fast",
        "-crf", "28", "-pix_fmt", "yuv420p",
        str(out_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)

    for f in tmp_dir.iterdir():
        f.unlink()
    tmp_dir.rmdir()
    sz = out_path.stat().st_size
    print(f"  episode_{ep_idx:03d}: {len(frames_to_render)} frames -> {sz / 1024:.0f} KB")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--episodes", type=str, default=None, help="e.g. '0,1,2' or '0' for single")
    args = parser.parse_args()

    info = json.loads((DS / "meta" / "info.json").read_text())
    fps = float(info["fps"])

    data = pq.read_table(DS / "data" / "chunk-000" / "file-000.parquet")
    d = data.to_pydict()

    by_ep: dict[int, list[dict]] = {}
    for i in range(len(d["episode_index"])):
        ep = int(d["episode_index"][i])
        by_ep.setdefault(ep, []).append({
            "frame_index": int(d["frame_index"][i]),
            "kp": np.array(d["observation.hand_keypoints_3d"][i]),
            "present": list(d["observation.hand_present"][i]),
            "action": np.array(d["action"][i]),
        })

    for ep_frames in by_ep.values():
        ep_frames.sort(key=lambda f: f["frame_index"])

    episodes = sorted(by_ep.keys())
    if args.episodes:
        episodes = [int(x) for x in args.episodes.split(",")]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"rendering {len(episodes)} episodes (subsample={SUBSAMPLE}, fps={fps/SUBSAMPLE:.1f})")

    for ep_idx in episodes:
        if ep_idx not in by_ep:
            print(f"  episode {ep_idx}: not found, skipping")
            continue
        out_path = OUT_DIR / f"episode_{ep_idx:03d}_skeleton.mp4"
        render_episode(ep_idx, by_ep[ep_idx], fps, out_path)

    total_size = sum(f.stat().st_size for f in OUT_DIR.glob("*.mp4"))
    print(f"\ntotal: {total_size / 1e6:.1f} MB in {OUT_DIR}")


if __name__ == "__main__":
    main()
