package io.rootlens.mentra;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.util.Log;

/** Sends semantic feedback events to the active ASG hardware owner. */
final class CaptureFeedback {
    private static final String TAG = "RootLensFeedback";
    private static final String STOCK_ASG_PACKAGE = "com.mentra.asg_client";
    private static final String FORK_ASG_PACKAGE = "com.mentra.asg_client.thirdparty";
    private static final String ASG_SERVICE =
            "com.mentra.asg_client.service.core.AsgClientService";
    private static final String ACTION_PLAY = "io.rootlens.mentra.PLAY_ASG_FEEDBACK";
    private static final String EXTRA_EVENT = "feedback_event";

    static void startReceived(Context context) {
        send(context, "capture_start_received");
    }

    static void stopReceived(Context context) {
        send(context, "capture_stop_received");
    }

    static void failed(Context context) {
        send(context, "capture_failed");
    }

    static void calibrationInstructions(Context context) {
        send(context, "calibration_instructions");
    }

    static void calibrationCancelled(Context context) {
        send(context, "capture_stop_received");
    }

    static void uploadStarted(Context context) {
        send(context, "upload_started");
    }

    static void uploadComplete(Context context) {
        send(context, "upload_complete");
    }

    static void uploadUnavailable(Context context) {
        send(context, "upload_unavailable");
    }

    static void errorTone(Context context) {
        record("error");
    }

    private static void send(Context context, String event) {
        Context appContext = context.getApplicationContext();
        String asgPackage = activeAsgPackage(appContext.getPackageManager());
        if (asgPackage == null) {
            Log.e(TAG, "No active Mentra ASG hardware owner for feedback: " + event);
            return;
        }

        Intent feedback = new Intent()
                .setComponent(new ComponentName(asgPackage, ASG_SERVICE))
                .setAction(ACTION_PLAY)
                .putExtra(EXTRA_EVENT, event);
        try {
            appContext.startForegroundService(feedback);
            Log.i(TAG, "Feedback delivered to " + asgPackage + ": " + event);
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not deliver feedback without affecting capture: " + event, error);
        }
    }

    private static String activeAsgPackage(PackageManager packageManager) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo resolved = packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolved != null && resolved.activityInfo != null) {
            String packageName = resolved.activityInfo.packageName;
            if (STOCK_ASG_PACKAGE.equals(packageName) || FORK_ASG_PACKAGE.equals(packageName)) {
                return packageName;
            }
        }

        if (isEnabled(packageManager, STOCK_ASG_PACKAGE)) return STOCK_ASG_PACKAGE;
        if (isEnabled(packageManager, FORK_ASG_PACKAGE)) return FORK_ASG_PACKAGE;
        return null;
    }

    private static boolean isEnabled(PackageManager packageManager, String packageName) {
        try {
            ApplicationInfo info = packageManager.getApplicationInfo(
                    packageName, PackageManager.MATCH_DISABLED_COMPONENTS);
            int state = packageManager.getApplicationEnabledSetting(packageName);
            return info.enabled
                    && state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                    && state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    private static void record(String event) {
        Log.i(TAG, "Feedback event kept silent: " + event);
    }

    private CaptureFeedback() {}
}
