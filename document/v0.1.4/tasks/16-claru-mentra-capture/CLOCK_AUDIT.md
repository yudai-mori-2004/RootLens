# INTERNAL — Mentra Live RGB/IMU clock audit

この文書は構成識別子、検証手法、binary hashを含む内部技術記録であり、Claruには送付しない。
対外回答は`devices/mentra-live.txt`を使用する。

## 結論

対象実機・対象firmwareでは、次の二つを分けて判定する必要がある。

| 判定対象 | 結論 |
|---|---|
| camera timestampとIMU timestampを生成する基礎hardware counter | **一つ**。13 MHz ARM architectural system counter |
| Camera2とSensorEventが返すAndroid timebase | **表現は別**。cameraはMONOTONIC、IMUはBOOTTIME。通常稼働中は固定offset |
| camera sensorとIMU sensorを駆動するsampling clock | **別**。IMX681は24 MHz camera MCLK/CAMTG、ICM426XXはsensor ODR |
| 露光開始とIMU sampleの共通hardware latch / trigger / FSYNC | **なし**。現在のdriver pathでは確認できず、IMUはpolling時にsoftware timestampを付与 |

Claruの`RGB and IMU on a single hardware clock source, with the per-frame video↔IMU timestamps
delivered alongside each clip`に対しては、基礎counterの共通性とper-frame timestamp納品の両方を
満たす。sampling frequency、同時trigger、sensor内latchは、異なるrateのstreamを共通timestamp軸へ
配置するこの要件とは別のacquisition特性として記録する。

## 監査対象

- Device: Mentra Live
- Android: 11 / SDK 30
- Build incremental: `mp1k61v164bspP6`
- Build fingerprint: `MentraLive`
- Hardware / board platform: `mt6761`
- Kernel: 4.19.127
- Boot A SHA-256: `21b25d040a00f41e00f6de008d66a39b817ceb97bf4a6a7c80653c7bbd0cb438`
- Kernel config SHA-256: `ae5c592149323cb5b6c0a25bbdf1a2389bf42abe50a4757869638ca01a01239f`

この判定はbuild fingerprintだけでなく、incremental build、SoC、current clocksourceが一致する場合にだけ
アプリの`clock_architecture_audit`へ適用する。firmware更新後は再監査する。

## 1. 共通system timestamp counter

実機は次を返す。

- `/sys/devices/system/clocksource/clocksource0/current_clocksource` = `arch_sys_counter`
- `available_clocksource` = `arch_sys_counter`
- device tree `/timer/compatible` = `arm,armv8-timer`
- device tree `/timer/clock-frequency` = `13,000,000 Hz`
- MediaTek timer node = `mediatek,sys_timer`, `mediatek,mt6761-timer`, `mediatek,mt6765-timer`

ARM arch timer driverは同じ`arch_timer_read_counter`を`arch_sys_counter`のclocksourceと
`sched_clock`へ登録する。MediaTek nodeはGPT sched clockを登録する`mt6577-timer` pathではなく、
system clock-event pathである。

参照:

