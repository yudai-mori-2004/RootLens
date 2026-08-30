import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { run } from './process.mjs';
import {
  REQUIRED_FILES,
  assertSourceSession,
  countAudioPackets,
  probeMedia,
  probeVideoPackets,
} from './session.mjs';
import { snapStartAtOrBefore } from './time.mjs';

const NS_PER_SECOND = 1_000_000_000;
const VERSION = '1.0.0';
const VIDEO_IMU_CONVENTION = 'imu_event_timestamp_minus_video_event_timestamp';
const VIDEO_CLOCK_MODEL_SCHEMA = 'rootlens.camera_imu_clock_model.v1';
const VIDEO_CLOCK_MAPPINGS = new Set([
  'coremedia_cmsync_v1',
  'coremedia_cmsync_v2',
  'coremedia_cmsync_v3',
  'affine_clock_model_v1',
]);
const IMU_EDGE_PADDING_NS = 100_000_000;
const COMBINED_MODEL_KIND = 'camera_to_imu_affine_clock_model_audit';

function isoStamp(date = new Date()) {
  const p = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function defaultOutputBase() {
  return path.join(os.homedir(), 'Downloads');
}

export function sanitizeLabel(value) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 120);
}

export function normalizeVideoImuCalibration(value, sourceMetadata) {
  if (sourceMetadata.recording_config === 'iphone'
      && sourceMetadata.timestamp_timebase?.video_clock_model_schema !== VIDEO_CLOCK_MODEL_SCHEMA
      && !VIDEO_CLOCK_MAPPINGS.has(sourceMetadata.timestamp_timebase?.video_clock_mapping)) {
    throw new Error(
      'このiPhone原本にはCore Motionと比較可能なcanonical clock modelがないため、端末共通のRGB–IMU残差を適用できません');
  }
  if (!value) {
    const sourceAudit = sourceMetadata.capture_configuration?.video_to_imu_calibration;
    const offsetNs = Number(sourceMetadata.capture_configuration?.video_to_imu_offset_ns ?? 0);
    const diagnostic = sourceMetadata.diagnostic_validation;
    if (sourceMetadata.recording_config === 'iphone'
        && diagnostic?.delivery_eligible === false
        && diagnostic?.alignment_kind === 'unsplit_recording_level_camera_to_imu_total_alignment') {
      if (offsetNs !== 0 || sourceAudit?.quality !== 'diagnostic_unsplit') {
        throw new Error('診断用total alignmentのresidual表現が不正です');
      }
      return {
        offsetNs: 0,
        audit: sourceAudit,
        isOverride: false,
        diagnostic: true,
        associationRecomputed: true,
      };
    }
    if (sourceMetadata.recording_config === 'iphone' && sourceAudit?.quality !== 'good') {
      throw new Error('iPhone原本にquality=goodのRGB–IMU校正がありません。端末で再測定したJSONを--calibrationで指定してください');
    }
    return {
      offsetNs,
      audit: sourceAudit ?? {
        offset_ns: offsetNs,
        convention: VIDEO_IMU_CONVENTION,
        source: 'source_metadata',
        measured_at: null,
        quality: null,
        peak_correlation: null,
        standard_deviation_ms: null,
      },
      isOverride: false,
      diagnostic: false,
      associationRecomputed: false,
    };
  }
  if (value.deviceModel && sourceMetadata.device_model && value.deviceModel !== sourceMetadata.device_model) {
    throw new Error(`RGB–IMU校正の端末が原本と一致しません: ${value.deviceModel}/${sourceMetadata.device_model}`);
  }
  if (value.cameraType && sourceMetadata.camera?.device_type && value.cameraType !== sourceMetadata.camera.device_type) {
    throw new Error('RGB–IMU校正のカメラ種別が原本と一致しません');
  }
  if (value.quality !== 'good') throw new Error('RGB–IMU校正はquality=goodの結果だけ使用できます');
  const offsetNs = Number.isFinite(Number(value.offset_ns))
    ? Math.round(Number(value.offset_ns))
    : Math.round(Number(value.videoToImuOffsetMs) * 1_000_000);
  if (!Number.isSafeInteger(offsetNs)) throw new Error('RGB–IMU校正値が不正です');
  const convention = value.convention ?? VIDEO_IMU_CONVENTION;
  if (convention !== VIDEO_IMU_CONVENTION) throw new Error(`RGB–IMU校正の符号規約が不一致です: ${convention}`);
  return {
    offsetNs,
    audit: {
      offset_ns: offsetNs,
      convention,
      source: value.source ?? 'on_device_pixel_motion_vs_gyro',
      measured_at: value.measured_at ?? value.measuredAt ?? null,
      quality: value.quality,
      peak_correlation: value.peak_correlation ?? value.peakCorrelation ?? null,
      standard_deviation_ms: value.standard_deviation_ms ?? value.standardDeviationMs ?? null,
      algorithm_version: value.algorithm_version ?? value.algorithmVersion ?? null,
      signal_pair: value.signal_pair ?? value.signalPair ?? null,
      calibration_duration_seconds: value.calibration_duration_seconds ?? value.durationSeconds ?? null,
      window_count: value.window_count ?? value.windowCount ?? null,
      range_min_ms: value.range_min_ms ?? value.rangeMinMs ?? null,
      range_max_ms: value.range_max_ms ?? value.rangeMaxMs ?? null,
      device_model: value.device_model ?? value.deviceModel ?? sourceMetadata.device_model ?? null,
      camera_type: value.camera_type ?? value.cameraType ?? sourceMetadata.camera?.device_type ?? null,
    },
    isOverride: true,
    diagnostic: false,
    associationRecomputed: true,
  };
}

