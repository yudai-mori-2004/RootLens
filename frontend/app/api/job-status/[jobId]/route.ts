// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Job Status API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from 'next/server';
import { mintQueue } from '@/app/lib/queue';
import type { JobStatusResponse, JobStatus } from '@shared/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // ジョブを取得
    const job = await mintQueue.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // ジョブの状態を取得
    const state = await job.getState();
    const progress = job.progress as number | undefined;
    const failedReason = job.failedReason;

    // レスポンスを構築
    const response: JobStatusResponse = {
      jobId: job.id!,
      state: state as JobStatus,
      progress,
      result: job.returnvalue,
      failedReason,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      finishedAt: job.finishedOn,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Job status API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job status' },
      { status: 500 }
    );
  }
}