# RootLens Capture App

An iPhone app (React Native + Expo, with native Swift modules) that records
egocentric video of real work together with ARKit measurements, and uploads the
raw recording sessions that become robot-learning training data.

Mentra Live用のAndroid capture stackは、iPhone/ARKit実装と分離して
[`mentra-os/`](../mentra-os/README.md) に置く。

The recording rig is an iPhone Pro mounted on the worker's head. Recording is
hands-free: an open-palm gesture starts a session and a thumbs-up gesture stops
it, with voice guidance, so the wearer never touches the screen while working.

## What a recording produces

Each recording session is a directory of files on a shared clock. Every sensor
timestamp is nanoseconds on the same monotonic time base, so streams align
without post-hoc synchronization.

| File | Content |
|---|---|
| `rgb.mp4` | H.264 video from the rear wide camera, full-sensor 4:3 (1920x1440), fragmented MP4 so a crash loses at most the last 10 seconds |
| `frames.jsonl` | One row per video frame: camera pose (4x4, ARKit world frame), intrinsics, tracking state, an IMU snapshot, and realtime hand landmarks. Row `i` corresponds to mp4 frame `i`; a row is written only after its frame lands in the mp4, so the pairing holds by construction |
| `imu.jsonl` | Accelerometer, gyroscope, and device motion at the configured rate (100 Hz default) |
| `metadata.json` | Static facts: device model, OS, app version, camera resolution and intrinsics, capture settings, thermal events, battery drain |
| `depth.tar` | LiDAR depth, one 16-bit PNG (millimeters) per frame under `depth/`, with the matching ARKit confidence map (8-bit, low/medium/high) under `confidence/`. LiDAR devices only |
| `pointcloud.jsonl` | ARKit VIO feature points per frame, world coordinates, raw float32 bytes |
| `mesh.jsonl` | ARKit scene-reconstruction mesh anchors, raw vertex and face buffers |
| `arkit_imu.jsonl` | One row per ARFrame (full sensor rate, sampling-independent): VIO camera orientation quaternion, angular velocity from the quaternion delta between consecutive frames, tracking state and reason |
| `device_metrics.jsonl` | One row per ARFrame: battery level/state, thermal state, per-thread CPU usage, resident memory footprint, grantable memory. Values refresh every 500 ms under each frame's own timestamp |

`metadata.json` additionally gains, at stop: per-stream counts and time ranges,
expected sampler slots, append failures, tracking-pause accounting, the
camera-IMU extrinsic estimate (hand-eye solve over the session's first
well-excited window, cached per device model), and a labeled static IMU noise
model (`source: "static_defaults"`).

Older clips name the per-frame track `realtime_handpose.jsonl`; the schema is
identical. Clips recorded before the per-ARFrame streams existed simply lack
those two files; the delivery pipeline degrades their topics to empty channels.

### Data fidelity

The data is used for research, so the app applies as little processing as
possible. The complete list of transforms between sensor and file:

- Video is H.264-encoded (inherently lossy). Rotation is stored as an MP4
  metadata flag; pixels are never resampled.
- Depth is quantized from float32 meters to uint16 millimeters. NaN becomes 0,
  the conventional RGB-D sentinel for missing data. The PNG container is
  lossless.
- The IMU `accel` field is the sum of user acceleration and gravity; both raw
  components are also stored under `device_motion`, so nothing is lost.

Everything else, including poses, intrinsics, confidence maps, feature points,
and mesh geometry, is written verbatim.

## Architecture

```
app/
├── modules/                 Native Swift (Expo modules)
│   ├── arkit-capture/       The measurement core: owns the ARSession, encodes
│   │                        video, and streams every sensor file listed above
│   │                        (ArSessionController, DepthTarWriter, PixelEncoders,
│   │                        MeshExporter, HandTracker, WearerHandClassifier)
│   └── content-hash/        SHA-256 over multi-GB files via CryptoKit
└── src/
    ├── dataflow/            UI-independent data layer: the clip store, the
    │                        recording-config registry, and the resumable upload
    │                        pipeline (hash → presigned R2 upload → registration).
    │                        Nothing here imports React
    ├── screens/             Capture, clip list, settings, login
    ├── components/          Clip cards, the upload-consent modal
    ├── services/            Auth (Supabase), capture settings, sound cues
    └── domain/              Gesture debouncing
```

A clip's identity is the SHA-256 of its raw mp4 bytes, computed on the device.
It serves as the storage key and the database primary key, and gives end-to-end
integrity for the video from device to consumer.

Uploads are deliberate, never automatic: the wearer reviews each clip and
records consent before anything leaves the device. The upload is stage-resumable
(hash, upload, register), so a failed or interrupted upload retries without
redoing finished work. Recording works fully offline and without an account;
signing in is required only at upload time.

## Development

```bash
npm install
cd ios && LANG=en_US.UTF-8 pod install && cd ..
npx expo run:ios --device        # native modules require a real device
```

Production builds ship through EAS (`eas build --platform ios --profile
production`). Environment template: `.env.example`.
