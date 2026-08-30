# RootLens Mentra capture app

Mentra Live 上で、Claru 向けの一人称 RGB と raw IMU を端末単独で収録する native Android
アプリ。iPhone/ARKit 実装の `app/` とは別の capture stack として並列に置く。

## 収録契約

各クリップはアプリ専用外部ストレージの
`files/recordings/rec-<UTC timestamp>/` に保存する。

| ファイル | 内容 |
|---|---|
| `rgb.mp4` | H.264、1920x1080、固定30fps要求、8-bit SDR。内蔵マイクのAAC-LC 48kHz mono音声を同じMP4へ収録。4:3 active arrayから16:9へ中央crop |
| `frames.jsonl` | MP4の全video sampleにつき1行。MP4 PTS、Camera2の露光開始timestamp、共通timelineへ写したtimestamp、前後のaccel/gyro indexとtimestamp |
| `imu.jsonl` | accelerometerとgyroscopeのraw `SensorEvent`。event timestamp、callback時のelapsed realtime、値、精度 |
| `camera_frames.raw.jsonl` | Camera2 capture resultの監査用raw記録。フレーム番号、露光開始、露光時間、frame duration、rolling-shutter skew、callback時刻 |
| `metadata.json` | codec、解像度、色、端末probe、ファイル数、SHA-256等の静的・集計情報 |
| `sync_report.json` | 端末内だけに保持する内部QA用の同期診断。アップロード・Claru納品はしない |
| `content_hash.txt` | raw `rgb.mp4` のSHA-256 |

1回の開始から手動停止までは1本のクリップとして収録し、5時間を安全上限とする。30分での
自動分割・休止・再開は行わない。途中失敗時は `failure.json` と `.partial` を残し、不完全データを
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
checkerboard等による1080p出力の実測値だけを納品仕様に使う。4:3 active arrayから1920x1080への
変換はHALの中央cropをそのまま使い、後段の再crop・再encodeは行わない。これは画素領域だけの変更で、
Camera2 frame timestampとIMU対応は変えない。

controlled motion captureにより、end-to-endの`video-to-IMU offset`は初期値として
`t_IMU - t_video = +73.5 ms`と実測した。全区間の相関は0.969。隠しキャリブレーションを
品質ゲート付きで完走すると、firmware fingerprint・camera ID・1920x1080@30構成に結び付けた
端末固有offsetを原子的に保存し、以後のclip単位で固定して使う。失敗・中止時は既存値を変更しない。
`frames.jsonl`は使用したcalibration IDとoffsetを明記し、各video frameに対して補正後の時刻位置を
挟む前後IMU sampleを対応付ける。raw `imu.jsonl`のtimestampは変更しない。

production delivery前に、次の長時間品質を検証する。

1. 30分以上の温度変化でもvideo-to-IMU offsetとvideo cadenceが維持されることを測る。
2. 複数回の録画開始・再起動でoffsetを再現する。
3. suspend前後でMONOTONIC↔BOOTTIMEのbridgeが正しく更新されることを測る。

## Claru品質バーの現状

| 要件 | 現状 |
|---|---|
| 0.5x–0.6x wide | **有力だが要実効FOV校正**。Mentra公式は119° FOVを公称しており、横方向の画角は1080pでも維持される。公式は水平/対角を明記しないため、0.5x表記との同等性は校正結果とサンプルで合意する |
| Landscape 1080p30、8-bit、HDR off、audio recorded | **映像・音声形式は実機で充足、長時間cadenceは未完了**。15秒実機clipは1920x1080 H.264 High、yuv420p 8-bit、BT.709 SDRとAAC-LC 48kHz mono / 96kbpsを同一MP4に収録した。音声は707 samples、最大音量-16.8dBで非無音。既存の現場30分clipは音声実装前で、PTS実測平均29.605fpsのため30fpsとの差が1%を超えた |
| 額/目線、少し下向き | メガネ装着で実現。角度は装着手順とサンプルQCで固定する |
| hands visible ≥80% | アプリ単体では保証しない。装着角度、作業指導、納品前のclip別hands QCが必要 |
| RGB/IMU single hardware clock | **充足**。documented capture configurationではcamera/IMU timestampは同じ13 MHz ARM counter由来。cameraはMONOTONIC、IMUはBOOTTIMEとして表現され、clipごとのsuspend offsetで一つのtime axisへ変換する。end-to-end offsetは`+73.5 ms`（`t_IMU-t_video`）と実測済み。全video frameへoffsetと補正後の前後IMU timestampを納品する |

