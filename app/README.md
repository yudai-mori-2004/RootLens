# RootLens Capture App

An iPhone app (React Native + Expo, with native Swift modules) that records
egocentric video of real work and uploads the raw recording sessions that
become robot-learning training data. Settings expose three capture methods:

- **iPhone ARKit** records RGB + ARKit/LiDAR/VIO sensor outputs on this phone.
- **Mentra** is an external-device method. The phone shutter is intentionally
  disabled because capture and upload are controlled on the glasses.
- **iPhone** records ultra-wide RGB + microphone audio + raw accelerometer and
  gyroscope samples on this phone, without starting ARKit.

Mentra Live用のAndroid capture stackは、iPhone/ARKit実装と分離して
[`mentra-os/`](../mentra-os/README.md) に置く。

The recording rig is an iPhone Pro mounted on the worker's head. Recording is
hands-free: the operator can choose gestures, spoken commands, or iOS physical
volume buttons as parallel start/stop control flows, so the screen is not needed
while working.

## What an iPhone ARKit recording produces

Each recording session is a directory of files on a shared clock. Every sensor
timestamp is nanoseconds on the same monotonic time base, so streams align
without post-hoc synchronization.

| File | Content |
|---|---|
| `rgb.mp4` | H.264 video from the rear wide camera, full-sensor 4:3 (1920x1440), fragmented MP4 so a crash loses at most the last 10 seconds |
| `frames.jsonl` | One row per video frame: camera pose (4x4, ARKit world frame), intrinsics, tracking state, an IMU snapshot, and realtime hand landmarks. Row `i` corresponds to mp4 frame `i`; a row is written only after its frame lands in the mp4, so the pairing holds by construction |
| `imu.jsonl` | Accelerometer, gyroscope, and device motion at the configured rate (100 Hz default) |
| `metadata.json` | Delivered-file manifest, schema version, device/OS/app, camera sensor rate, requested/effective output rates, encoding/timebase, intrinsics, measured stream counts/ranges, thermal events, and battery drain |
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

## iPhone RGB + IMU contract

The non-ARKit **iPhone** method has the same delivered-file manifest as Mentra:

| File | Content |
|---|---|
| `rgb.mp4` | Rear ultra-wide H.264, 1920x1080 at 30 fps, with mono AAC microphone audio at 48 kHz |
| `frames.jsonl` | One row per appended MP4 video sample, including the raw capture timestamp, canonical/input-port mapping, host-clock diagnostic, MP4 PTS, residual video-to-IMU offset, and neighboring accelerometer/gyroscope indices and timestamps |
| `imu.jsonl` | Raw accelerometer (m/s²) and gyroscope (rad/s) samples with their unmodified Core Motion timestamps |
| `metadata.json` | Capture settings, measured stream counts/failures, camera facts, timestamp sources, calibration audit fields, and the exact four-file delivered manifest |

`CMSampleBuffer.presentationTimeStamp` is expressed on
`AVCaptureSession.synchronizationClock`, while Core Motion timestamps are
boot-relative. Following Apple's documented Core Motion synchronization example,
every video timestamp is reverse-mapped to `AVCaptureInput.Port.clock` with
`CMSyncConvertTime`, which accounts for the clocks' offset and measured drift.
The same source timestamp is also mapped to `CMClockGetHostTimeClock()` and
retained as an independent diagnostic.
`frames.jsonl` keeps the unmodified capture timestamp in `timestamp_ns` and
`camera_sensor_timestamp_ns`, the canonical mapping in
`video_frame_timestamp_canonical_ns` and `camera_timestamp_mapped_input_port_clock_ns`,
and the host diagnostic in `camera_timestamp_mapped_system_uptime_ns`.
Frame-to-IMU association uses only the canonical mapping. Clock rates, anchor
pairs, and each mapping's difference from `ProcessInfo.systemUptime` at recording start
are copied into metadata so a delivered clip can be audited without inferring
the mapping from image motion.

The remaining observable end-to-end sensor/pipeline residual can be measured
from a five-minute Settings recording made through the exact same session and
recorder as production capture. Only a repeatable result is persisted. The
stored residual is reused on that device until remeasurement and is used only
for frame-to-IMU association; raw video and IMU timestamps are never rewritten.
The calibration record is stored per device model and ultra-wide camera, and is
copied into each clip's metadata for auditability. After the existing
content-hash step identifies the immutable MP4, the iPhone config's own
finalization hook adds `content_hash` and
`video_bytes` to metadata before upload; the generic pipeline does not edit
config-specific JSON.

## Architecture

```
app/
├── modules/                 Native Swift (Expo modules)
│   ├── arkit-capture/       Native measurement core with peer ARKit and
│   │                        AVCapture/Core Motion controllers. They share hand
│   │                        tracking, orientation, and RGB-IMU residual analysis
│   │                        while keeping camera-session implementations separate
│   └── content-hash/        SHA-256 over multi-GB files via CryptoKit
└── src/
    ├── dataflow/            UI-independent data layer: the clip store, the
    │                        recording-config registry, and the resumable upload
    │                        pipeline (hash → presigned R2 upload → registration).
    │                        Nothing here imports React
    ├── screens/             Capture, clip list, settings, login
    ├── components/          Clip cards, local upload consent, and remote Mentra review
    ├── services/            Auth (Supabase), capture settings, sound cues
    └── domain/              Gesture debouncing
```

A clip's identity is the SHA-256 of its raw mp4 bytes, computed on the device.
It serves as the storage key and the database primary key, and gives end-to-end
integrity for the video from device to consumer.

For iPhone captures, the wearer reviews each local clip and records consent
before upload. The upload is stage-resumable (hash, upload, register), so a
failed or interrupted upload retries without redoing finished work. Mentra
captures follow the field-device path: the glasses upload under the signed-in
site account first, and the same account reviews the remote clip in this app.
The resulting consent event is attached to that existing content-hash row;
unreviewed Mentra clips never appear in the consented history or its totals.

## Development

```bash
npm install
cd ios && LANG=en_US.UTF-8 pod install && cd ..
npx expo run:ios --device        # native modules require a real device
```

Production builds ship through EAS (`eas build --platform ios --profile
production`). Environment template: `.env.example`.
