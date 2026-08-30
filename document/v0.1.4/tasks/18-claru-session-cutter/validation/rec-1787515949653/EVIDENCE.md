# rec-1787515949653 delivery evidence

## Result

`/Users/forest/Downloads/RootLens-Claru-RF-20260825-112613` の19クリップは、
独立監査で `PASS 19 / REVIEW 0 / FAIL 0` となった。

- R2配置: `raw/<content_hash>/`
- manifest: 各clipとも `rgb.mp4 / frames.jsonl / imu.jsonl / metadata.json` の4ファイル
- 合計: 7,027.968342秒、210,801 video frames、707,006 accelerometer samples、
  707,007 gyroscope samples、10,641,179,158 video bytes
- 原本RGB SHA-256: `1d5cbd20521880113aa1ab939d3bd8f36d60771e76029e35690f4dee7e278926`
- 19件の`segmentation.source_content_hash`はすべて上記原本hashと一致

## Recording-level RGB–IMU model

原本内の5つの独立した5分windowを使い、長尺原本全体に1つのaffine modelを適用した。
clipごとの補正値は作っていない。

- window相関: 0.955760–0.984577
- 全windowの最良pair: `rotation_vs_gyro_z`
- camera→IMU rate correction: −30.353257 ppm
- affine fitの最大window残差: 2.010564 ms
- clip別独立監査の最小相関: 0.875987
- clip別独立監査の最大絶対残差: 5.520710 ms
- clip別最良pair: 19/19で`rotation_vs_gyro_z`
- clock差とsensor-validity residualは分離せず、1つのcamera→IMU modelとして表現
- 追加の`video_to_imu_offset_ns`: 0
- 納品metadata内の`mapping_method`: 19/19で不在

## Structural and media checks

- H.264 1920×1080 video + AAC mono 48kHz audio: 19/19 pass
- video/audio full decode with FFmpeg `-xerror`: 19/19 pass
- content hash再計算: 19/19 pass
- MP4 packet数 = `frames.jsonl`行数 = metadata frame数: 19/19 pass
- frame index / MP4 sample index連続: 19/19 pass
- raw camera / canonical camera / MP4 PTS単調増加: 19/19 pass
- 最大video frame gap: 33.359246 ms
- accelerometer / gyroscope sample index連続・timestamp単調増加: 19/19 pass
- accelerometer最大gap: 9.946209 ms
- gyroscope最大gap: 9.946125 ms
- accelerometer実測rate: 100.553042–100.573268 Hz
- gyroscope実測rate: 100.553042–100.573268 Hz
- 全frameでaccelerometer/gyroscopeのbefore/after sampleがassociation timestampを挟む: 19/19 pass
- clip先頭・末尾の映像decodeと非black frame: 19/19 pass
- internal cut / video re-encode / audio re-encode: 19/19でなし

## Boundary note

H.264 bitstreamを再エンコードしないため、開始は直前のkeyframeへ安全側にsnapしている。
選択境界より前に含まれる時間は121–1,793 ms（19clip合計19,690 ms）。終了側は選択境界で切られる。
これは破損や同期ずれではないが、選択した開始時刻と可視ファイル開始が完全一致するという意味ではない。

## Evidence hashes

- boundary JSON: `fe28a0d24053ce5adcd40ab8b9ccd04d4a6d276ae0f45f3c3998ff569757b070`
- internal clock audit JSON: `f59295821b6ec0c71a33f6c170df4bf8dbde4c52709360114042e673d09c7cd1`
- per-clip validation JSON: `3d751e5c9d9203fcd9962ee1874ea69e370aae83991985815cf31b6449cbbdda`
- rendered Markdown report: `b5f3c1fa62985306b18610d2db117b3ab55ec996cefb299d6d7737e9e4e22b0f`