export function normalizeCombinedClockAudit(value, sourceMetadata) {
  if (!value || value.schema !== VIDEO_CLOCK_MODEL_SCHEMA || value.kind !== COMBINED_MODEL_KIND) {
    throw new Error(`camera–IMU監査は${VIDEO_CLOCK_MODEL_SCHEMA}のaffine auditである必要があります`);
  }
  if (value.quality !== 'good') throw new Error('camera–IMU監査はquality=goodだけ使用できます');
  const model = value.clock_model;
  if (!model || model.model_type !== 'affine') throw new Error('camera–IMU監査にaffine modelがありません');
  const sourceAnchorNs = Number(model.source_anchor_ns);
  const offsetAtSourceAnchorNs = Number(model.offset_at_source_anchor_ns);
  const targetRatePerSourceRate = Number(model.target_rate_per_source_rate);
  if (!Number.isSafeInteger(sourceAnchorNs)
      || !Number.isSafeInteger(offsetAtSourceAnchorNs)
      || !Number.isFinite(targetRatePerSourceRate)
      || targetRatePerSourceRate <= 0) {
    throw new Error('camera–IMU affine modelの数値が不正です');
  }
  if (model.offset_convention !== VIDEO_IMU_CONVENTION) {
    throw new Error(`camera–IMU affine modelの符号規約が不一致です: ${model.offset_convention}`);
  }
  if (Number(value.frame_count) !== Number(sourceMetadata.video_frame_count)) {
    throw new Error('camera–IMU監査のframe数が原本metadataと一致しません');
  }
  if (Number(value.gyro_count) !== Number(sourceMetadata.gyroscope_sample_count)) {
    throw new Error('camera–IMU監査のgyro数が原本metadataと一致しません');
  }
  return {
    sourceAnchorNs,
    offsetAtSourceAnchorNs,
    targetRatePerSourceRate,
    quality: value.quality,
    affineFit: value.affine_fit,
    sourceObservation: value.source_observation,
  };
}

export function applyCombinedClockModel(row, audit) {
  const rawNs = Number(row.camera_sensor_timestamp_ns ?? row.timestamp_ns);
  if (!Number.isSafeInteger(rawNs)) throw new Error(`frame ${row.frame_index}: raw camera timestampが不正です`);
  const totalAlignmentNs = Math.round(
    audit.offsetAtSourceAnchorNs
    + (rawNs - audit.sourceAnchorNs) * (audit.targetRatePerSourceRate - 1),
  );
  const canonicalNs = rawNs + totalAlignmentNs;
  if (!Number.isSafeInteger(canonicalNs)) throw new Error(`frame ${row.frame_index}: canonical timestampが不正です`);
  const rewritten = { ...row };
  // The old build did not retain an independently valid host-clock mapping.
  // Do not repurpose those field names for the canonical association timeline.
  delete rewritten.video_frame_timestamp_system_uptime_ns;
  delete rewritten.camera_timestamp_mapped_system_uptime_ns;
  delete rewritten.camera_to_system_uptime_offset_ns;
  delete rewritten.camera_timestamp_legacy_unmapped_ns;
  delete rewritten.mapping_quality;
  rewritten.video_frame_timestamp_canonical_ns = canonicalNs;
  rewritten.video_frame_timestamp_source = VIDEO_CLOCK_MODEL_SCHEMA;
  rewritten.video_to_imu_offset_ns = 0;
  rewritten.video_to_imu_offset_convention = VIDEO_IMU_CONVENTION;
  rewritten.imu_association_timestamp_ns = canonicalNs;
  return rewritten;
}

