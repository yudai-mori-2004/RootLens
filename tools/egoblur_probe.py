"""EgoBlur で「顔検出寸前」を調べるハーネス。

stera を経由せず、 EgoBlur 本家 (gen2) の EgoblurDetector を直接叩く。
`get_detections` を呼んで DetectionsBatch から生スコアを得るので、
低い score_threshold で全検出を拾ってから閾値スイープできる。

Usage:
  python tools/egoblur_probe.py --src /path/to/b47a56cc.mcap \
      --egoblur-dir references/egoblur \
      --conf 0.05,0.1,0.2,0.3,0.5 \
      --max-frames 40 --stride 40 \
      --outdir /tmp/egoblur_out

出力:
  各 conf で「N フレーム中 何枚に検出があったか」+ 検出があったフレームの
  orig|blurred montage (= 目視確認用)。 R2 には触らない。
"""
import os
import sys
import argparse
import numpy as np
import cv2


def iter_rgb_from_mcap(path, stride, maxf):
    from mcap.reader import make_reader
    from mcap_ros2.decoder import DecoderFactory as RosDecoder
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "references/stera-sdk/src"))
    from stera.data.mcap import _decoders as dec
    i = kept = 0
    with open(path, "rb") as f:
        reader = make_reader(f, decoder_factories=[RosDecoder()])
        for _s, _ch, _m, decoded in reader.iter_decoded_messages(
                topics=["/camera/rgb/compressed"]):
            if i % stride == 0:
                _, rgb = dec.decode_compressed_image(decoded)
                yield i, rgb
                kept += 1
                if maxf and kept >= maxf:
                    return
            i += 1


def iter_rgb_from_mp4(path, stride, maxf):
    cap = cv2.VideoCapture(path)
    i = kept = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if i % stride == 0:
            yield i, cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            kept += 1
            if maxf and kept >= maxf:
                break
        i += 1
    cap.release()


