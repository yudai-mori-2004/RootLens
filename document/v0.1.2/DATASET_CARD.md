# RootLens Egocentric Household Dataset

Per-clip multimodal recordings of household tasks captured on consumer iPhones, distributed in the [LeRobotDataset v3.0](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3) format used across HuggingFace robotics pipelines.

## At a glance

| | |
|---|---|
| **Format** | LeRobotDataset v3.0 (Apache Parquet + H.264 MP4) |
| **Granularity** | 1 dataset = 1 episode = 1 captured clip |
| **Modalities** | RGB video, 6-DoF camera pose, IMU (orientation + angular velocity + linear acceleration), AR tracking state, 21-joint 3D hand keypoints per hand, two-hand wrist action signal, LiDAR depth (Pro devices) |
| **Recording device** | iPhone (LiDAR optional, see `camera_intrinsics.json`) |
| **Capture framework** | Apple ARKit (`worldAlignment = .gravity`, `frameSemantics = .sceneDepth`) |
| **Distribution** | Per-clip, fetched directly from the dataset prefix; loadable via `LeRobotDataset(repo_id_or_path)` |
| **Privacy treatment** | Per-frame face blur via OpenCV YuNet, embedded C2PA manifest signed by RootLens (`c2pa.placed.face_blur`) |
| **Provenance** | Solana Root NFT (Title Protocol cNFT) bound to the signed video's content hash; the asset id is embedded in `meta/info.json` |
| **Hand pose model** | WiLoR-mini (`pred_keypoints_3d`, MANO canonical space) |

## Schema overview

Conforms to LeRobotDataset v3.0. Directory layout per dataset:

```
<root>/
├── meta/
│   ├── info.json                                       # schema + RootLens provenance
│   ├── tasks.jsonl                                     # task description, integer index
│   ├── stats.json                                      # placeholder (no per-feature stats v1)
│   └── episodes/chunk-000/file-000.parquet             # episode segmentation record
├── data/chunk-000/file-000.parquet                     # per-frame observations
└── videos/observation.images.ego_cam/chunk-000/
    └── file-000.mp4                                    # H.264 RGB, face-blurred, C2PA-signed
```

### Per-frame columns (`data/chunk-000/file-000.parquet`)

All columns use LeRobotDataset v3 naming conventions (`observation.*`, `action`, `timestamp`, `frame_index`, `episode_index`, `index`, `task_index`).

| Column | dtype | Shape | Description |
|---|---|---|---|
| `timestamp` | float32 | scalar | Seconds since clip start. |
| `frame_index` | int64 | scalar | Index within the episode. |
| `episode_index` | int64 | scalar | Always 0 in single-clip datasets. |
| `index` | int64 | scalar | Global row index. |
| `task_index` | int64 | scalar | Index into `tasks.jsonl`. |
| `observation.images.ego_cam` | video (file ref) | [3, H, W] | RGB H.264, face-blurred. H, W match the recording device (typically 1080x1920 portrait or rotated landscape). |
| `observation.state` | float32 | [7] | ARKit camera 6-DoF in world frame: `[x, y, z, qx, qy, qz, qw]`. World aligned to gravity; origin at ARKit session start. |
| `observation.imu_orientation` | float32 | [4] | Device attitude quaternion `[qx, qy, qz, qw]` from CMDeviceMotion, sampled at the RGB frame instant. |
| `observation.imu_angular_velocity` | float32 | [3] | Gyroscope (rad/s). |
| `observation.imu_linear_acceleration` | float32 | [3] | Accelerometer (m/s^2) including gravity. Static device reads roughly 9.81 m/s^2 in magnitude. |
| `observation.tracking_state` | int8 | [1] | ARCamera tracking state: `0 = notAvailable`, `1 = limited`, `2 = normal`. Filter on `>= 1` for usable frames. |
| `observation.hand_keypoints_3d` | float32 | [2, 21, 3] | 21-joint 3D hand keypoints per hand `[left, right]` in MANO canonical hand-local space (origin at wrist). Joints follow the MANO ordering. |
| `observation.hand_present` | bool | [2] | Per-hand detection flag `[left, right]`. |
| `observation.hand_pose_mano` | float32 | [2, 48] | MANO axis-angle pose: global rotation (3) concatenated with 15 finger joint rotations (15 x 3 = 45). Extracted from WiLoR-mini `global_orient` + `hand_pose`. |
| `observation.hand_shape_mano` | float32 | [2, 10] | MANO shape coefficients (beta). Zero-filled (neutral hand mean shape) since the upstream hand pose model does not return per-subject shape parameters. |
| `action` | float32 | [14] | Two-hand wrist 6-DoF concatenated: `[lh_x, lh_y, lh_z, lh_qx, lh_qy, lh_qz, lh_qw, rh_x, rh_y, rh_z, rh_qx, rh_qy, rh_qz, rh_qw]`. Wrist translation comes from WiLoR-mini's `pred_cam_t_full` and is expressed in WiLoR's **weak-perspective MANO-canonical units** (the MANO neutral hand is roughly 2 units wide, so `z` of 10-34 corresponds to roughly 5-17 hand-widths away from the camera). All three of x, y, z share this convention; none are metric meters. Wrist rotation is the unit quaternion form of WiLoR-mini's `global_orient` axis-angle. To recover metric world coordinates: combine `action` with `camera_intrinsics.json` (focal pixels) and either an assumed MANO neutral-hand size (~17 cm in the literature) or, on LiDAR-equipped devices, the sampled depth at the wrist pixel from `observation.depth`. Compatible with EgoMimic / EgoVLA action conventions. |

Companion side files (uploaded alongside the dataset, not part of the LeRobot loader contract):

