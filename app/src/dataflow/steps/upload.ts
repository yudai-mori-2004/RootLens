// Pipeline 1 step: R2 アップロード (DATA_SPECS §2.4)。
//
// signature_hash + 撮影構成を /api/v1/raw-uploads に投げて presigned PUT URL を取得し、
// 撮影構成が出力したファイル群を raw/<signature_hash>/ に並列 PUT する。
// アップロード先バケットは構成でサーバが決める (= ultra_wide → raw、 arkit → raw-arkit)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import { SERVER_URL } from '../../env';
import type { EventSink } from '../events';
import type { UploadInput, UploadResult } from '../types';

interface PresignedFile {
  url: string;
  key: string;
  contentType: string;
}
interface PresignResponse {
  files: Record<string, PresignedFile>;
  bucket?: string;
}

async function requestPresignedUrls(
  signatureHash: string,
  recordingConfig: string,
): Promise<PresignResponse> {
  const res = await fetch(`${SERVER_URL}/api/v1/raw-uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureHash, recordingConfig }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/raw-uploads ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as PresignResponse;
}

/**
 * signature_hash の presigned URL を取得し、 files マップ (= 名前 → ローカル URI) を R2 に並列 PUT。
 * presigned に存在しない名前のファイルが渡された場合は fail-loud (= 構成と server contract のズレ検出)。
 */
export async function uploadToR2(input: UploadInput, sink: EventSink): Promise<UploadResult> {
  sink({ step: 'r2-upload', level: 'info', message: `presigned URL を取得 (構成 ${input.recordingConfig})` });
  const presigned = await requestPresignedUrls(input.signatureHash, input.recordingConfig);

  const names = Object.keys(input.files);
  sink({
    step: 'r2-upload',
    level: 'info',
    message: `${names.length} ファイルを並列 PUT${presigned.bucket ? ` → ${presigned.bucket}` : ''}: ${names.join(', ')}`,
  });

  const uploadedKeys = await Promise.all(
    names.map(async (name) => {
      const local = input.files[name];
      const target = presigned.files[name];
      if (!target) throw new Error(`presigned URL missing for ${name} (server contract mismatch?)`);
      const info = await FileSystem.getInfoAsync(local);
      if (!info.exists) throw new Error(`${name} not found: ${local}`);
      const res = await FileSystem.uploadAsync(target.url, local, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': target.contentType },
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`R2 PUT ${name} ${res.status}: ${res.body?.slice(0, 200) ?? ''}`);
      }
      return target.key;
    }),
  );

  sink({
    step: 'r2-upload',
    level: 'success',
    message: `アップロード完了 (${uploadedKeys.length} ファイル)`,
    detail: { uploadedKeys },
  });
  return { uploadedKeys };
}
