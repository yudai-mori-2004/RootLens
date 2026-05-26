# パイプライン設計変更: プライバシーぼかしの端末移管

日付: 2026-05-21

## 変更内容

顔ぼかし処理を Pipeline 2 (サーバ側) から Pipeline 1 (端末側) に移管する。

**変更前:**
- Pipeline 1 (端末): 撮影のみ。生映像をアップロード
- Pipeline 2 (サーバ): YuNet (OpenCV) でぼかし + C2PA + quality + TP register

**変更後:**
- Pipeline 1 (端末): 撮影 + Apple Vision (`VNDetectFaceRectangles`) でぼかし。ぼかし済み映像をアップロード
- Pipeline 2 (サーバ): C2PA + quality + TP register (ぼかし処理は受け取らない)

## 理由

YuNet (OpenCV 同梱) は誤検出率が高く、拳や手を顔として検出してしまう。特に家事操作のような手が映り込む ego-centric 動画で顕著。Apple Vision の `VNDetectFaceRectangles` は顔の構造特徴に基づく検出を行うため精度が高い。

端末側でぼかすことで、生の顔映像がネットワークを流れない利点もある。

## 影響範囲

- `server/modal/blur.py`: YuNet ぼかし処理を削除。C2PA + quality のみ残す
- `server/modal/lp_bundle.py`: YuNet ぼかし処理を削除
- `server/modal/models/face_detection_yunet_2023mar.onnx`: 削除対象
- iOS アプリ: 撮影後に Apple Vision でぼかし処理を実行してからアップロード

## LP サンプル動画の対応

LP サンプル (v0.1) の 48 本は iPhone 純正カメラで撮影し、サーバ側 YuNet でぼかしたもの。拳の誤検出が含まれている。Mac 上で Apple Vision を使って再処理し、R2 に再アップロードする。
