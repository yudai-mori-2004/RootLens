// Core types for the dataflow layer: everything between "recording finished on
// the device" and "raw files uploaded and registered with the server".
//
// ⚠ The dataflow layer is UI-independent. Nothing under src/dataflow/ may import
//   react or react-native, so the same code drives the app UI, the dev sandbox,
//   and tests.

// ─── Clip state machine ────────────────────────────────────────────────

export type ClipState =
  | 'recorded'    // saved on the device, not uploaded yet (visible in the clip list)
  | 'uploading'   // the user tapped upload; hash → R2 PUT → server registration in progress
  | 'uploaded'    // upload and registration complete (drops out of the list)
  | 'error';      // a step failed; the clip stays listed with a retry option

/**
 * Checkpoint for the resumable upload. advanceClip() reads this to decide where
 * to resume, so a failed or interrupted upload never redoes finished work.
 *
 *   pending     raw MP4 only; content hash not computed yet. Retry re-hashes.
 *   hashed      content hash fixed (SHA-256 of the raw mp4 bytes). Retry resumes at the upload.
 *   registered  R2 upload + server registration done (state='uploaded').
 *
 * ⚠ The content hash only exists from 'hashed' on. Before that a clip is known
 *   by its local id alone.
 */
export type UploadStage = 'pending' | 'hashed' | 'registered';

// ─── Clip ──────────────────────────────────────────────────────────────

export interface Clip {
  /** Internal id. Born as a local id at recording time, re-keyed to the content hash once hashing completes. */
  id: string;
  state: ClipState;
  /** When recording finished on the device (ms epoch). */
  createdAt: number;

  /** Id of the recording config that produced this clip ('arkit' | ...). */
  recordingConfigId?: string;
  /** Recording session dir (file:// URI). Holds every file the upload will send. */
  sessionDir?: string;

  /** Upload checkpoint stage. */
  stage?: UploadStage;

  /** SHA-256 hex (64 chars) of the raw MP4. Serves as the clip's identity everywhere:
   *  the R2 object key prefix and the server DB primary key. */
  contentHash?: string;
  /** Byte size of the raw MP4. */
  contentSize?: number;

  /** Upload-consent event id (returned by POST /api/v1/consents). Recorded before
   *  the upload starts, then stored on the server clip row at registration, which
   *  is what ties a clip to its consent record. */
  consentEventId?: string;

  /** Recording duration (ms), self-reported by the device as stop − start. */
  durationMs?: number | null;
  /** Device model of the recording phone ("iPhone15,2" etc.). */
  deviceModel?: string | null;

  /** Error detail when state === 'error'. */
  errorMessage?: string | null;

  /** Upload progress (0..1). Only meaningful while state === 'uploading'. */
  uploadProgress?: number;
}

// ─── Step inputs / outputs ─────────────────────────────────────────────
// Each step is a pure function (input, sink) → Promise<output>; side effects on
// the store are the caller's job.

/** hash step: raw MP4 → SHA-256 (the content hash). */
export interface HashResult {
  /** SHA-256 hex, 64 chars, over the raw mp4 bytes. */
  contentHash: string;
  /** Raw MP4 byte size. */
  contentSize: number;
}

/** upload step: get presigned URLs for the content hash, then PUT the files to R2 in parallel. */
export interface UploadInput {
  contentHash: string;
  /** Recording config id. The server derives the target bucket and the allowed file manifest from it. */
  recordingConfig: string;
  /** Map of R2 file name → local file:// URI (mirrors the recording config's outputFiles). */
  files: Record<string, string>;
}
export interface UploadResult {
  /** Object keys PUT to R2. */
  uploadedKeys: string[];
}

/** register step: create the server-side clip row with POST /api/clips.
 *  The owner is derived server-side from the Bearer token's subject, so no
 *  account identifier travels in the body. */
export interface RegisterInput {
  contentHash: string;
  contentSize: number;
  /** Recording config id ('arkit'). */
  recordingConfig: string;
  /** Recording duration (ms). Omitted when unknown. */
  durationMs?: number | null;
  /** Device model (utsname machine). */
  deviceModel?: string | null;
  /** Upload-consent event id (consent_events.id). */
  consentEventId?: string | null;
}
export interface RegisterResult {
  /** Clip identifier (the content hash). */
  clipId: string;
}

/** Server-side clip as returned by GET /api/clips.
 *  Server rows only exist after a completed upload, so there is no state field. */
export interface ServerClipStatus {
  /** Identifier (the content hash). */
  contentHash: string;
  /** Row creation time (ISO 8601; effectively the recording time). */
  createdAt?: string;
  durationMs?: number | null;
  recordingConfig?: string | null;
  deviceModel?: string | null;
  contentSize?: number | null;
  consentEventId?: string | null;
}
