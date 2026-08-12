package io.rootlens.mentra;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class FieldControlBootReceiver extends BroadcastReceiver {
    private static final String TAG = "RootLensFieldControl";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            context.startForegroundService(new Intent(context, FieldControlService.class));
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not start field controls after boot/update", error);
        }
    }
}
