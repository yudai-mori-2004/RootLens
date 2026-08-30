# 17 — iPhone RGB + IMU capture

## 目的

設定画面の撮影方法を `iPhone ARKit / Mentra / iPhone` の3択にし、3つ目の
`iPhone`ではARKitを起動せず、背面超広角RGB・マイク音声・raw IMUを収録する。
納品ファイルはMentraと同じ `rgb.mp4 / frames.jsonl / imu.jsonl / metadata.json`
の4ファイルに固定する。

## 読むべきファイル

- `app/src/dataflow/recording-configs/types.ts`
- `app/src/dataflow/recording-configs/{index,arkit,iphone}.ts`
- `app/modules/arkit-capture/ios/{ArSessionController,IphoneCaptureController,IphoneCaptureRecorder,CameraImuTimeCalibrator}.swift`
- `mentra-os/app/src/main/java/io/rootlens/mentra/{SessionArtifacts,RawImuRecorder}.java`
- `web/lib/{r2-keys,r2}.ts`
- `app/README.md`

## スコープ

### やること

- 設定上の外部撮影方法と、端末内で動く`RecordingConfig`を別の型として扱う。
- Mentra選択時はiPhoneのシャッターを無効化し、Mentra本体操作であることを表示する。
- iPhone実装は既存native pod内でARKit実装と並列に置き、HandTracker、向き、RGB–IMU残差解析を共有する。
- AVCaptureSessionで超広角1920×1080・30fps・H.264・mono AAC 48kHzを収録する。
- Core Motionの加速度・ジャイロをraw timestampのまま記録する。
- AVCaptureのsample PTSは`AVCaptureSession.synchronizationClock`から
  `AVCaptureInput.Port.clock`と`CMClockGetHostTimeClock()`の両方へ`CMSyncConvertTime`で変換し、raw PTS、
  両mapped PTS、clock rate、anchor pairを残す。AppleがCore Motion同期用途として直接例示するinput-port経路と、
  host/boot-time経路を実機比較してcanonical fieldを確定する。
- `frames.jsonl`をMP4サンプルと1:1にし、各frameに前後IMU sampleと保存済み残差を対応づける。
- Settingsの残差計測をARKit/iPhoneの選択中backendへ接続する。iPhoneは本番と
  同じ撮影経路を5分間使い、良好な値だけを端末×超広角の校正値として再測定まで使い回す。
  補正値はraw timestampを書き換えない。
- 開始・終了操作を`gesture / voice / hardware_button`の並列なCaptureFlowとして登録する。
- `hardware_button`はiOS 17.2以降の`AVCaptureEventInteraction`で音量±を同じトグルとして受け、
  システム音量を変更せず、開始・終了の効果音だけを鳴らす。
- app/web双方の4ファイルmanifestと`iphone` config IDを一致させる。
- 実機で映像・AAC・IMU・frame対応・metadataを検証してからTestFlightへ提出する。

### やらないこと

- MentraをiPhone内の録画sessionとして扱わない。
- ARKit/LiDAR/VIO出力をiPhone RGB+IMUモードへ混ぜない。
- RGB–IMU残差をraw timestampへ直接加算しない。
- 自動アップロードを復活させない。

## 成功基準

- 3つの撮影方法が設定から選べる。
- Mentra時にiPhoneシャッターを押せない。
- iPhone時に超広角previewから録画開始・停止できる。
- 設定の「開始・終了の操作」で音量ボタンを選べ、±どちらでも開始・終了できる。
- 音量ボタンフロー中はTTS・ジェスチャー・音声コマンド・印刷マーカーが開始終了へ介入しない。
- 4つの必須ファイルだけがupload manifestに入り、すべて非空である。
- MP4に1920×1080 H.264 30fps映像と48kHz AAC音声がある。
- `frames.jsonl`行数とMP4 video sample数が一致する。
- accel/gyroがともに存在し、frameごとの前後sample indexが範囲内である。
- `metadata.json`がclock source、raw timestamp非改変、残差値と監査情報を持つ。
- TypeScript/dataflow/web contract test/native build/実機smokeが通る。

