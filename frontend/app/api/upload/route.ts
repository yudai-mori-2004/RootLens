// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver5 - Upload API (Proxy to Railway Worker)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from 'next/server';
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

  // サムネイル公開URL（Arweave用）
  thumbnailPublicUrl?: string;

  // RootLens独自データ
  price: number;
  title?: string;
  description?: string;

  // Lens Workerによって生成されたID
  mediaProofId?: string;
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
      thumbnailPublicUrl: body.thumbnailPublicUrl,
      price: body.price,
      title: body.title,
      description: body.description,
      mediaProofId: body.mediaProofId,
    };

    // 2. Railway WorkerのAPIを呼び出す
    const workerUrl = process.env.WORKER_URL || 'http://localhost:8080';
    console.log(`🔄 Forwarding to Worker: ${workerUrl}/api/upload`);

    const response = await fetch(`${workerUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobData),
    });

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }

    const result = await response.json();
    console.log(`✅ Worker response:`, result);

    // 3. レスポンス
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Upload API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