LiDARは搭載・出力しない。

## 容量と連続運用

既定video bitrateは7 Mbps。開始時の容量検査は30分ぶんの映像に20%の変動幅と512 MiBの
固定余白を足した容量を要求する。録画中は5秒ごとに空き容量を検査し、空きが512 MiB以下に
達した場合は停止音を出して現在のMP4とsidecarを正常確定し、セッションを終了する。

容量が足りても内蔵電池だけで5時間は保証しない。外部給電し、実運用前に5時間の発熱、
encoder安定性、給電、眼鏡側の装着を通し試験する。ローカルclipはR2への全PUTと
`POST /api/clips`の成功を確認し、content hashと全4ファイル名を含むfsync済みupload receiptを
原子的に保存した後にだけ削除する。

foreground serviceのpartial wake lockは5時間の録画上限と確定処理の余白を含めて保持する。

## ビルドと実機起動

`app/.env` にある既存のRootLens server URLとSupabase public設定をbuild時に読む。
passwordは保存せず、取得したaccess/refresh tokenだけをAndroid KeystoreのAES-GCM鍵で
暗号化して保持する。

```sh
cd mentra-os
bash gradlew assembleDebug
scripts/install-field-capture.sh
```

`SYSTEM_ALERT_WINDOW`はAndroid 11のbackground activity launch制限下で、画面消灯中に開始した
camera foreground serviceが撮影Activityを前面化するための固定端末用セットアップ権限である。
Play配布を前提とした権限ではない。setup scriptはこれに加えてcamera権限とDoze whitelistを固定し、
全権限を検証してから成功を返す。
macOSではMentraがnative USB backendに現れずlibusb backendで安定して認識されたため、setup scriptは
未指定時に`ADB_LIBUSB=1`を設定する。

### 現場での開始・停止

初回セットアップ後はスマートフォン、Bluetooth、ADBを必要としない。

1. Mentra Liveの電源を入れて装着する。
2. アクションボタンを通常押しする。瞬間的に弾かず、押し込んでから長押し判定になる前に離す。
3. 「撮影スタート」が終わってから作業を始める。実機I2S経路の終了後に余白を置いてcameraを開き、
   手動停止まで1本のclipへ連続収録する。5時間または容量の安全余白到達時は自動停止する。
4. 終了時に同じアクションボタンをもう一度通常押しする。録画中または確定中の操作は、新規開始ではなく
   現在のsessionの停止として扱う。
5. 「撮影ストップ」は停止要求の受理を表す。成功時の保存音声は鳴らさず、失敗時だけ案内する。
   30分実測ではMP4とsidecarの確定に約51秒かかったため、停止後約1分は電源を切らない。

RootLens APKは通常撮影の録画入力としてAndroid標準`MIC`を所有するが、スピーカー出力用I2SとUARTは操作しない。
`capture_start_received`、`capture_stop_received`、`capture_failed`、`calibration_instructions`と
3種類のupload feedbackの
allowlist済みsemantic eventだけをASG forkへ明示Intentで渡し、
ASGの既存`I2SAudioController`がMediaPlayerとK900 commandを同一processで所有する。ASGはI2S停止後に
touch reportingを冪等に再有効化する。feedback再生に失敗しても撮影state/effectは取り消さないが、
通常撮影MP4にAAC-LC 48kHz mono音声trackがない場合、または音声の先頭・末尾が映像から2秒を超えて
欠ける場合はclip確定をfail-loudにする。信号内容は判定せず、静かな現場を無音だけで破棄しない。
RootLensの案内音声MP3はすべて元音源比でpitchを8%上げる。開始・停止音声だけはさらに1.5dB下げ、
その前に鳴らすMentra標準の開始・停止効果音には加工を加えない。
RootLens reducerがSTARTまたはSTOPを受理した直後には、Mentra標準の開始・停止効果音を鳴らし、
ASG側の1つの再生シーケンスとして`capture_start.mp3`または`capture_stop.mp3`を続けて鳴らす。開始側は
効果音約0.58秒と音声約1.38秒にI2S開始・停止の余白を加え、3.2秒待ってからCamera2を開き、
案内音声を通常撮影MP4へ混入させない。停止音声は操作受理を表し、保存成功は無音、失敗時だけ
`capture_failed.mp3`を鳴らす。