- [AOSP common kernel: ARM architectural timer](https://android.googlesource.com/kernel/common/+/refs/tags/android14-6.1.147_r00/drivers/clocksource/arm_arch_timer.c)
- [AOSP common kernel: MediaTek timer](https://android.googlesource.com/kernel/common/+/refs/tags/android16-6.12-2025-07_r19/drivers/clocksource/timer-mediatek.c)

## 2. Camera timestamp path

実機のsensorは`imx681_mipi_raw`。`/proc/driver/camera_info`は24 MHz MCLK、MIPI 2 laneを示す。
device treeのcamera clock群にも`CLK_TOP_CAMTG_SEL`と`CLK_MCLK_24M`がある。

boot kernelを展開し、実行中`/proc/kallsyms`と対応させて確認した。

1. `ISP_Irq_CAM` (`0xffffff9c08cc96cc`) がISP interrupt entryで
   `sched_clock` (`0xffffff9c0855a7a4`) を呼ぶ。
2. SOF処理branchでも再度`sched_clock`を呼び、IRQ/SOF time infoへ格納する。
3. Camera userspaceの`IspDrvImp::queryirqtimeinfo()`はISP ioctlのtime infoを読み出す。
4. P1 nodeは`MTK_P1NODE_FRAME_START_TIMESTAMP` / `MTK_SENSOR_TIMESTAMP`を生成し、Camera2の
   `SENSOR_TIMESTAMP`へ渡す。

実測でもCamera2 timestampは`System.nanoTime()`、すなわちCLOCK_MONOTONIC側に一致した。
HAL metadataは`SENSOR_INFO_TIMESTAMP_SOURCE=UNKNOWN`なのでAndroid API契約として他subsystemとの
比較可能性は宣言していないが、このfirmwareの実装path自体は特定できた。

Camera HAL binary hashes:

- `libcamdrv.so`: `9a97aa9b4d222003aeca29570b68598c0b5ea10c5e9d03db44e8bd5f1dcd0774`
- `libmtkcam_hwnode.so`: `485c45da97178e9d8d34bc45ee7384a13ec0069371bfbd6b124c104e2ad00683`
- `libcam.halsensor.so`: `1ffed792555781ce39884193dbd0f8684029ae9e7b795e0fc08f3fb9edf9a992`

参照: [Android Camera2 `TIMESTAMP_SOURCE_UNKNOWN`](https://developer.android.com/reference/android/hardware/camera2/CameraMetadata#SENSOR_INFO_TIMESTAMP_SOURCE_UNKNOWN)

## 3. IMU timestamp path

実機はICM426XX accelerometer / gyroscopeをI2C bus 1の`0x68` / `0x69`へ接続している。

- driver: `ICM426XX_ACCEL`, `ICM426XX_GYRO`
- kernel worker: `accel_polling`, `gyro_polling`
- `CONFIG_CUSTOM_KERNEL_SENSORHUB` / `CONFIG_MTK_TINYSYS_SCP_SUPPORT`: disabled
- IMU device-tree nodeにclock、interrupt、FSYNC、cameraとのphandle linkはない

kernel instruction pathは次の通り。

1. `accel_poll`と`gyro_work_func`が`ktime_get_with_offset(1)`を呼ぶ。
2. kernel 4.19の`1`は`TK_OFFS_BOOT`であり、返り値はCLOCK_BOOTTIME。
3. `icm426xx_accel_get_data` / `icm426xx_gyro_get_data`はsensor registerからaxis値を読み、
   chip sample timestampを返さない。
4. MediaTek Sensors HALはkernel eventに入ったtimestampを通常sampleの`SensorEvent.timestamp`へコピーする。

つまりIMU timestampはICM426XXのsample瞬間に13 MHz counterをhardware latchした値ではなく、polling pathが
system BOOTTIMEを読み取って付けた値である。Android Sensors HALが要求するtimebaseには載っているが、
poll/read latency、batch interpolation、scheduler jitterを含み得る。

参照: [Android Sensors HAL timestamp requirements](https://source.android.com/docs/core/interaction/sensors/hal-interface)

## 4. MONOTONICとBOOTTIMEの関係

この端末では両方が13 MHz architectural counterを基礎にする。

```text
camera ISP SOF IRQ -> sched_clock -> CLOCK_MONOTONIC-like timestamp
                                      + accumulated suspend offset
IMU kernel poll    -> ktime_get(TK_OFFS_BOOT) -> CLOCK_BOOTTIME timestamp
```

録画中にsuspendしなければ`BOOTTIME - MONOTONIC`は固定で、二つのsystem timebase間に周波数driftはない。
suspendするとoffsetが段階的に増える。10秒の同時bridge実測でoffsetの標準偏差は約3.9 µsだった。

参照: [Linux `clock_gettime(2)`](https://man7.org/linux/man-pages/man2/clock_gettime.2.html)

## 5. Claru要件への適用範囲

主張できる:

- audited firmwareではcamera/IMU timestampの基礎hardware counterは一つ
- Camera2 MONOTONICとSensorEvent BOOTTIMEはsuspend offsetで決定論的に変換できる
- 全video frameへ変換後timestampと前後IMU sampleを納品できる

別の品質指標として測定・報告する:

- video-to-gyro offset
- 長時間・温度変化を含むoffset安定性の上限

hardware triggerの有無、sensor内latch、sampling clockはclock source要件の合否とは分離して技術記録へ残す。
controlled motion captureでsoftware timestamp位置に由来するend-to-end offsetを定量化した。
次に、5時間の温度変化でも同じoffset範囲を維持できるかを測る。

## 6. End-to-end video-to-IMU offset

60秒のcontrolled motion captureで、映像の符号付き3軸回転波形と200 Hz gyroscopeを相関した。

- offset convention: `t_IMU - t_video`
- full-sequence best fit: `+73.5 ms`
- motion-magnitude correlation: `0.9685`
- high-confidence 5秒区間: `70–78 ms`
- high-confidence区間の中央値: `74.5 ms`

このoffsetはMONOTONIC/BOOTTIMEのclock-domain差ではなく、cameraとIMUのacquisition pathを含む
end-to-endの実効offsetである。`frames.jsonl`ではcamera frameを共通time axisへ変換した後、
`+73.5 ms`のIMU timestamp位置にある前後sampleを対応付ける。raw `imu.jsonl`のtimestampは変更しない。
