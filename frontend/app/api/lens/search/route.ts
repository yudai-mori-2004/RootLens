import { NextRequest, NextResponse } from 'next/server';

/**
 * Lens Search API
 * ユーザーがアップロードした画像から類似画像を検索
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image');

    if (!image || !(image instanceof File)) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Cloudflare Lens Workerに転送
    const lensWorkerUrl = process.env.LENS_WORKER_URL;

    if (!lensWorkerUrl) {
      return NextResponse.json(
        { error: 'Lens Worker not configured' },
        { status: 500 }
      );
    }

    const workerFormData = new FormData();
    workerFormData.append('image', image);

    const response = await fetch(`${lensWorkerUrl}/search`, {
      method: 'POST',
      body: workerFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lens Worker error:', errorText);
      return NextResponse.json(
        { error: 'Search failed', details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('Lens search error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
