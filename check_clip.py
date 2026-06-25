#!/usr/bin/env python3
"""1 クリップの整合性を全項目チェックする。

  python3 check_clip.py <clip_dir_or_hash_prefix>

  例:
    python3 check_clip.py sample/clips/565d2608c9e4287522b99a4e5bc76e5213acbbf8d77df71cb79acc05229f1cad
    python3 check_clip.py 565d2608           # prefix で sample/clips/ から検索

チェック内容:
  1. ファイル存在 (rgb.mp4 / realtime_handpose / handpose_handpose / metadata)
  2. rgb.mp4 ffprobe (codec / 解像度 / fps / duration / frame 数)
  3. metadata.json 内容と rgb.mp4 との一致
  4. realtime_handpose.jsonl 構造 (= 各 frame に hands、 21 keypoints、 [0,1] 座標、 frame_index 連続性、 timestamp_ns 増加)
  5. handpose.jsonl 構造 (= ヘッダ、 各 frame の shape、 frame_index 連続性 0..N-1、 行数 == total_frames)
  6. クロスチェック (= realtime と handpose の frame 数、 metadata fps と動画 fps)
"""
import json
import os
import subprocess
import sys
from pathlib import Path


GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
CYAN = '\033[36m'
RESET = '\033[0m'


def ok(msg): print(f"  {GREEN}✓{RESET} {msg}")
def ng(msg): print(f"  {RED}✗{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}!{RESET} {msg}")
def info(msg): print(f"  {CYAN}·{RESET} {msg}")


def resolve(arg: str) -> Path:
    p = Path(arg)
    if p.is_dir():
        return p
    matches = sorted(Path("sample/clips").glob(f"{arg}*"))
    if not matches:
        print(f"{RED}no clip dir starts with {arg}{RESET}", file=sys.stderr)
        sys.exit(1)
    if len(matches) > 1:
        print(f"{RED}ambiguous prefix {arg}: {[str(m) for m in matches]}{RESET}", file=sys.stderr)
        sys.exit(1)
    return matches[0]


