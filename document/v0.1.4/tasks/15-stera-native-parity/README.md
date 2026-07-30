# 15-stera-native-parity — 収録と MCAP を stera-app と呼び出しレベルで一致させる

## 目的

FPV Labs が公開した撮影スタック stera-app (github.com/fpv-labs/stera-app、 初回公開 commit fce8de1、
Apache 2.0) と、 うちの収録 + MCAP 組み立てを**内部のネイティブ呼び出しレベルで**一致させる。
「実質同じだから OK」の同値判断はしない。 ARKit 設定・フレームサンプリング・センサー取得・
スキーマ・書き込み順・コンテナ設定まで、 stera_recorder を RN + サーバ組み立てへ翻訳した形にする。

狙いは営業上の主張を単純にすること: 「収録構成もデータ形式も FPV の公開実装と同一。 差分は
顔ぼかし等の宣言済み処理のみ」。

## 読むべきファイル

- 比較元 (再取得: `git clone --depth 1 https://github.com/fpv-labs/stera-app`)
  - `packages/stera_recorder/ios/stera_recorder/Sources/stera_recorder/`
    - `session/ArSessionManagerImpl.swift` (ARKit 設定と videoFormat 選択)
    - `coordination/RecordingFrameOrchestrator.swift` (フレーム処理と書き込み順の正)
    - `encoding/FrameSamplerImpl.swift` (決定論的サンプリング)
    - `sensors/ImuCollectorImpl.swift` / `sensors/ImuIntrinsics.swift`
    - `coordination/CameraImuExtrinsicEstimator.swift`
    - `data/MCAPDatasetWriter.swift` / `data/ROS2SchemaDefinitions.swift` / `data/CDRSerializer.swift`
    - `coordination/MetadataAssembler.swift`
  - `packages/stera_recorder/lib/src/data/models/recording_config.dart` (実効デフォルトは Dart 側が正)
- 直す先
  - `app/modules/arkit-capture/ios/ArSessionController.swift` (+ `PixelEncoders.swift`, `DepthTarWriter.swift`, `MeshExporter.swift`)
  - `app/src/services/captureSettings.ts`
  - `tools/modal/fpvlabs/fpvlabs.py`
- 検証
  - `stera-sdk` の `MCAPSession(check_format=True)` (REFERENCE_TOPICS 11 本)
  - Hugging Face `fpvlabs` の Stera-10M 実セッション MCAP (フィンガープリント比較の正)

## 突き合わせ結果 (2026-07-30、 両実装の全読で確定)

stera-app 実効出荷設定 (Dart 層が送る値が正。 Swift 側デフォルトの 15Hz/720p は上書きされる):