export function validateSegments(segments, durationSeconds, keyframes, minDurationSeconds = 120) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error('タスク区間を1件以上追加してください');
  const normalized = segments.map((segment, index) => {
    const label = sanitizeLabel(segment.label);
    const startSeconds = Number(segment.startSeconds);
    const endSeconds = Number(segment.endSeconds);
    if (!label) throw new Error(`区間${index + 1}: タスク名がありません`);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      throw new Error(`区間${index + 1}: 開始・終了時刻が不正です`);
    }
    if (startSeconds < 0 || endSeconds > durationSeconds + 0.05 || endSeconds <= startSeconds) {
      throw new Error(`区間${index + 1}: 収録範囲外または終了が開始以前です`);
    }
    if (endSeconds - startSeconds < minDurationSeconds) {
      throw new Error(`区間${index + 1}: ${minDurationSeconds}秒未満です`);
    }
    const effectiveStartSeconds = snapStartAtOrBefore(startSeconds, keyframes);
    return { id: segment.id ?? `segment-${index + 1}`, label, startSeconds, endSeconds, effectiveStartSeconds };
  }).sort((a, b) => a.startSeconds - b.startSeconds);

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].startSeconds < normalized[i - 1].endSeconds - 0.001) {
      throw new Error(`区間が重複しています: ${normalized[i - 1].label} / ${normalized[i].label}`);
    }
  }
  return normalized;
}

async function sha256File(file, onProgress) {
  const stat = await fs.stat(file);
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(file);
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
      onProgress?.(stat.size ? bytes / stat.size : 1);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function* jsonLines(file) {
  const input = fsSync.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function writeLine(stream, row) {
  const line = `${JSON.stringify(row)}\n`;
  if (!stream.write(line)) await new Promise((resolve) => stream.once('drain', resolve));
}

async function closeStream(stream) {
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

function findSourceStartPacket(packets, effectiveStartSeconds) {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < packets.length; index += 1) {
    if (!packets[index].keyFrame) continue;
    const delta = Math.abs(packets[index].ptsSeconds - effectiveStartSeconds);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
    if (packets[index].ptsSeconds > effectiveStartSeconds + 0.1) break;
  }
  if (best < 0 || bestDelta > 0.1) throw new Error(`開始keyframeをpacket列へ対応できません: ${effectiveStartSeconds}`);
  return best;
}

async function exportVideo(source, destination, segment, onProgress) {
  const duration = segment.endSeconds - segment.effectiveStartSeconds;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-y',
    '-ss', segment.effectiveStartSeconds.toFixed(6),
    '-i', source,
    '-t', duration.toFixed(6),
    '-map', '0:v:0', '-map', '0:a:0',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    destination,
  ], {
    onLine(line) {
      const match = line.match(/^out_time_us=(\d+)$/);
      if (match) onProgress?.(Math.min(1, Number(match[1]) / 1_000_000 / duration));
    },
  });
}

function dateAtOffset(isoValue, offsetSeconds) {
  const base = Date.parse(isoValue);
  return Number.isFinite(base) ? new Date(base + offsetSeconds * 1000).toISOString() : isoValue;
}

function floorIndex(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function mappedVideoTimestamp(row) {
  const value = row.video_frame_timestamp_canonical_ns
    ?? row.camera_timestamp_mapped_system_uptime_ns;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`frame ${row.frame_index}: Core Motionと比較可能なcanonical video timestampがありません`);
  }
  return value;
}

