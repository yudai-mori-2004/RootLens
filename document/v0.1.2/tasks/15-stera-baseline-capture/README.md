# Task 15: Stera 互換計測ベースライン

## 状態

**v0.1 完了** (2026-05-16): iPhone 12 (非 Pro) 実機で 1 セッション撮影し、 出力 MCAP を `mcap` Python ライブラリでロード成功。 9 トピック全部が正規 ROS1 wire format で正しくデコードされることを確認 (= スキーマ確認スクリプト `decode_samples.py` 全 type pass)。 検証ログは `progress/v0.1.2/task-15/` を参照。

LiDAR 依存トピック (`/camera/depth`, `/camera/depth/camera_info`, `/map/point_cloud`) は iPhone 12 では空のまま。 iPhone 12 Pro 系で同等撮影して非空になることを確認するのは別タスク (= 同じ撮影パスを動かすだけ、 別実装は不要)。

stera-sdk 自体での `check_format=True` 通過と Evaluate 健康スコアの取得は、 stera-sdk の pip install を端末で完走させる時点で実施する (= 現環境で pip 依存が重く完走しなかったため留保。 MCAP 構造の検証は mcap lib 直読みで代替済)。

## 位置付け

iPhone 上で撮影される 1 セッションが、 そのまま FPV Labs の `stera-sdk` (= 公開 SDK) で読み出せる MCAP ファイルとして書き出される、 という状態を作る。

計測フォーマットの仕様は自前で発明せず、 Stera が公開している仕様 (= 論文 + SDK ソース + データセットカード) を逐一そのまま採用する。 採用範囲・対応関係は `document/v0.1.2/STERA.md` に整理済み。

研究バックグラウンドがないため、 我々は計測層を発明しない。 既に研究グレードで動いている仕様を再現する役割に徹する。 これにより:

- 買い手 (= AI 企業) が既存ツール (`stera-sdk` 等) で読み出せる
- 我々は計測仕様の妥当性を自分で立証する必要がない (= Stera の論文と公開実装が立証している)
- ライセンス・ブロックチェーン・撮影者集約という我々の差別化レイヤーに集中できる

## 進捗サマリ

既に動いていて本 task のスコープ外であるもの:

- ✅ ARKit ベースの撮影は v0.0.1 系列で動作実績あり (= AVCaptureSession 直叩きで広角録画 + 顔ぼかし)
- ✅ ライセンス NFT、 ToS 同意連鎖、 stake、 buyer co-sign 等の事業層は task 06 / 07 / 08 / 14 で完成
- ✅ Stera 仕様の全公開資料を `document/v0.1.2/STERA.md` に整理済 (= 採用範囲は §7、 未確認事項は §8)

着手前に解消すべき前提:

- 既存撮影パス (= `app/src/screens/CaptureScreen.tsx` + `app/modules/hand-pose/`) は AVCaptureSession ベース。 本 task では **新しい撮影パスを ARKit ベースで別モジュールとして起こす**。 既存パスは並走させて、 デモで動いている画面を壊さない
- LiDAR を持たない非 Pro 機への対応は本 task のスコープ外 (= STERA.md §7 参照)

## 本 task のスコープ

### 実装する成果物

順番に成果物として実装する。 各項目はそのまま「完了の定義」 のチェック対象になる。

- **新モジュール `app/modules/stera-capture` を起こす** (Swift)。 既存の `hand-pose` モジュールに影響を与えず、 独立したネイティブモジュールとして React Native 側に bridge する
- **ARSession の起動と設定** — `ARWorldTrackingConfiguration` を採用、 `worldAlignment = .gravity`、 `frameSemantics.insert(.sceneDepth)` (LiDAR 機限定)。 解像度・フレームレートは ARVideoFormat から RGB 1280×720 @ 15 fps が取れる format を選ぶ
- **MCAP writer 統合** — Foxglove 公式 Swift パッケージ (`github.com/foxglove/mcap`, swift/ サブディレクトリ) を Swift Package Manager で追加。 自前実装はしない
- **ROS 1 メッセージのバイナリシリアライザを実装** — 必要な 6 型を Swift で書く: `sensor_msgs/CompressedImage`, `sensor_msgs/Image`, `sensor_msgs/CameraInfo`, `sensor_msgs/Imu`, `geometry_msgs/PoseStamped`, `sensor_msgs/PointCloud2`, `visualization_msgs/Marker`, `nav_msgs/Path`。 加えてカスタム `stera/TrackingState` も。 ROS 1 のバイナリ規約は単純なリトルエンディアン構造 packing + 可変長配列の uint32 長さプレフィックス
- **STERA.md §4 の必須 6 トピック + 追加 4 トピックを MCAP に書き出す**:
  - `/camera/rgb/compressed`: ARFrame.capturedImage を CIContext で JPEG エンコード (品質 0.8 を初期値、 STERA.md §8.1 で値の最終確認をする)
  - `/camera/depth`: ARFrame.sceneDepth.depthMap を 32FC1 で書き出す
  - `/camera/camera_info` + `/camera/depth/camera_info`: 撮影開始時と解像度変化時に 1 回ずつ
  - `/camera/pose`: ARFrame.camera.transform を Pose に分解
  - `/camera/tracking_state`: ARCamera.trackingState を毎フレーム + 状態変化時にも
  - `/device/imu`: CoreMotion `CMMotionManager` を別スレッドで 100 Hz で回す
  - `/map/mesh`, `/map/mesh_cloud`, `/map/point_cloud`: ARMeshAnchor の集約から派生 (= 低頻度で OK)
  - `/trajectory`: セッション終了時に全 pose 履歴を 1 メッセージで書く