| 項目 | stera-app | うち現状 |
|---|---|---|
| videoFormat | height cap 1080 → 面積最大 → 要求 fps 一致 (= 1920×1080@30, 16:9) | 4:3 優先 → 面積最小 (= 1920×1440) |
| ARKit config | planeDetection [.h,.v] / **.smoothedSceneDepth** / .mesh / run() **オプションなし** | planeDetection なし / .sceneDepth / .mesh / [.resetTracking, .removeExistingAnchors] |
| 露出 | autoExposure=true (false 時は 1.5s 後に .locked) | 無し |
| 録画開始ゲート | 30 フレーム捨て + .normal 連続 10 (isSessionReady) | 無し |
| サンプリング | FrameSampler ×3 (rgb/depth/pc 独立、 タイムスタンプ表 + tracking-pause オフセット) | RGB は keep-interval、 depth/pc は書込フレームの剰余 |
| spatial 書込 | **isTracking (= .normal) 時のみ** | tracking 無関係に書く |
| レート | rgb=depth=pc=30Hz / imu=100Hz / arkitFps=30 | 実質同値 (30/30/30/100) だが枠組みが別 |
| RGB 保存 | **mp4 なし**。 CIContext jpeg q0.8 sRGB → MCAP 直行 | h264 12Mbps mp4 → サーバで cv2 jpeg q85 |
| depth | smoothedSceneDepth、 vDSP (vsmul→vclip[0,65535]→vfixu16)、 confidence 不読 | sceneDepth、 スカラーループ NaN→0、 confidence PNG あり |
| IMU | deviceMotion、 **userAcceleration×9.81 (重力除去)**、 covariance = ImuIntrinsics 式、 frame_id `imu_frame` | accel = user+gravity (g 単位) を ×9.80665、 covariance 全 0、 frame_id `imu` |
| /arkit/imu | 全 ARFrame で姿勢差分から角速度 (camera_link) | 無し |
| /device/metrics | 全 ARFrame (値は 500ms キャッシュ) | 無し |
| /device/imu/intrinsics /device/camera_imu_extrinsics | あり (端末上で外部パラメータ推定) | 無し |
| tracking_state | 全 ARFrame、 camera_link | kept フレームのみ、 reason=0 固定 |
| camera_info | **spatial フレーム毎** (ピクセルバッファ寸法) | 先頭 1 回 (metadata 由来) |
| /tf | pose と同カデンツで毎回 2 transform (world→camera_link, camera_link→optical) | 静的 1 回 |
| /trajectory | 5 秒毎、 バッファはその都度クリア (増分) | 最後に全 pose 1 回 |
| point_cloud | フレーム毎スナップショット、 x,y,z,confidence(=1.0固定) step16 | 全期間 union 去重 1 回、 x,y,z step12 |
| mesh | 停止時 1 回、 **全 anchor 統合 1 Marker** (ns="", id=0, color 1,1,1,1) + confidence 付き mesh_cloud | anchor 毎 Marker (ns="mesh", color .8,.8,.8) + xyz mesh_cloud |
| 時刻 | 全て boot-time ns (epoch 変換なし)、 logTime=publishTime | 同じ (ここは既に一致) |
| コンテナ | 手書き writer: **無圧縮**、 chunk 512KB、 library "fpv_labs/1.0"、 グローバル通番、 schema 12 + channel 17 を固定順で先行登録、 Metadata record `session_metadata` (dot-flatten) | mcap_ros2: zstd、 1MB、 遅延 channel、 sequence=0、 Metadata record なし |
| スキーマ名 | `stera/msg/TrackingState` 等 | `stera_msgs/TrackingState` (名前不一致) |
| metadata.json | MetadataAssembler ~120 キー (ドロップ index 一覧、 ドリフト、 ストリーム範囲 ns、 性能統計) | rootlens 独自スキーマ (キー互換なし) |

stera-app 側の確認済みの死にコード (真似しないこと): VideoEncoder 系 (mp4) は配線だけで未呼び出し、
per-frame mesh は meshData 未代入で不達、 frame/system ログはハンドル未代入で無出力、
depth camera_info はプロセス内 2 本目の録画で欠落する (フラグ未リセット)。

## 決定事項 (このタスクの前提)

1. **videoFormat は stera の選択関数を移植し、 cap=1440 で呼ぶ**。 preferredVideoFormat() は
   「height ≤ cap で絞り面積最大 → 要求 fps 一致優先」の汎用関数で、 cap 1080 は Dart 層の
   出荷既定にすぎない。 cap 1440 なら同じコードが 1920×1440 (4:3) を選ぶ = アルゴリズム一致と
   現行画角の維持が両立する。 縦画角は削らない。 JPEG 目標寸法もセンサー寸法のまま (縮小なし)
2. **depth は現行維持で確定 (sceneDepth + confidence)**。 研究用途の慣行を文献で確認した結果:
   ARKitScenes (Apple 自身の学術データセット、 NeurIPS 2021) はメンテナが sceneDepth API 使用を
   明言し confidence を資産として配布、 ARKitTrack (CVPR 2023) も depth + confidence (0/1/2) を
   保存、 Stray Scanner (研究コミュニティ標準の iOS 収録アプリ) も同様。 smoothedSceneDepth は
   Apple がレンダリング向けフレーム間ちらつき低減として提供する時間平滑化版で、 これを収録に
   使う研究データセットは確認できず。 stera 自身の論文 (MobileEgo, arXiv:2605.05945) も API 選択を
   明記せず理由の記載なし (かつ confidence を捨てており研究慣行から外れる)。
   平滑化は後処理で再現可能・逆は不可逆という非対称も現行維持を支持。
   → stera との値差は恒常差分として宣言 (トピック/寸法/レートの形式指紋は一致)
3. **isTracking ゲートは pose / depth / point_cloud のみ**。 tracking .normal 以外で無効なポーズ系を
   書かないのは stera どおり。 ただし **RGB (mp4 append) は継続する** — stera は tracking 喪失中
   RGB ごと欠落させるが (RecordingFrameOrchestrator.swift:151-157、 pause offset で恒久穴)、
   映像の連続性は egocentric データの価値そのもので、 「タスクを途中で切るな」という買い手要件とも
   衝突するため複製しない。 宣言差分
