# Hand visibility QC

macOSのApple VisionでMP4の全フレームを検査し、少なくとも片手を検出できたフレームの割合を出す。
Claruの`hands visible in at least 80% of frames`に対する納品前QC用。

判定はiOSアプリの既存Hand Pose設定に揃える。

- `VNDetectHumanHandPoseRequestRevision1`
- 最大2手
- observation confidence 0.3以上
- 片手以上を検出したフレームを`hand_visible=true`

これはフレーム内の手の存在判定であり、装着者と第三者の手は区別しない。

```sh
xcrun swift tools/hand-visibility-qc/hand_visibility_qc.swift \
  /path/to/rgb.mp4 \
  --report /path/to/hand_visibility_report.json \
  --details /path/to/hand_visibility_frames.jsonl
```

`--limit N`を付けると先頭Nフレームだけで速度と閾値を確認できる。本番QCでは付けない。
長い動画を分割処理する場合は、`--skip-frames`と`--limit`で非重複フレーム区間を指定する。
skip区間はデコードだけ行い、Vision推論は実行しない。全区間の集計フレーム数が元動画の
フレーム数と一致することを確認する。
