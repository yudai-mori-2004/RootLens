# 18 — Claru long-session cutter

## 目的

iPhone RGB+IMUモードで収録した長時間の1セッションをMac上でプレビューし、人間が指定した
タスク開始・終了境界から、Claru確認用の連続クリップ群を作る。出力はiPhoneのR2 uploadと同じ
`rgb.mp4 / frames.jsonl / imu.jsonl / metadata.json` の4ファイル契約とし、各クリップを
R2と同じ `raw/<content_hash>/` 配置で置く。

## 読むべきファイル

- `tools/claru-session-cutter/README.md`
- `tools/claru-session-cutter/lib/{session,exporter}.mjs`
- `app/modules/arkit-capture/ios/IphoneCaptureRecorder.swift`
- `app/README.md` の `iPhone RGB + IMU contract`
- Claru RFP `Main footage requirements / Clips`

## スコープ

### やること

- Macのlocalhostだけで動く長時間video previewと境界入力UI
- 右矢印長押し中だけ2〜10倍速、右を押したまま上下で倍率変更、左矢印長押し中だけ-2倍速
- 開始、終了、2分要件、区間重複、実書出しkeyframeの表示。タスク名は内部で自動採番する
- 区間一覧を全体時間上の位置つきで表示し、削除できる。登録済み区間内部への再生・seekを防ぐ
- 1区間を一度だけstream copyし、内部削除・複数区間結合・再エンコード・速度/画角変更をしない
- video frame、accelerometer、gyroscopeのraw timestampを維持する
- 出力内だけのframe/sample indexとMP4 PTSを0始まりに再構成する
- `frames.jsonl`の前後IMU参照を出力`imu.jsonl`へ再対応させる
- 同一端末×超広角の5分校正値1つを8本の原本すべてに使い回し、各frameのIMU前後参照と
  metadataの校正監査値を同じ値で再構成する
- 端末共通残差を適用する前に、原本がAVCapture PTSをsystem uptimeへCoreMedia clock変換済みであることを検証する
- 出力MP4ごとにSHA-256を計算し、フォルダ名・metadata `content_hash`・`video_bytes`を一致させる
- 切り出し元・選択境界・実境界・非再エンコードをmetadataへ監査記録する
- Downloads配下へ、R2と同じ `raw/<content_hash>/`・4ファイルだけで出力する

### やらないこと

- 区間途中のidle削除
- 複数の離れた区間の結合
- RGB/音声の再エンコード、速度変更、画角crop、blur
- raw video/IMU timestampの書換え
- 長尺原本からの派生クリップを、撮影開始・停止で得た原本だと偽ること
- R2・Google Driveへの自動送信

## 成功基準

- UIで2分以上の複数タスク区間を追加・削除でき、削除後の区間は再びseekできる
- 登録済み区間内部へのseek・通常再生・矢印shuttleが区間外へ退避する
- 矢印を離すと必ず通常の再生/停止状態へ戻る
- 各出力の映像がH.264、音声がAACのまま
- MP4 video packet数、frames行数、metadata frame数が一致する
- accel/gyroのsample indexが0から連続し、timestampは元値のまま単調増加する
- 全frameの前後IMU index/timestampが出力IMUと一致する
- 出力フォルダ名、MP4 SHA-256、metadata `content_hash`が一致する
- 出力クリップフォルダ内に必須4ファイル以外がない
- 提出フォルダの直下は `raw/` だけで、その下のクリップ名はMP4のSHA-256である
- 実際のiPhone長時間収録をMacへ取り込み、全区間を書き出して確認する

## Claru要件上の扱い

RFPは `One task per clip, at least 2 minutes, filmed start to finish. No cuts mid-task,
no edits, no speed changes` とする。stream copyによる連続区間抽出は、区間内部の編集や再エンコードを
行わないが、時間方向の開始・終了trim自体が`no edits`に含まれるかはRFPだけでは確定しない。
そのためツールは派生履歴をmetadataへ残し、最終提出前にClaruのOrder Formまたは担当者へ確認する。

## 進捗

- [x] localhost preview・境界入力・キーボードshuttle UI
- [x] lossless stream copyとkeyframe snap
- [x] frames/IMUの区間分配・再索引
- [x] SHA-256・metadata・4ファイルcontract生成
- [x] 疑似H.264/AAC + 100Hz IMUの統合テスト
- [x] ブラウザ実操作で2分境界登録→書出→全件検証
- [x] Hallmark Workbench UIへ簡素化し、320/375/414/768pxで表示検証
- [x] 実データの別originで区間可視化、登録済み区間のseek防止、右2〜10倍の上下限を操作検証
- [x] 接続中iPhoneの長時間収録から5分区間を実データ検証

実機は`iPhone13,1`としてMacとのpairingとDeveloper Mode経由のapp data container読出しまで完了。
Claruテスト対象は端末内の8 sessionすべて。空き容量を守るため1本ずつMacへcopyし、各sessionの
境界入力・書出・検証後に次へ進み、最後に全clipを1つの提出フォルダへ集約する。
最初の実データ`rec-1787515949653`（2:20:15）と、境界監査用の2本目
`rec-1787534086150`（32:27）はDownloadsへcopyした。端末側の原本は削除していない。

この原本の1:00:00–1:05:00を選び、直前keyframeを含む301.689秒をcurrent exporterで再書出しした。
H.264 1920×1080 30fps + AAC mono 48kHz、9,049 frame、accelerometer/gyroscope各30,354 sample、
4ファイル以外なし、MP4 SHA-256・folder名・metadata content hash一致を確認した。5分映像から独立推定した
`-546.7334 ms`は実データ上の参照再構成テストだけに使い、全9,049 frameで補正後時刻がaccel/gyroの
before/after sampleに挟まれることを検証した。これは端末校正の最終値ではない。

2本目の開始・中間・終了側を各5分解析すると、`-872.252 / -896.342 / -923.046 ms`と収録内で変化し、
camera/gyroの経過時間にも77.569 msの差があった。8本はいずれもAVCapture PTSをsystem uptimeへ変換せず
保存したbuild 62原本であり、端末共通の固定残差をそのまま適用できない。cutterは
legacyの`timestamp_timebase.video_clock_mapping=coremedia_cmsync_v1/v2/v3`も受けるが、新形式では
`video_clock_model_schema=rootlens.camera_imu_clock_model.v1`とcanonical fieldがないiPhone原本への端末共通残差適用を
fail-loudにする。既存8本は最新の`raw timestamps + canonical timestamps + clock_model`形式へ統一する。
長時間原本ごとに一度だけaffine clock modelを確定し、その原本から切り出す全clipへ同じmodelを継承する。
raw値は変更しない。納品metadataは方法名を省いた共通schemaとし、今後のplatform mappingとの違いは
原本hashへ紐づく社内監査記録へ残す。
`canonicalize_camera_imu_clock.py`は原本・raw timestampを変更せず、最新と共通のcanonical fieldを持つ
4ファイルcopyを作る。motion相関のtotal alignmentからdevice/config residualを分離するため、修正版経路で
取得した`quality=good`のresidual calibrationを必須入力にする。同じscriptを8原本へ順番に適用し、原本ごとに
clock-model quality gateを通す。
