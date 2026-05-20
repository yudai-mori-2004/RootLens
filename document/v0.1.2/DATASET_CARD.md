# RootLens Egocentric Dataset

Per-clip multimodal recording captured on an iPhone with Apple ARKit, distributed in the [LeRobotDataset v3.0](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3) format.

## Format

LeRobotDataset v3.0. A dataset is one or more captured clips packaged together; each clip is one episode.

Directory layout (per-clip distribution shape):

```
<root>/
├── meta/
│   ├── info.json
│   ├── tasks.jsonl
│   ├── stats.json
│   └── episodes/chunk-000/file-000.parquet
├── data/chunk-000/file-000.parquet
└── videos/observation.images.ego_cam/chunk-000/file-000.mp4
```

The `data_path` template in `meta/info.json` follows the LeRobotDataset v3.0 convention (`data/chunk-{episode_chunk:03d}/file-{file_index:03d}.parquet`).

The `video_path` template has two supported forms, recorded in `meta/info.json`:

- Concatenated form: `videos/{video_key}/chunk-{episode_chunk:03d}/file-{file_index:03d}.mp4` (= multiple episodes encoded into one MP4 file per chunk, with byte/frame offsets stored in `meta/episodes/.../*.parquet`).
- Per-episode form: `videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:03d}.mp4` (= one MP4 file per episode, independently addressable).

Multi-episode preview releases (e.g. the public sample) use the per-episode form so individual clips can be linked and streamed without pulling the whole dataset.

## Bundler version

`meta/info.json` carries `rootlens.bundler_version`. The version described by this document is `v1-wilor-mano`.

## RGB video

`videos/observation.images.ego_cam/chunk-000/file-000.mp4`:

- Codec: H.264 (`AVVideoCodecType.h264`), pixel format `yuv420p`, profile `H264HighAutoLevel`.
- Source: `ARFrame.capturedImage` from an `ARWorldTrackingConfiguration` session, written through `AVAssetWriter` with an `AVAssetWriterInputPixelBufferAdaptor`.
- Recording bitrate target: 6 Mbps (`AVVideoAverageBitRateKey = 6_000_000`).
- Face blur applied per frame on the capture device with Apple's [Vision framework](https://developer.apple.com/documentation/vision/vndetectfacerectanglesrequest) (`VNDetectFaceRectanglesRequest` revision 3) before encoding. Detected faces are tracked across frames (IoU matching + EMA smoothing) to suppress per-frame jitter, then masked with a Gaussian blur. The raw, unblurred frames never leave the device.
- C2PA "signature S" embedded in the file. The C2PA manifest's actions include `c2pa.placed.face_blur` with software agent `Apple Vision`. Signing uses ES256 with a leaf certificate issued by the RootLens authority.
- Resolution and frame rate are device-format dependent and recorded in `meta/info.json` (`fps`) and in the sidecar `camera_intrinsics.json` (`rgb.width`, `rgb.height`, `rgb.fps`). The iOS capture module (`ArSessionController.pickPreferredFormat`) prefers the built-in ultra-wide camera at a video format near 720 px height; the reference clip captured on iPhone 12 was 1280 x 720 at 60 fps.

## Per-frame columns (`data/chunk-000/file-000.parquet`)

LeRobotDataset v3.0 naming conventions throughout (`observation.*`, `action`, `timestamp`, `frame_index`, `episode_index`, `index`, `task_index`).

