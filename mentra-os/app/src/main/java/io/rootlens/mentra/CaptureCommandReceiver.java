package io.rootlens.mentra;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class CaptureCommandReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent command) {
        String action = command.getAction();
        Class<?> serviceClass;
        if (AppContract.ACTION_UPLOAD.equals(action)) {
            serviceClass = UploadService.class;
        } else if (AppContract.ACTION_CALIBRATE.equals(action)) {
            if (!DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CALIBRATION)) {
                CaptureFeedback.failed(context);
                return;
            }
            command.putExtra(AppContract.EXTRA_OPERATION_PREACQUIRED, true);
            serviceClass = CalibrationService.class;
        } else if (AppContract.ACTION_TOGGLE.equals(action)
                && DeviceOperationGate.isOwnedBy(DeviceOperationGate.Owner.CALIBRATION)) {
            command.setAction(AppContract.ACTION_CANCEL_CALIBRATION);
            serviceClass = CalibrationService.class;
        } else {
            serviceClass = CaptureService.class;
        }
        Intent service = new Intent(context, serviceClass);
        service.setAction(command.getAction());
        service.putExtras(command);
        try {
            context.startForegroundService(service);
        } catch (RuntimeException error) {
            if (AppContract.ACTION_UPLOAD.equals(action)) {
                CaptureFeedback.uploadUnavailable(context);
            } else {
                CaptureFeedback.failed(context);
            }
        }
    }
}