4. **RGB は h264 12Mbps mp4 経由を維持** (唯一の恒常差分)。 端末 jpeg 直行は 顔ぼかし前提 +
   アップロード容量 4 倍と両立しない。 `/rootlens/processing_info` に h264 中継を明記する
5. **tf の camera_link→optical 回転は Stera-10M 実データで確定してから実装**。 stera-app は
   (x:1,y:0,z:0,w:0) = ARKit カメラ→ROS optical の素直な軸反転 diag(1,−1,−1)。 stera-sdk 定数
   R_OPTICAL_TO_LINK (0.7071,0,0.7071,0) はそれにカメラ上軸まわり 90° を重ねた値 (= 縦横の
   向き扱いの混入疑い)。 ランドスケープ JPEG と幾何整合するのは app 値。 現行 fpvlabs.py は
   SDK 値を書いており、 過去納品分は SDK 整合である点に注意
6. うち独自の上積みは維持: 顔ぼかし / marker zone ぼかし / `/camera/depth/confidence` /
   hands (raw のみ、 MCAP 非同梱の判断は不変)

## やること

### A. app 側 (stera_recorder の翻訳。 ArSessionController の録画コアを再構成)

- A1. ARKit 設定を ArSessionManagerImpl と同一に: planeDetection、 frameSemantics (depth は
  決定事項 2 の確定に従う)、 run() オプション除去、 videoFormat 選択アルゴリズム移植 (cap=1440)、
  autoExposure 設定 + 1.5s 遅延ロック、 readiness ゲート (30 捨て + .normal×10、 録画開始条件)
- A2. FrameSamplerImpl を移植し rgb/depth/pc の 3 本へ (決定論スケジュール + tracking-pause
  オフセット)。 depth/pc の「書込フレーム剰余」方式を廃止
- A3. 新規 raw ストリーム: `arkit_imu.jsonl` (全 ARFrame: qNow と姿勢差分角速度、 emitArkitImuIfNeeded
  と同式)、 `device_metrics.jsonl` (全 ARFrame、 500ms キャッシュ、 DeviceMetrics スキーマの
  フィールド)、 tracking_state/reason を全 ARFrame へ (arkit_imu 行に同乗させる)
- A4. CameraImuExtrinsicEstimator + ImuIntrinsics を移植 (metadata に camera_imu_extrinsic ブロック、
  imu_intrinsics は static_defaults / arkit_vio_derived の 2 種)。 位置づけ: 商品要件ではなく
  「stera 形式パリティに同梱される無料の上積み + 運用 QA」。 機種指定で発注する買い手は
  同型機で自前校正できる前提で動くため必須ではないが、 stera 自身が端末上推定を選んで
  出荷しており、 移植すれば受動的に動く。 残差とドリフト値はリグ異常 (取付緩み・機体交換) の
  検出に使える。 ノイズ実測 (静置収録系のオペレーション) は行わない
- A5. depth 変換を vDSP 系列 (vsmul ×1000 → vclip [0,65535] → vfixu16) に置換。 読み元は
  決定事項 2 の確定に従う。 confidence は現行どおり記録
- A6. IMU: `startDeviceMotionUpdates(using: .xArbitraryZVertical, to:)` を明示、 OperationQueue の
  name/maxConcurrent/qos を合わせる。 imu.jsonl の生値は現行維持 (user_accel と gravity を
  別々に持っているので MCAP 側で stera 式を正確に組める)
- A7. metadata.json を MetadataAssembler のキー体系へ (counters は A2 の orchestrator 翻訳で
  自然に取れるもの + ストリーム範囲 ns + 性能統計。 rootlens 独自キーは廃止し、 うちにしか
  ないもの (thermal_events 等) は追加キーとして残す)

### B. fpvlabs.py 側 (MCAPDatasetWriter の翻訳)

- B1. 組み立てを**時系列インターリーブ**に書き換え (現行のトピック別一括書きを廃止)。
  1 フレーム毎の書き込み順を RecordingFrameOrchestrator と同一に:
  camera_info → pose (+tf 2 transform +trajectory 5s) → point_cloud → depth → rgb →
  tracking_state → imu バッチ → device_metrics
