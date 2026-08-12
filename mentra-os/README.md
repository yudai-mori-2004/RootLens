# RootLens Mentra capture app

Mentra Live 上で、Claru 向けの一人称 RGB と raw IMU を端末単独で収録する native Android
アプリ。iPhone/ARKit 実装の `app/` とは別の capture stack として並列に置く。

## 収録契約

各クリップはアプリ専用外部ストレージの
`files/recordings/rec-<UTC timestamp>/` に保存する。

| ファイル | 内容 |
|---|---|
| `rgb.mp4` | H.264、1920x1080、固定30fps要求、8-bit SDR、音声なし |
| `frames.jsonl` | MP4の全video sampleにつき1行。MP4 PTS、Camera2の露光開始timestamp、共通timelineへ写したtimestamp、前後のaccel/gyro indexとtimestamp |
| `imu.jsonl` | accelerometerとgyroscopeのraw `SensorEvent`。event timestamp、callback時のelapsed realtime、値、精度 |
| `camera_frames.raw.jsonl` | Camera2 capture resultの監査用raw記録。フレーム番号、露光開始、露光時間、frame duration、rolling-shutter skew、callback時刻 |
| `metadata.json` | codec、解像度、色、端末probe、ファイル数、SHA-256等の静的・集計情報 |
| `sync_report.json` | 端末内だけに保持する内部QA用の同期診断。アップロード・Claru納品はしない |
| `content_hash.txt` | raw `rgb.mp4` のSHA-256 |

録画要求が30分を超える場合は、最大30分の独立クリップへ分割する。5時間ボタンは10本の
クリップを連続生成する。途中失敗時は `failure.json` と `.partial` を残し、不完全データを
アップロード対象にしない。

## RGBとIMUの時刻

Androidで次の二つは同じ意味ではない。

- `SENSOR_INFO_TIMESTAMP_SOURCE=REALTIME`: カメラtimestampを
  `SystemClock.elapsedRealtimeNanos()` と比較できるというAndroid HAL契約。
- single hardware timestamp source: camera/IMUのtimestampが同じhardware counterを基礎とし、
  一つのtime axisへ決定的に配置できること。sampling rateの一致やhardware triggerによる同時発火は
  別のacquisition特性であり、この用語だけからは含意しない。

アプリはAndroid APIの宣言と、documented capture configurationのplatform timestamp pathを分けて記録する。
対象構成の内部監査詳細は
`document/v0.1.4/tasks/16-claru-mentra-capture/CLOCK_AUDIT.md`を参照する。

接続したMentra Live（Android 11、incremental build `mp1k61v164bspP6`）の実測では、
カメラHALは `UNKNOWN` を返し、カメラtimestampは `System.nanoTime()` に近い
CLOCK_MONOTONIC側、IMUは `elapsedRealtimeNanos()` のCLOCK_BOOTTIME側だった。
アプリは各camera callbackで両時計を同時採取し、中央値の差でカメラtimelineをBOOTTIMEへ
写す。これは校正済み共通timelineを作る手段であり、同一物理クロックの証明ではない。

実機kernelまで追跡した結果、camera ISP SOFは`sched_clock()`、IMU polling pathは
`ktime_get_with_offset(TK_OFFS_BOOT)`で刻時され、両方の基礎は13 MHz ARM architectural
system counterだと確定した。従ってsystem timestamp counterは一つであり、MONOTONICとBOOTTIMEの差は
累積suspend時間のoffsetである。

ただしsensor samplingは共通clock/triggerではない。IMX681は24 MHz camera MCLK、ICM426XXはsensor
ODRで動き、IMU timestampはsample瞬間のhardware latchではなくkernel polling pathで付く。
端末内QA用の`sync_report.json`は`single_hardware_timestamp_counter_confirmed=true`と、
`sample_event_hardware_latched_to_common_counter=false`を同時に出力する。

### FOVメタデータの注意

Mentra公式仕様は119° FOV。実機Camera2はsensor size 4.71×3.49 mm、focal length 3.3 mmを
返すが、intrinsic calibrationとlens distortionを公開しない。この値へ通常のピンホール式を
適用すると水平71°/対角79°になり、公称119°と矛盾する。超広角レンズの歪みとISP補正を
無視した計算なので、71°を実FOVとして使わない。`fov_assessment`には両方の値と矛盾を残し、
checkerboard等による1080p出力の実測値だけを納品仕様に使う。

controlled motion captureにより、end-to-endの`video-to-IMU offset`は
`t_IMU - t_video = +73.5 ms`と実測した。高信頼の5秒区間は70–78 ms、全区間の相関は0.969。
`frames.jsonl`はこのoffsetを明記し、各video frameに対して補正後の時刻位置を挟む前後IMU sampleを
対応付ける。raw `imu.jsonl`のtimestampは変更しない。

production delivery前に、次の長時間品質を検証する。

1. 30分以上の温度変化でもvideo-to-IMU offsetとvideo cadenceが維持されることを測る。
2. 複数回の録画開始・再起動でoffsetを再現する。
3. suspend前後でMONOTONIC↔BOOTTIMEのbridgeが正しく更新されることを測る。

## Claru品質バーの現状

