"""
各エピソードの observation.hand_keypoints_3d から
MANO 21 関節のスケルトンアニメーションを MP4 に書き出す。

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
JOINT_SIZE = 8
BONE_WIDTH = 2.5
FIG_SIZE = (4, 4)
DPI = 100
SUBSAMPLE = 2  # render every Nth frame to reduce file size


HAND_OFFSET_X = 0.12


def render_episode(ep_idx: int, frames: list[dict], fps: float, out_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

    frames_to_render = frames[::SUBSAMPLE]
    render_fps = fps / SUBSAMPLE

    all_kp = np.array([f["kp"] for f in frames_to_render])  # [T, 2, 21, 3]
    all_present = [f["present"] for f in frames_to_render]
    present_mask = np.array([[p[0] for p in all_present], [p[1] for p in all_present]])  # [2, T]

    norm_kp = all_kp.copy()
    for h in range(2):
        for t in range(len(frames_to_render)):
            if present_mask[h, t]:
                wrist = norm_kp[t, h, 0].copy()
                norm_kp[t, h] -= wrist

    valid_kp = []
    for h in range(2):
        for t in range(len(frames_to_render)):
            if present_mask[h, t]:
                valid_kp.append(norm_kp[t, h])
    if not valid_kp:
        print(f"  episode {ep_idx}: no hands detected, skipping")
        return
    valid_kp = np.concatenate(valid_kp, axis=0)  # [N, 3]
    rng = valid_kp.max(axis=0) - valid_kp.min(axis=0)
    scale = float(rng.max()) * 0.35
    if scale < 1e-6:
        scale = 1.0

    has_both = bool(present_mask[0].any() and present_mask[1].any())

    tmp_dir = out_path.parent / f"_tmp_ep{ep_idx:03d}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    for i, frame in enumerate(frames_to_render):
        fig = plt.figure(figsize=FIG_SIZE, dpi=DPI, facecolor=BG_COLOR)
        ax = fig.add_subplot(111, projection="3d", facecolor=BG_COLOR)
        ax.set_proj_type("ortho")

        cx = 0.0
        if has_both:
            ax.set_xlim(-HAND_OFFSET_X - scale, HAND_OFFSET_X + scale)
        else:
            ax.set_xlim(cx - scale, cx + scale)
        ax.set_ylim(-scale, scale)
        ax.set_zlim(-scale, scale)
        ax.set_axis_off()
        ax.view_init(elev=25, azim=-90)

        present = frame["present"]

        for h, (color, is_present) in enumerate(
            zip([LEFT_COLOR, RIGHT_COLOR], present)
        ):
            if not is_present:
                continue
            joints = norm_kp[i, h].copy()  # [21, 3] wrist-normalized
            if has_both:
                offset = -HAND_OFFSET_X if h == 0 else HAND_OFFSET_X
                joints[:, 0] += offset
            ax.scatter(
                joints[:, 0], joints[:, 1], joints[:, 2],
                c=color, s=JOINT_SIZE, depthshade=False, alpha=0.9,
            )
            for a, b in MANO_BONES:
                ax.plot(
                    [joints[a, 0], joints[b, 0]],
                    [joints[a, 1], joints[b, 1]],
                    [joints[a, 2], joints[b, 2]],
                    color=color, linewidth=BONE_WIDTH, alpha=0.7,
                )

        fig.savefig(tmp_dir / f"{i:06d}.png", facecolor=BG_COLOR, bbox_inches="tight", pad_inches=0.02)
        plt.close(fig)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(render_fps),
        "-i", str(tmp_dir / "%06d.png"),
        "-c:v", "libx264", "-preset", "fast",
        "-crf", "28", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