- B2. スキーマを ROS2SchemaDefinitions.swift の**全文と同一に** (`stera/msg/...` 名を含む)。
  schema 12 本 + channel 17 本を stera の固定順で先行登録
- B3. /device/imu: frame_id は `imu_frame` に合わせる。 **値の意味論は合わせない**:
  linear_acceleration は重力込み × 9.80665 を維持 (REP 145 準拠。 stera の userAcceleration×9.81 は
  規約違反)、 covariance は全ゼロ = 「不明」を維持 (Imu.msg 明記の規約。 stera の静的定数由来の
  合成値は複製しない)
- B4. camera_info を frames.jsonl の per-frame intrinsics から spatial フレーム毎に
- B5. tf 毎フレーム 2 transform / trajectory 5 秒毎クリア / point_cloud 行毎 (x,y,z,confidence=1.0) /
  mesh 全統合 1 Marker + confidence 付き mesh_cloud / tracking_state・arkit_imu・metrics は
  新 raw から。 pose の quaternion は simd_quatf 相当の float32 経路に合わせる
- B6. コンテナ: schema/channel の名前・全文・登録順・Metadata record `session_metadata`
  (dot-flatten) は合わせる。 **合わせないもの**: 圧縮と CRC は zstd + CRC 有効を維持
  (stera の手書き writer は uncompressed_crc=0 / summary_crc=0 で破損検出不能 + サイズ倍増。
  SDK 読者には透過)、 library 文字列は自分名義 (他実装の名乗りはしない)。 グローバル通番
  sequence は mcap 基底 Writer で対応可能なら合わせ、 不可なら 0 のまま (読者に影響なし)
- B7. jpeg 品質 85 → 80。 processing_info に h264 中継と jpeg エンコーダ差 (CIContext vs OpenCV) を明記

### C. 検証

- C1. 新規実機収録 → `--target-bucket` で MCAP 化 → stera-sdk `MCAPSession(check_format=True)` 通過
- C2. Stera-10M 実セッションとのフィンガープリント比較スクリプト (トピック集合 / スキーマ名・全文 /
  channel 順 / 各トピック Hz / Imu covariance / PointCloud2 レイアウト / Marker フィールド /
  tf 回転値)。 差分は宣言済みリストと一致すること

## やらないこと

- 4K (2160 cap)、 Android (ARCore)、 アップロード方式の変更 (単発 presigned PUT を維持)
- 端末内 MCAP 化 (blur を納品前に必ず通す構造を優先)
- handpose の MCAP 同梱 (判断済み事項の維持)
- 旧セッションの遡及変換 (旧 raw は旧 fpvlabs.py = git 履歴で処理可能。 新パイプラインは
  新フィールド前提で fail-loud)
- stera-app の死にコードの再現 (mp4 encoder 配線、 未出力ログ、 depth camera_info 欠落バグ)

## コードレビュー確定: バグ互換で複製しない stera 挙動 (2026-07-30)

両実装の欠陥探索レビューで確定した、 stera 側の欠陥 5 つ。 呼び出しレベル一致の対象から明示的に除外する。

1. バックプレッシャ時の IMU サンプル破棄 (drainSamples が判定より前、 破棄分も metrics には
   記録済み = metadata が MCAP に無い IMU を「あった」と報告する)。 うちの IMU 独立キューを維持
2. tracking 喪失中の RGB 欠落 (決定事項 3 参照)
3. IMU の重力除去 + 合成 covariance (B3 参照。 REP 145 / Imu.msg 規約準拠側に立つ)
4. CRC ゼロ・無圧縮コンテナ (B6 参照)
5. metadata の死にフィールド (bitrate=0、 actual_width=0、 実体のない frame_drop_log_path、
   arcoreFrameCount、 production_certified_mode_b 等)。 生きている計測群のみ移植する
6. VIO 姿勢差分の角速度 (参照実装の emit): world 系の値を camera_link 名義で書き、 四元数の
   二重被覆も未処理 (符号反転フレームで ~2π/dt のスパイク)。 うちは最短弧補正 + body-frame
   デルタで実装 (実データ検証: ジャイロと外部パラメータ経由で整合 15%、 world 式は 108%)

参考: stera 側の既知バグでこちらに影響しないもの — 同一プロセス 2 本目の録画で
/camera/depth/camera_info 欠落 (depthIntrinsicsWritten 未リセット)、 設定デフォルトの 4 層不整合、
FFI 経路の autoExposure 脱落。

