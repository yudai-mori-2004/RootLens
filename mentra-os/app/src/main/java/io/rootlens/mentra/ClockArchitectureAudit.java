package io.rootlens.mentra;

import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ClockArchitectureAudit {
    private static final String AUDITED_BUILD_INCREMENTAL = "mp1k61v164bspP6";
    private static final String AUDITED_HARDWARE = "mt6761";
    private static final String AUDITED_CLOCKSOURCE = "arch_sys_counter";

    private ClockArchitectureAudit() {}

    static JSONObject inspect(String linuxClocksource) throws JSONException {
        String normalizedClocksource = linuxClocksource == null ? "" : linuxClocksource.trim();
        boolean applies = AUDITED_BUILD_INCREMENTAL.equals(Build.VERSION.INCREMENTAL)
                && AUDITED_HARDWARE.equals(Build.HARDWARE)
                && AUDITED_CLOCKSOURCE.equals(normalizedClocksource);

        JSONObject audit = new JSONObject()
                .put("schema", "rootlens.mentra.clock-audit.v1")
                .put("audit_target", new JSONObject()
                        .put("build_incremental", AUDITED_BUILD_INCREMENTAL)
                        .put("hardware", AUDITED_HARDWARE)
                        .put("linux_clocksource", AUDITED_CLOCKSOURCE))
                .put("current_build", new JSONObject()
                        .put("build_fingerprint", Build.FINGERPRINT)
                        .put("build_incremental", Build.VERSION.INCREMENTAL)
                        .put("hardware", Build.HARDWARE)
                        .put("linux_clocksource", normalizedClocksource))
                .put("audit_applies_to_current_build", applies)
                .put("evidence", new JSONArray()
                        .put("rooted live device tree and sysfs inspection")
                        .put("boot_a kernel binary symbol and instruction-path inspection")
                        .put("MediaTek Camera HAL and Sensors HAL binary inspection")
                        .put("Camera2, SensorEvent, CLOCK_MONOTONIC and CLOCK_BOOTTIME runtime measurements"));

        if (!applies) {
            return audit
                    .put("status", "not_applicable_to_current_build")
                    .put("single_hardware_timestamp_counter_confirmed", false)
                    .put("single_physical_acquisition_clock_confirmed", false)
                    .put("hardware_capture_sync_confirmed", false);
        }

        return audit
                .put("status", "current_firmware_architecture_confirmed")
                .put("system_timestamp_clock", new JSONObject()
                        .put("single_hardware_timestamp_counter_confirmed", true)
                        .put("counter", "ARM architectural system counter")
                        .put("kernel_clocksource", "arch_sys_counter")
                        .put("counter_frequency_hz", 13_000_000)
                        .put("camera_timebase", "CLOCK_MONOTONIC via ISP SOF IRQ sched_clock()")
                        .put("imu_timebase", "CLOCK_BOOTTIME via ktime_get_with_offset(TK_OFFS_BOOT)")
                        .put("relationship",
                                "BOOTTIME is the same running counter plus accumulated suspend time"))
                .put("camera_path", new JSONObject()
                        .put("sensor", "Sony IMX681 MIPI RAW")
                        .put("sensor_clock", "24 MHz camera MCLK/CAMTG")
                        .put("timestamp_point", "MediaTek ISP SOF interrupt handler")
                        .put("timestamp_function", "sched_clock()")
                        .put("sample_event_hardware_latched_to_system_counter", false))
                .put("imu_path", new JSONObject()
                        .put("sensor", "ICM426XX accelerometer/gyroscope")
                        .put("transport", "direct I2C, no sensor hub")
                        .put("sampling", "sensor ODR with kernel accel/gyro polling workers")
                        .put("timestamp_function", "ktime_get_with_offset(TK_OFFS_BOOT)")
                        .put("timestamp_point", "kernel polling path, after/beside sensor register read")
                        .put("chip_sample_timestamp_forwarded", false)
                        .put("sample_event_hardware_latched_to_system_counter", false))
                .put("hardware_sync", new JSONObject()
                        .put("single_physical_acquisition_clock_confirmed", false)
                        .put("camera_imu_fsync_or_trigger_detected", false)
                        .put("common_sample_event_latch_detected", false)
                        .put("device_tree_camera_imu_sync_link_detected", false))
                .put("single_hardware_timestamp_counter_confirmed", true)
                .put("single_physical_acquisition_clock_confirmed", false)
                .put("hardware_capture_sync_confirmed", false)
                .put("claru_interpretation", new JSONObject()
                        .put("common_hardware_timestamp_counter", "met_on_audited_firmware")
                        .put("hardware_synchronized_sensor_sampling", "not_met")
                        .put("remaining_validation", new JSONArray()
                                .put("measure video-to-gyro phase offset and jitter with motion correlation")
                                .put("verify offset stability over the full five-hour thermal run")));
    }
}
