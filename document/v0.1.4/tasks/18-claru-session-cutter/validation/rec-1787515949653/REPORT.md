# rec-1787515949653 exported clip validation

- Overall: **PASS**
- Clips: 19
- PASS / REVIEW / FAIL: 19 / 0 / 0
- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.
- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.

| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clip-001 | PASS | 222.978s | 6688 | 100.57 | 100.57 | 0.9843 | -5.395ms | 1455ms | PASS |
| clip-002 | PASS | 308.501s | 9253 | 100.57 | 100.57 | 0.9681 | +1.486ms | 1279ms | PASS |
| clip-003 | PASS | 213.461s | 6402 | 100.56 | 100.56 | 0.9768 | -1.091ms | 1331ms | PASS |
| clip-004 | PASS | 447.616s | 13426 | 100.56 | 100.56 | 0.9883 | -3.325ms | 1453ms | PASS |
| clip-005 | PASS | 518.951s | 15566 | 100.56 | 100.56 | 0.9744 | -2.775ms | 813ms | PASS |
| clip-006 | PASS | 124.603s | 3737 | 100.56 | 100.56 | 0.9678 | -1.726ms | 1481ms | PASS |
| clip-007 | PASS | 136.333s | 4089 | 100.56 | 100.56 | 0.9631 | -2.188ms | 177ms | PASS |
| clip-008 | PASS | 325.696s | 9769 | 100.56 | 100.56 | 0.9743 | -1.745ms | 533ms | PASS |
| clip-009 | PASS | 416.235s | 12485 | 100.56 | 100.56 | 0.9881 | -2.130ms | 683ms | PASS |
| clip-010 | PASS | 314.027s | 9419 | 100.56 | 100.56 | 0.9851 | +0.819ms | 1414ms | PASS |
| clip-011 | PASS | 368.832s | 11063 | 100.56 | 100.56 | 0.9767 | -0.141ms | 1787ms | PASS |
| clip-012 | PASS | 365.574s | 10965 | 100.56 | 100.56 | 0.9784 | +0.583ms | 727ms | PASS |
| clip-013 | PASS | 583.050s | 17489 | 100.56 | 100.56 | 0.9436 | +3.770ms | 1793ms | PASS |
| clip-014 | PASS | 220.181s | 6604 | 100.56 | 100.56 | 0.9125 | +3.005ms | 444ms | PASS |
| clip-015 | PASS | 478.249s | 14345 | 100.57 | 100.57 | 0.8760 | +5.334ms | 372ms | PASS |
| clip-016 | PASS | 713.067s | 21389 | 100.56 | 100.56 | 0.9806 | +2.865ms | 1725ms | PASS |
| clip-017 | PASS | 810.648s | 24316 | 100.55 | 100.55 | 0.8782 | +5.521ms | 121ms | PASS |
| clip-018 | PASS | 154.746s | 4641 | 100.56 | 100.56 | 0.9856 | -3.227ms | 1743ms | PASS |
| clip-019 | PASS | 305.219s | 9155 | 100.56 | 100.56 | 0.9664 | -1.561ms | 359ms | PASS |

## Decision rule

A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.