def ffprobe_video(path: Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error",
         "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames",
         "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    d = json.loads(r.stdout)
    s = d["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return {
        "codec": s["codec_name"],
        "width": s["width"],
        "height": s["height"],
        "fps": float(num) / float(den),
        "nb_frames": int(s["nb_frames"]),
        "duration": float(d["format"]["duration"]),
    }


def check_files(d: Path) -> dict:
    print(f"\n[1] ファイル存在")
    paths = {
        "rgb": d / "rgb.mp4",
        "realtime": d / "realtime_handpose.jsonl",
        "handpose": d / "handpose.jsonl",
        "meta": d / "metadata.json",
    }
    for name, p in paths.items():
        if not p.exists():
            ng(f"{p.name}: 不在")
            sys.exit(1)
        sz = p.stat().st_size
        # symlink resolve to get real size
        real = os.path.realpath(p)
        ok(f"{p.name}: {sz} bytes" + (f" → {real}" if str(p) != real else ""))
    return paths


def check_video(rgb: Path) -> dict:
    print(f"\n[2] rgb.mp4 (ffprobe)")
    v = ffprobe_video(rgb)
    info(f"codec        = {v['codec']}")
    info(f"resolution   = {v['width']}x{v['height']}")
    info(f"fps          = {v['fps']:.4f}")
    info(f"nb_frames    = {v['nb_frames']}")
    info(f"duration     = {v['duration']:.3f}s ({v['duration']/60:.2f}min)")
    if v['width'] == 1920 and v['height'] == 1080:
        ok("1920×1080 一致")
    else:
        warn(f"解像度 {v['width']}x{v['height']} は 1920×1080 と違う")
    if abs(v['fps'] - 30) < 0.1:
        ok("約 30fps")
    else:
        warn(f"fps {v['fps']:.4f} は 30 と違う")
    return v


def check_meta(meta_path: Path, video: dict) -> dict:
    print(f"\n[3] metadata.json")
    m = json.load(open(meta_path))
    info(f"device_model = {m.get('device_model')}")
    info(f"os_version   = {m.get('os_version')}")
    info(f"recording_config = {m.get('recording_config')}")
    cam = m.get("camera", {})
    info(f"camera.lens  = {cam.get('lens')}")
    info(f"camera.fov   = {cam.get('field_of_view_deg')}°")

    if m.get("recording_config") == "ultra_wide": ok("recording_config = ultra_wide")
    else: ng(f"recording_config = {m.get('recording_config')} (= ultra_wide ではない)")
    if cam.get("lens") == "ultra_wide": ok("camera.lens = ultra_wide")
    else: ng(f"camera.lens = {cam.get('lens')}")
    if cam.get("width") == video["width"] and cam.get("height") == video["height"]:
        ok("metadata 解像度 ↔ rgb.mp4 一致")
    else:
        ng(f"metadata {cam.get('width')}x{cam.get('height')} ↔ rgb.mp4 {video['width']}x{video['height']}")
    if cam.get("fps") and abs(cam.get("fps") - video["fps"]) < 0.5:
        ok(f"metadata fps {cam.get('fps')} ↔ rgb.mp4 fps {video['fps']:.2f}")
    else:
        warn(f"fps 不一致 metadata={cam.get('fps')} rgb={video['fps']:.2f}")
    return m


def check_realtime(rt_path: Path, video: dict) -> dict:
    print(f"\n[4] realtime_handpose.jsonl")
    frame_count = 0; total_hands = 0; landmark_counts = set(); hands_in = set()
    x_violations = 0; y_violations = 0
    prev_fi = -1; prev_ts = -1; ts_decreases = 0; fi_jumps = 0
    with open(rt_path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: d = json.loads(line)
            except: ng(f"JSON parse 失敗"); return {}
            frame_count += 1
            fi = d.get("frame_index")
            if fi is None: ng("frame_index 不在"); return {}
            if fi != prev_fi + 1: fi_jumps += 1
            prev_fi = fi
            ts = int(d.get("timestamp_ns", 0))
            if ts < prev_ts: ts_decreases += 1
            prev_ts = ts
            for h in d.get("hands", []):
                total_hands += 1
                landmark_counts.add(len(h.get("landmarks", [])))
                hands_in.add(h.get("handedness"))
                for lm in h.get("landmarks", []):
                    if not (0 <= lm.get("x", -1) <= 1): x_violations += 1
                    if not (0 <= lm.get("y", -1) <= 1): y_violations += 1
    info(f"frame_count          = {frame_count}")
    info(f"landmarks per hand   = {landmark_counts}")
    info(f"handedness values    = {hands_in}")
    info(f"total hand instances = {total_hands}")
    if 21 in landmark_counts and len(landmark_counts) == 1:
        ok("全 hand で landmarks=21")
    else:
        ng(f"landmarks per hand が不揃い: {landmark_counts}")
    if hands_in <= {"right", "left"}:
        ok("handedness ∈ {right, left}")
    else:
        ng(f"未知の handedness: {hands_in}")
    if fi_jumps == 0:
        ok(f"frame_index 連続 ({frame_count} 件)")
    else:
        ng(f"frame_index に {fi_jumps} 箇所の飛び")
    if ts_decreases == 0:
        ok("timestamp_ns 単調増加")
    else:
        warn(f"timestamp_ns 減少 {ts_decreases} 箇所")
    if x_violations == 0 and y_violations == 0:
        ok("座標が完全に [0,1] 内")
    else:
        warn(f"座標 [0,1] 逸脱 x={x_violations} y={y_violations} (= Apple Vision 出力のまま、 clamp なし)")
    diff = video["nb_frames"] - frame_count
    if abs(diff) <= 5:
        ok(f"realtime 行数 ({frame_count}) ≈ 動画 frame 数 ({video['nb_frames']})")
    else:
        warn(f"realtime 行数 {frame_count} vs 動画 frame {video['nb_frames']} (差 {diff})")
    return {"frame_count": frame_count}


def check_handpose(off_path: Path, video: dict) -> dict:
    print(f"\n[5] handpose.jsonl")
    with open(off_path) as f:
        header_line = f.readline().strip()
        try: header = json.loads(header_line)
        except: ng("ヘッダ JSON parse 失敗"); return {}
        info(f"model        = {header.get('model')}")
        info(f"fps          = {header.get('fps')}")
        info(f"total_frames = {header.get('total_frames')}")
        info(f"sig_hash     = {header.get('signature_hash')[:16]}...")
        if header.get("model") == "WiLoR-mini": ok("model = WiLoR-mini")
        else: warn(f"model = {header.get('model')}")

        required = {"hand_present", "pred_keypoints_3d", "pred_cam_t_full", "global_orient", "hand_pose"}
        present = set((header.get("fields") or {}).keys())
        if required <= present: ok(f"ヘッダ fields に全項目: {sorted(present)}")
        else: ng(f"ヘッダ fields 不足: missing={required - present}")

        # frame 行
        frame_count = 0; prev_fi = -1; fi_jumps = 0; bad_shape = 0
        both = left = right = none = 0
        for line in f:
            line = line.strip()
            if not line: continue
            d = json.loads(line)
            frame_count += 1
            fi = d.get("frame_index")
            if fi != prev_fi + 1: fi_jumps += 1
            prev_fi = fi
            hp = d.get("hand_present", [False, False])
            if len(hp) != 2: bad_shape += 1
            l, r = bool(hp[0]), bool(hp[1])
            if l and r: both += 1
            elif l: left += 1
            elif r: right += 1
            else: none += 1
            kp = d.get("pred_keypoints_3d")
            if not (isinstance(kp, list) and len(kp) == 2 and len(kp[0]) == 21 and len(kp[0][0]) == 3):
                bad_shape += 1

    any_h = both + left + right
    info(f"frame 行数   = {frame_count}")
    info(f"検出: 両手={both} 左のみ={left} 右のみ={right} なし={none}")
    if frame_count == header.get("total_frames"):
        ok(f"ヘッダ total_frames ({header.get('total_frames')}) と frame 行数 ({frame_count}) 一致")
    else:
        ng(f"ヘッダ total_frames {header.get('total_frames')} ≠ frame 行数 {frame_count}")
    if frame_count == video["nb_frames"]:
        ok(f"frame 行数 ({frame_count}) = 動画 frame 数")
    else:
        ng(f"frame 行数 {frame_count} ≠ 動画 frame 数 {video['nb_frames']}")
    if fi_jumps == 0:
        ok(f"frame_index 連続 0..{frame_count-1}")
    else:
        ng(f"frame_index に {fi_jumps} 箇所の飛び")
    if bad_shape == 0:
        ok("全 frame で shape OK (= hand_present[2], keypoints[2,21,3])")
    else:
        ng(f"shape 不正 {bad_shape} 箇所")
    info(f"any-hand 検出率   = {100*any_h/frame_count:.1f}%")
    info(f"両手検出率       = {100*both/frame_count:.1f}%")
    return {"frame_count": frame_count, "header": header}


def cross_check(realtime: dict, handpose: dict, video: dict, meta: dict):
    print(f"\n[6] クロスチェック")
    rt_n = realtime.get("frame_count", 0)
    off_n = handpose.get("frame_count", 0)
    if abs(rt_n - off_n) <= 5:
        ok(f"realtime ({rt_n}) ≈ handpose ({off_n}) ≈ video ({video['nb_frames']})")
    else:
        warn(f"realtime {rt_n} vs handpose {off_n} (差 {abs(rt_n - off_n)})")
    sig = handpose.get("header", {}).get("signature_hash", "")
    expected = Path(realtime).parent.name if hasattr(realtime, 'parent') else ""


def main():
    if len(sys.argv) < 2:
        print("usage: check_clip.py <clip_dir_or_hash_prefix>", file=sys.stderr)
        sys.exit(2)
    clip_dir = resolve(sys.argv[1])
    print(f"clip dir: {clip_dir}")

    paths = check_files(clip_dir)
    video = check_video(paths["rgb"])
    meta = check_meta(paths["meta"], video)
    realtime = check_realtime(paths["realtime"], video)
    handpose = check_handpose(paths["handpose"], video)

    print(f"\n[6] クロスチェック")
    rt_n = realtime.get("frame_count", 0)
    off_n = handpose.get("frame_count", 0)
    if abs(rt_n - off_n) <= 5:
        ok(f"realtime ({rt_n}) ≈ handpose ({off_n}) ≈ video ({video['nb_frames']})")
    else:
        warn(f"realtime {rt_n} vs handpose {off_n} (差 {abs(rt_n - off_n)})")
    sig = handpose.get("header", {}).get("signature_hash", "")
    if sig == clip_dir.name:
        ok(f"handpose ヘッダの signature_hash ↔ ディレクトリ名 一致")
    else:
        ng(f"handpose ヘッダ sig_hash {sig[:12]} ≠ ディレクトリ {clip_dir.name[:12]} (= 過去の broken 修復が必要)")
    print()


if __name__ == "__main__":
    main()
