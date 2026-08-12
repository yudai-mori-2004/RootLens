package io.rootlens.mentra;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class RawImuRecorder implements SensorEventListener {
    private static final String TAG = "RootLensImu";

    private final SensorManager sensorManager;
    private final Sensor accelerometer;
    private final Sensor gyroscope;
    private final HandlerThread sensorThread = new HandlerThread("rootlens-imu");
    private final PrimitiveLongList accelTimestamps = new PrimitiveLongList();
    private final PrimitiveLongList gyroTimestamps = new PrimitiveLongList();

    private Handler sensorHandler;
    private BufferedWriter writer;
    private volatile boolean recording;
    private volatile IOException writeFailure;
    private int linesSinceFlush;

    RawImuRecorder(Context context) {
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
    }

    void start(File output) throws IOException {
        if (accelerometer == null || gyroscope == null) {
            throw new IOException("Mentra capture requires both accelerometer and gyroscope");
        }
        if (recording) throw new IOException("IMU recorder is already active");

        sensorThread.start();
        sensorHandler = new Handler(sensorThread.getLooper());
        writer = new BufferedWriter(new FileWriter(output, false), 1024 * 1024);
        recording = true;

        boolean accelRegistered = sensorManager.registerListener(
                this, accelerometer, AppContract.IMU_PERIOD_US, 0, sensorHandler);
        boolean gyroRegistered = sensorManager.registerListener(
                this, gyroscope, AppContract.IMU_PERIOD_US, 0, sensorHandler);
        if (!accelRegistered || !gyroRegistered) {
            stop();
            throw new IOException("Failed to register raw IMU listeners");
        }
    }

    void stop() {
        recording = false;
        sensorManager.unregisterListener(this);
        if (sensorHandler == null) return;

        CountDownLatch closed = new CountDownLatch(1);
        if (!sensorHandler.post(() -> {
            try {
                if (writer != null) {
                    writer.flush();
                    writer.close();
                }
            } catch (IOException error) {
                writeFailure = error;
            } finally {
                writer = null;
                closed.countDown();
            }
        })) {
            closed.countDown();
        }
        try {
            closed.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        sensorThread.quitSafely();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!recording || writer == null) return;

        String sensorName;
        int sampleIndex;
        if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            sensorName = "accelerometer";
            sampleIndex = accelTimestamps.add(event.timestamp);
        } else if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
            sensorName = "gyroscope";
            sampleIndex = gyroTimestamps.add(event.timestamp);
        } else {
            return;
        }

        long receiptElapsedNs = SystemClock.elapsedRealtimeNanos();
        long receiptMonotonicNs = System.nanoTime();
        String row = "{\"sensor\":\"" + sensorName
                + "\",\"sample_index\":" + sampleIndex
                + ",\"timestamp_ns\":" + event.timestamp
                + ",\"receipt_elapsed_realtime_ns\":" + receiptElapsedNs
                + ",\"receipt_monotonic_ns\":" + receiptMonotonicNs
                + ",\"accuracy\":" + event.accuracy
                + ",\"x\":" + Float.toString(event.values[0])
                + ",\"y\":" + Float.toString(event.values[1])
                + ",\"z\":" + Float.toString(event.values[2]) + "}\n";
        try {
            writer.write(row);
            if (++linesSinceFlush >= 400) {
                writer.flush();
                linesSinceFlush = 0;
            }
        } catch (IOException error) {
            writeFailure = error;
            Log.e(TAG, "IMU stream write failed", error);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    PrimitiveLongList accelTimestamps() {
        return accelTimestamps;
    }

    PrimitiveLongList gyroTimestamps() {
        return gyroTimestamps;
    }

    IOException writeFailure() {
        return writeFailure;
    }

    Sensor accelerometer() {
        return accelerometer;
    }

    Sensor gyroscope() {
        return gyroscope;
    }
}