- `sensors.jsonl` (30 Hz, one line per RGB frame)
- `imu_high_rate.jsonl` (100 Hz CMDeviceMotion samples)
- `camera_intrinsics.json` (RGB intrinsics; LiDAR intrinsics on Pro devices)
- `depth/{frame_index:06d}.png` (16-bit grayscale depth, 144 x 256, millimeters; LiDAR-equipped iPhones only)

### `meta/info.json` extensions

Standard LeRobot v3 fields (`features`, `fps`, `total_episodes`, `total_frames`, `data_path`, `video_path`, ...) plus a `rootlens` block:

```json
{
  "rootlens": {
    "root_nft_asset_id": "0x...",          // Solana cNFT (Title Protocol)
    "content_hash": "<sha256 hex>",        // SHA-256 of the face-blurred MP4
    "signed_json_uri": "...",              // Title Protocol storage URI (when available)
    "c2pa_signer_cert_chain_sha256": "...",
    "pipeline_version": "v0.1.2",
    "bundler_version": "v1-wilor",
    "captured_at": "<ISO 8601>"
  }
}
```

Every dataset can therefore be cross-referenced to the on-chain Solana Root NFT and back to the device-side capture without trusting RootLens as an authority.

## Quality metrics

Each clip carries a 0-100 quality score (`meta/info.json` extension, also surfaced via the issuance API). The components are:

- `>= 40%` frames with at least one detected hand
- `>= 30%` frames with both hands detected
- `>= 70%` frames with any hand detected
- `>= 80%` depth-valid coverage (LiDAR-equipped devices only)
- `>= 90%` RGB / depth / IMU sync ratio
- IMU gravity vector within 0.5 m/s^2 of the gravitational constant
- Zero dropped RGB frames

These match the operational benchmarks used in the broader egocentric measurement literature so quality is comparable across providers.

## Provenance and integrity

- **C2PA signature** ("signature S" in RootLens terminology): every RGB MP4 in `videos/` carries an active C2PA manifest issued by RootLens. The signer's certificate chains up to the RootLens development authority (production deployments will roll a CA-signed leaf without changing the manifest format). Manifests include `c2pa.placed.face_blur` actions performed by YuNet.
- **Solana Root NFT** (Title Protocol cNFT): minted in a TEE that has read the signed MP4. The Root NFT's `content_hash` attribute equals the SHA-256 of the face-blurred MP4 that ships in `videos/`. Verification path: parse `info.json`'s `root_nft_asset_id` -> read the cNFT on Solana -> compare `content_hash`.
- **TEE attestation**: returned alongside Root NFT issuance; available via the `signed_json_uri`.

This makes each clip independently auditable: a third party can clone the dataset, recompute the video's SHA-256, fetch the matching cNFT, and verify the C2PA manifest, all without contacting RootLens.

## Loader example

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

# Local copy (after downloading datasets/<root_asset_id>/ from the distribution endpoint)
dataset = LeRobotDataset("/path/to/dataset_dir")

print(dataset.num_frames, "frames")
print(dataset.features)

sample = dataset[0]
rgb = sample["observation.images.ego_cam"]      # torch.Tensor [3, H, W]
cam_pose = sample["observation.state"]          # [7]
hand_kp = sample["observation.hand_keypoints_3d"]  # [2, 21, 3]
action = sample["action"]                       # [14]
```

For streaming-from-Hub workflows (`StreamingLeRobotDataset`, `lerobot-imgtransform-viz`, etc.) follow the official LeRobot documentation; no RootLens-specific adapter is needed.

## Comparison

| | RootLens (this) | [Ego4D](https://ego4d-data.org/) | [EgoExo4D](https://ego-exo4d-data.org/) | [Stera-10M](https://huggingface.co/datasets/fpvlabs/stera-10m) |
|---|---|---|---|---|
| Capture device | iPhone (LiDAR optional) | varied | varied including Project Aria | iPhone Pro (LiDAR) |
| Modalities | RGB + 6-DoF + IMU + depth (Pro) + hand kp 3D + action | RGB + audio + IMU + 3D meshes + gaze | RGB + multiple egocentric views + audio + gaze + hand pose | RGB + depth + IMU + 6-DoF + MANO hand mocap |
| Hand pose | 21-joint 3D (MANO canonical), per-frame | annotation subset | annotation subset | full MANO, per-frame |
| Distribution format | LeRobotDataset v3 | custom CSV + MP4 | custom JSON + MP4 | MP4 + HDF5 (released form) |
| Verifiability | C2PA + Solana cNFT, per clip | none | none | none |
| Licensing | per-clip license via on-chain NFT | research only | research only | gated research access |

## Versioning

This document describes RootLens dataset format version `v0.1.2`. Bundler version is recorded per dataset in `meta/info.json` (`rootlens.bundler_version`). Buyer-side loaders should treat unknown bundler versions as forward-compatible: schema is fixed (LeRobot v3 + the `rootlens.*` block), only column values evolve.

## Roadmap (schema unchanged)

- Per-subject MANO shape estimation (currently `observation.hand_shape_mano` is the neutral mean): could be added when a hand-shape estimator becomes available without a non-commercial license attached to MANO outputs.
- Optional `observation.hand_vertices` column for the 778-vertex MANO mesh (off by default; large parquet impact).
- Higher-rate IMU as a parallel parquet alongside the RGB-aligned 30 Hz `observation.imu_*` columns (raw 100 Hz samples are shipped in `imu_high_rate.jsonl`).
- World-space wrist 6-DoF derivable by composing `action` (camera-space wrist) with `observation.state` (camera 6-DoF). Loaders can do this on the fly; we intentionally ship raw camera-space values for forward compatibility.

## Contact / access

Per-dataset license issuance and access tokens are documented separately in the RootLens platform docs. The format described here is stable and intended to remain backwards-compatible at the column-and-shape level.