export function rewriteFrame(row, packet, localIndex, segment) {
  const rewritten = { ...row };
  rewritten.frame_index = localIndex;
  rewritten.mp4_sample_index = localIndex;
  rewritten.mp4_pts_ns = Math.round(packet.ptsSeconds * NS_PER_SECOND);
  rewritten.mp4_sample_size_bytes = packet.sizeBytes;
  rewritten.mp4_key_frame = packet.keyFrame;
  if (typeof rewritten.camera_result_index === 'number') rewritten.camera_result_index = localIndex;
  if (segment.imuTimeline && Number.isSafeInteger(segment.videoImuCalibration?.offsetNs)) {
    const offsetNs = segment.videoImuCalibration.offsetNs;
    const associationNs = mappedVideoTimestamp(rewritten) + offsetNs;
    rewritten.video_to_imu_offset_ns = offsetNs;
    rewritten.video_to_imu_offset_convention = VIDEO_IMU_CONVENTION;
    rewritten.imu_association_timestamp_ns = associationNs;
    for (const sensor of ['accelerometer', 'gyroscope']) {
      const values = segment.imuTimeline[sensor];
      const before = floorIndex(values, associationNs);
      if (before < 0 || before + 1 >= values.length) {
        throw new Error(`frame ${localIndex}: ${sensor}で校正後時刻を挟めません`);
      }
      rewritten[`${sensor}_before_index`] = before;
      rewritten[`${sensor}_before_timestamp_ns`] = values[before];
      rewritten[`${sensor}_after_index`] = before + 1;
      rewritten[`${sensor}_after_timestamp_ns`] = values[before + 1];
    }
  } else {
    for (const sensor of ['accelerometer', 'gyroscope']) {
      const base = segment.imuRanges[sensor].min;
      for (const side of ['before', 'after']) {
        const key = `${sensor}_${side}_index`;
        if (typeof rewritten[key] === 'number') rewritten[key] -= base;
      }
    }
  }
  return rewritten;
}

export function rewriteImu(row, baseIndex) {
  return { ...row, sample_index: row.sample_index - baseIndex };
}

export function buildMetadata(sourceMetadata, segment, facts) {
  const metadata = structuredClone(sourceMetadata);
  delete metadata.content_hash;
  delete metadata.video_bytes;
  metadata.created_at = dateAtOffset(sourceMetadata.created_at, segment.sourceStartPtsSeconds);
  metadata.stopped_at = dateAtOffset(sourceMetadata.created_at, segment.sourceStartPtsSeconds + facts.media.durationSeconds);
  metadata.actual_duration_ms = Math.round(facts.media.durationSeconds * 1000);
  metadata.video_frame_count = facts.videoFrameCount;
  metadata.accelerometer_sample_count = facts.accelerometerSampleCount;
  metadata.gyroscope_sample_count = facts.gyroscopeSampleCount;
  metadata.audio_sample_count = facts.audioSampleCount;
  metadata.content_hash = facts.contentHash;
  metadata.video_bytes = facts.videoBytes;
  metadata.files = [...REQUIRED_FILES];
  delete metadata.task_label;
  if (facts.videoImuCalibration) {
    metadata.capture_configuration ??= {};
    metadata.capture_configuration.video_to_imu_offset_ns = facts.videoImuCalibration.offsetNs;
    metadata.capture_configuration.video_to_imu_offset_convention = VIDEO_IMU_CONVENTION;
    if (facts.videoImuCalibration.audit) {
      metadata.capture_configuration.video_to_imu_calibration = facts.videoImuCalibration.audit;
    } else {
      delete metadata.capture_configuration.video_to_imu_calibration;
    }
  }
  if (facts.videoClockAudit) {
    const audit = facts.videoClockAudit;
    delete metadata.camera_imu_model;
    metadata.timestamp_timebase = {
      unit: 'nanoseconds',
      clock: 'CoreMotion boot-relative association timeline',
      video_source: 'CMSampleBuffer.presentationTimeStamp',
      video_source_clock: 'AVCaptureSession.synchronizationClock',
      video_mapped_field: 'video_frame_timestamp_canonical_ns',
      video_mapped_clock: 'CoreMotion boot-relative association timeline',
      video_clock_model_schema: VIDEO_CLOCK_MODEL_SCHEMA,
      imu_source: 'CMAccelerometerData.timestamp / CMGyroData.timestamp',
      raw_timestamps_modified: false,
      clock_model: {
        model_type: 'affine',
        equation: 'target_ns = target_anchor_ns + (source_ns - source_anchor_ns) * target_rate_per_source_rate',
        source_clock: 'AVCaptureSession.synchronizationClock',
        target_clock: 'CoreMotion boot-relative association timeline',
        source_anchor_ns: audit.sourceAnchorNs,
        target_anchor_ns: audit.sourceAnchorNs + audit.offsetAtSourceAnchorNs,
        target_rate_per_source_rate: audit.targetRatePerSourceRate,
        offset_convention: VIDEO_IMU_CONVENTION,
      },
    };
  }
  metadata.segmentation = {
    schema: 'rootlens.continuous-extraction.v1',
    tool: `rootlens-claru-session-cutter/${VERSION}`,
    created_at: new Date().toISOString(),
    mode: 'single_continuous_interval',
    source_content_hash: facts.sourceContentHash,
    source_recording_created_at: sourceMetadata.created_at,
    source_selected_start_ms: Math.round(segment.startSeconds * 1000),
    source_selected_end_ms: Math.round(segment.endSeconds * 1000),
    source_exported_start_ms: Math.round(segment.sourceStartPtsSeconds * 1000),
    source_exported_end_ms: Math.round((segment.sourceStartPtsSeconds + facts.media.durationSeconds) * 1000),
    source_first_frame_index: segment.sourceStartFrameIndex,
    source_last_frame_index: segment.sourceEndFrameIndexExclusive - 1,
    start_snapped_to_prior_keyframe: Math.abs(segment.startSeconds - segment.sourceStartPtsSeconds) > 0.0005,
    internal_cuts: 0,
    video_reencoded: false,
    audio_reencoded: false,
    speed_changed: false,
    image_cropped: false,
    raw_video_timestamps_modified: false,
    raw_imu_timestamps_modified: false,
    video_to_imu_association_recomputed: Boolean(
      facts.videoImuCalibration?.isOverride || facts.videoImuCalibration?.associationRecomputed),
  };
  return metadata;
}