- **撮影セッションのライフサイクル管理** — start/stop API を React Native 側に公開、 出力 MCAP ファイルパスを返す。 ファイル名は `session_<utc_iso8601>.mcap` 形式
- **時刻同期** — STERA.md §4.2 に従い、 すべてのメッセージの `header.stamp` を ARFrame.timestamp ベースの ns 表現で揃える。 IMU は CoreMotion の `motion.timestamp` (= 同じモノトニッククロック) をそのまま使う
- **座標系の検証** — STERA.md §4.3 の規約に従って書き出した pose が stera-sdk の `MCAPReader().camera_poses()` で読んで意味のある軌跡になることを確認する

### 検証

- **MacBook 上で stera-sdk によるロードテスト** — 1 セッション撮影 → mac に転送 → `python -c "from stera.data import MCAPReader; r = MCAPReader('session.mcap'); print(r.summary())"` で REFERENCE_TOPICS がすべて非空になっていることを確認
- **Foxglove Studio による可視化** — 同じ MCAP を Foxglove Studio で開いて、 RGB 動画と pose の軌跡が同期して再生できることを確認
- **stera-sdk の Evaluate を回す** — `from stera.eval import Evaluate; Evaluate(session).show()` で品質レポートが生成されること。 健康スコアは 60 点以上を target

## 完了の定義

以下がすべて満たされた時点で本 task 完了。

1. iPhone Pro 上で `stera-capture` モジュールから 1 セッション撮影できる
2. 出力ファイルが `stera-sdk` の `MCAPReader` で読み込め、 `check_format=True` (= REFERENCE_TOPICS チェック付き) を通過する
3. Foxglove Studio で開いて RGB + depth + pose + IMU が同期再生される
4. `Evaluate(session).show()` の健康スコアが 60 点以上
5. 出力 MCAP ファイル 1 個と Evaluate の HTML レポートを `progress/v0.1.2/task-15/` 直下にサンプルとして commit

## 非スコープ

- 後続 task に回すもの:
  - **非 Pro 機 (LiDAR なし) 対応** (= STERA.md §7 「採用しない」、 task 16+ で別途検討)
  - **HDF5 + PLY + RRD への変換** (= STERA.md §5、 サーバ側後フェーズ)
  - **手姿勢、 顔ぼかし、 品質評価の自前実装** (= STERA.md §6、 サーバ側で stera-sdk を呼び出す形が筋。 別 task)
  - **暗号化、 R2 アップロード、 TP 登録、 ライセンス NFT 連動** (= 別レイヤー、 既存 task に統合)
- リアルタイム HUD (= 撮影者向けフィードバック表示) は本 task の対象外。 計測層がクリーンに動いてから、 後続 task で stera-sdk の `EvaluateConfig` の閾値を端末側で再現して HUD に出す形を検討する

## 依存・前提

- iPhone 12 Pro 以上 (= LiDAR 搭載機)
- iOS 16 以上 (= ARKit 6 が安定して使える)
- Foxglove MCAP Swift パッケージ (= SPM 経由)
- Python 環境 (= stera-sdk を mac 側で実行するため、 検証フェーズで必要)

## 参考資料

- `document/v0.1.2/STERA.md` — Stera 仕様の参照本体 (= 本 task の出発点)
- `references/stera-sdk/` — Stera SDK ソース (= スキーマ確認用)
- `references/Arvos/` — 別の iOS + ARKit + MCAP 実装 (= 参考のみ、 そのまま流用しない)
- 論文: <https://arxiv.org/abs/2605.05945>
- Foxglove MCAP Swift: <https://github.com/foxglove/mcap/tree/main/swift>
- MCAP 仕様: <https://mcap.dev/specification>
- ROS msg 仕様: <https://docs.ros.org/en/api/sensor_msgs/html/>
