# rec-1787267373237 exported clip validation

- Overall: **PASS**
- Clips: 9
- PASS / REVIEW / FAIL: 9 / 0 / 0
- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.
- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.

| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clip-001 | PASS | 1018.604s | 30554 | 100.57 | 100.57 | 0.9789 | -3.699ms | 1695ms | PASS |
| clip-002 | PASS | 408.774s | 12261 | 100.57 | 100.57 | 0.8487 | +1.743ms | 1782ms | PASS |
| clip-003 | PASS | 263.300s | 7897 | 100.57 | 100.57 | 0.9716 | -6.715ms | 1048ms | PASS |
| clip-004 | PASS | 1055.609s | 31664 | 100.57 | 100.57 | 0.9823 | -5.337ms | 491ms | PASS |
| clip-005 | PASS | 129.301s | 3878 | 100.58 | 100.58 | 0.9806 | +5.258ms | 1942ms | PASS |
| clip-006 | PASS | 293.501s | 8803 | 100.57 | 100.57 | 0.9810 | +2.229ms | 1841ms | PASS |
| clip-007 | PASS | 938.360s | 28147 | 100.57 | 100.57 | 0.9752 | +2.144ms | 746ms | PASS |
| clip-008 | PASS | 899.756s | 26989 | 100.56 | 100.56 | 0.8128 | +11.723ms | 772ms | PASS |
| clip-009 | PASS | 281.920s | 8456 | 100.57 | 100.57 | 0.9674 | +1.722ms | 1031ms | PASS |

## Packet timestamp follow-up

- Video packet DTS: 0 nonmonotonic values across 158,649 packets.
- Audio packet DTS: 0 nonmonotonic values across 247,925 packets.
- The delivered MP4 packet DTS and `frames.jsonl` timestamps are strictly monotonic, and all streams decoded to completion.

## Decision rule

A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.