## 恒常差分 (宣言して残すもの)

| 差分 | 理由 |
|---|---|
| RGB が h264 12Mbps mp4 を経由 (jpeg 直行でない) | 顔ぼかし前提 + アップロード容量。 processing_info に明記 |
| 解像度 1920×1440 (stera 出荷既定は 1080。 選択アルゴリズムは同一、 cap 値のみ 1440) | 縦画角を削る理由がない |
| depth が sceneDepth (stera は smoothedSceneDepth)。 confidence 付き | 研究慣行 (ARKitScenes / ARKitTrack / Stray Scanner) に整合。 平滑化は後処理で再現可 |
| IMU が重力込み ×9.80665、 covariance は「不明」宣言 | REP 145 / Imu.msg 準拠 (stera は規約違反側) |
| RGB は tracking 喪失中も継続 | 映像連続性 = 商品価値。 買い手のタスク連続性要件 |
| コンテナは zstd + CRC 有効、 library 自分名義 | 破損検出とサイズ。 SDK 読者に透過 |
| 顔ぼかし / marker zone ぼかし | 商品要件 |
| `/camera/depth/confidence` の追加 topic | うちだけの上積み。 REFERENCE_TOPICS 判定に影響なし |
| jpeg エンコーダが OpenCV (品質 80 は一致) | サーバ組み立ての帰結 |
| mesh の logTime が最終フレーム ts (stera は stop 時 uptime) | サーバ組み立てでは stop 時刻が存在しない |

## 成功基準

- C1〜C2 が通る
- 比較スクリプトの差分出力が「恒常差分」表と完全一致する (未宣言の差分ゼロ)

## 進捗

- 2026-07-30: stera-app / うち両実装の呼び出しレベル棚卸し完了、 差分と決定事項を本 README に固定。
  tf 回転の app/sdk 矛盾を発見 (決定事項 5)。 実装未着手。
- 2026-07-30 (改訂): 解像度は 1440 維持で確定 (stera の選択関数に cap=1440 を渡す形で
  アルゴリズム一致と両立)。 16:9 化と画角の実機確認基準を撤回。 depth ソースは要確定に変更
  (推奨は sceneDepth + confidence 維持)。 tf 矛盾は「SDK 定数 = app 値 + カメラ上軸 90°」と判明。
- 2026-07-30 (確定): depth は文献調査の結果 sceneDepth + confidence 維持で確定 (決定事項 2 に
  根拠を記載)。
- 2026-07-30 (E2E): build 48/49 実機クリップ 2 本で全チャンネル・メッセージ単位の監査完了
  (check_format PASS、 8 ストリーム ts 一致、 fx per-frame 変動、 重力込み IMU 9.76、 深度/信頼度/
  メッシュ/軌跡 全数健全、 外部パラメータは nominal 並進 + 90°±0.35° 回転を実測復元)。
  発見 2 件を修正: pipeline_version 上げ忘れ (fpvlabs-6)、 /arkit/imu の角速度が参照実装由来の
  world 系 + 符号反転スパイク → body-frame + 最短弧へ (複製しないもの 6 に追記)。
- 2026-07-30 (実装): B (fpvlabs.py) 完了 + 合成/旧セッションのローカル検証で受け手 SDK の
  check_format=True 通過を確認、 push 済み。 A1-A7 実装完了 (ローカルコミット、 実機テスト前に
  つき未 push): ARKit 設定 / FrameSampler / arkit_imu + device_metrics ストリーム /
  外部パラメータ推定器 / vDSP 深度 + IMU 明示化 / metadata 計測群。 カスタムスキーマ名は
  rootlens/msg/* 名義 (コード内に外部実装への言及を残さない方針)。 残り: 実機ビルド +
  E2E (--target-bucket) + フィンガープリント比較スクリプト。
- 2026-07-30 (レビュー): 両実装の欠陥探索レビュー完了。 stera 側の欠陥 5 つを複製対象から除外
  (専用セクション)、 うち側の要修正を確認 (fpvlabs.py が IMU orientation 欠落時に (0,0,0,1) を
  無言で書く → 実装時に修正、 captureSettings 無ロック競合 → 実装時にロック追加)。
  決定論サンプラー / 外部パラメータ推定 / 生きた metadata 計測群 / readiness ゲートの採用を確定。
  未決事項ゼロ、 実装着手可。