入力はASG forkがMCUから受け取るアクションボタン通常押し`cs_pho`を入口とする。ASGは物理押下ごとに
一意なcommand IDを付け、署名権限で保護した明示broadcastをRootLensのmanifest receiverへ送る。
RootLensが未導入、無効、または配送不能でもCameraNeoへfallbackせず、失敗音だけを鳴らして終了する。
長押し`cs_vdo`はstock動画へ渡さない。物理入力はpure reducerが一元管理し、状態は
`IDLE`または次の長押しを待つ`PENDING(count, first, last, deadline, revision)`、deadlineは
`min(直前の押下+8秒, 最初の押下+30秒)`とする。各受理回はMentra標準`click_sound.wav`を一度鳴らす。
deadlineまでに5回目へ到達した場合だけ隠しRGB/IMUキャリブレーションを起動し、1〜4回目で
deadlineを過ぎた場合はuploadを一度だけ明示起動する。1秒未満の重複firmware reportは状態も期限も
進めない。通常押しは期限内のPENDINGを取消して通常撮影toggleへ進み、古いtimeout callbackは
revision不一致でno-opになる。通常押し・長押しのどちらからもstock写真・stock動画は始まらない。

5回目の後は、模様のある静止した景色に向け、メガネへ触れず、頭を左右・上下へ速さと停止を
変えながら5分間動かす。5回目の標準clickが終わってから11.651秒の説明音声を流し、I2S cleanupを
含めて12.8秒後にCamera2を開く。キャリブレーション開始後に別の音声は再生しない。解析は15秒windowごとの
visual global motionとraw gyro magnitudeの相関から
offsetを求め、全体相関、peak prominence、受理window数、window間MAD、全体推定との一致をすべて通した
場合だけ値を採用する。通常押しは録画・確定・解析のどの段階でもキャリブレーション全体の中止を意味し、
通常撮影の開始には解釈しない。`calibration-*`成果物はupload scannerの対象外で、成功時は端末から削除、
解析失敗時は診断用に残す。

RootLensは物理入力待ちの常駐serviceを持たず、`READ_LOGS`やlogcat監視も使わない。ASGの明示broadcastが
停止中のRootLens processを起こし、receiverから`CaptureService`へそのまま命令する。RootLens側の
reducerが同じcommand IDの再配送をno-opにする。

撮影sessionの制御規則はAndroid serviceから分離したpure reducerに置く。
`state × event -> next state + effects`だけを計算し、`CaptureService`はcamera、timer、feedback、uploadを
effectとして実行する。feedback effectはASGへsemantic eventを送るだけでhardware routeを操作しない。START/STOPの
重複はno-op、timerとcamera callbackはclipごとのgenerationが
一致する場合だけ受理する。これにより、開始待ち中のSTOP後に古いtimerがcameraを開くことや、
停止済みclipへ古い容量・時間制限callbackが作用することを防ぐ。`CaptureEngine`は1 clipだけを所有する。
reducerは手動停止、5時間制限、容量制限の停止原因を保持し、確定完了後にsessionを閉じる。

専用端末設定ではcamera ownerはRootLensだけである。`Camera disconnected`、camera device error、
MP4確定失敗は設定またはhardwareの契約違反としてfail-loudにする。一方、Androidがsleep中の再openを
`CAMERA_DISABLED`で拒否する場合だけは別であり、Activityとscreen wake lockでcamera access pathを
再度foreground化し、同じclip generationを最大4回まで再試行する。録画時間を消費せず、全試行が
失敗した場合だけ失敗音と`status.json`へ原因を残す。

RootLensはMCU UARTを直接開かない。ASG serviceがUARTの単一ownerであり、別processから
同時に書き込むとcommand frameや音声制御を壊し得るためである。ASG forkは公式v39 commitへ固定し、
service起動、UART接続、I2S停止、service終了の各境界で、`mh_stopi2s`と`cs_swit` type 26を同じ
直列化済みtransportから再設定する。再設定はgeneration付きreconcilerで冪等化し、送信不能時だけ
250ms / 1s / 3sでretryする。forkの再現手順とstock復元境界は`asg-fork/README.md`を正とする。

画面がsleep中でも、アクションボタン通常押しはUIを経由せずmanifest receiverから`CaptureService`へ渡る。
初回camera open前は開始音声の再生時間を確保してからcameraを開く。停止はservice内だけで完結する。

開発時にはActivity intentでも同じ操作を行える。

```sh
adb shell am start -W \
  -a io.rootlens.mentra.START \
  -n io.rootlens.mentra.debug/io.rootlens.mentra.MainActivity \
  --ei duration_seconds 30
```

