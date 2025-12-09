import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// R2クライアント (サーバーサイド専用)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ originalHash: string }> }
) {
  try {
    const { originalHash } = await params;

    if (!originalHash) {
      return NextResponse.json({ error: 'Hash is required' }, { status: 400 });
    }

    // R2から manifest.json を取得
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: `media/${originalHash}/manifest.json`,
    });

    const response = await r2Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'Manifest not found' }, { status: 404 });
    }

    // ストリームを文字列に変換
    const manifestStr = await response.Body.transformToString();
    const manifestJson = JSON.parse(manifestStr);

    return NextResponse.json(manifestJson);
  } catch (error) {
    console.error('Manifest fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manifest' },
      { status: 500 }
    );
  }
}