| Column | dtype | Shape | Origin |
|---|---|---|---|
| `timestamp` | float32 | scalar | Frame index divided by `fps`. |
| `frame_index` | int64 | scalar | Index within the episode, starting at 0. |
| `episode_index` | int64 | scalar | Always 0 in the per-clip distribution shape. |
| `index` | int64 | scalar | Global row index (equal to `frame_index` for single-episode datasets). |
| `task_index` | int64 | scalar | Index into `tasks.jsonl` identifying the sub-task (phase) currently in progress for this frame. See "Phase labels" below. |
| `observation.images.ego_cam` | video (file ref) | [3, H, W] | Reference to the corresponding frame in `videos/observation.images.ego_cam/...`. |
| `observation.state` | float32 | [7] | Camera 6-DoF in the ARKit world frame: `[tx, ty, tz, qx, qy, qz, qw]`. Translation extracted from `ARFrame.camera.transform.columns.3`; quaternion derived from the upper-left 3x3 of the same transform. `ARWorldTrackingConfiguration.worldAlignment` is set to `.gravity`; see the [Apple ARKit documentation](https://developer.apple.com/documentation/arkit/arconfiguration/worldalignment/gravity) for the exact axis convention. |
| `observation.imu_orientation` | float32 | [4] | Quaternion `[qx, qy, qz, qw]` from `CMDeviceMotion.attitude.quaternion`, sampled at the RGB frame instant. |
| `observation.imu_angular_velocity` | float32 | [3] | `CMDeviceMotion.rotationRate` in rad/s. |
| `observation.imu_linear_acceleration` | float32 | [3] | `CMDeviceMotion.userAcceleration + CMDeviceMotion.gravity`. `CMAcceleration` values are expressed in [G ratio (1 G = 9.81 m/s^2)](https://developer.apple.com/documentation/coremotion/cmacceleration). For a stationary device, the magnitude is approximately 1.0. |
| `observation.tracking_state` | int8 | [1] | `ARCamera.TrackingState` mapped as `0 = notAvailable`, `1 = limited`, `2 = normal`. |
| `observation.hand_keypoints_3d` | float32 | [2, 21, 3] | 21 hand joints per hand `[left, right]`, taken from WiLoR-mini's `wilor_preds.pred_keypoints_3d`. Coordinates are in the WiLoR / MANO canonical hand-local frame as defined by the WiLoR-mini pipeline source (`wilor_mini/pipelines/wilor_hand_pose3d_estimation_pipeline.py`). When a hand is not detected, the corresponding `[21, 3]` block is zero-filled. |
| `observation.hand_present` | bool | [2] | `[left_detected, right_detected]`. True iff the corresponding hand is returned by `WiLorHandPose3dEstimationPipeline.predict()`. |
| `observation.hand_pose_mano` | float32 | [2, 48] | MANO axis-angle pose per hand. Composed as `concat(global_orient[3], hand_pose[45])` from WiLoR-mini's `wilor_preds.global_orient` and `wilor_preds.hand_pose`. Frames or hands without a WiLoR detection are zero-filled. |
| `observation.hand_shape_mano` | float32 | [2, 10] | MANO shape coefficients (beta). Zero-filled; MANO defines beta = 0 as the mean shape, and WiLoR-mini does not return betas in `wilor_preds`. |
| `action` | float32 | [14] | Two-hand wrist 6-DoF concatenated: `[lh_tx, lh_ty, lh_tz, lh_qx, lh_qy, lh_qz, lh_qw, rh_tx, rh_ty, rh_tz, rh_qx, rh_qy, rh_qz, rh_qw]`. Translation comes from WiLoR-mini's `wilor_preds.pred_cam_t_full`. Rotation is the unit quaternion form of `wilor_preds.global_orient` (axis-angle to quaternion conversion). For a hand whose `observation.hand_present` is `false`, the per-hand block defaults to translation `[0, 0, 0]` and the identity quaternion `[0, 0, 0, 1]`. |

### Notes on the action wrist translation

The `pred_cam_t_full` values are produced by WiLoR-mini's `utils.cam_crop_to_full` ([source](https://github.com/warmshao/WiLoR-mini/blob/main/wilor_mini/utils/utils.py)) following the formula:

```
tz = 2 * focal_length / (box_size * cam_bbox[0])
tx = 2 * (cx - w/2) / (box_size * cam_bbox[0]) + cam_bbox[1]
ty = 2 * (cy - h/2) / (box_size * cam_bbox[0]) + cam_bbox[2]
```

The inputs (`box_size`, `cx`, `cy`, `w`, `h`, `focal_length`) are all in pixels, and `cam_bbox[0:3]` is the unitless weak-perspective camera prediction from the network. The result is a dimensionless triplet tied to the MANO canonical mesh scale; it is not in metric meters. Converting to metric coordinates requires either a known scale for the MANO hand used at training time or a depth measurement at the wrist (for example, sampling `depth/{frame_index:06d}.png` at the wrist pixel on LiDAR-equipped devices).

## Phase labels (semantic sub-tasks)

`task_index` resolves to a natural-language phase description for the current frame, looked up in `meta/tasks.jsonl`. A single episode is segmented into multiple phases, and `task_index` changes from frame to frame as the action progresses.

Phase text is free-form English in the style of Ego4D narrations (e.g. `"Right hand reaches for the kettle handle."`). The vocabulary is intentionally open: no fixed closed taxonomy is imposed, so phases can describe whatever happens in the clip at whatever granularity the labeler chose.

Phases are produced server-side from the blurred RGB video by a vision-language model invoked at bundle time. They are not derived from raw measurements and are not deterministic re-computable from the parquet columns; consumers who want a different segmentation should re-segment the video themselves.

`meta/tasks.jsonl` typically contains both:

- One entry naming the episode-level task that the contributor chose (e.g. `"pour tea into a cup"`).
- Multiple entries naming the per-segment phases that occurred during the episode.

`meta/episodes/chunk-XXX/file-YYY.parquet` lists, per episode, the full set of phase strings that appear in that episode in its `tasks` column (string array).

The `rootlens` block in `meta/info.json` records which vision-language model produced the phase labels (see below).

## `meta/info.json` extensions

In addition to the standard LeRobotDataset v3.0 fields (`features`, `fps`, `total_episodes`, `total_frames`, `data_path`, `video_path`, ...) the file contains a `rootlens` block written by the bundler:

```json
{
  "rootlens": {
    "root_nft_asset_id": "<asset id of the Title Protocol cNFT>",
    "pipeline_version": "v0.1.2",
    "bundler_version": "v1-wilor-mano",
    "phase_labeler": "claude-haiku-4-5"
  }
}
```

`phase_labeler` records the model identifier used to generate the per-segment phase strings stored in `meta/tasks.jsonl` (see "Phase labels" above). The other three fields identify the dataset release, the upstream RootLens server pipeline version, and the bundler that produced the per-frame columns.

## Companion sidecar files (not part of the LeRobot loader contract)

Uploaded alongside the dataset under the same content-hash prefix on the raw storage side:

- `sensors.jsonl` (one JSON line per RGB frame): `ts`, `frame_index`, `tracking_state`, `tracking_reason`, `camera_transform` (4x4 row-major), `camera_intrinsics` (3x3 row-major flattened to 9 values), and an `imu` block snapshot. Schema is defined in `app/modules/arkit-capture/ios/ArSessionController.swift::writeSensorsLine`.
- `imu_high_rate.jsonl` (one JSON line per IMU sample at 100 Hz): `ts`, `orientation`, `angular_velocity`, `linear_acceleration` in the same units as the corresponding parquet columns.
- `camera_intrinsics.json` (one object per session): `device_model`, `platform`, `os_version`, `rgb { width, height, fps, fx, fy, cx, cy }` from `ARFrame.camera.intrinsics`; on LiDAR-equipped devices an additional `depth { width, height, fx, fy, cx, cy }` is included, with the depth intrinsics derived by scaling the RGB intrinsics to the depth resolution (`ArSessionController.writeCameraIntrinsicsJson`).
- `depth/{frame_index:06d}.png` (LiDAR-equipped devices only): 16-bit grayscale PNG. Values are unsigned millimeters, quantized from `ARFrame.sceneDepth.depthMap` (CVPixelBuffer of float32 meters) by clipping to `[0, 65535] mm`. Depth resolution from ARKit is 144 x 256.

These sidecars are not consumed by the LeRobotDataset loader. They are provided as the raw upstream of the parquet so downstream users can regenerate or validate the per-frame columns.

## Provenance

- **C2PA manifest** in every RGB MP4: ES256 signed by a leaf certificate issued by the RootLens authority. The active manifest includes a `c2pa.actions` block with `c2pa.placed.face_blur` performed by `Apple Vision`.
- **Solana Root NFT (Title Protocol cNFT)**: minted by Title Protocol's TEE after C2PA verification. The asset id is recorded in `meta/info.json` as `rootlens.root_nft_asset_id`.

## Loading

LeRobotDataset v3.0 is loaded with the [`lerobot`](https://github.com/huggingface/lerobot) library (>= 0.4.0):

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset
dataset = LeRobotDataset(repo_id_or_path)
```

Refer to the LeRobot documentation for the exact loading semantics for local directories vs. Hub-hosted repositories. The dataset is in the standard LeRobotDataset v3.0 layout, so no RootLens-specific loader code is required.

## Versioning

`rootlens.bundler_version` in `meta/info.json` identifies the bundler that produced a given dataset. This document describes `v1-wilor-mano`.
