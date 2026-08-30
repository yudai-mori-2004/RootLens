# rec-1787515949653 normalized delivery verification

- Delivery root: `/Users/forest/Downloads/RootLens-Claru-RF-20260825-DELIVERY`
- Clip count: 19
- Required four-file manifest: 19/19
- Exporter tests: 10/10 passed
- `rgb.mp4`: byte-identical to the independently audited export for 19/19 clips
- `imu.jsonl`: byte-identical to the independently audited export for 19/19 clips
- `frames.jsonl`: row count unchanged and equal to `video_frame_count` for 19/19 clips
- Affine clock model: numerically unchanged for 19/19 clips
- Internal method/fit/separation diagnostics: absent from delivery metadata
- Invalid legacy host-clock field names: absent from delivery frame rows

The prior independent media and RGB↔IMU audit remains applicable because the
MP4 bytes, raw IMU bytes, canonical timestamps, associations, and numerical clock
models were not changed. Its result was PASS 19 / REVIEW 0 / FAIL 0. This
normalization only removed non-contract diagnostic fields and legacy field names.

The source audit and fit evidence remain internal under this task directory and
`tmp/claru-clock-audits`; they are not part of the four-file delivery manifest.
