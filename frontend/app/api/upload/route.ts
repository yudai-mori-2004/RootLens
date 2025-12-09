// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Upload API (Job Submission)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from 'next/server';
import { mintQueue } from '@/app/lib/queue';
import { createClient } from '@supabase/supabase-js';
import type { MintJobData } from '@shared/types';

interface UploadRequest {
  // ユーザー情報
  userWallet: string;

  // ハッシュ値（C2PA検証済み）
  originalHash: string;

  // C2PA情報（最小限）
  rootSigner: string;
  rootCertChain: string;

  // R2パス（アップロード済み）
  mediaFilePath: string;

  // RootLens独自データ
  price: number;
  title?: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadRequest = await request.json();

    console.log('📤 Upload API: Received request');
    console.log(`   User: ${body.userWallet}`);
    console.log(`   Hash: ${body.originalHash}`);

    // 1. ジョブデータを構築
    const jobData: MintJobData = {
      userWallet: body.userWallet,
      originalHash: body.originalHash,
      rootSigner: body.rootSigner,
      rootCertChain: body.rootCertChain,
      mediaFilePath: body.mediaFilePath,
      price: body.price,
      title: body.title,
      description: body.description,
    };

    // 2. ジョブをキューに追加
    const job = await mintQueue.add('mint-nft', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    console.log(`✅ Job ${job.id} added to queue`);

    // 3. レスポンス
    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: '処理を開始しました。完了までお待ちください。',
    });
  } catch (error) {
    console.error('❌ Upload API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
