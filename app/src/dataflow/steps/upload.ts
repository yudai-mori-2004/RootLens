// Upload step: PUT the recording's files to R2.
//
// POST the content hash + recording config to /api/v1/raw-uploads to get
// presigned PUT URLs, then send the recording config's output files under
// raw/<content_hash>/. The server derives the target bucket from the config
// (arkit → the raw ARKit bucket).
//
// ⚠ Dataflow layer: must not import react / react-native.

import * as FileSystem from 'expo-file-system';

import { SERVER_URL } from '../../env';
import { getAuthHeader } from '../../services/auth/instance';
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
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: JSON.stringify({ contentHash, recordingConfig }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/raw-uploads ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as PresignResponse;
}

// R2 occasionally answers a large single-shot PUT with a transient 500
// InternalError (observed in production). 5xx and network drops are retried
// automatically; 4xx (expired presign, contract mismatch) gives up immediately
// and defers to the user-level retry, which starts over from a fresh presign.
// A single-shot PUT cannot resume midway, so each retry resends the whole file.
const MAX_PUT_ATTEMPTS = 4;
const PUT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putWithRetry(
  name: string,
  localUri: string,
  target: PresignedFile,
  sink: EventSink,
  onSentBytes: (sent: number) => void,
): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
    const task = FileSystem.createUploadTask(
      target.url,
      localUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: { 'Content-Type': target.contentType },
      },
      (data) => onSentBytes(data.totalBytesSent),
    );
    let res: Awaited<ReturnType<typeof task.uploadAsync>>;
    try {
      res = await task.uploadAsync();
    } catch (e) {
      res = undefined;
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (res && res.status >= 200 && res.status < 300) return;
    if (res) {
      lastErr = new Error(`R2 PUT ${name} ${res.status}: ${res.body?.slice(0, 200) ?? ''}`);
      if (res.status < 500) break; // retrying a 4xx is pointless
    }
    if (attempt < MAX_PUT_ATTEMPTS) {
      const wait = PUT_RETRY_DELAYS_MS[attempt - 1];
      sink({
        step: 'r2-upload',
        level: 'info',
        message: `${name} の PUT に失敗、 ${Math.round(wait / 1000)} 秒後に送り直し (${attempt}/${MAX_PUT_ATTEMPTS - 1}): ${lastErr?.message ?? '不明なエラー'}`,
      });
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`R2 PUT ${name} failed`);
}

/**
 * Get presigned URLs for the content hash and PUT the files map (name → local
 * URI) to R2. A file whose name has no presigned URL fails loudly, which is how
 * a drift between the recording config and the server contract gets caught.
 */
export async function uploadToR2(
  input: UploadInput,
  sink: EventSink,
  /** Real byte progress (0..1 across all files), to keep the UI progress bar smooth. */
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  sink({ step: 'r2-upload', level: 'info', message: `presigned URL を取得 (構成 ${input.recordingConfig})` });
  const presigned = await requestPresignedUrls(input.contentHash, input.recordingConfig);

  const names = Object.keys(input.files);

  // Measure every file first so progress can be reported in real bytes.
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

  // ⚠ Send sequentially over a foreground session; this is an OOM fix confirmed
  //   on real devices. With the default background session, iOS copies each file
  //   into the nsurlsessiond container when the task starts. Launching several
  //   multi-GB uploads in parallel (a 4 GB rgb.mp4 plus a similar depth.tar and
  //   friends) makes those copies run at once and memory jumps from a few
  //   hundred MB to ~3.7 GB, at which point jetsam kills the app. A foreground
  //   session streams straight from the file with no copy, so sending one file
  //   at a time keeps memory flat. The trade-off: the app must stay foregrounded
  //   while sending (backgrounding rejects the task). createUploadTask, unlike
  //   uploadAsync, has a sent-bytes callback, which keeps the bar smooth through
  //   the longest span of the upload.
  const uploadedKeys: string[] = [];
  let sentBytes = 0;
  for (const name of names) {
    const local = input.files[name];
    const target = presigned.files[name];
    if (!target) throw new Error(`presigned URL missing for ${name} (server contract mismatch?)`);
    const base = sentBytes;
    await putWithRetry(name, local, target, sink, (sent) => {
      if (totalBytes > 0) onProgress?.((base + sent) / totalBytes);
    });
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
