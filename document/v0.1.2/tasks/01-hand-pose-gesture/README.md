# Task 01: Hand Pose + Gesture Detection

## 目的

撮影中にリアルタイムで両手の 3D hand pose を取得し、特定のジェスチャーで撮影開始/終了のトリガーを切れることを実機検証する。

## 背景

### なぜ hand pose が必要か

1. **データ品質の担保**: buyer (Figure, π0.5, GR00T 等) が求める egocentric 家事データは「両手がフレーム内に映っている」ことが前提。Apple EgoDex (829hr, ICLR 2025) はフレームレートで 3D hand pose を同梱しており、2026 年時点の市場品質バーは「21 関節の hand pose が撮影時に取れていること」。
2. **ユーザーガイド**: 両手がフレーム外に出たら警告を出し、正しい撮影姿勢を維持してもらう。セキュリティ機構ではなく、品質ガイド。
3. **ジェスチャートリガー**: 両手がふさがった状態で撮影するユースケースにおいて、画面タップ以外の開始/終了手段が必要。特定の手の形 (例: サムズアップ) をトリガーにする。

### なぜ 21 関節か

iOS Vision `VNHumanHandPoseObservation` と Android MediaPipe HandLandmarker はどちらも手あたり 21 landmark を返す (wrist ×1 + 各指 ×4)。これが業界標準であり、EgoDex もこの粒度。遮蔽時は joint ごとに confidence (0-1) が返るため、取れた分 + confidence をそのまま記録する。

## 検証内容

### Phase 1: リアルタイム 21 関節取得

- iOS: `VNDetectHumanHandPoseRequest` でカメラフレームごとに両手の 21 関節座標 + confidence を取得
- Android: MediaPipe HandLandmarker で同等の取得
- フレームレート (30fps) で安定して取れるか、遅延はどの程度か
- 片手 / 両手 / 遮蔽時の挙動を確認

### Phase 2: ジェスチャー判定

- 21 関節の座標から特定ポーズを判定 (関節角度の閾値ベース)
- 最低限: サムズアップ (開始) / パー (終了) 等、2 種のジェスチャーを区別
- 判定の安定性 (連続 N フレームで確定、チャタリング防止)

### Phase 3: カメラプレビュー + hand pose overlay

- カメラプレビュー上に hand landmark を描画
- 両手がフレーム外に出たら警告 UI
- ジェスチャー検出時にフィードバック (色変化等)

## 実装方針

Expo Modules API で hand-pose ネイティブモジュールを新設 (`app/modules/hand-pose/`)。v0.1.1 の sensor-session と同じパターン。

## 完了条件

- [ ] iOS / Android 実機でカメラプレビュー + 21 関節 overlay が 30fps で動く
- [ ] 両手フレーム外検出 → 警告 UI
- [ ] 2 種以上のジェスチャーを安定して区別
- [ ] hand pose data (関節座標 + confidence) を JSON で出力できる
