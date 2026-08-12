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
- 5時間要求を30分クリップへ分割し、容量を事前検査する
- resumable R2 uploadとclip登録を追加する
- serverへ`recordingConfig=mentra` manifestを追加する
- 実機build、sleepからの起動、短時間収録、成果物formatを検証する

### やらないこと

- Mentraに存在しないLiDAR/depthを生成する
- 公称119°を水平/対角の確認や実効FOV校正なしにiPhoneの0.5x相当と断定する
- documented capture configurationを越えてclock適合を一般化する
- 個体識別子、binary hash、解析手法をClaru向けの初回要件回答へ記載する
- hands visibility 80%を収録アプリだけで保証する
- production deployまたはrawデータの自動削除

## 成功基準

- [x] debug APKがbuildできる
- [x] 接続したMentra Liveで1080p30 SDR MP4を生成できる
- [x] `frames.jsonl`がMP4の全sampleにつき1行を持つ
- [x] raw accel/gyroと前後timestamp indexを各frameへ対応付ける
- [x] HAL `UNKNOWN` と別timebaseの実測をfail-loudに記録する
- [x] sleep中の端末をActivity intentから起こして収録できる
- [x] Android uploaderとweb presign manifestが一致する
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
- end-to-end video-to-IMU offset: `+73.5 ms`（`t_IMU-t_video`）。全区間相関0.969、
  高信頼5秒区間70–78 ms
- FOV: Mentra公称119°。Camera2の未校正pinhole計算値71°は公称値と矛盾するため採用せず、
  1080p ISP出力をcheckerboard等で実測する
- 実機空き容量: 約25 GB。5時間の予測総量は約18 GB以内

この結果とper-frame timestamp納品により、Claruのsingle hardware clock source要件へ適合する。
IMX681とICM426XXのsampling clock、hardware trigger、sensor内latchは別のacquisition特性であり、
clock source要件の合否とは分離して記録する。実測offsetは各frameへ適用済みで、長時間試験を通すまで
温度変化を含むoffset安定性の上限は主張しない。

## 進捗

アプリ・upload contract・短時間実機smoke・timestamp counter経路監査・controlled motion offset測定は完了。
5時間enduranceとproduction upload E2Eは未完了。
