import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { C2PASummaryData } from '@/app/lib/c2pa-parser';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// R2クライアント初期化
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

// Public Bucket用クライアント（同じ認証情報を使用）
const r2PublicClient = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const PUBLIC_BUCKET_NAME = process.env.R2_PUBLIC_BUCKET_NAME!;
const PUBLIC_BUCKET_URL = process.env.R2_PUBLIC_BUCKET_URL!;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Presigned URL生成（アップロード用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600 // 1時間
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn });
    return presignedUrl;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Presigned URL生成（ダウンロード用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generatePresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600 // 1時間
): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn });
    return presignedUrl;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// R2キー生成ヘルパー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function generateR2Key(contentId: string, fileType: 'original' | 'sidecar' | 'qr_watermarked', extension: string): string {
    const fileNames = {
        original: `original.${extension}`,
        sidecar: 'metadata.c2pa',
        qr_watermarked: `qr_watermarked.${extension}`,
    };

    return `media/${contentId}/${fileNames[fileType]}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ファイル拡張子を取得
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getFileExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
    };

    return mimeToExt[mimeType] || 'bin';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public Bucketへの直接アップロード（サムネイル・manifest用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function uploadThumbnailToPublicBucket(
    originalHash: string,
    thumbnailBlob: Blob
): Promise<string> {
    const key = `media/${originalHash}/thumbnail.jpg`;

    const command = new PutObjectCommand({
        Bucket: PUBLIC_BUCKET_NAME,
        Key: key,
        Body: Buffer.from(await thumbnailBlob.arrayBuffer()),
        ContentType: 'image/jpeg',
    });

    await r2PublicClient.send(command);

    // 公開URLを返す
    return `${PUBLIC_BUCKET_URL}/${key}`;
}

export async function uploadManifestToPublicBucket(
    originalHash: string,
    manifestData: C2PASummaryData
): Promise<string> {
    const key = `media/${originalHash}/manifest.json`;

    const command = new PutObjectCommand({
        Bucket: PUBLIC_BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(manifestData, null, 2),
        ContentType: 'application/json',
    });

    await r2PublicClient.send(command);

    // 公開URLを返す
    return `${PUBLIC_BUCKET_URL}/${key}`;
}

export function getPublicThumbnailUrl(originalHash: string): string {
    return `${PUBLIC_BUCKET_URL}/media/${originalHash}/thumbnail.jpg`;
}

export function getPublicManifestUrl(originalHash: string): string {
    return `${PUBLIC_BUCKET_URL}/media/${originalHash}/manifest.json`;
}
