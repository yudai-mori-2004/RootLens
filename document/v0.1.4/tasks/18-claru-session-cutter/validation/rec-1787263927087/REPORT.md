# rec-1787263927087 exported clip validation

- Overall: **PASS**
- Clips: 4
- PASS / REVIEW / FAIL: 4 / 0 / 0
- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.
- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.

| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clip-001 | PASS | 628.620s | 18856 | 100.57 | 100.57 | 0.9848 | -0.790ms | 1276ms | PASS |
| clip-002 | PASS | 616.021s | 18478 | 100.57 | 100.57 | 0.9858 | +0.911ms | 612ms | PASS |
| clip-003 | PASS | 806.083s | 24179 | 100.57 | 100.57 | 0.9862 | -0.846ms | 272ms | PASS |
| clip-004 | PASS | 393.110s | 11791 | 100.56 | 100.56 | 0.9826 | -1.644ms | 406ms | PASS |

## Packet timestamp follow-up

- Video packet DTS: 0 nonmonotonic values across 73,304 packets.
- Audio packet DTS: 0 nonmonotonic values across 114,553 packets.
- Three full-decode runs emitted warnings from ffmpeg's null output muxer. The delivered MP4 packet DTS and `frames.jsonl` timestamps are strictly monotonic, all streams decoded to completion, and the warnings do not indicate a defect in the delivered files.

## Decision rule

A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.
