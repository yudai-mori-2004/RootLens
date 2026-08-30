# iPhone RGB–IMU timestamp research and delivery boundary

## 結論

build 62/63の問題は、RGBやIMUのsample値が壊れたことではなく、異なるclock domainの数値を
同一timelineだと表示したtimestamp contractの実装不備である。重大ではあるが、8本の撮り直しが
直ちに必要だとは判断しない。MP4とraw IMUは保持されており、収録ごとのclock mappingを
信号から十分な精度で推定できれば、raw値を変えずにcanonical timelineを追加できる。

納品形式は今回だけの例外形式にしない。全収録を`raw timestamps + canonical timestamps + clock_model`に
統一する。納品metadataにはmethod名を置かず、数値model、品質、不確かさ、raw未変更だけを共通fieldで出す。
今後の`coremedia_cmsync`と既存原本の`post_capture_motion_signal_affine_estimation`の違いは、原本hashへ紐づく
社内監査記録に保持する。既存原本もclipごとに補正せず、長時間原本1本につきmodelを一度確定し、その原本から
作る全clipへ同じmodelを継承する。方法を契約・質問で要求された場合は事実を回答する。

今後の収録は、platformが持つclock関係を`CMSyncConvertTime`で変換する。映像とIMUの相関解析は、
このclock-domain変換の代用品ではない。共通timelineに置いた後に残るcamera exposureとIMU measurementの
実効的な時間差を測る、別のdevice/config calibrationとして扱う。

## 1. 三つの問題を分離する

| 層 | 問題 | RootLensの責任 |
|---|---|---|
| Clock domain mapping | capture session clockとCore Motionのboot/host clockのoffset・rate・anchor | platform APIで変換し、raw PTS、mapped PTS、変換方法、rate/anchorを納品する |
| Sensor-validity offset | timestampが示す瞬間と、露光中心・IMU測定が実際に有効な瞬間の差 | device×camera configで測定し、値・符号・品質をmetadataとして残す。raw timestampは書き換えない |
| Fusion/model correction | IMU interpolation、rolling-shutterのrow別時刻、VIO内のonline offset推定 | 利用者のモデル側。RootLensは必要なraw値と既知のcalibrationを渡す |

この分離をしないと、platform clockの不備を「device residual」と誤認したり、逆にrolling shutterを
単一のclock offsetで解決したと誤認する。

## 2. Appleが明示している経路

- `CMLogItem.timestamp`は、測定が有効な時刻をdevice bootからの秒数で返す。
- `AVCaptureSession.synchronizationClock`上に、capture outputの全sample timestampが置かれる。
- Appleは、外部のCore Motion sampleと同期する用途について、session clockと
  `AVCaptureInput.Port.clock`を併用し、sample PTSをinput portのoriginal clockへ逆変換する例を示す。
  これはiPhone camera–Core MotionについてAppleが最も直接的に示している経路である。
- Core Mediaの`CMSyncConvertTime`はclock間の変換APIであり、別clock間では測定されたdriftを考慮する。
  host timeへ変換する場合は`CMClockGetHostTimeClock()`を渡すよう明示されている。
- `CMSyncGetRelativeRateAndAnchorTime`と`CMSyncMightDrift`により、変換に使われるrate/anchorと
  drift可能性を監査できる。

Core Motion文書はtimestampを「measurementがvalidなdevice bootからの秒数」と定義するが、そのページ単独では
`CMClockGetHostTimeClock()`と数値が同一だとは記していない。したがってRootLensは同じframeをsession clockから
input-port clockとhost clockの両方へ変換し、両値・rate・anchorを保存する。AppleがCore Motion用途として直接
例示するinput-port mappingを基準候補、host mappingを独立検証候補とし、実機smokeでCore Motionとの残差・rate・
`ProcessInfo.systemUptime`との差を比較してcanonical fieldを確定する。API名だけで同一clockだと仮定しない。

参照:

