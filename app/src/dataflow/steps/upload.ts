// Pipeline 1 step: R2 アップロード (DATA_SPECS §2.4)。
//
// content_hash + 撮影構成を /api/v1/raw-uploads に投げて presigned PUT URL を取得し、
// 撮影構成が出力したファイル群を raw/<content_hash>/ に並列 PUT する。
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
  contentHash: string,
  recordingConfig: string,
): Promise<PresignResponse> {
  const res = await fetch(`${SERVER_URL}/api/v1/raw-uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentHash, recordingConfig }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/raw-uploads ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as PresignResponse;
}

/**
 * content_hash の presigned URL を取得し、 files マップ (= 名前 → ローカル URI) を R2 に並列 PUT。
 * presigned に存在しない名前のファイルが渡された場合は fail-loud (= 構成と server contract のズレ検出)。
 */
export async function uploadToR2(
  input: UploadInput,
  sink: EventSink,
  /** 実バイト進捗 (0..1、 全ファイル合計)。 UI のプログレスバーを滑らかにするため。 */
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  sink({ step: 'r2-upload', level: 'info', message: `presigned URL を取得 (構成 ${input.recordingConfig})` });
  const presigned = await requestPresignedUrls(input.contentHash, input.recordingConfig);

  const names = Object.keys(input.files);

  // 進捗を実バイトで出すため、 先に全ファイルの合計サイズを測る。
  const sizes: Record<string, number> = {};
  let totalBytes = 0;
  for (const name of names) {
    const info = await FileSystem.getInfoAsync(input.files[name], { size: true });
    if (!info.exists) throw new Error(`${name} not found: ${input.files[name]}`);
    const size = (info as { size?: number }).size ?? 0;
    sizes[name] = size;
    totalBytes += size;
  }

  sink({
    step: 'r2-upload',
    level: 'info',
    message: `${names.length} ファイルを順次 PUT${presigned.bucket ? ` → ${presigned.bucket}` : ''} (${(totalBytes / 1e9).toFixed(1)} GB)`,
  });

  // ⚠ 逐次 + foreground セッションで送る (2026-07-07 実測で確定した OOM 対策)。
  //   既定の background セッションは、 タスク起動時に iOS がファイルを nsurlsessiond の
  //   コンテナへコピーする。 大容量 (rgb 4GB + depth 数 GB …) を並列 (Promise.all) で 7 本
  //   同時起動すると、 このコピーが一斉に走ってメモリが数百 MB → 3.7GB に瞬時に跳ね jetsam kill。
  //   foreground はファイルから直接ストリーム (コピーなし) なので、 1 本ずつ順に送ればメモリは平坦。
  //   代償: 送信中はアプリを foreground に保つ必要がある (background に落ちると reject)。
  //   createUploadTask は uploadAsync と違い送信バイトの進捗コールバックを持つので、 これでバー
  //   を滑らかにする (= 一番長いアップロード区間が飛び飛びにならない)。
  const uploadedKeys: string[] = [];
  let sentBytes = 0;
  for (const name of names) {
    const local = input.files[name];
    const target = presigned.files[name];
    if (!target) throw new Error(`presigned URL missing for ${name} (server contract mismatch?)`);
    const base = sentBytes;
    const task = FileSystem.createUploadTask(
      target.url,
      local,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: { 'Content-Type': target.contentType },
      },
      (data) => {
        if (totalBytes > 0) onProgress?.((base + data.totalBytesSent) / totalBytes);
      },
    );
    const res = await task.uploadAsync();
    if (!res || res.status < 200 || res.status >= 300) {
      throw new Error(`R2 PUT ${name} ${res?.status ?? '??'}: ${res?.body?.slice(0, 200) ?? ''}`);
    }
    sentBytes += sizes[name];
    if (totalBytes > 0) onProgress?.(sentBytes / totalBytes);
    uploadedKeys.push(target.key);
  }

  sink({
    step: 'r2-upload',
    level: 'success',
    message: `アップロード完了 (${uploadedKeys.length} ファイル)`,
    detail: { uploadedKeys },
  });
  return { uploadedKeys };
}
