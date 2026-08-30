# Task 16: Claru Mentra capture

## 目的

Mentra Live単体で1080p30 SDRの一人称RGBとraw IMUを収録し、各video frameとIMUの
timestamp対応を監査可能な形で保存・アップロードする。Claruのsingle hardware clock source要件への
適合と、実効video-to-IMU offset/jitterの品質測定を分離して管理する。

## 読むべきファイル

- `devices/mentra-live.txt`（Claru向けデバイス別要件回答）
- `CLOCK_AUDIT.md`（構成識別子と検証手法を含む内部技術監査）
- `mentra-os/README.md`
- `mentra-os/app/src/main/java/io/rootlens/mentra/SessionArtifacts.java`
- `mentra-os/app/src/main/java/io/rootlens/mentra/DeviceProbe.java`
- `web/lib/r2-keys.ts`
- `app/README.md`

## スコープ

### やること

- iOS `app/`と並列なnative Android capture appを`mentra-os/`に作る
- 1920x1080、30fps、H.264 8-bit SDRを固定して録画する
- accelerometer/gyroscopeをraw timestamp付きで保存する
- MP4の全video sampleにper-frameのcamera↔IMU対応を出す
- HAL時刻源、clock bridge、alignment誤差、保証不足を`sync_report.json`に残す
- 1回の開始から手動停止までを1クリップとして最大5時間収録し、開始前と録画中に容量を検査する
- resumable R2 uploadとclip登録を追加する
- serverへ`recordingConfig=mentra` manifestを追加する
- 実機build、sleepからの起動、短時間収録、成果物formatを検証する

### やらないこと

- Mentraに存在しないLiDAR/depthを生成する
- 公称119°を水平/対角の確認や実効FOV校正なしにiPhoneの0.5x相当と断定する
- documented capture configurationを越えてclock適合を一般化する
- 個体識別子、binary hash、解析手法をClaru向けの初回要件回答へ記載する
- hands visibility 80%を収録アプリだけで保証する
- R2全PUT・API登録・fsync済みreceiptの確認前にrawデータを削除すること

## 成功基準

- [x] debug APKがbuildできる
- [x] 接続したMentra Liveで1080p30 SDR MP4を生成できる
- [x] `frames.jsonl`がMP4の全sampleにつき1行を持つ
- [x] raw accel/gyroと前後timestamp indexを各frameへ対応付ける
- [x] HAL `UNKNOWN` と別timebaseの実測をfail-loudに記録する
- [x] sleep中の端末をActivity intentから起こして収録できる
- [x] 物理long pressをUI非依存の冪等commandとして開始・停止へ直結する
- [x] 再起動、連続開始停止、sleep、USB未接続で物理操作を実機検証する
- [x] Android uploaderとweb presign manifestが一致する
- [x] API登録receiptをfsync後だけローカルclipを削除し、中断cleanupを再試行する
- [x] 5連続長押しだけで起動する端末固有RGB/IMU calibrationと品質gateを実装する
- [x] web unit testとTypeScript checkが通る
- [x] controlled motion captureによるvideo↔gyro offsetの物理検証
- [ ] 外部給電で5時間の容量・温度・encoder endurance test
- [x] rooted実機のdevice tree、kernel、vendor HALからtimestamp counter経路を確定
- [ ] local web変更をdeploy後、認証付きuploadをend-to-end検証

## 実機結果

- 端末: Mentra Live、Android 11、incremental build `mp1k61v164bspP6`
- Camera HAL timestamp source: `UNKNOWN`
- camera timestamp: 実測上CLOCK_MONOTONIC側
- IMU timestamp: CLOCK_BOOTTIME / `elapsedRealtimeNanos()`側
- Linux clocksource: `arch_sys_counter`。device treeとkernel instruction pathから、camera/IMU
  timestampの共通基礎が13 MHz ARM architectural counterだと確定
- vendor Sensors HAL: `SensorBase::getTimestamp()`は`elapsedRealtimeNano()`を使用。通常の
  accel/gyro sampleはkernel/vendor event timestampをSensorEventへ引き継ぐ