async function validateClipFolder(folder) {
  const names = (await fs.readdir(folder)).sort();
  const expected = [...REQUIRED_FILES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`出力manifest不一致: ${names.join(', ')}`);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(folder, 'metadata.json'), 'utf8'));
  const [media, packets, actualHash, videoStat] = await Promise.all([
    probeMedia(path.join(folder, 'rgb.mp4')),
    probeVideoPackets(path.join(folder, 'rgb.mp4')),
    sha256File(path.join(folder, 'rgb.mp4')),
    fs.stat(path.join(folder, 'rgb.mp4')),
  ]);
  if (actualHash !== metadata.content_hash || videoStat.size !== metadata.video_bytes) {
    throw new Error('content_hashまたはvideo_bytesがmetadataと一致しません');
  }
  const expectedOffsetNs = Number(metadata.capture_configuration?.video_to_imu_offset_ns ?? 0);
  const expectedConvention = metadata.capture_configuration?.video_to_imu_offset_convention
    ?? VIDEO_IMU_CONVENTION;
  const calibrationAudit = metadata.capture_configuration?.video_to_imu_calibration;
  if (!Number.isSafeInteger(expectedOffsetNs)
      || expectedConvention !== VIDEO_IMU_CONVENTION
      || (calibrationAudit && calibrationAudit.offset_ns !== expectedOffsetNs)
      || (calibrationAudit && calibrationAudit.convention !== expectedConvention)) {
    throw new Error('metadataのRGB–IMU校正値または符号規約が不正です');
  }
  const accel = new Float64Array(metadata.accelerometer_sample_count);
  const gyro = new Float64Array(metadata.gyroscope_sample_count);
  const next = { accelerometer: 0, gyroscope: 0 };
  const previousTs = { accelerometer: -Infinity, gyroscope: -Infinity };
  for await (const row of jsonLines(path.join(folder, 'imu.jsonl'))) {
    if (!(row.sensor in next)) throw new Error(`未知のIMU sensor: ${row.sensor}`);
    if (row.sample_index !== next[row.sensor]) throw new Error(`${row.sensor} sample_indexが連続していません`);
    if (row.timestamp_ns <= previousTs[row.sensor]) throw new Error(`${row.sensor} timestampが単調増加ではありません`);
    const target = row.sensor === 'accelerometer' ? accel : gyro;
    if (row.sample_index >= target.length) throw new Error(`${row.sensor} sample数がmetadataを超えています`);
    target[row.sample_index] = row.timestamp_ns;
    previousTs[row.sensor] = row.timestamp_ns;
    next[row.sensor] += 1;
  }
  if (next.accelerometer !== accel.length || next.gyroscope !== gyro.length) {
    throw new Error('IMU sample countがmetadataと一致しません');
  }
  let frameCount = 0;
  let previousVideoTimestamp = -Infinity;
  for await (const row of jsonLines(path.join(folder, 'frames.jsonl'))) {
    if (frameCount >= packets.length) throw new Error('frames.jsonlがMP4 sample数を超えています');
    if (row.frame_index !== frameCount || row.mp4_sample_index !== frameCount) throw new Error('frame indexが連続していません');
    if (row.timestamp_ns <= previousVideoTimestamp) throw new Error('video raw timestampが単調増加ではありません');
    const packet = packets[frameCount];
    if (Math.abs(row.mp4_pts_ns - Math.round(packet.ptsSeconds * NS_PER_SECOND)) > 1_000) {
      throw new Error(`frame ${frameCount}: MP4 PTSが一致しません`);
    }
    const associationTimestampNs = mappedVideoTimestamp(row) + expectedOffsetNs;
    if (row.video_to_imu_offset_ns !== expectedOffsetNs
        || row.video_to_imu_offset_convention !== expectedConvention
        || row.imu_association_timestamp_ns !== associationTimestampNs) {
      throw new Error(`frame ${frameCount}: RGB–IMU補正値または対応時刻がmetadataと一致しません`);
    }
    for (const [sensor, values] of [['accelerometer', accel], ['gyroscope', gyro]]) {
      const references = {};
      for (const side of ['before', 'after']) {
        const index = row[`${sensor}_${side}_index`];
        const timestamp = row[`${sensor}_${side}_timestamp_ns`];
        if (index == null && timestamp == null) {
          throw new Error(`frame ${frameCount}: ${sensor}_${side}参照がありません`);
        }
        if (!Number.isInteger(index) || index < 0 || index >= values.length || values[index] !== timestamp) {
          throw new Error(`frame ${frameCount}: ${sensor}_${side}参照が不正です`);
        }
        references[side] = timestamp;
      }
      if (references.before > associationTimestampNs || references.after < associationTimestampNs) {
        throw new Error(`frame ${frameCount}: ${sensor}参照が補正後時刻を挟んでいません`);
      }
    }
    previousVideoTimestamp = row.timestamp_ns;
    frameCount += 1;
  }
  if (frameCount !== packets.length || frameCount !== metadata.video_frame_count) {
    throw new Error(`video/frame count不一致: mp4=${packets.length} frames=${frameCount} metadata=${metadata.video_frame_count}`);
  }
  return { media, frameCount, contentHash: actualHash };
}

