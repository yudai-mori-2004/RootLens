package io.rootlens.mentra;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 100;
    private final ExecutorService accountWorker = Executors.newSingleThreadExecutor();
    private RootLensAuth auth;
    private TextView accountStatus;
    private boolean handledLaunchIntent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        auth = new RootLensAuth(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(40, 40, 40, 40);

        TextView title = new TextView(this);
        title.setText(R.string.capture_title);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        Button probe = new Button(this);
        probe.setText(R.string.probe_hardware);
        probe.setOnClickListener(v -> send(AppContract.ACTION_PROBE));
        root.addView(probe);

        Button start = new Button(this);
        start.setText(R.string.start_short_capture);
        start.setOnClickListener(v -> {
            Intent intent = new Intent(this, CaptureService.class);
            intent.setAction(AppContract.ACTION_START);
            intent.putExtra(AppContract.EXTRA_DURATION_SECONDS, 30);
            startForegroundService(intent);
        });
        root.addView(start);

        Button startFiveHours = new Button(this);
        startFiveHours.setText(R.string.start_five_hour_capture);
        startFiveHours.setOnClickListener(v -> startCapture(AppContract.MAX_SESSION_SECONDS));
        root.addView(startFiveHours);

        Button stop = new Button(this);
        stop.setText(R.string.stop_capture);
        stop.setOnClickListener(v -> send(AppContract.ACTION_STOP));
        root.addView(stop);

        accountStatus = new TextView(this);
        accountStatus.setText(auth.hasSession()
                ? R.string.upload_account_signed_in : R.string.upload_account_signed_out);
        root.addView(accountStatus);

        EditText loginId = new EditText(this);
        loginId.setHint(R.string.login_id_hint);
        loginId.setSingleLine(true);
        root.addView(loginId);

        EditText password = new EditText(this);
        password.setHint(R.string.password_hint);
        password.setSingleLine(true);
        password.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(password);

        Button login = new Button(this);
        login.setText(R.string.sign_in_for_upload);
        login.setEnabled(auth.isConfigured());
        login.setOnClickListener(v -> {
            accountStatus.setText(R.string.signing_in);
            accountWorker.execute(() -> {
                try {
                    auth.login(loginId.getText().toString(), password.getText().toString());
                    password.getText().clear();
                    runOnUiThread(() -> accountStatus.setText(R.string.upload_account_signed_in));
                } catch (Exception error) {
                    runOnUiThread(() -> accountStatus.setText(
                            getString(R.string.sign_in_failed, error.getMessage())));
                }
            });
        });
        root.addView(login);

        Button upload = new Button(this);
        upload.setText(R.string.upload_all_pending);
        upload.setOnClickListener(v -> {
            Intent intent = new Intent(this, UploadService.class);
            intent.setAction(AppContract.ACTION_UPLOAD);
            startForegroundService(intent);
            accountStatus.setText(R.string.upload_requested);
        });
        root.addView(upload);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Intent intent = getIntent();
        if (handledLaunchIntent) return;
        String action = intent.getAction();
        if (AppContract.ACTION_START.equals(action)) {
            handledLaunchIntent = true;
            int duration = intent.getIntExtra(AppContract.EXTRA_DURATION_SECONDS, 30);
            new Handler(Looper.getMainLooper()).postDelayed(() -> startCapture(duration), 500L);
        } else if (AppContract.ACTION_STOP.equals(action)
                || AppContract.ACTION_PROBE.equals(action)
                || AppContract.ACTION_STATUS.equals(action)) {
            handledLaunchIntent = true;
            send(action);
        } else if (AppContract.ACTION_UPLOAD.equals(action)) {
            handledLaunchIntent = true;
            Intent upload = new Intent(this, UploadService.class);
            upload.setAction(action);
            startForegroundService(upload);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handledLaunchIntent = false;
    }

    private void send(String action) {
        Intent intent = new Intent(this, CaptureService.class);
        intent.setAction(action);
        startForegroundService(intent);
    }

    private void startCapture(int durationSeconds) {
        Intent intent = new Intent(this, CaptureService.class);
        intent.setAction(AppContract.ACTION_START);
        intent.putExtra(AppContract.EXTRA_DURATION_SECONDS, durationSeconds);
        startForegroundService(intent);
    }

    @Override
    protected void onDestroy() {
        accountWorker.shutdown();
        super.onDestroy();
    }
}
