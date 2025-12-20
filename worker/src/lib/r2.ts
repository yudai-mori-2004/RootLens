// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// R2 File Operations
// Cloudflare R2からファイルをダウンロードする機能
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * R2クライアントを作成
 */
function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * R2 Private Bucketから元ファイルをダウンロード
 * @param filePath - R2のパス（例: "media/abc123.../original.jpg"）
 * @returns Buffer
 */
export async function downloadFromR2(filePath: string): Promise<Buffer> {
  const client = createR2Client();
  const bucket = process.env.R2_BUCKET_NAME!;

  console.log(`📥 Downloading from R2: ${bucket}/${filePath}`);

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: filePath,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('No response body from R2');
    }

    // StreamをBufferに変換
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    console.log(`✅ Downloaded ${buffer.length} bytes from R2`);
    return buffer;

  } catch (error) {
    console.error(`❌ R2 download failed:`, error);
    throw new Error(`R2からのダウンロードに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