- 同時採取したBOOTTIME−MONOTONIC bridgeの10秒標準偏差: 約3.9 µs
- MP4 PTSとCamera2 relative timelineの平均絶対誤差: 約0.17 ms
- 10秒clip: 1920x1080、H.264 High、yuv420p、8-bit BT.709 SDR、音声なし
- MP4 PTSの実測平均: 29.72 fps（nominal 30fpsの1%以内。長時間cadence確認は未完了）
- 現場30分clip: 1,800.126秒、1.56 GB、53,287 video samples、Camera2 resultsとの対応53,287件、
  accel 360,243件、gyro 360,268件。実測29.605 fpsで30fpsとの差が1%を超えるためcadence要改善
- 同clipはSHA-256一致を確認してPCへ救出し、`rootlens-raw-mentra`の
  `raw/78c34fcebd81e592b3e5ea17531c5bfc048b2d8c8814f79badf40192e67e952f/`へ契約上の4ファイルを
  直接PUT。R2 HEADでsizeとContent-Typeを検証済み。account認証付きclip登録は未実施
- end-to-end video-to-IMU offset: `+73.5 ms`（`t_IMU-t_video`）。全区間相関0.969、
  高信頼5秒区間70–78 ms
- FOV: Mentra公称119°。Camera2の未校正pinhole計算値71°は公称値と矛盾するため採用せず、
  1080p ISP出力をcheckerboard等で実測する
- 実機空き容量: 約25 GB。5時間の予測総量は約18 GB以内
- 物理操作v0.1.17: 連続4 cycle、sleepからのcycle、USB未接続start、UI非経由cycleで
  Camera2 CONNECT/DISCONNECTが受理操作と一対一。終了後active camera client 0
- RootLens APKから音声/I2S/UART操作を撤去し、allowlist済みsemantic feedbackをASG forkへ渡す構成をbuild済み
- ケース復帰後の停止操作1回はASGが`long_press`を発行せず、次の押下で停止。RootLens state machine
  以前の欠落に対し、公式v39ベースASG forkで起動/UART接続/I2S停止時のtouch reporting再有効化を実装・unit test済み
- 30分分割後のgeneration 2は、画面消灯中のcamera再openをAndroid AppOpsが`MODE_IGNORED`にして
  `CAMERA_DISABLED`となった。generation 1は完全に確定済み。各segment openでforeground camera pathを
  再確立し、同じgenerationをbounded retryするv0.1.19へ修正
- v0.1.19のsegment上限を一時的に15秒へした35秒sessionで画面を強制消灯し、3 clipの連続確定を確認。
  generation 2のopen時にapp wake lockで`Asleep`から復帰し、camera policy rejectionなし。検証後は
  30分設定APK（SHA-256 `85766dc94af90f24e826382d5db94b090191bd574e44312977fab2930736ee1d`）を再導入
- v0.1.23で30分camera停止時点から3分のinter-segment intervalを開始するpure reducer policyを追加。
  MP4/sidecar確定とinterval timerは独立して完了を待ち、両方が揃った場合だけ次generationを開く。
  `FINALIZING`または`INTERVAL`中の物理toggleは論理session全体のSTOPとしてlatched/cancelされ、
  遅延timerがcameraを再開できないことをunit testで固定。一時的な6秒clip/20秒interval・upload無効APKでも、
  `RECORDING -> FINALIZING -> INTERVAL -> STOP -> SUCCEEDED`後に旧timer期限を越えてcamera client 0、
  無操作時は2 clip/2 generationの自動完走を実機確認。試験clip削除後、30分/3分の本番APKを再導入した。
  導入済みv0.1.23-debug（versionCode 25）とbuild APKのSHA-256はともに
  `a3016c3a8d466a2ecca759447d4202b869ff9f24c6683c3ccadb4046f5babb17`
- v0.1.24で長押し単発のno-opを、30秒以内の異なる長押し5回だけを受理するhidden calibration gateへ
  置換。通常押し、8秒超の間隔、1秒以内の重複reportで誤作動しないpure testを追加した。5分の
  controlled-motion clipを15秒windowへ分け、visual motionとgyroの相関・peak prominence・window MAD・
  全体推定一致を通った値だけfirmware/camera/config binding付きAtomicFileへcommitする。通常撮影との
  camera ownerは排他で、通常押しはcalibration全体をcancelし、失敗時は従来値を保持する。
  ElevenLabs説明音声（9.273秒）は5回目のstock click後にASGから再生し、実尺＋余白後にcameraを開く。
  実機の説明中cancelではcamera client 0・成果物0、説明完走後RECORDING直後cancelでも値更新なし・
  `calibration-*`残存0・camera client 0を確認した。
