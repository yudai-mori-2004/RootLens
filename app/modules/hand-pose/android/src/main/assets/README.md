# MediaPipe HandLandmarker model asset

このディレクトリに `hand_landmarker.task` を配置する必要があります。

## ダウンロード

```sh
curl -L -o hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

## 参照

- https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/index
- ライセンス: Apache 2.0
- サイズ: ~7MB (float16)

build.gradle で `noCompress 'task'` 指定済み (`.task` は既に圧縮ファイルのため再圧縮を抑制)。
