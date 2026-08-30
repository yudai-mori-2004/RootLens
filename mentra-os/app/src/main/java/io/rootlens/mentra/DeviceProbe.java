package io.rootlens.mentra;

import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.util.Range;
import android.util.Size;
import android.util.SizeF;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

final class DeviceProbe {
    static final class Snapshot {
        final String cameraId;
        final CameraCharacteristics characteristics;
        final int timestampSource;
        final JSONObject json;

        Snapshot(String cameraId, CameraCharacteristics characteristics, int timestampSource, JSONObject json) {
            this.cameraId = cameraId;
            this.characteristics = characteristics;
            this.timestampSource = timestampSource;
            this.json = json;
        }

        String timestampSourceName() {
            return timestampSource == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME
                    ? "REALTIME" : "UNKNOWN";
        }

        boolean androidElapsedRealtimeComparable() {
            return timestampSource == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
        }
    }

    private DeviceProbe() {}

    static Snapshot inspect(Context context) throws IOException {
        try {
            CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            String selectedId = null;
            CameraCharacteristics selected = null;
            for (String cameraId : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (selected == null || (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK)) {
                    selectedId = cameraId;
                    selected = characteristics;
                }
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) break;
            }
            if (selected == null || selectedId == null) throw new IOException("No camera found");

            Integer sourceValue = selected.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
            int timestampSource = sourceValue == null
                    ? CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_UNKNOWN : sourceValue;

            JSONObject root = new JSONObject();
            root.put("device_manufacturer", Build.MANUFACTURER);
            root.put("device_model", Build.MODEL);
            root.put("android_release", Build.VERSION.RELEASE);
            root.put("android_sdk", Build.VERSION.SDK_INT);
            Object linuxClocksourceValue = readOptionalText(
                    "/sys/devices/system/clocksource/clocksource0/current_clocksource");
            String linuxClocksource = linuxClocksourceValue instanceof String
                    ? (String) linuxClocksourceValue : "";
            root.put("linux_clocksource", linuxClocksourceValue);
            root.put("camera_id", selectedId);
            root.put("camera_timestamp_source", timestampSource == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME
                    ? "REALTIME" : "UNKNOWN");
            root.put("camera_timestamp_comparable_to_elapsed_realtime_by_hal",
                    timestampSource == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME);
            JSONObject clockAudit = ClockArchitectureAudit.inspect(linuxClocksource);
            root.put("clock_architecture_audit", clockAudit);
            root.put("single_hardware_timestamp_counter_confirmed",
                    clockAudit.optBoolean("single_hardware_timestamp_counter_confirmed", false));
            root.put("single_physical_clock_source_guaranteed", false);
            root.put("single_physical_clock_source_evidence",
                    clockAudit.optBoolean("audit_applies_to_current_build", false)
                            ? "distinct camera and IMU sampling clocks; no shared trigger or sample-event latch"
                            : "clock audit does not apply to this firmware build");

            Integer facing = selected.get(CameraCharacteristics.LENS_FACING);
            Integer orientation = selected.get(CameraCharacteristics.SENSOR_ORIENTATION);
            Integer level = selected.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
            root.put("lens_facing", facing == null ? JSONObject.NULL : facing);
            root.put("sensor_orientation_degrees", orientation == null ? JSONObject.NULL : orientation);
            root.put("hardware_level", level == null ? JSONObject.NULL : level);
            root.put("active_array", rectJson(selected.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)));
            root.put("pixel_array", sizeJson(selected.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)));
            SizeF physicalSize = selected.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
            float[] focalLengths = selected.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
            float[] intrinsicCalibration = selected.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION);
            float[] lensDistortion = selected.get(CameraCharacteristics.LENS_DISTORTION);
            root.put("physical_size_mm", sizeFJson(physicalSize));
            root.put("focal_lengths_mm", floatArray(focalLengths));
            root.put("intrinsic_calibration", floatArray(intrinsicCalibration));
            root.put("lens_distortion", floatArray(lensDistortion));
            Float maxDigitalZoom = selected.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
            Range<Float> zoomRatioRange = selected.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
            root.put("maximum_digital_zoom", maxDigitalZoom == null ? JSONObject.NULL : maxDigitalZoom);
            root.put("zoom_ratio_range", zoomRatioRange == null ? JSONObject.NULL
                    : new JSONArray().put(zoomRatioRange.getLower()).put(zoomRatioRange.getUpper()));
            root.put("fov_assessment", fovAssessment(
                    physicalSize, focalLengths, intrinsicCalibration, lensDistortion));

            StreamConfigurationMap map = selected.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (map == null) throw new IOException("Camera has no stream configuration map");
            JSONArray recorderSizes = new JSONArray();
            boolean supportsTarget = false;
            Size[] sizes = map.getOutputSizes(MediaRecorder.class);
            if (sizes != null) {
                for (Size size : sizes) {
                    recorderSizes.put(sizeJson(size));
                    if (size.getWidth() == AppContract.WIDTH && size.getHeight() == AppContract.HEIGHT) {
                        supportsTarget = true;
                    }
                }
            }
            root.put("media_recorder_sizes", recorderSizes);
            root.put("supports_1920x1080", supportsTarget);

            JSONArray yuvSizes = new JSONArray();
            Size[] yuv = map.getOutputSizes(ImageFormat.YUV_420_888);
            if (yuv != null) for (Size size : yuv) yuvSizes.put(sizeJson(size));
            root.put("yuv_sizes", yuvSizes);

            JSONArray fpsRanges = new JSONArray();
            boolean supports30 = false;
            Range<Integer>[] ranges = selected.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
            if (ranges != null) {
                for (Range<Integer> range : ranges) {
                    JSONArray pair = new JSONArray().put(range.getLower()).put(range.getUpper());
                    fpsRanges.put(pair);
                    if (range.getLower() == 30 && range.getUpper() == 30) supports30 = true;
                }
            }
            root.put("ae_fps_ranges", fpsRanges);
            root.put("supports_fixed_30fps", supports30);

            SensorManager sensors = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
            root.put("accelerometer", sensorJson(sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)));
            root.put("gyroscope", sensorJson(sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)));
            root.put("avc_encoder", avcEncoderJson());

            boolean hasMicrophone = context.getPackageManager()
                    .hasSystemFeature(PackageManager.FEATURE_MICROPHONE);
            JSONArray audioInputs = audioInputDevices(context);
            root.put("has_microphone_feature", hasMicrophone);
            root.put("audio_input_devices", audioInputs);

            StatFs storage = new StatFs(Environment.getExternalStorageDirectory().getAbsolutePath());
            root.put("storage_total_bytes", storage.getTotalBytes());
            root.put("storage_available_bytes", storage.getAvailableBytes());
            root.put("capture_contract", new JSONObject()
                    .put("width", AppContract.WIDTH)
                    .put("height", AppContract.HEIGHT)
                    .put("fps", AppContract.FPS)
                    .put("codec", "video/avc")
                    .put("bit_depth", 8)
                    .put("hdr", false)
                    .put("audio", true)
                    .put("audio_source", "mic")
                    .put("audio_codec", "audio/mp4a-latm")
                    .put("audio_sample_rate_hz", AppContract.AUDIO_SAMPLE_RATE_HZ)
                    .put("audio_channels", AppContract.AUDIO_CHANNELS)
                    .put("audio_bitrate_bps", AppContract.AUDIO_BITRATE_BPS)
                    .put("imu_period_us", AppContract.IMU_PERIOD_US));

            if (!supportsTarget) throw new IOException("Camera does not expose 1920x1080 recording");
            if (!supports30) throw new IOException("Camera does not expose a fixed 30fps AE range");
            if (!hasMicrophone || audioInputs.length() == 0) {
                throw new IOException("Device does not expose a microphone input");
            }
            return new Snapshot(selectedId, selected, timestampSource, root);
        } catch (JSONException | android.hardware.camera2.CameraAccessException error) {
            throw new IOException("Hardware probe failed", error);
        }
    }

    private static JSONObject sensorJson(Sensor sensor) throws JSONException {
        if (sensor == null) return null;
        return new JSONObject()
                .put("name", sensor.getName())
                .put("vendor", sensor.getVendor())
                .put("type", sensor.getStringType())
                .put("min_delay_us", sensor.getMinDelay())
                .put("max_delay_us", sensor.getMaxDelay())
                .put("fifo_max_events", sensor.getFifoMaxEventCount())
                .put("resolution", sensor.getResolution());
    }

    private static JSONArray audioInputDevices(Context context) throws JSONException {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONArray devices = new JSONArray();
        for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            JSONObject value = new JSONObject()
                    .put("id", device.getId())
                    .put("type", device.getType())
                    .put("product_name", device.getProductName().toString())
                    .put("sample_rates_hz", intArray(device.getSampleRates()))
                    .put("channel_counts", intArray(device.getChannelCounts()));
            devices.put(value);
        }
        return devices;
    }

    private static JSONArray intArray(int[] values) {
        JSONArray result = new JSONArray();
        if (values != null) for (int value : values) result.put(value);
        return result;
    }

    private static JSONObject avcEncoderJson() throws JSONException, IOException {
        MediaCodecInfo selected = null;
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (!info.isEncoder()) continue;
            for (String type : info.getSupportedTypes()) {
                if (MediaFormat.MIMETYPE_VIDEO_AVC.equalsIgnoreCase(type)) {
                    selected = info;
                    break;
                }
            }
            if (selected != null) break;
        }
        if (selected == null) throw new IOException("No H.264 encoder found");
        MediaCodecInfo.CodecCapabilities caps = selected.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC);
        JSONArray colorFormats = new JSONArray();
        for (int value : caps.colorFormats) colorFormats.put(value);
        JSONArray profiles = new JSONArray();
        for (MediaCodecInfo.CodecProfileLevel value : caps.profileLevels) {
            profiles.put(new JSONObject().put("profile", value.profile).put("level", value.level));
        }
        return new JSONObject()
                .put("name", selected.getName())
                .put("hardware_accelerated", selected.isHardwareAccelerated())
                .put("color_formats", colorFormats)
                .put("profiles", profiles);
    }

    private static Object rectJson(Rect value) throws JSONException {
        if (value == null) return JSONObject.NULL;
        return new JSONObject().put("left", value.left).put("top", value.top)
                .put("right", value.right).put("bottom", value.bottom);
    }

    private static Object sizeJson(Size value) throws JSONException {
        if (value == null) return JSONObject.NULL;
        return new JSONObject().put("width", value.getWidth()).put("height", value.getHeight());
    }

    private static Object sizeFJson(SizeF value) throws JSONException {
        if (value == null) return JSONObject.NULL;
        return new JSONObject().put("width", value.getWidth()).put("height", value.getHeight());
    }

    private static JSONArray floatArray(float[] values) throws JSONException {
        JSONArray result = new JSONArray();
        if (values != null) for (float value : values) result.put(value);
        return result;
    }

    private static JSONObject fovAssessment(
            SizeF physicalSize,
            float[] focalLengths,
            float[] intrinsicCalibration,
            float[] lensDistortion) throws JSONException {
        JSONObject result = new JSONObject()
                .put("manufacturer_claimed_degrees", 119)
                .put("manufacturer_claimed_axis", "not_specified")
                .put("manufacturer_spec_url", "https://mentraglass.com/live")
                .put("effective_1080p_fov_status", "requires_empirical_calibration")
                .put("iphone_zoom_equivalence", "not_established");
        boolean hasCalibration = intrinsicCalibration != null && intrinsicCalibration.length >= 5;
        boolean hasDistortion = lensDistortion != null && lensDistortion.length > 0;
        result.put("camera2_intrinsic_calibration_available", hasCalibration);
        result.put("camera2_lens_distortion_available", hasDistortion);
        if (physicalSize == null || focalLengths == null || focalLengths.length == 0
                || focalLengths[0] <= 0) {
            return result.put("camera2_rectilinear_estimate", JSONObject.NULL);
        }
        double focal = focalLengths[0];
        double horizontal = Math.toDegrees(2.0 * Math.atan(physicalSize.getWidth() / (2.0 * focal)));
        double croppedHeight = physicalSize.getWidth() * AppContract.HEIGHT / AppContract.WIDTH;
        croppedHeight = Math.min(croppedHeight, physicalSize.getHeight());
        double vertical = Math.toDegrees(2.0 * Math.atan(croppedHeight / (2.0 * focal)));
        double diagonalSize = Math.hypot(physicalSize.getWidth(), croppedHeight);
        double diagonal = Math.toDegrees(2.0 * Math.atan(diagonalSize / (2.0 * focal)));
        return result.put("camera2_rectilinear_estimate", new JSONObject()
                .put("basis", "pinhole formula from Camera2 sensor size and focal length; 16:9 center crop assumed")
                .put("horizontal_degrees", horizontal)
                .put("vertical_degrees", vertical)
                .put("diagonal_degrees", diagonal)
                .put("valid_for_delivery_claim", false)
                .put("reason", "conflicts with the 119-degree manufacturer specification and lacks "
                        + "intrinsic/distortion data for the ultra-wide lens and ISP pipeline"));
    }

    private static Object readOptionalText(String path) {
        try {
            String value = new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8).trim();
            return value.isEmpty() ? JSONObject.NULL : value;
        } catch (IOException | SecurityException error) {
            return JSONObject.NULL;
        }
    }
}