- 同版でupload後削除を登録flag・content hash・全4ファイル名入りのfsync済みreceiptでgateし、
  receiptを最後まで保持するtombstone cleanupとpersisted retryへ変更した。
  実機導入済みRootLens v0.1.24-debug（versionCode 26）のSHA-256は
  `72b283312c142b57228dc7ca9c9a1397970a55da2664bc6ddea931f7d631bf8a`、説明音声入りASG forkは
  `92a04f3b3a6fce89a8be4fe87ffab1f5f0d1dfab6af4ae22ea5df2cf2fbfb9ec`で、端末上base APKと一致した。
- 4:3 raw master案は実機で1920x1440 MediaRecorderのstop失敗を確認し、後段再encodeの運用費用も
  発生するため不採用。1920x1080のHAL中央cropを正本として直接R2へ置く
- v0.1.25で`RECORD_AUDIO`を追加し、Android標準`MIC`をAAC-LC 48 kHz mono / 96 kbpsとして
  `rgb.mp4`へ多重化する。確定時にAAC trackと1件以上のaudio sampleを必須検査し、欠落時は
  `failure.json`を残してupload対象外にする。versionCode 27のdebug APKはunit test・lint・clean buildを
  通過し、実機へ導入済み。15.083秒のclipでH.264映像とAAC-LC 48 kHz mono / 96 kbps音声を
  同一MP4に収録し、707 audio samples、最大音量-16.8 dBの非無音信号をffprobe/ffmpegで確認した。
  clip content hashは`bcf69572d02efee3f32673f72fe0147d57ab3c5596926d34793793bc0cd6ccfe`、
  導入APKのSHA-256は`517b47e94b7aed1eb576ca430885da9e91d2830b8b0c74db0b8c12fce3aa0401`。
- v0.1.26ではAndroid 11のcapture foreground serviceへ`microphone`型を追加し、通常撮影だけで
  マイクを有効化する。キャリブレーションは音声を保存しない。通常撮影の確定条件はAAC-LC、48 kHz、
  mono、1件以上のsample、音声と映像の先頭・末尾差が各2秒以内とした。信号強度は条件にせず、静かな
  現場を破棄しない。録画開始後の長い開始読み上げを廃止し、事前の操作受付音と確定後の保存音は維持した。
  exported Activityの外部START経路を削除し、署名broadcastまたはアプリ内ボタンだけを受理する。
  15.061秒の実機clipでH.264 14.889秒とAAC-LC 48 kHz mono / 96 kbps 15.061秒、706 audio samplesを
  確認し、新しい全区間検査を通過した。clip content hashは
  `b57b078dbca7e267643efd0755fde5ed2ea59be225cf6909c3eaf28d74026806`。最終debug APKと
  実機上base APKのSHA-256はともに
  `1201940320a518c8dd45c8934fd3a0115c003e9e751761e7124a718d28082308`。

この結果とper-frame timestamp納品により、Claruのsingle hardware clock source要件へ適合する。
IMX681とICM426XXのsampling clock、hardware trigger、sensor内latchは別のacquisition特性であり、
clock source要件の合否とは分離して記録する。実測offsetは各frameへ適用済みで、長時間試験を通すまで
温度変化を含むoffset安定性の上限は主張しない。

## 進捗

アプリ・upload contract・短時間実機smoke・timestamp counter経路監査・controlled motion offset測定・
物理操作state machineと実機cycle試験は完了。ASG自己回復forkは実機導入済み。30分clipで判明した
background camera再openをv0.1.19で修正した。v0.1.23で追加した30分/3分の自動分割は現場の
手動区切りを正とする方針へ変更したため撤去し、現在は1操作につき最大5時間の単一clipとする。
開始時は30分ぶんだけを容量予約し、録画中は512 MiBの安全余白を5秒ごとに監視して自動停止する。
unit test/lint/buildと5時間指定の短時間実機smokeまで完了。
現場clipのPC救出とR2直接PUTも完了。実30分clipの確定には約51秒かかる。5時間endurance、
cadence改善、account認証を含むproduction upload E2Eは未完了。
