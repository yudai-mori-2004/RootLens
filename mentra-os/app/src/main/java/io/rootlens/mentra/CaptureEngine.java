package io.rootlens.mentra;

import android.annotation.SuppressLint;
import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureFailure;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.TotalCaptureResult;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;
import android.util.Range;
import android.view.Surface;

import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

final class CaptureEngine {
    interface Listener {
        void onStarted(File directory, DeviceProbe.Snapshot probe);
        void onCompleted(File directory);
        void onFailed(File directory, Throwable error);
    }

    private static final String TAG = "RootLensCapture";

    private final Context context;
    private final long requestedDurationSeconds;
    private final int bitrateBps;
    private final boolean calibrationCapture;
    private final Listener listener;
    private final HandlerThread cameraThread = new HandlerThread("rootlens-camera");
    private final AtomicBoolean terminal = new AtomicBoolean();
    private final Map<Long, StartedFrame> startedFrames = new HashMap<>();

    private Handler cameraHandler;
    private DeviceProbe.Snapshot probe;
    private VideoImuCalibration calibration;
    private SessionArtifacts artifacts;
    private RawImuRecorder rawImu;
    private MediaRecorder recorder;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private boolean recorderStarted;
    private volatile boolean acceptFrames;
    private long recorderStartWallMs;
    private long recorderStartElapsedNs;
    private long recorderStartMonotonicNs;
    private int captureFailureCount;

    CaptureEngine(Context context, long requestedDurationSeconds, int bitrateBps, Listener listener) {
        this(context, requestedDurationSeconds, bitrateBps, false, listener);
    }

    CaptureEngine(
            Context context,
            long requestedDurationSeconds,
            int bitrateBps,
            boolean calibrationCapture,
            Listener listener) {
        this.context = context.getApplicationContext();
        this.requestedDurationSeconds = requestedDurationSeconds;
        this.bitrateBps = bitrateBps;
        this.calibrationCapture = calibrationCapture;
        this.listener = listener;
    }

    @SuppressLint("MissingPermission")
    void start() throws IOException, CameraAccessException {
        if (cameraHandler != null) throw new IOException("Capture engine cannot be reused");
        try {
            probe = DeviceProbe.inspect(context);
            calibration = CalibrationStore.resolve(context, probe.cameraId);
            File root = new File(context.getExternalFilesDir(null), "recordings");
            artifacts = calibrationCapture
                    ? SessionArtifacts.createCalibration(root)
                    : SessionArtifacts.create(root);
            rawImu = new RawImuRecorder(context);
            rawImu.start(artifacts.partialImu);
            prepareRecorder();

            cameraThread.start();
            cameraHandler = new Handler(cameraThread.getLooper());
            CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            manager.openCamera(probe.cameraId, cameraStateCallback, cameraHandler);
        } catch (IOException | CameraAccessException | RuntimeException error) {
            fail(error);
            throw error;
        }
    }

    void stop() {
        Handler handler = cameraHandler;
        if (handler == null) {
            fail(new IOException("Capture was stopped before camera initialization"));
            return;
        }
        handler.post(this::stopInternal);
    }

    File directory() {
        return artifacts == null ? null : artifacts.directory;
    }

    private void prepareRecorder() throws IOException {
        recorder = new MediaRecorder();
        boolean recordAudio = !calibrationCapture;
        if (recordAudio) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        if (recordAudio) {
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(AppContract.AUDIO_SAMPLE_RATE_HZ);
            recorder.setAudioChannels(AppContract.AUDIO_CHANNELS);
            recorder.setAudioEncodingBitRate(AppContract.AUDIO_BITRATE_BPS);
        }
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        recorder.setVideoEncodingBitRate(bitrateBps);
        recorder.setVideoFrameRate(AppContract.FPS);
        recorder.setVideoSize(AppContract.WIDTH, AppContract.HEIGHT);
        recorder.setOrientationHint(0);
        recorder.setOutputFile(artifacts.partialVideo.getAbsolutePath());
        recorder.prepare();
    }