def apply_blur(rgb, boxes_xyxy):
    if not len(boxes_xyxy):
        return rgb
    h, w = rgb.shape[:2]
    out = rgb.copy()
    mask = np.zeros((h, w), np.uint8)
    ksize = (max(1, h // 2), max(1, w // 2))
    for x1, y1, x2, y2 in boxes_xyxy:
        x1 = max(0, int(x1)); y1 = max(0, int(y1))
        x2 = min(w, int(x2)); y2 = min(h, int(y2))
        if x2 <= x1 or y2 <= y1:
            continue
        patch = out[y1:y2, x1:x2]
        out[y1:y2, x1:x2] = cv2.blur(patch, ksize)
        cv2.ellipse(mask,
                    (((x1 + x2) // 2, (y1 + y2) // 2), (x2 - x1, y2 - y1), 0),
                    255, -1)
    imask = cv2.bitwise_not(mask)
    bg = cv2.bitwise_and(rgb, rgb, mask=imask)
    fg = cv2.bitwise_and(out, out, mask=mask)
    return cv2.add(bg, fg)


def build_montage(rows, cellw=520):
    if not rows:
        return None
    out_rows = []
    for idx, orig, blur, score_str in rows[:16]:
        h, w = orig.shape[:2]
        o = cv2.resize(orig, (cellw, int(h * cellw / w)))
        b = cv2.resize(blur, (cellw, int(h * cellw / w)))
        row = np.hstack([o, np.full((o.shape[0], 4, 3), 255, np.uint8), b])
        label = f"frame {idx}  scores={score_str}"
        cv2.putText(row, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(row, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 1, cv2.LINE_AA)
        out_rows.append(row)
    return np.vstack(out_rows)


def detect_frame(det, patch_instances, fields, bgr):
    """demo 経路: pre_process → inference → get_detections で face_bboxes と face_scores を取る。"""
    import torch
    tensor = torch.from_numpy(np.transpose(bgr, (2, 0, 1)))
    if tensor.ndim == 3:
        batched = tensor.unsqueeze(0)
    else:
        batched = tensor
    with patch_instances(fields=fields):
        img_batch, orig_img_hw_list, model_input_hw_list = det.pre_process(batched)
        preds = det.inference(img_batch)
        detections_batch = det.get_detections(
            output_tensor=preds,
            timestamp_s=0.0,
            stream_id="",
            rotation_angle=0.0,
            model_input_hw_list=model_input_hw_list,
            target_img_hw_list=orig_img_hw_list,
        )
    if not detections_batch:
        return [], []
    d = detections_batch[0]
    if d is None:
        return [], []
    boxes = np.asarray(d.face_bboxes, dtype=np.float32).reshape(-1, 4)
    scores = np.asarray(d.face_scores, dtype=np.float32).reshape(-1)
    return boxes.tolist(), scores.tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--egoblur-dir", default="references/egoblur")
    ap.add_argument("--conf", default="0.05,0.1,0.2,0.3,0.5")
    ap.add_argument("--stride", type=int, default=40)
    ap.add_argument("--max-frames", type=int, default=40)
    ap.add_argument("--outdir", default="/tmp/egoblur_out")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    confs = sorted(float(c) for c in args.conf.split(","))

    # Load frames
    it = iter_rgb_from_mcap(args.src, args.stride, args.max_frames) \
        if args.src.endswith(".mcap") \
        else iter_rgb_from_mp4(args.src, args.stride, args.max_frames)
    frames = list(it)
    print(f"読み込んだフレーム: {len(frames)} (stride={args.stride})", flush=True)
    if not frames:
        return

    # Load model (score_threshold=0 で全検出を拾い、 後段でスイープ)
    from gen2.script.detectron2.export.torchscript_patch import patch_instances
    from gen2.script.predictor import EgoblurDetector, ClassID, PATCH_INSTANCES_FIELDS
    from gen2.script.constants import RESIZE_MIN_GEN2, RESIZE_MAX_GEN2
    jit = os.path.join(args.egoblur_dir, "ego_blur_face_gen2.jit")
    det = EgoblurDetector(
        model_path=jit, device="cpu", detection_class=ClassID.FACE,
        score_threshold=0.0, nms_iou_threshold=0.3,
        resize_aug={"min_size_test": RESIZE_MIN_GEN2, "max_size_test": RESIZE_MAX_GEN2},
        image_format="BGR", use_gpu_resize=False,
    )
    print("EgoBlur loaded, running detection (CPU)...", flush=True)

    # 各フレームの生 (box, score) を保存
    per_frame = []  # (idx, rgb, [(box, score)])
    all_scores = []
    for k, (idx, rgb) in enumerate(frames, 1):
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        boxes, scores = detect_frame(det, patch_instances, PATCH_INSTANCES_FIELDS, bgr)
        pairs = list(zip(boxes, scores))
        per_frame.append((idx, rgb, pairs))
        all_scores.extend(scores)
        if k % 5 == 0:
            print(f"  {k}/{len(frames)} 処理済 (これまでの検出総数 {len(all_scores)})", flush=True)

    if all_scores:
        s = np.array(all_scores)
        print(f"\n検出総数: {len(s)} / スコア分布: "
              f"min={s.min():.3f}  25%={np.percentile(s,25):.3f}  "
              f"50%={np.percentile(s,50):.3f}  75%={np.percentile(s,75):.3f}  "
              f"max={s.max():.3f}", flush=True)
    else:
        print("\n検出 0 (どんな閾値でもぼかしゼロ)", flush=True)
        return

    for conf in confs:
        rows = []
        n_blurred = 0
        for idx, rgb, pairs in per_frame:
            kept = [(b, s) for (b, s) in pairs if s > conf]
            if not kept:
                continue
            n_blurred += 1
            boxes = [b for (b, _) in kept]
            score_str = ", ".join(f"{s:.2f}" for _, s in kept)
            blurred = apply_blur(rgb, boxes)
            rows.append((idx, rgb, blurred, score_str))
        n = len(per_frame)
        print(f"[conf > {conf}] {n_blurred}/{n} フレームに検出 ({100 * n_blurred / n:.1f}%)",
              flush=True)
        m = build_montage(rows)
        if m is not None:
            out = os.path.join(args.outdir, f"egoblur_conf{conf}.jpg")
            cv2.imwrite(out, cv2.cvtColor(m, cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 88])
            print(f"   → {out}", flush=True)


if __name__ == "__main__":
    main()