通常Androidアプリのbackground serviceだけでsleep中にcameraを開くと、OSのbackground
camera制限により `CAMERA_DISABLED` になる。`CaptureService`はclipのopen effectでActivityを
foregroundへ移してからCamera2を開き、policy rejectionだけを1.5秒間隔でbounded retryする。

実機v0.1.21では、アクションボタン入力が署名IPCを一度だけ通り、RootLensの
CONNECT/DISCONNECTと一対一になることを確認した。同じ試験中にCameraNeoは起動せず、終了後の
active camera clientは0だった。51.864秒の成果物はvideo 1,533 sampleとCamera2 1,533 frameが一致し、
補間0、accelerometer 10,582 sample、gyroscope 10,590 sampleだった。ASG forkとRootLensは
unit test・lint・build済みで実機へ導入済み。stock ASGは復元可能なdisabled-user状態で保持する。

実機v0.1.19ではsegment上限を一時的に15秒へ短縮した35秒sessionを使い、開始3秒後に画面を
強制消灯した。generation 1/2/3の3 clipをすべて確定し、generation 2のopen前に
`RootLensMentra:camera-start` wake lockで`Asleep`から復帰した。`CAMERA_DISABLED`は再発しなかった。
検証clipはproduction upload対象から外して`recordings/test-archive/`へ移し、端末には30分設定の
APKを再導入した。

## アップロード

固定端末の初回セットアップ時は、資格情報をshell引数やログへ出さないQR provisioning scriptを使う。

```sh
cd mentra-os
scripts/provision-from-qr.sh ../web/accounts-out/bakery_01.png
```

scriptはQRをPC上でdecodeし、mode 0600の一時JSONをアプリ専用外部directoryへpushする。
端末は資格情報を読み取ると直ちにJSONを削除し、取得したaccess/refresh tokenだけをAndroid
KeystoreのAES-GCM鍵で暗号化して保持する。statusにはlogin IDと成否だけを残し、password/tokenは
書かない。

録画終了時にはuploadを開始しない。長押しシーケンスが1〜4回で期限切れになった場合、または画面の
`Upload all pending clips`を明示操作した場合だけ、端末内の完了済み未送信clipへ次を実行する。

1. `POST /api/v1/raw-uploads` で `recordingConfig=mentra` のpresigned URLを取得。
2. 必須4ファイル（`rgb.mp4`、`frames.jsonl`、`imu.jsonl`、`metadata.json`）を
   `rootlens-raw-mentra/raw/<content_hash>/`へstreaming PUT。
   各成功後に `upload_state.json` を更新。内部QA用`sync_report.json`はアップロードしない。
3. 全PUT後に `POST /api/clips` で登録。
4. API登録の成功後、schema・登録済みflag・content hash・全4ファイル名を含むupload receiptを
   `AtomicFile`でfsyncしてからだけ削除へ進む。receipt検証済みclipをtombstoneへrenameし、receiptを
   最後まで残してpayloadを削除する。削除途中で再起動しても次回の明示upload scanで安全に消し切る。

`metadata.json` の `files` はR2に納品される上記4ファイルを列挙する。
`camera_frames.raw.jsonl`、`sync_report.json`、`content_hash.txt`は端末内で整合性確認と
アップロード処理に使う補助ファイルであり、R2には納品せず、登録成功時にclipと一緒に削除する。

明示commandのscanで、pending clip、保存済みaccount session、validated Wi-Fiを確認できた場合だけ
`upload_started.mp3`を鳴らす。未送信clipが0件ならfeedbackは鳴らさない。開始条件を満たさない場合
または処理途中で失敗した場合は`upload_unavailable.mp3`、全対象の登録と削除まで完了した場合は
`upload_complete.mp3`を鳴らす。
Wi-Fi復帰、端末boot、録画停止を契機とする自動再送Jobは持たない。

端末からPCへ救出したclipを直接R2へ戻す場合は、次を使う。

```sh
cd web
node scripts/r2_mentra_upload.mjs <clip-directory> <content-hash>
```

`rgb.mp4`のSHA-256をkeyと照合してから契約上の4ファイルだけをアップロードし、R2のsizeと
Content-Typeを各PUT後に検証する。`metadata.json`は最後に置く。これはR2オブジェクト救出用であり、
account認証が必要な`POST /api/clips`登録やローカル削除は行わない。

一回の明示command内ではPUTを最大4回まで再試行する。失敗後の次回明示commandではcheckpointから
成功済みファイルを飛ばして再開する。upload中に届いた追加commandは同時実行も後続scanも作らず、
進行中の1回へまとめる。物理command IDの重複配送も永続記録によりno-opにする。