    private final CameraDevice.StateCallback cameraStateCallback = new CameraDevice.StateCallback() {
        @Override
        public void onOpened(CameraDevice camera) {
            if (terminal.get()) {
                camera.close();
                return;
            }
            cameraDevice = camera;
            Surface recorderSurface = recorder.getSurface();
            try {
                camera.createCaptureSession(
                        Collections.singletonList(recorderSurface), sessionStateCallback, cameraHandler);
            } catch (CameraAccessException error) {
                fail(error);
            }
        }

        @Override
        public void onDisconnected(CameraDevice camera) {
            camera.close();
            fail(new IOException("Camera disconnected"));
        }

        @Override
        public void onError(CameraDevice camera, int error) {
            camera.close();
            fail(new IOException("CameraDevice error " + error));
        }
    };

    private final CameraCaptureSession.StateCallback sessionStateCallback =
            new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession session) {
                    if (terminal.get() || cameraDevice == null) {
                        session.close();
                        return;
                    }
                    captureSession = session;
                    try {
                        CaptureRequest.Builder builder = cameraDevice.createCaptureRequest(
                                CameraDevice.TEMPLATE_RECORD);
                        builder.addTarget(recorder.getSurface());
                        builder.set(CaptureRequest.CONTROL_CAPTURE_INTENT,
                                CaptureRequest.CONTROL_CAPTURE_INTENT_VIDEO_RECORD);
                        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
                        builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                                new Range<>(AppContract.FPS, AppContract.FPS));
                        Range<Float> zoomRange = probe.characteristics.get(
                                CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                        if (zoomRange != null && zoomRange.contains(1.0f)) {
                            builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, 1.0f);
                        }
                        builder.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                                CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF);
                        setOpticalStabilizationOff(builder);
                        builder.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF);
                        session.setRepeatingRequest(builder.build(), captureCallback, cameraHandler);

                        recorder.start();
                        recorderStarted = true;
                        recorderStartWallMs = System.currentTimeMillis();
                        recorderStartElapsedNs = SystemClock.elapsedRealtimeNanos();
                        recorderStartMonotonicNs = System.nanoTime();
                        acceptFrames = true;
                        listener.onStarted(artifacts.directory, probe);
                    } catch (CameraAccessException | RuntimeException error) {
                        fail(error);
                    }
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession session) {
                    session.close();
                    fail(new IOException("Camera capture session configuration failed"));
                }
            };

    private final CameraCaptureSession.CaptureCallback captureCallback =
            new CameraCaptureSession.CaptureCallback() {
                @Override
                public void onCaptureStarted(
                        CameraCaptureSession session, CaptureRequest request, long timestamp, long frameNumber) {
                    if (!acceptFrames) return;
                    startedFrames.put(frameNumber, new StartedFrame(timestamp,
                            SystemClock.elapsedRealtimeNanos(), System.nanoTime()));
                }

                @Override
                public void onCaptureCompleted(
                        CameraCaptureSession session, CaptureRequest request, TotalCaptureResult result) {
                    if (!acceptFrames) return;
                    Long sensorTimestamp = result.get(TotalCaptureResult.SENSOR_TIMESTAMP);
                    if (sensorTimestamp == null) {
                        fail(new IOException("CaptureResult is missing SENSOR_TIMESTAMP"));
                        return;
                    }
                    long frameNumber = result.getFrameNumber();
                    StartedFrame started = startedFrames.remove(frameNumber);
                    SessionArtifacts.FrameRecord frame = new SessionArtifacts.FrameRecord();
                    frame.frameNumber = frameNumber;
                    frame.sensorTimestampNs = sensorTimestamp;
                    frame.captureStartedTimestampNs = started == null ? sensorTimestamp : started.timestampNs;
                    frame.callbackElapsedRealtimeNs = SystemClock.elapsedRealtimeNanos();
                    frame.callbackMonotonicNs = System.nanoTime();
                    Long exposure = result.get(TotalCaptureResult.SENSOR_EXPOSURE_TIME);
                    Long duration = result.get(TotalCaptureResult.SENSOR_FRAME_DURATION);
                    Long skew = result.get(TotalCaptureResult.SENSOR_ROLLING_SHUTTER_SKEW);
                    Integer sensitivity = result.get(TotalCaptureResult.SENSOR_SENSITIVITY);
                    if (exposure != null) frame.exposureTimeNs = exposure;
                    if (duration != null) frame.frameDurationNs = duration;
                    if (skew != null) frame.rollingShutterSkewNs = skew;
                    if (sensitivity != null) frame.sensitivityIso = sensitivity;
                    artifacts.addCameraFrame(frame);
                }

                @Override
                public void onCaptureFailed(
                        CameraCaptureSession session, CaptureRequest request, CaptureFailure failure) {
                    captureFailureCount++;
                    Log.e(TAG, "Camera frame failed: reason=" + failure.getReason()
                            + " frame=" + failure.getFrameNumber());
                }
            };

    private void setOpticalStabilizationOff(CaptureRequest.Builder builder) {
        int[] modes = probe.characteristics.get(
                CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION);
        if (modes == null) return;
        for (int mode : modes) {
            if (mode == CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_OFF) {
                builder.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
                        CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_OFF);
                return;
            }
        }
    }

    private void stopInternal() {
        if (!terminal.compareAndSet(false, true)) return;
        acceptFrames = false;
        long stopWallMs = System.currentTimeMillis();
        boolean recorderStopSucceeded = false;
        try {
            if (captureSession != null) {
                try {
                    captureSession.stopRepeating();
                    captureSession.abortCaptures();
                } catch (CameraAccessException | IllegalStateException error) {
                    Log.w(TAG, "Could not drain camera session", error);
                }
                captureSession.close();
                captureSession = null;
            }
            if (cameraDevice != null) {
                cameraDevice.close();
                cameraDevice = null;
            }
            if (recorderStarted) {
                recorder.stop();
                recorderStopSucceeded = true;
            }
            releaseRecorder();
            rawImu.stop();
            File directory = artifacts.finalizeClip(
                    probe,
                    rawImu,
                    requestedDurationSeconds,
                    bitrateBps,
                    recorderStartWallMs,
                    recorderStartElapsedNs,
                    recorderStartMonotonicNs,
                    stopWallMs,
                    recorderStopSucceeded,
                    calibration,
                    !calibrationCapture);
            if (captureFailureCount > 0) {
                SessionArtifacts.writeText(new File(directory, "camera_capture_failures.txt"),
                        Integer.toString(captureFailureCount) + "\n");
            }
            listener.onCompleted(directory);
        } catch (Throwable error) {
            artifacts.failClip(error);
            listener.onFailed(artifacts.directory, error);
        } finally {
            cameraThread.quitSafely();
        }
    }

    private void fail(Throwable error) {
        Handler handler = cameraHandler;
        if (handler != null && Thread.currentThread() != cameraThread) {
            handler.post(() -> fail(error));
            return;
        }
        if (!terminal.compareAndSet(false, true)) return;
        acceptFrames = false;
        try {
            if (captureSession != null) captureSession.close();
        } catch (RuntimeException ignored) {
        }
        try {
            if (cameraDevice != null) cameraDevice.close();
        } catch (RuntimeException ignored) {
        }
        if (recorderStarted) {
            try {
                recorder.stop();
            } catch (RuntimeException ignored) {
            }
        }
        releaseRecorder();
        if (rawImu != null) rawImu.stop();
        if (artifacts != null) artifacts.failClip(error);
        listener.onFailed(directory(), error);
        if (cameraHandler != null) cameraThread.quitSafely();
    }

    private void releaseRecorder() {
        if (recorder == null) return;
        try {
            recorder.reset();
        } catch (RuntimeException ignored) {
        }
        recorder.release();
        recorder = null;
    }

    private static final class StartedFrame {
        final long timestampNs;
        final long callbackElapsedNs;
        final long callbackMonotonicNs;

        StartedFrame(long timestampNs, long callbackElapsedNs, long callbackMonotonicNs) {
            this.timestampNs = timestampNs;
            this.callbackElapsedNs = callbackElapsedNs;
            this.callbackMonotonicNs = callbackMonotonicNs;
        }
    }
}
