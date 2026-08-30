import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SCHEMA = 'rootlens.claru.boundaries.v1';
const SOURCE_FILES = ['rgb.mp4', 'frames.jsonl', 'imu.jsonl', 'metadata.json'];

function safeSourceName(value) {
  const name = path.basename(String(value ?? '')).replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!name || name === '.' || name === '..') throw new Error('境界保存用の収録名が不正です');
  return name;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { flag: 'wx' });
  await fs.rename(temporary, file);
}

async function sourceFingerprint(session) {
  const metadataBytes = await fs.readFile(path.join(session.sourceDir, 'metadata.json'));
  const files = {};
  for (const name of SOURCE_FILES) {
    const stat = await fs.stat(path.join(session.sourceDir, name));
    files[name] = { size_bytes: stat.size };
  }
  return {
    directory_name: safeSourceName(session.sourceName),
    metadata_sha256: sha256(metadataBytes),
    files,
    metadata: {
      schema: session.metadata?.schema ?? null,
      created_at: session.metadata?.createdAt ?? null,
      device_model: session.metadata?.deviceModel ?? null,
      video_frame_count: session.metadata?.videoFrameCount ?? null,
      accelerometer_sample_count: session.metadata?.accelerometerSampleCount ?? null,
      gyroscope_sample_count: session.metadata?.gyroscopeSampleCount ?? null,
    },
  };
}

export function normalizeBoundarySegments(segments, durationSeconds, minDurationSeconds = 120) {
  if (!Array.isArray(segments)) throw new Error('境界一覧が配列ではありません');
  const normalized = segments.map((segment, index) => {
    const label = String(segment.label ?? `clip-${String(index + 1).padStart(3, '0')}`).trim();
    const startSeconds = Number(segment.startSeconds);
    const endSeconds = Number(segment.endSeconds);
    if (!label) throw new Error(`区間${index + 1}: ラベルがありません`);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      throw new Error(`区間${index + 1}: 開始・終了時刻が不正です`);
    }
    if (startSeconds < 0 || endSeconds > durationSeconds + 0.05 || endSeconds <= startSeconds) {
      throw new Error(`区間${index + 1}: 収録範囲外または終了が開始以前です`);
    }
    if (endSeconds - startSeconds < minDurationSeconds) {
      throw new Error(`区間${index + 1}: ${minDurationSeconds}秒未満です`);
    }
    return {
      id: String(segment.id ?? `segment-${index + 1}`),
      label,
      startSeconds,
      endSeconds,
    };
  }).sort((a, b) => a.startSeconds - b.startSeconds);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startSeconds < normalized[index - 1].endSeconds - 0.001) {
      throw new Error(`区間が重複しています: ${normalized[index - 1].label} / ${normalized[index].label}`);
    }
  }
  return normalized;
}

export function boundaryCheckpointPath(boundaryDir, session) {
  return path.join(path.resolve(boundaryDir), `${safeSourceName(session.sourceName)}.boundaries.json`);
}

export async function saveBoundaryCheckpoint(boundaryDir, session, segments, now = new Date()) {
  const normalized = normalizeBoundarySegments(segments, session.media.durationSeconds);
  const source = await sourceFingerprint(session);
  const checkpoint = {
    schema: SCHEMA,
    saved_at: now.toISOString(),
    source,
    segment_count: normalized.length,
    segments: normalized,
  };
  const contents = `${JSON.stringify(checkpoint, null, 2)}\n`;
  const checksum = sha256(contents);
  const primary = boundaryCheckpointPath(boundaryDir, session);
  const historyDir = path.join(path.resolve(boundaryDir), 'history', source.directory_name);
  const revisionName = `${checkpoint.saved_at.replace(/[^0-9A-Za-z.-]/g, '-')}-${randomUUID()}.json`;
  const history = path.join(historyDir, revisionName);

  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(history, contents, { flag: 'wx' });
  await writeAtomic(primary, contents);
  await writeAtomic(`${primary}.sha256`, `${checksum}  ${path.basename(primary)}\n`);

  return { checkpoint, path: primary, historyPath: history, checksum };
}

export async function loadBoundaryCheckpoint(boundaryDir, session) {
  const primary = boundaryCheckpointPath(boundaryDir, session);
  const contents = await fs.readFile(primary, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (contents == null) return null;

  const sidecar = await fs.readFile(`${primary}.sha256`, 'utf8');
  const expectedChecksum = sidecar.trim().split(/\s+/)[0];
  const actualChecksum = sha256(contents);
  if (expectedChecksum !== actualChecksum) throw new Error(`境界ファイルのSHA-256が一致しません: ${primary}`);

  const checkpoint = JSON.parse(contents);
  if (checkpoint.schema !== SCHEMA) throw new Error(`境界ファイルschemaが不正です: ${checkpoint.schema ?? 'missing'}`);
  if (checkpoint.source?.directory_name !== safeSourceName(session.sourceName)) {
    throw new Error('境界ファイルの収録名が現在の原本と一致しません');
  }
  const currentSource = await sourceFingerprint(session);
  if (checkpoint.source.metadata_sha256 !== currentSource.metadata_sha256) {
    throw new Error('境界ファイルの原本metadata SHA-256が現在の原本と一致しません');
  }
  for (const name of SOURCE_FILES) {
    if (checkpoint.source.files?.[name]?.size_bytes !== currentSource.files[name].size_bytes) {
      throw new Error(`境界ファイルの原本サイズが一致しません: ${name}`);
    }
  }
  const segments = normalizeBoundarySegments(checkpoint.segments, session.media.durationSeconds);
  if (checkpoint.segment_count !== segments.length) throw new Error('境界ファイルの区間数が一致しません');
  return { checkpoint: { ...checkpoint, segments }, path: primary, checksum: actualChecksum };
}

