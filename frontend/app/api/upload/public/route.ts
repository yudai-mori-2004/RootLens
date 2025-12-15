/**
 * Public Bucket アップロードAPI
 * サムネイルとmanifestをpublicバケットにアップロード
 */

import { NextRequest, NextResponse } from 'next/server';
import { uploadThumbnailToPublicBucket, uploadManifestToPublicBucket, getPublicThumbnailUrl } from '@/app/lib/r2';
import { C2PASummaryData } from '@/app/lib/c2pa-parser';

interface PublicUploadRequest {
  original_hash: string;
  thumbnail_data_uri: string | null; // Data URI形式のサムネイル
  manifest_data: C2PASummaryData; // manifestオブジェクト
}

export async function POST(request: NextRequest) {
  try {
    const body: PublicUploadRequest = await request.json();
    const { original_hash, thumbnail_data_uri, manifest_data } = body;

    // 1. サムネイルがある場合、R2にアップロード
    let thumbnailPublicUrl: string | null = null;
    if (thumbnail_data_uri) {
      // Data URIをBlobに変換
      const thumbnailBlob = await dataUriToBlob(thumbnail_data_uri);
      thumbnailPublicUrl = await uploadThumbnailToPublicBucket(original_hash, thumbnailBlob);
      console.log('📸 サムネイルアップロード完了:', thumbnailPublicUrl);
    } else {
      // サムネイルがない場合でも、URLは生成しておく（後で404になるが、一貫性のため）
      thumbnailPublicUrl = getPublicThumbnailUrl(original_hash);
    }

    // 2. manifestをpublicバケットにアップロード（内容は変更しない）
    const manifestUrl = await uploadManifestToPublicBucket(original_hash, manifest_data);
    console.log('📄 Manifestアップロード完了:', manifestUrl);

    return NextResponse.json({
      success: true,
      thumbnail_url: thumbnailPublicUrl,
      manifest_url: manifestUrl,
    });

  } catch (error) {
    console.error('❌ Public Bucketアップロードエラー:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Data URIをBlobに変換
 */
async function dataUriToBlob(dataUri: string): Promise<Blob> {
  const response = await fetch(dataUri);
  return response.blob();
}