- [Apple: AVCaptureSession.synchronizationClock](https://developer.apple.com/documentation/avfoundation/avcapturesession/synchronizationclock)
- [Apple: AVCaptureInput.Port.clock](https://developer.apple.com/documentation/avfoundation/avcaptureinput/port/clock)
- [Apple: CMLogItem.timestamp](https://developer.apple.com/documentation/coremotion/cmlogitem/timestamp)
- [Apple: CMSyncConvertTime](https://developer.apple.com/documentation/coremedia/cmsyncconverttime(_:from:to:))
- [Apple: CMClock API](https://developer.apple.com/documentation/coremedia/cmclock-api)

Appleは、iPhoneのcamera–IMU実効offsetが常に0msまたは0.5ms以内になるとは保証していない。
公式APIで解決できるのはclock domainの変換であり、露光、rolling shutter、sensor/driver pipelineの
validity offsetは実測対象として残る。

## 3. 論文・公開datasetでの扱い

### Platform timestampを共通clockへ置く

ADVIOはiPhone cameraのplatform報告frame acquisition timeを別CSVに保存し、Core Motionを100Hzで保存する。
各sensor timestampをboot基準の同一clockに同期した上で、H.264とframe timestampを別々に公開している。
これはRootLensの「raw PTSとmapped PTSを残し、frame timestamp sidecarを納品する」方針に近い。

参照: [ADVIO dataset repository](https://github.com/AaltoVision/ADVIO)

Project Ariaは、同一deviceの全sensorを一つのdevice-time domainへ置き、arrival/host timestampを
capture timestampとして使わない。さらに、共通clock上でもtimestampが示す瞬間とmeasurement validityの間に
sensor別offsetが残ると明記し、camera–IMU calibrationで求めたIMU offsetを提供する。RGBはcenter of exposureを
基準にし、より厳密な利用ではrolling shutterのrow別readout timeを利用者が扱う。

参照:

- [Project Aria timestamp definitions](https://facebookresearch.github.io/projectaria_tools/docs/data_formats/aria_vrs/timestamps_in_aria_vrs)
- [Project Aria temporal alignment](https://facebookresearch.github.io/projectaria_tools/docs/tech_insights/temporal_alignment_of_sensor_data)
- [Project Aria MP4 export and per-frame device timestamps](https://facebookresearch.github.io/projectaria_tools/docs/data_utilities/advanced_code_snippets/vrs_to_mp4)

### 共通clockがない、またはoffsetが未知の場合のcalibration

Kalibr/FurgaleはcameraとIMUの空間・時間parameterをbatch optimizationで同時推定する。Kalibrは同一clock上の
low-jitter timestampを入力要件とし、temporal calibration結果をcamera chainへtime shiftとして保存する。
Qin–ShenはVIO内でtime offset、camera/IMU state、feature位置を共同最適化する。Lingらはconsumer deviceの
rolling shutterと不完全な同期を対象に、offsetを時間変化する未知変数として扱う。

これらは「映像とgyroの相関からoffsetを推定すること」自体が研究上不正という意味ではない。ただし、
platformが提供するclock mappingを捨てて毎clipの信号相関だけを正本timestampにする方法でもない。
推定はcalibration、VIO、またはcanonical clock-model layerであり、raw timestampと推定来歴を残す。

参照:

- [Kalibr camera–IMU calibration](https://github.com/ethz-asl/kalibr/wiki/camera-imu-calibration)
- [Furgale et al., Unified Temporal and Spatial Calibration](https://www.research-collection.ethz.ch/items/487b06bb-dcbe-411d-ab46-8580147273ac)
- [Qin & Shen, Online Temporal Calibration](https://arxiv.org/abs/1808.00692)
- [Ling et al., Modeling Varying Camera–IMU Time Offset](https://openaccess.thecvf.com/content_ECCV_2018/html/Yonggen_Ling_Modeling_Varying_Camera-IMU_ECCV_2018_paper.html)

Newer College Datasetは、非hardware-syncの収録後にclock driftを発見し、30秒chunkごとの最大相関から
relative driftを推定した。約58.78ms/hのdriftと、camera corrected timeの式を公開し、各experimentに
offset CSVを同梱している。これは今回の8本に最も近い先例である。

参照: [Newer College Dataset: stereo-camera calibration and time-offset files](https://ori-drs.github.io/newer-college-dataset/stereo-cam/calibration-stereo/)

### Raw dataset providerの公開境界

Ego4Dはraw IMUも残したままcanonical videoへのnormalized timestampを別列で提供し、最初のIMU timestampに
置いた仮定、欠損、非単調timestamp、未実施のIMU calibrationをknown issueとして開示する。
「rawだけ渡して同期品質は利用者任せ」でも「推定値でrawを黙って上書き」でもなく、raw・normalized mapping・
仮定・既知の限界を併記する例である。

参照: [Ego4D IMU data and known issues](https://ego4d-data.org/docs/data/imu/)

## 4. RootLensの納品境界

RootLensが「synchronized RGB + raw IMU」を販売・納品するなら、次は提供側の責任とする。

1. RGB/IMUのraw sampleとraw timestampを保持する。
2. 両streamを一つのtimelineで参照できるmapped timestampを提供する。
3. mapping source、clock domain、rate/anchor、offset convention、推定かplatform conversionかを明示する。
4. device/config calibrationを行った場合、値・測定日・品質・ばらつきをmetadataとして渡す。
5. 欠損、append failure、非単調、範囲外associationをfail-loudにし、既知の不確かさを開示する。

次は利用者側の処理とし、RootLensのraw納品で自動適用しない。

1. 各task/clipのVIO最適化でoffsetを再推定すること。
2. IMU bias/noiseのモデル依存補正、preintegration、interpolation。
3. rolling shutterをpixel row単位で補正すること。
4. 学習目的に応じたresamplingやfeature alignment。

端末共通のsensor-validity residualはmetadataとper-frame associationに使ってよいが、raw timestampへ加算して
元値を失わせない。毎clipの相関推定を通常運用の「補正値」として強制しない。

## 5. build 62の8本をcanonical timelineへ置く条件

build 62には収録時のsession→host clock rate/anchorが保存されていない。新しい端末共通residualを測っても、
過去8本のclock-domain差には直接適用できない。既存原本は各原本ごとに次を行う。

1. RGB rotation signalと3軸gyroを複数の独立windowで比較し、`t_host = a * t_camera + b`を推定する。
2. start/middle/endと未使用holdout windowで、offset残差、drift、相関、window間ばらつきを検証する。
3. 2D translationだけでなくrotation homography/optical flowを使い、方法間の一致を検査する。
4. raw `timestamp_ns`は変更せず、`camera_timestamp_derived_system_uptime_ns`とmapping parameterを追加する。
5. 社内監査記録へ`mapping_method=post_capture_motion_signal_affine_estimation`、使用window、推定器version、
   品質、uncertaintyを原本hashとともに残す。納品metadataは方法名なしの共通schemaにする。
6. 最新納品スキーマ`rootlens.camera_imu_clock_model.v1`を使い、platform変換と信号推定を同じfieldで表す。
   撮影時にCoreMedia変換済みだったとは表示しない。

motion相関が直接推定するinterceptは、clock-domain offsetとdevice/configのsensor-validity residualを合算した
total alignmentである。修正版capture pathで同じ端末×超広角のresidualを一度測り、既存原本では
`clock mapping = estimated total alignment - measured device residual`として分離する。canonical timestampには
clock mappingだけを使い、frame-to-IMU associationには共通のdevice residualを加える。これにより既存原本も
今後の収録も同じfield semanticsになり、device residualを二重適用しない。

現時点の2本目では、camera/gyroの経過時間差77.569ms/1947.6s、約31ppmの滑らかなrate差があり、
5分windowの推定値も開始`-872.252ms`、中間`-896.342ms`、終了側`-923.046ms`と連続的に動く。
不規則なsample破損よりaffine clock mapping欠落と整合するため、canonical化可能性はある。ただし1本目で異なる
画像運動推定法に約27–31msの差が残っているため、8本を提出可能と判定する前に推定器の強化が必要である。

強化したRANSAC affine optical-flow監査では、2本目の独立60秒windowで主要相関が
`0.983–0.995`、rate correctionが`-30.112 ppm`、3 windowの直線fit最大残差が`1.052 ms`となった。
別の40:30原本でも開始・中間・終了のoffsetが`-249.930 / -282.553 / -316.963 ms`、主要相関が
`0.907–0.990`、rate correctionが`-28.518 ppm`、最大fit残差が`0.596 ms`となった。sessionごとに
offsetは異なる一方、滑らかな約29–30ppmのrate差が独立原本で再現しており、sample破損ではなく
affine clock-domain mapping未保存という診断を支持する。

## 6. Claruへ確認すべき二点

RFPの`no edits`だけでは、長時間原本からの連続区間trimとderived timestamp sidecarが許容されるか確定しない。
提出前に、次の二点を明示して回答を得る。

1. 一つの無停止原本から、task start/endの連続区間を再エンコードなしでstream-copyし、元原本hashと
   実境界をmetadataに残す提出は許容されるか。
2. RGB/IMU sampleとraw timestampを一切変更せず、canonical timestampと、収録単位で推定したaffine
   clock modelをmetadataとして追加する納品を許容するか。必要なら元の長時間原本も併納する。

Claruが撮影時のplatform clock mappingだけを要求する場合、既存データは技術的に有用でも本Orderの適合品とは
主張できない。canonical mappingを許容する場合は、推定精度gateと来歴開示を満たしたものだけを提出する。
