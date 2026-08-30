# rec-1787515949653 exported clip validation

- Overall: **PASS**
- Clips: 2
- PASS / REVIEW / FAIL: 2 / 0 / 0
- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.
- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.

| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clip-001 | PASS | 1150.581s | 34513 | 100.56 | 100.56 | 0.9911 | +2.110ms | 1088ms | FAIL |
| clip-002 | PASS | 698.099s | 20940 | 100.56 | 100.56 | 0.9910 | +0.851ms | 586ms | FAIL |

## Decision rule

A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.