## 設計

`CaptureMethod`は設定とUXの概念で、`RecordingConfig`はこの端末で動く録画実装の
interfaceとする。Mentraは前者にだけ存在し、`arkit`と`iphone`だけが後者へ写像される。
native側では`ArkitCaptureController`と`IphoneCaptureController`をpeerとして置き、
共通の計測ロジックだけを共有する。これにより、外部デバイスへ偽のsession lifecycleを
持たせず、録画実装の差もUI/dataflowへ漏らさない。

開始・終了の操作も同じ考え方で、`CaptureFlow`をstrategy interfaceとして
`gesture / voice / hardware_button`をpeer登録する。物理イベントの購読は
`usesHardwareCaptureEvents`を持つフローの稼働期間だけに限定し、他フローの補助入力にはしない。

## 進捗

- [x] 設定/registry/UIへ3撮影方法を追加
- [x] iPhone AVCapture + Core Motion backendを追加
- [x] Mentra同一4ファイルmanifestをapp/webで固定
- [x] RGB–IMU残差計測とmetadata監査フィールドを接続
- [x] 音声記録の権限文言・利用規約・プライバシー表示を確定方針へ同期
- [x] TypeScript/dataflow/web contract test
- [x] iOS simulator native build
- [x] iPhone 12実機smokeと成果物検証
- [x] production backend反映
- [x] TestFlight提出（0.1.0 build 59）
- [x] 物理音量ボタンを独立CaptureFlowとして実装（`AVCaptureEventInteraction`）
- [x] iPhone 12 / iOS 26.5.2で音量＋開始→音量−終了のUI実機試験（0 failures）
- [x] 音量ボタンフローを含むTestFlight提出（0.1.0 build 61）
- [x] RGB–IMU計測の±150ms探索、review値保存、超広角preview向き適用漏れを監査
- [x] 本番recordingと同一経路の5分計測、±1,000ms探索、複数軸相関、good値だけの永続化へ修正
- [x] 修正版TestFlight提出（0.1.0 build 63）
- [x] build 62の別収録を開始・中間・終了で検査し、camera PTSをsystem uptimeと同一視した実装不備を特定
- [x] AVCapture clock mapping修正版のnative build・TestFlight提出（0.1.0 build 64）
- [ ] build 64でinput-port/host両経路を記録する実機smoke
- [ ] 同一端末での5分再測定

物理ボタン入力はカメラbackendから独立した`CaptureControlModule`が所有し、選択中の
ARKit/iPhone previewへinteractionを取り付ける。iOS 26ではOS既定キャプチャ音を無効化し、
RootLensの開始・終了効果音だけを鳴らす。

実機smokeは12.035秒、H.264 1920×1080 30fps + AAC mono 48kHz、video 361 sample、
accelerometer/gyroscope各1,204 sample。4ファイル以外の納品物なし、append failure 0、
全streamのtimestamp単調、frame indexとMP4 sample 1:1、前後IMU参照不整合0を確認した。

接続中`iPhone13,1`の旧cacheは`-6.1006 ms`、correlation 0.754、sigma 10.324 ms、quality `review`だった。
旧実装は±150msしか探索せず、このreview値も保存・再利用していた。build 63では探索を±1,000msへ広げたが、
AVCaptureのsample PTSをCore Motionと同じsystem uptime値として扱う根本誤りが残っていた。

build 62の別収録（32:27）を同じVision analyzerで開始・中間・終了側から各5分検査すると、残差は
`-872.252 / -896.342 / -923.046 ms`となり、約31 ppmで連続的に変化した。raw timestampの経過時間も
cameraとgyroで77.569 msずれていた。AVFoundation契約上、capture output timestampは
`AVCaptureSession.synchronizationClock`上にあり、外部motion sampleとの同期には明示的なclock変換が必要である。
修正版ではalgorithm v3としてCoreMediaのclock mapping後にだけ物理的な残差を測る。