export async function exportSegments({
  sourceDir,
  segments,
  keyframes,
  outputBase = defaultOutputBase(),
  minDurationSeconds = 120,
  videoImuCalibration,
  videoClockAudit,
  onProgress,
}) {
  const { sourceDir: resolved, metadata: sourceMetadata } = await assertSourceSession(sourceDir);
  const sourceVideo = path.join(resolved, 'rgb.mp4');
  const sourceMedia = await probeMedia(sourceVideo);
  const normalized = validateSegments(segments, sourceMedia.durationSeconds, keyframes, minDurationSeconds);
  const normalizedClockAudit = videoClockAudit
    ? normalizeCombinedClockAudit(videoClockAudit, sourceMetadata)
    : null;
  const normalizedCalibration = normalizedClockAudit
    ? {
        offsetNs: 0,
        audit: null,
        isOverride: false,
        diagnostic: false,
        associationRecomputed: true,
      }
    : normalizeVideoImuCalibration(videoImuCalibration, sourceMetadata);
  const outputPrefix = sourceMetadata.diagnostic_validation?.delivery_eligible === false
    ? 'RootLens-Claru-NOT-FOR-DELIVERY-DIAGNOSTIC'
    : 'RootLens-Claru-DELIVERY';
  const outputRoot = path.join(path.resolve(outputBase), `${outputPrefix}-${isoStamp()}`);
  const workRoot = path.join(outputRoot, '.work');
  const rawRoot = path.join(outputRoot, 'raw');
  await fs.mkdir(workRoot, { recursive: true });
  await fs.mkdir(rawRoot, { recursive: true });
  const report = (phase, detail = {}) => onProgress?.({ phase, ...detail });

  report('source-hash', { message: '長尺原本のSHA-256を計算中', progress: 0 });
  const sourceContentHash = await sha256File(sourceVideo, (progress) => report('source-hash', { progress }));
  report('source-packets', { message: '長尺原本のvideo packetを検査中', progress: 0 });
  const sourcePackets = await probeVideoPackets(sourceVideo);
  if (sourceMetadata.video_frame_count !== sourcePackets.length) {
    throw new Error(`原本のMP4/frame契約不一致: mp4=${sourcePackets.length} metadata=${sourceMetadata.video_frame_count}`);
  }

  const states = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const segment = normalized[index];
    const workDir = path.join(workRoot, String(index + 1).padStart(3, '0'));
    await fs.mkdir(workDir, { recursive: true });
    const videoPath = path.join(workDir, 'rgb.mp4');
    report('video', { clipIndex: index, clipCount: normalized.length, label: segment.label, progress: 0, message: '再エンコードなしで映像・音声を書出中' });
    await exportVideo(sourceVideo, videoPath, segment, (progress) => report('video', {
      clipIndex: index, clipCount: normalized.length, label: segment.label, progress,
    }));
    const [outputPackets, media, audioSampleCount] = await Promise.all([
      probeVideoPackets(videoPath),
      probeMedia(videoPath),
      countAudioPackets(videoPath),
    ]);
    const sourceStartFrameIndex = findSourceStartPacket(sourcePackets, segment.effectiveStartSeconds);
    const sourceEndFrameIndexExclusive = sourceStartFrameIndex + outputPackets.length;
    if (sourceEndFrameIndexExclusive > sourcePackets.length) throw new Error(`${segment.label}: 出力frame範囲が原本を超えています`);
    states.push({
      ...segment,
      workDir,
      videoPath,
      outputPackets,
      media,
      audioSampleCount,
      sourceStartFrameIndex,
      sourceEndFrameIndexExclusive,
      sourceStartPtsSeconds: sourcePackets[sourceStartFrameIndex].ptsSeconds,
      rawFramesPath: path.join(workDir, '.source-frames.jsonl'),
      rawImuPath: path.join(workDir, '.source-imu.jsonl'),
      rawFrameCount: 0,
      firstVideoTimestampNs: null,
      lastVideoTimestampNs: null,
      videoImuCalibration: normalizedCalibration,
      imuTimeline: { accelerometer: [], gyroscope: [] },
      imuRanges: {
        accelerometer: { min: Infinity, max: -Infinity, count: 0 },
        gyroscope: { min: Infinity, max: -Infinity, count: 0 },
      },
    });
  }

  report('frames', { message: 'frame対応を各タスク区間へ分配中', progress: 0 });
  const frameStreams = states.map((state) => fsSync.createWriteStream(state.rawFramesPath));
  let sourceFrameRows = 0;
  let firstRawCameraTimestampNs = null;
  let lastRawCameraTimestampNs = null;
  for await (const row of jsonLines(path.join(resolved, 'frames.jsonl'))) {
    if (row.frame_index !== sourceFrameRows) throw new Error(`原本frame_indexが不連続です: ${row.frame_index}`);
    const normalizedRow = normalizedClockAudit ? applyCombinedClockModel(row, normalizedClockAudit) : row;
    const rawCameraTimestampNs = Number(row.camera_sensor_timestamp_ns ?? row.timestamp_ns);
    firstRawCameraTimestampNs ??= rawCameraTimestampNs;
    lastRawCameraTimestampNs = rawCameraTimestampNs;
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (row.frame_index < state.sourceStartFrameIndex || row.frame_index >= state.sourceEndFrameIndexExclusive) continue;
      await writeLine(frameStreams[index], normalizedRow);
      state.rawFrameCount += 1;
      const timestampNs = mappedVideoTimestamp(normalizedRow);
      state.firstVideoTimestampNs ??= timestampNs;
      state.lastVideoTimestampNs = timestampNs;
    }
    sourceFrameRows += 1;
    if (sourceFrameRows % 10_000 === 0) report('frames', { progress: sourceFrameRows / sourcePackets.length });
  }
  await Promise.all(frameStreams.map(closeStream));
  if (sourceFrameRows !== sourcePackets.length) throw new Error(`原本frames.jsonl行数不一致: ${sourceFrameRows}/${sourcePackets.length}`);
  if (normalizedClockAudit) {
    const observation = normalizedClockAudit.sourceObservation ?? {};
    if (Number(observation.first_camera_timestamp_ns) !== firstRawCameraTimestampNs
        || Number(observation.last_camera_timestamp_ns) !== lastRawCameraTimestampNs) {
      throw new Error('camera–IMU監査のcamera timestamp端点が原本と一致しません');
    }
  }
  for (const state of states) {
    if (state.rawFrameCount !== state.outputPackets.length) {
      throw new Error(`${state.label}: MP4と抽出frame数が一致しません: ${state.outputPackets.length}/${state.rawFrameCount}`);
    }
    if (!Number.isSafeInteger(state.firstVideoTimestampNs) || !Number.isSafeInteger(state.lastVideoTimestampNs)) {
      throw new Error(`${state.label}: video timestamp範囲を確定できません`);
    }
    state.associationStartNs = state.firstVideoTimestampNs + normalizedCalibration.offsetNs;
    state.associationEndNs = state.lastVideoTimestampNs + normalizedCalibration.offsetNs;
  }

  report('imu', { message: 'raw IMUを同じ時刻範囲へ分配中', progress: 0 });
  const imuStreams = states.map((state) => fsSync.createWriteStream(state.rawImuPath));
  const sourceImuExpected = Number(sourceMetadata.accelerometer_sample_count ?? 0) + Number(sourceMetadata.gyroscope_sample_count ?? 0);
  let sourceImuRows = 0;
  let firstGyroTimestampNs = null;
  let lastGyroTimestampNs = null;
  for await (const row of jsonLines(path.join(resolved, 'imu.jsonl'))) {
    if (!['accelerometer', 'gyroscope'].includes(row.sensor)) throw new Error(`未知の原本IMU sensor: ${row.sensor}`);
    if (row.sensor === 'gyroscope') {
      firstGyroTimestampNs ??= row.timestamp_ns;
      lastGyroTimestampNs = row.timestamp_ns;
    }
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      const range = state.imuRanges[row.sensor];
      if (row.timestamp_ns < state.associationStartNs - IMU_EDGE_PADDING_NS
          || row.timestamp_ns > state.associationEndNs + IMU_EDGE_PADDING_NS) continue;
      if (!Number.isFinite(range.min)) range.min = row.sample_index;
      range.max = row.sample_index;
      await writeLine(imuStreams[index], rewriteImu(row, range.min));
      state.imuTimeline[row.sensor].push(row.timestamp_ns);
      range.count += 1;
    }
    sourceImuRows += 1;
    if (sourceImuRows % 50_000 === 0 && sourceImuExpected) report('imu', { progress: sourceImuRows / sourceImuExpected });
  }
  await Promise.all(imuStreams.map(closeStream));
  if (sourceImuExpected && sourceImuRows !== sourceImuExpected) {
    throw new Error(`原本IMU行数がmetadataと一致しません: ${sourceImuRows}/${sourceImuExpected}`);
  }
  if (normalizedClockAudit) {
    const observation = normalizedClockAudit.sourceObservation ?? {};
    if (Number(observation.first_gyro_timestamp_ns) !== firstGyroTimestampNs
        || Number(observation.last_gyro_timestamp_ns) !== lastGyroTimestampNs) {
      throw new Error('camera–IMU監査のgyro timestamp端点が原本と一致しません');
    }
  }
  for (const state of states) {
    for (const sensor of ['accelerometer', 'gyroscope']) {
      if (state.imuTimeline[sensor].length < 2) {
        throw new Error(`${state.label}: ${sensor}の校正後時刻範囲を抽出できません`);
      }
    }
  }

  const results = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    report('finalize', { clipIndex: index, clipCount: states.length, label: state.label, progress: 0, message: 'index・metadata・hashを確定中' });
    const framesPath = path.join(state.workDir, 'frames.jsonl');
    const framesStream = fsSync.createWriteStream(framesPath);
    let localIndex = 0;
    for await (const row of jsonLines(state.rawFramesPath)) {
      await writeLine(framesStream, rewriteFrame(row, state.outputPackets[localIndex], localIndex, state));
      localIndex += 1;
    }
    await closeStream(framesStream);
    await fs.rename(state.rawImuPath, path.join(state.workDir, 'imu.jsonl'));
    await fs.rm(state.rawFramesPath, { force: true });
    const [contentHash, videoStat] = await Promise.all([
      sha256File(state.videoPath, (progress) => report('finalize', { clipIndex: index, clipCount: states.length, label: state.label, progress })),
      fs.stat(state.videoPath),
    ]);
    const metadata = buildMetadata(sourceMetadata, state, {
      sourceContentHash,
      media: state.media,
      videoFrameCount: state.outputPackets.length,
      accelerometerSampleCount: state.imuRanges.accelerometer.count,
      gyroscopeSampleCount: state.imuRanges.gyroscope.count,
      audioSampleCount: state.audioSampleCount,
      contentHash,
      videoBytes: videoStat.size,
      videoImuCalibration: normalizedCalibration,
      videoClockAudit: normalizedClockAudit,
    });
    await fs.writeFile(path.join(state.workDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    const validation = await validateClipFolder(state.workDir);
    const finalDir = path.join(rawRoot, contentHash);
    await fs.rename(state.workDir, finalDir);
    results.push({
      contentHash,
      label: state.label,
      folder: finalDir,
      durationSeconds: validation.media.durationSeconds,
      videoFrameCount: validation.frameCount,
    });
  }
  await fs.rm(workRoot, { recursive: true, force: true });
  const outputEntries = await fs.readdir(outputRoot);
  if (outputEntries.length !== 1 || outputEntries[0] !== 'raw') {
    throw new Error(`R2 upload root不一致: ${outputEntries.join(', ')}`);
  }
  report('complete', { progress: 1, outputRoot, clips: results });
  return { outputRoot, sourceContentHash, clips: results };
}

export { validateClipFolder };
