/**
 * R2 Presigned URL発行API
 * アップロード用のPresigned URLを発行
 */

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface PresignedUrlRequest {
  original_hash: string;
  file_type: string; // 'original' | 'manifest'
  content_type: string; // 'image/jpeg' | 'application/json' 等
}

export async function POST(request: NextRequest) {
  try {
    const body: PresignedUrlRequest = await request.json();
    const { original_hash, file_type, content_type } = body;

    // 1. R2クライアント作成
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    // 2. R2パス決定
    let key: string;
    if (file_type === 'manifest') {
      key = `media/${original_hash}/manifest.json`;
    } else {
      const extension = getExtensionFromContentType(content_type);
      key = `media/${original_hash}/original.${extension}`;
    }

    console.log('📝 Presigned URL発行:', key);

    // 3. Presigned URL生成（アップロード用）
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      ContentType: content_type,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1時間有効
    });

    console.log('✅ Presigned URL発行完了');

    return NextResponse.json({
      presigned_url: presignedUrl,
      key,
      expires_in: 3600,
    });

  } catch (error) {
    console.error('❌ Presigned URL発行エラー:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Content-Typeから拡張子を推測
 */
function getExtensionFromContentType(contentType: string): string {
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'application/json': 'json',
    'application/octet-stream': 'bin',
  };

  return mapping[contentType] || 'bin';
}
