# rec-1787528213668 exported clip validation

- Overall: **PASS**
- Clips: 6
- PASS / REVIEW / FAIL: 6 / 0 / 0
- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.
- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.

| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clip-001 | PASS | 631.302s | 18936 | 100.57 | 100.57 | 0.9759 | -4.617ms | 1761ms | PASS |
| clip-002 | PASS | 508.712s | 15259 | 100.56 | 100.56 | 0.9750 | -0.855ms | 1675ms | PASS |
| clip-003 | PASS | 540.395s | 16209 | 100.56 | 100.56 | 0.9803 | -0.440ms | 303ms | PASS |
| clip-004 | PASS | 1835.520s | 55059 | 100.56 | 100.56 | 0.9641 | -0.919ms | 379ms | PASS |
| clip-005 | PASS | 560.678s | 16818 | 100.56 | 100.56 | 0.9898 | +0.109ms | 428ms | PASS |
| clip-006 | PASS | 587.213s | 17614 | 100.56 | 100.56 | 0.9899 | -3.645ms | 77ms | PASS |

## Packet timestamp follow-up

- Video packet DTS: 0 nonincreasing values across 139,895 packets.
- Audio packet DTS: 0 nonincreasing values across 218,614 packets.
- The source packet DTS, exported `frames.jsonl` timestamps, and canonical camera timestamps are strictly monotonic in all six clips.

## Decision rule

A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.
