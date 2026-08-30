# Claru session cutter

Mac上で、RootLensの長時間iPhone収録にタスク境界を付け、Claru確認用の連続区間へ
切り出すローカルツールです。動画をブラウザへアップロードせず、`127.0.0.1`だけで動作します。

## 守る契約

- 入力はiPhone撮影モードの `rgb.mp4 / frames.jsonl / imu.jsonl / metadata.json`。
- 1クリップは元収録の連続した一区間だけ。区間内部の削除・結合はしない。
- RGBと音声はFFmpegのstream copyでremuxし、再エンコード・速度変更・画角cropをしない。
- 開始点は直前のH.264 keyframeへ安全側にsnapする。実際の書出境界はUIに表示する。
- video/IMUのraw timestampは変更せず、出力MP4のPTSと各sample indexだけを新しい
  ファイルの0始まりへ再構成する。
- `content_hash`は各出力 `rgb.mp4` のSHA-256で再計算する。
- 長時間原本から切り出したことは `metadata.json.segmentation` に監査情報として残す。
- 出力はR2と同じ `raw/<content_hash>/` 配置とし、クリップ内は
  iPhone contractの4ファイルだけにする。

この処理はbitstreamを再エンコードしませんが、長時間原本から時間区間を抽出する処理では
あります。Claru RFPの `no edits` が開始・終了trimも禁止するかは文面だけでは確定しないため、
最終提出前にOrder FormまたはClaru担当者の確認を取ってください。

## 起動

macOSにHomebrew版 `ffmpeg` / `ffprobe` があることを確認し、リポジトリrootから実行します。

```bash
node tools/claru-session-cutter/server.mjs
```

ブラウザで `http://127.0.0.1:4318` を開き、収録フォルダを選びます。起動時に既知の
sessionを渡すこともできます。

```bash
node tools/claru-session-cutter/server.mjs --source /path/to/rec-1234567890
```

区間は追加・削除・復元のたびに、ブラウザ内の一時状態とは別に
`tools/claru-session-cutter/boundaries/<収録名>.boundaries.json`へatomic保存します。
同じ原本を開き直すと、このファイルを正として区間を復元します。各保存前の版は
`boundaries/history/<収録名>/`へ追記し、現行JSONのSHA-256 sidecarも併記します。
原本4ファイルと原本フォルダには書き込みません。

既収録セッションに、同じ端末×超広角で5分間測定した1つの校正値を適用する場合は、
端末から取得した測定JSONを指定します。全出力クリップで同じ値を使い、
raw video/IMU timestampは変えず、frameのIMU前後参照とmetadataだけを再構成します。

```bash
node tools/claru-session-cutter/server.mjs \
  --source /path/to/rec-1234567890 \
  --calibration /path/to/iphone-ultrawide-calibration.json
```

iPhone原本のmetadataに`quality=good`の校正値がない場合、`--calibration`なしの書き出しは失敗します。
区間入力と保存はその前でも行えますが、0msの既定値で提出物を作ることはできません。

完成物は既定で `~/Downloads/RootLens-Claru-DELIVERY-YYYYMMDD-HHMMSS/` に作られ、
その中に `raw/<content_hash>/` というR2 uploadと同じフォルダ構成で
クリップが並びます。

## キーボード

- `Space`: 再生 / 一時停止
- `→` 長押し: 押している間だけ、設定中の倍率で前進
- `→` を押したまま `↑` / `↓`: 前進倍率を2〜10倍の範囲で変更
- `←` 長押し: 押している間だけ2倍速で後退
- `S`: 現在位置を開始に設定
- `E`: 現在位置を終了に設定
- `J` / `L`: 1フレーム戻る / 進む

タスク名は入力せず、区間には `clip-001` から内部名を自動付与します。登録済み区間の内部へは
再生・シークできません。区間一覧の削除を押すとその範囲は再びシーク可能になり、直後は
「元に戻す」で復元できます。

## 検証

```bash
npm --prefix tools/claru-session-cutter test
```

テストは短い疑似RGB+音声と100Hz IMUを生成し、stream copy、frame/IMU再索引、
SHA-256、4ファイルmanifestまで通します。

### Existing recording clock-model audit

build 62のiPhone原本はAVCapture session clockをCore Motionのhost clockへ変換するための
rate/anchorを保存していません。次の診断は原本を書き換えず、開始・中間・終了の独立windowで
global image motionと3軸gyroを比較し、収録ごとのaffine clock mappingを推定します。

```bash
python3 tools/claru-session-cutter/scripts/audit_historical_clock.py \
  /path/to/rec-1234567890 \
  --window-seconds 300 \
  --window-count 3 \
  --output /path/to/audit.json
```

出力は最新納品仕様と共通の`rootlens.camera_imu_clock_model.v1`です。raw RGB、raw IMU、raw timestampは
変更せず、原本ごとに一度確定したaffine modelを、その原本から作る全clipへ継承します。納品metadataは
方法名を持たない共通schemaとし、CoreMedia platform conversionかmotion-signal affine estimationかの違いは
原本hashへ紐づく社内audit JSONだけに残します。`quality=good`だけで自動適用せず、独立window・方法間一致・
holdoutを通過したmodelだけを使います。

監査が`good`になり、修正版capture pathで同じ端末×超広角のresidual calibrationを取得した後、原本を
変更せず最新canonical fieldを持つ4ファイルcopyを作ります。motion相関で得たtotal alignmentから
device/config residualを分離するため、calibration JSONは必須です。

```bash
python3 tools/claru-session-cutter/scripts/canonicalize_camera_imu_clock.py \
  /path/to/rec-1234567890 \
  --audit /path/to/rec-1234567890-clock-audit.json \
  --calibration /path/to/iphone13,1-ultrawide-calibration.json \
  --output /path/to/rec-1234567890-canonical
```

出力は`rgb.mp4 / frames.jsonl / imu.jsonl / metadata.json`だけです。RGBとIMUのbytes、raw timestampは
不変で、`video_frame_timestamp_canonical_ns`とIMU前後参照を生成します。先頭・末尾でIMUがevent時刻を
挟めないframeは削除せずnull参照として数え、最終clip書出しでは0件であることをfail-loudに検証します。

修正版capture pathのdevice residualをまだ測定できない期間に、既存原本の救済可能性を検証する場合だけ、
`--diagnostic-unsplit-total-alignment`を使えます。この出力はclock差とsensor residualを分離せず、
`delivery_eligible=false`と`local_validation_only`をmetadataへ強制します。納品物の代替にはできません。

```bash
python3 tools/claru-session-cutter/scripts/canonicalize_camera_imu_clock.py \
  /path/to/rec-1234567890 \
  --audit /path/to/rec-1234567890-clock-audit.json \
  --diagnostic-unsplit-total-alignment \
  --output /path/to/rec-1234567890-diagnostic
```

実収録全体のaffine監査が独立window・方法間一致・holdoutを通過し、各clipの独立検証を行う場合は、
中間の長尺RGB copyを作らず原本から直接書き出せます。納品metadataはcanonical時刻を再現する
数値モデルのみを持ち、推定方法、fit診断、sensor-validity分離の内部情報は原本hashへ紐づく
社内audit JSONにのみ保存します。

```bash
node tools/claru-session-cutter/scripts/export_with_clock_audit.mjs \
  --source /path/to/rec-1234567890 \
  --boundaries tools/claru-session-cutter/boundaries/rec-1234567890.boundaries.json \
  --clock-audit /path/to/rec-1234567890.clock-model.audit.json \
  --output-base /path/to/output
```
