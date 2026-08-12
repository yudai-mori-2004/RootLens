package io.rootlens.mentra;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

public final class UploadRetryJobService extends JobService {
    private static final int JOB_ID = 0x524c55;

    static void schedule(Context context) {
        JobInfo job = new JobInfo.Builder(
                JOB_ID, new ComponentName(context, UploadRetryJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
                .setMinimumLatency(30_000L)
                .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .setPersisted(true)
                .build();
        context.getSystemService(JobScheduler.class).schedule(job);
    }

    static void cancel(Context context) {
        context.getSystemService(JobScheduler.class).cancel(JOB_ID);
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Intent upload = new Intent(this, UploadService.class)
                .setAction(AppContract.ACTION_UPLOAD);
        startForegroundService(upload);
        return false;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