| 要件 | 現状 |
|---|---|
| 0.5x–0.6x wide | **有力だが要実効FOV校正**。Mentra公式は119° FOVを公称しており、角度としてはiPhone ultra-wide相当の候補。公式は水平/対角を明記せず、1080p ISP出力後のcropも未測定なので、0.5x表記との同等性は校正結果とサンプルで合意する |
| Landscape 1080p30、8-bit、HDR off | **映像形式は充足、cadenceは要長時間確認**。MP4は1920x1080 H.264 High、yuv420p 8-bit、BT.709 SDR、音声なし。10秒smokeのPTS実測平均は29.72fpsで、30fps要求の1%以内 |
| 額/目線、少し下向き | メガネ装着で実現。角度は装着手順とサンプルQCで固定する |
| hands visible ≥80% | アプリ単体では保証しない。装着角度、作業指導、納品前のclip別hands QCが必要 |
| RGB/IMU single hardware clock | **充足**。documented capture configurationではcamera/IMU timestampは同じ13 MHz ARM counter由来。cameraはMONOTONIC、IMUはBOOTTIMEとして表現され、clipごとのsuspend offsetで一つのtime axisへ変換する。end-to-end offsetは`+73.5 ms`（`t_IMU-t_video`）と実測済み。全video frameへoffsetと補正後の前後IMU timestampを納品する |

LiDARは搭載・出力しない。

## 容量と連続運用

既定video bitrateは7 Mbps。5時間のvideoは約15.8 GB、sidecarを含め概ね18 GB以内を
想定する。実機probeではアプリ外部ストレージに約25 GBの空きがあり、容量上は5時間を
収録できる。開始時には20%の変動幅と512 MiBの固定余白を足した約19.4 GBを要求し、
不足ならfail-loudに停止する。

容量が足りても内蔵電池だけで5時間は保証しない。外部給電し、実運用前に5時間の発熱、
encoder安定性、給電、眼鏡側の装着を通し試験する。アップロード成功後もローカルデータは
自動削除しない。

## ビルドと実機起動

`app/.env` にある既存のRootLens server URLとSupabase public設定をbuild時に読む。
passwordは保存せず、取得したaccess/refresh tokenだけをAndroid KeystoreのAES-GCM鍵で
暗号化して保持する。

```sh
cd mentra-os
bash gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant io.rootlens.mentra.debug android.permission.READ_LOGS
adb shell pm grant io.rootlens.mentra.debug android.permission.CAMERA
adb shell am start -W \
  -a io.rootlens.mentra.FIELD_READY \
  -n io.rootlens.mentra.debug/io.rootlens.mentra.MainActivity
```

`READ_LOGS`は、Bluetooth未接続時にもMentra MCUのタッチ操作を端末内で受け取るための固定端末用
セットアップ権限である。付与されていない場合、常駐通知は`field controls need setup`を表示し、
物理操作可能な状態であると扱わない。Play配布を前提とした権限ではない。

### 現場での開始・停止

初回セットアップ後はスマートフォン、Bluetooth、ADBを必要としない。

1. Mentra Liveの電源を入れて装着する。
2. つるのタッチ面を約1秒長押しする。
3. 開始音を確認して作業を始める。最大5時間のsessionを30分以下の独立clipへ自動分割する。
4. 終了時に同じタッチ面をもう一度約1秒長押しする。
5. 停止音が鳴るまで待つ。停止音はMP4とsidecarの確定が完了した後に鳴る。

開始時は短い高音、停止確定時は下降する2音を再生する。Mentraでは通常のAndroid
`STREAM_MUSIC`だけではスピーカーへ出力されないため、標準ASG serviceへI2S開始を要求し、
notification audioを再生してからI2Sを停止する。再生中だけnotification volumeを上げ、終了後に
元の値へ戻す。エラー時は低い3音を鳴らす。

入力はMentra標準ASG clientがMCUから受け取る`long_press (3)`を端末内で購読する。1.5秒以内の
重複イベントは無視する。カメラボタン長押しは、Bluetooth未接続時に標準ASG client自身の
動画録画も開始してカメラが競合するため、RootLens操作には使用しない。タッチ面のlong pressは
標準側ではBLE転送だけを行い、未接続時にもローカル撮影を開始しない。

アプリ更新後と端末boot後にはfield-control foreground serviceを自動起動する。画面がsleep中でも、
長押しを受けるとActivityを前面へ起動してからcamera foreground serviceを開始する。

開発時にはActivity intentでも同じ操作を行える。

```sh
adb shell am start -W \
  -a io.rootlens.mentra.START \
  -n io.rootlens.mentra.debug/io.rootlens.mentra.MainActivity \
  --ei duration_seconds 30
```

通常Androidアプリのbackground broadcastだけでsleep中にcameraを開くと、OSのbackground
camera制限により `CAMERA_DISABLED` になる。field-control serviceは長押しごとにActivityを
foregroundへ移してからcapture serviceへtoggleを渡す。

## アップロード

アプリ画面でRootLens運営発行アカウントへsign inし、`Upload all pending clips` を押す。
完了したクリップだけを対象に、次を順番に行う。

1. `POST /api/v1/raw-uploads` で `recordingConfig=mentra` のpresigned URLを取得。
2. 必須4ファイル（`rgb.mp4`、`frames.jsonl`、`imu.jsonl`、`metadata.json`）をR2へstreaming PUT。
   各成功後に `upload_state.json` を更新。内部QA用`sync_report.json`はアップロードしない。
3. 全PUT後に `POST /api/clips` で登録。

PUTは再試行でき、アプリ再起動後は成功済みファイルを飛ばす。production APIが
`mentra` manifestに対応するコードをdeployするまではend-to-end uploadを実行しない。
