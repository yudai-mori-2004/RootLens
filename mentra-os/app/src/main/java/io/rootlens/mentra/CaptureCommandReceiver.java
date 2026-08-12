package io.rootlens.mentra;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class CaptureCommandReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent command) {
        Class<?> serviceClass = AppContract.ACTION_UPLOAD.equals(command.getAction())
                ? UploadService.class : CaptureService.class;
        Intent service = new Intent(context, serviceClass);
        service.setAction(command.getAction());
        service.putExtras(command);
        context.startForegroundService(service);
    }
}
