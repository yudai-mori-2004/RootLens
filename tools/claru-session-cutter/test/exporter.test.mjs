import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  exportSegments,
  normalizeVideoImuCalibration,
  rewriteFrame,
  rewriteImu,
  validateClipFolder,
  validateSegments,
} from '../lib/exporter.mjs';
import { run } from '../lib/process.mjs';
import { probeKeyframes, probeMedia, probeVideoPackets } from '../lib/session.mjs';
import { formatTime, parseTime, snapStartAtOrBefore } from '../lib/time.mjs';

test('time parser/formatter and keyframe snap are deterministic', () => {
  assert.equal(parseTime('01:02:03.250'), 3723.25);
  assert.equal(parseTime('02:03.5'), 123.5);
  assert.equal(formatTime(3723.25), '01:02:03.250');
  assert.equal(snapStartAtOrBefore(4.7, [0, 2, 4, 6]), 4);
});

test('segment validation enforces labels, duration, range, and overlap', () => {
  const keyframes = [0, 2, 4, 6, 8, 10];
  const valid = validateSegments([{ label: 'prep', startSeconds: 2.3, endSeconds: 5 }], 10, keyframes, 2);
  assert.equal(valid[0].effectiveStartSeconds, 2);
  assert.throws(() => validateSegments([{ label: '', startSeconds: 2, endSeconds: 5 }], 10, keyframes, 2), /タスク名/);
  assert.throws(() => validateSegments([{ label: 'short', startSeconds: 2, endSeconds: 3 }], 10, keyframes, 2), /2秒未満/);
  assert.throws(() => validateSegments([
    { label: 'a', startSeconds: 1, endSeconds: 5 },
    { label: 'b', startSeconds: 4, endSeconds: 7 },
  ], 10, keyframes, 2), /重複/);
});

test('frame and IMU rewrites preserve raw timestamps while rebasing indices', () => {
  const segment = { imuRanges: { accelerometer: { min: 10 }, gyroscope: { min: 20 } } };
  const row = {
    frame_index: 40,
    mp4_sample_index: 40,
    mp4_pts_ns: 9,
    timestamp_ns: 999,
    camera_result_index: 40,
    accelerometer_before_index: 10,
    accelerometer_after_index: 11,
    gyroscope_before_index: 20,
    gyroscope_after_index: 21,
  };
  const rewritten = rewriteFrame(row, { ptsSeconds: 0.5, sizeBytes: 123, keyFrame: true }, 0, segment);
  assert.equal(rewritten.timestamp_ns, 999);
  assert.equal(rewritten.frame_index, 0);
  assert.equal(rewritten.mp4_pts_ns, 500_000_000);
  assert.equal(rewritten.accelerometer_after_index, 1);
  assert.equal(rewritten.gyroscope_after_index, 1);
  assert.deepEqual(rewriteImu({ sample_index: 22, timestamp_ns: 77 }, 20), { sample_index: 2, timestamp_ns: 77 });

  const calibrated = rewriteFrame({
    ...row,
    video_frame_timestamp_canonical_ns: 1_015,
    camera_timestamp_mapped_system_uptime_ns: 9_999,
  }, { ptsSeconds: 0.5, sizeBytes: 123, keyFrame: true }, 0, {
    videoImuCalibration: { offsetNs: 5 },
    imuTimeline: {
      accelerometer: [1_010, 1_020, 1_030],
      gyroscope: [1_010, 1_020, 1_030],
    },
  });
  assert.equal(calibrated.imu_association_timestamp_ns, 1_020);
  assert.equal(calibrated.accelerometer_before_index, 1);
});

test('device calibration is fail-loud and normalized to metadata audit fields', () => {
  const source = {
    device_model: 'iPhone13,1',
    camera: { device_type: 'AVCaptureDeviceTypeBuiltInUltraWideCamera' },
    capture_configuration: {},
    recording_config: 'iphone',
    timestamp_timebase: { video_clock_mapping: 'coremedia_cmsync_v1' },
  };
  const value = normalizeVideoImuCalibration({
    deviceModel: 'iPhone13,1',
    cameraType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
    videoToImuOffsetMs: -546.75,
    quality: 'good',
    measuredAt: '2026-08-25T00:00:00Z',
    peakCorrelation: 0.8,
  }, source);
  assert.equal(value.offsetNs, -546_750_000);
  assert.equal(value.audit.offset_ns, -546_750_000);
  assert.equal(value.audit.measured_at, '2026-08-25T00:00:00Z');
  assert.doesNotThrow(() => normalizeVideoImuCalibration({
    deviceModel: 'iPhone13,1',
    cameraType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
    videoToImuOffsetMs: -4,
    quality: 'good',
  }, {
    ...source,
    timestamp_timebase: { video_clock_mapping: 'coremedia_cmsync_v2' },
  }));
  assert.doesNotThrow(() => normalizeVideoImuCalibration({
    deviceModel: 'iPhone13,1',
    cameraType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
    videoToImuOffsetMs: -4,
    quality: 'good',
  }, {
    ...source,
    timestamp_timebase: { video_clock_mapping: 'coremedia_cmsync_v3' },
  }));
  assert.doesNotThrow(() => normalizeVideoImuCalibration({
    deviceModel: 'iPhone13,1',
    cameraType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
    videoToImuOffsetMs: -4,
    quality: 'good',
  }, {
    ...source,
    timestamp_timebase: {
      video_clock_model_schema: 'rootlens.camera_imu_clock_model.v1',
    },
  }));
  assert.throws(() => normalizeVideoImuCalibration({
    deviceModel: 'iPhone16,1', videoToImuOffsetMs: 0, quality: 'good',
  }, source), /端末/);
  assert.throws(() => normalizeVideoImuCalibration({
    deviceModel: 'iPhone13,1', videoToImuOffsetMs: 0, quality: 'review',
  }, source), /quality=good/);
  assert.throws(() => normalizeVideoImuCalibration(null, {
    ...source,
    recording_config: 'iphone',
    capture_configuration: {
      video_to_imu_offset_ns: 0,
      video_to_imu_calibration: { source: 'unmeasured_zero_default', quality: null },
    },
  }), /--calibration/);
});

async function makeFixture(root) {
  const fixtureDuration = Number(process.env.CLARU_FIXTURE_DURATION ?? 6);
  const source = path.join(root, 'rec-fixture');
  await fs.mkdir(source, { recursive: true });
  const video = path.join(source, 'rgb.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=10:duration=${fixtureDuration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${fixtureDuration}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '10', '-bf', '0',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart',
    video,
  ]);
  const [media, packets] = await Promise.all([probeMedia(video), probeVideoPackets(video)]);
  const baseNs = 10_000_000_000;
  const imuCountPerSensor = Math.ceil((fixtureDuration + 1) * 100);
  const imuLines = [];
  for (let index = 0; index < imuCountPerSensor; index += 1) {
    const timestampNs = baseNs + index * 10_000_000;
    imuLines.push(JSON.stringify({ sensor: 'accelerometer', sample_index: index, timestamp_ns: timestampNs, receipt_system_uptime_ns: timestampNs + 1000, accuracy: null, x: 0, y: 9.80665, z: 0 }));
    imuLines.push(JSON.stringify({ sensor: 'gyroscope', sample_index: index, timestamp_ns: timestampNs, receipt_system_uptime_ns: timestampNs + 1000, accuracy: null, x: 0, y: 0, z: 0 }));
  }
  await fs.writeFile(path.join(source, 'imu.jsonl'), `${imuLines.join('\n')}\n`);
  const frameLines = packets.map((packet, index) => {
    const timestampNs = baseNs + Math.round(packet.ptsSeconds * 1e9);
    const before = Math.max(0, Math.floor(packet.ptsSeconds * 100));
    const after = Math.min(imuCountPerSensor - 1, before + 1);
    return JSON.stringify({
      frame_index: index,
      mp4_sample_index: index,
      mp4_pts_ns: Math.round(packet.ptsSeconds * 1e9),
      mp4_sample_size_bytes: null,
      mp4_key_frame: null,
      timestamp_ns: timestampNs,
      video_frame_timestamp_system_uptime_ns: timestampNs,
      video_frame_timestamp_source: 'CMSampleBuffer.presentationTimeStamp',
      camera_result_present: true,
      camera_result_index: index,
      camera_sensor_timestamp_ns: timestampNs,
      camera_timestamp_mapped_system_uptime_ns: timestampNs,
      camera_to_system_uptime_offset_ns: 0,
      video_to_imu_offset_ns: 0,
      imu_association_timestamp_ns: timestampNs,
      accelerometer_before_index: before,
      accelerometer_before_timestamp_ns: baseNs + before * 10_000_000,
      accelerometer_after_index: after,
      accelerometer_after_timestamp_ns: baseNs + after * 10_000_000,
      gyroscope_before_index: before,
      gyroscope_before_timestamp_ns: baseNs + before * 10_000_000,
      gyroscope_after_index: after,
      gyroscope_after_timestamp_ns: baseNs + after * 10_000_000,
    });
  });
  await fs.writeFile(path.join(source, 'frames.jsonl'), `${frameLines.join('\n')}\n`);
  await fs.writeFile(path.join(source, 'metadata.json'), `${JSON.stringify({
    schema: 'rootlens.iphone.raw.v1',
    recording_config: 'iphone',
    created_at: '2026-08-25T00:00:00.000Z',
    stopped_at: new Date(Date.parse('2026-08-25T00:00:00.000Z') + fixtureDuration * 1000).toISOString(),
    actual_duration_ms: Math.round(media.durationSeconds * 1000),
    device_model: 'iPhone13,1',
    video: { mime: 'video/avc', width: 320, height: 180, frame_rate: 10, bit_depth: 8, hdr: false },
    audio: { mime: 'audio/mp4a-latm', sample_rate_hz: 48_000, channel_count: 1, bitrate_bps: 96_000 },
    video_frame_count: packets.length,
    accelerometer_sample_count: imuCountPerSensor,
    gyroscope_sample_count: imuCountPerSensor,
    video_append_failure_count: 0,
    audio_append_failure_count: 0,
    audio_sample_count: 1,
    capture_configuration: { width: 320, height: 180, fps: 10, codec: 'video/avc', audio: true, orientation: 'landscape', imu_rate_hz: 100 },
    timestamp_timebase: { unit: 'nanoseconds', clock: 'system_uptime', video_source: 'CMSampleBuffer.presentationTimeStamp', video_source_clock: 'AVCaptureSession.synchronizationClock', video_mapped_field: 'camera_timestamp_mapped_system_uptime_ns', video_mapped_clock: 'CMClockGetHostTimeClock/system_uptime', video_clock_mapping: 'coremedia_cmsync_v1', imu_source: 'Core Motion', raw_timestamps_modified: false },
    camera: { lens: 'ultra_wide' },
    files: ['rgb.mp4', 'frames.jsonl', 'imu.jsonl', 'metadata.json'],
  }, null, 2)}\n`);
  return { source, media, packets, baseNs, imuCountPerSensor };
}

test('canonical clock copy keeps raw bytes/timestamps and uses the common schema', { timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claru-clock-copy-test-'));
  t.after(() => process.env.KEEP_CLARU_FIXTURE ? undefined : fs.rm(root, { recursive: true, force: true }));
  const { source, packets, baseNs, imuCountPerSensor } = await makeFixture(root);
  const auditPath = path.join(root, 'clock-audit.json');
  const calibrationPath = path.join(root, 'calibration.json');
  const output = path.join(root, 'rec-fixture-canonical');
  await fs.writeFile(auditPath, `${JSON.stringify({
    schema: 'rootlens.camera_imu_clock_model.v1',
    kind: 'camera_to_imu_affine_clock_model_audit',
    source,
    source_files_modified: false,
    raw_timestamps_modified: false,
    mapping_method: 'post_capture_motion_signal_affine_estimation',
    offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
    frame_count: packets.length,
    gyro_count: imuCountPerSensor,
    source_observation: {
      first_camera_timestamp_ns: baseNs + Math.round(packets[0].ptsSeconds * 1e9),
      last_camera_timestamp_ns: baseNs + Math.round(packets.at(-1).ptsSeconds * 1e9),
      first_gyro_timestamp_ns: baseNs,
      last_gyro_timestamp_ns: baseNs + (imuCountPerSensor - 1) * 10_000_000,
    },
    clock_model: {
      model_type: 'affine',
      source_anchor_ns: baseNs,
      offset_at_source_anchor_ns: 0,
      target_rate_per_source_rate: 1,
      offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
      contains_sensor_validity_residual: true,
    },
    affine_fit: {
      offset_at_first_window_ms: 0,
      offset_slope_ms_per_second: 0,
      camera_to_imu_rate_correction_ppm: 0,
      max_window_fit_residual_ms: 0,
      window_fit_residuals_ms: [0, 0, 0],
    },
    quality: 'good',
  }, null, 2)}\n`);
  await fs.writeFile(calibrationPath, `${JSON.stringify({
    deviceModel: 'iPhone13,1',
    videoToImuOffsetMs: 0,
    quality: 'good',
    measuredAt: '2026-08-25T00:00:00Z',
  }, null, 2)}\n`);
  await run('python3', [
    path.resolve('scripts/canonicalize_camera_imu_clock.py'),
    source,
    '--audit', auditPath,
    '--calibration', calibrationPath,
    '--output', output,
  ]);
  assert.deepEqual((await fs.readdir(output)).sort(), ['frames.jsonl', 'imu.jsonl', 'metadata.json', 'rgb.mp4']);
  assert.deepEqual(await fs.readFile(path.join(output, 'rgb.mp4')), await fs.readFile(path.join(source, 'rgb.mp4')));
  assert.deepEqual(await fs.readFile(path.join(output, 'imu.jsonl')), await fs.readFile(path.join(source, 'imu.jsonl')));
  const sourceFirstFrame = JSON.parse((await fs.readFile(path.join(source, 'frames.jsonl'), 'utf8')).split('\n')[0]);
  const outputFirstFrame = JSON.parse((await fs.readFile(path.join(output, 'frames.jsonl'), 'utf8')).split('\n')[0]);
  assert.equal(outputFirstFrame.timestamp_ns, sourceFirstFrame.timestamp_ns);
  assert.equal(outputFirstFrame.video_frame_timestamp_canonical_ns, sourceFirstFrame.timestamp_ns);
  const metadata = JSON.parse(await fs.readFile(path.join(output, 'metadata.json'), 'utf8'));
  assert.equal(metadata.timestamp_timebase.video_clock_model_schema, 'rootlens.camera_imu_clock_model.v1');
  assert.equal(metadata.timestamp_timebase.video_clock_mapping, undefined);
  assert.equal(metadata.timestamp_timebase.mapping_method, undefined);
  assert.equal(metadata.canonicalization.mapping_method, undefined);
  assert.equal(metadata.canonicalization.source_files_modified, false);

  const diagnosticOutput = path.join(root, 'rec-fixture-diagnostic');
  await run('python3', [
    path.resolve('scripts/canonicalize_camera_imu_clock.py'),
    source,
    '--audit', auditPath,
    '--diagnostic-unsplit-total-alignment',
    '--output', diagnosticOutput,
  ]);
  const diagnosticMetadata = JSON.parse(
    await fs.readFile(path.join(diagnosticOutput, 'metadata.json'), 'utf8'),
  );
  assert.equal(diagnosticMetadata.canonicalization.delivery_eligible, false);
  assert.equal(diagnosticMetadata.diagnostic_validation.delivery_eligible, false);
  assert.equal(
    diagnosticMetadata.diagnostic_validation.alignment_kind,
    'unsplit_recording_level_camera_to_imu_total_alignment',
  );
  assert.equal(
    diagnosticMetadata.capture_configuration.video_to_imu_calibration.quality,
    'diagnostic_unsplit',
  );
  assert.equal(diagnosticMetadata.timestamp_timebase.clock_model_contains_sensor_validity_residual, true);
});

test('diagnostic unsplit alignment can export clips only with diagnostic lineage', { timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claru-diagnostic-export-test-'));
  t.after(() => process.env.KEEP_CLARU_FIXTURE ? undefined : fs.rm(root, { recursive: true, force: true }));
  const { source, packets, baseNs, imuCountPerSensor } = await makeFixture(root);
  const auditPath = path.join(root, 'clock-audit.json');
  await fs.writeFile(auditPath, `${JSON.stringify({
    schema: 'rootlens.camera_imu_clock_model.v1',
    kind: 'camera_to_imu_affine_clock_model_audit',
    source,
    source_files_modified: false,
    raw_timestamps_modified: false,
    mapping_method: 'post_capture_motion_signal_affine_estimation',
    offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
    frame_count: packets.length,
    gyro_count: imuCountPerSensor,
    source_observation: {
      first_camera_timestamp_ns: baseNs + Math.round(packets[0].ptsSeconds * 1e9),
      last_camera_timestamp_ns: baseNs + Math.round(packets.at(-1).ptsSeconds * 1e9),
      first_gyro_timestamp_ns: baseNs,
      last_gyro_timestamp_ns: baseNs + (imuCountPerSensor - 1) * 10_000_000,
    },
    clock_model: {
      model_type: 'affine',
      source_anchor_ns: baseNs,
      offset_at_source_anchor_ns: 0,
      target_rate_per_source_rate: 1,
      offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
      contains_sensor_validity_residual: true,
    },
    affine_fit: {
      offset_at_first_window_ms: 0,
      offset_slope_ms_per_second: 0,
      camera_to_imu_rate_correction_ppm: 0,
      max_window_fit_residual_ms: 0,
      window_fit_residuals_ms: [0, 0, 0],
    },
    quality: 'good',
  }, null, 2)}\n`);
  const diagnosticSource = path.join(root, 'rec-fixture-diagnostic');
  await run('python3', [
    path.resolve('scripts/canonicalize_camera_imu_clock.py'),
    source,
    '--audit', auditPath,
    '--diagnostic-unsplit-total-alignment',
    '--output', diagnosticSource,
  ]);
  const keyframes = await probeKeyframes(path.join(diagnosticSource, 'rgb.mp4'));
  const result = await exportSegments({
    sourceDir: diagnosticSource,
    keyframes,
    segments: [{ label: 'clip-001', startSeconds: 1.2, endSeconds: 4.8 }],
    outputBase: path.join(root, 'out'),
    minDurationSeconds: 1,
  });
  assert.match(
    path.basename(result.outputRoot),
    /^RootLens-Claru-NOT-FOR-DELIVERY-DIAGNOSTIC-/,
  );
  const metadata = JSON.parse(
    await fs.readFile(path.join(result.clips[0].folder, 'metadata.json'), 'utf8'),
  );
  assert.equal(metadata.diagnostic_validation.delivery_eligible, false);
  assert.equal(metadata.capture_configuration.video_to_imu_calibration.quality, 'diagnostic_unsplit');
  assert.equal(metadata.segmentation.video_to_imu_association_recomputed, true);
});

test('a good recording-level combined model exports delivery clips without a long RGB copy', { timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claru-combined-model-export-test-'));
  t.after(() => process.env.KEEP_CLARU_FIXTURE ? undefined : fs.rm(root, { recursive: true, force: true }));
  const { source, packets, baseNs, imuCountPerSensor } = await makeFixture(root);
  const audit = {
    schema: 'rootlens.camera_imu_clock_model.v1',
    kind: 'camera_to_imu_affine_clock_model_audit',
    source,
    source_files_modified: false,
    raw_timestamps_modified: false,
    mapping_method: 'post_capture_motion_signal_affine_estimation',
    offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
    frame_count: packets.length,
    gyro_count: imuCountPerSensor,
    source_observation: {
      first_camera_timestamp_ns: baseNs + Math.round(packets[0].ptsSeconds * 1e9),
      last_camera_timestamp_ns: baseNs + Math.round(packets.at(-1).ptsSeconds * 1e9),
      first_gyro_timestamp_ns: baseNs,
      last_gyro_timestamp_ns: baseNs + (imuCountPerSensor - 1) * 10_000_000,
    },
    clock_model: {
      model_type: 'affine',
      source_anchor_ns: baseNs,
      offset_at_source_anchor_ns: 0,
      target_rate_per_source_rate: 1,
      offset_convention: 'imu_event_timestamp_minus_video_event_timestamp',
      contains_sensor_validity_residual: true,
    },
    affine_fit: {
      offset_at_first_window_ms: 0,
      offset_slope_ms_per_second: 0,
      camera_to_imu_rate_correction_ppm: 0,
      max_window_fit_residual_ms: 0,
      window_fit_residuals_ms: [0, 0, 0],
    },
    quality: 'good',
  };
  const keyframes = await probeKeyframes(path.join(source, 'rgb.mp4'));
  const result = await exportSegments({
    sourceDir: source,
    keyframes,
    segments: [{ label: 'clip-001', startSeconds: 1.2, endSeconds: 4.8 }],
    outputBase: path.join(root, 'out'),
    minDurationSeconds: 1,
    videoClockAudit: audit,
  });
  assert.match(path.basename(result.outputRoot), /^RootLens-Claru-DELIVERY-/);
  const folder = result.clips[0].folder;
  const metadata = JSON.parse(await fs.readFile(path.join(folder, 'metadata.json'), 'utf8'));
  assert.equal(metadata.timestamp_timebase.video_clock_model_schema, 'rootlens.camera_imu_clock_model.v1');
  assert.equal(metadata.timestamp_timebase.clock_model_contains_sensor_validity_residual, undefined);
  assert.equal(metadata.timestamp_timebase.mapping_method, undefined);
  assert.equal(metadata.timestamp_timebase.clock_model_quality, undefined);
  assert.equal(metadata.timestamp_timebase.clock_model_affine_fit, undefined);
  assert.equal(metadata.camera_imu_model, undefined);
  assert.equal(metadata.capture_configuration.video_to_imu_offset_ns, 0);
  assert.equal(metadata.capture_configuration.video_to_imu_calibration, undefined);
  assert.equal(metadata.segmentation.video_to_imu_association_recomputed, true);
  const firstFrame = JSON.parse((await fs.readFile(path.join(folder, 'frames.jsonl'), 'utf8')).split('\n')[0]);
  assert.equal(firstFrame.timestamp_ns, firstFrame.video_frame_timestamp_canonical_ns);
  assert.equal(firstFrame.imu_association_timestamp_ns, firstFrame.video_frame_timestamp_canonical_ns);
  assert.equal(firstFrame.mapping_quality, undefined);
  assert.equal(firstFrame.video_frame_timestamp_system_uptime_ns, undefined);
  assert.equal(firstFrame.camera_timestamp_mapped_system_uptime_ns, undefined);
  assert.equal(firstFrame.camera_to_system_uptime_offset_ns, undefined);
});

test('integration: lossless interval becomes a validated four-file R2-style clip', { timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claru-cutter-test-'));
  t.after(() => process.env.KEEP_CLARU_FIXTURE ? undefined : fs.rm(root, { recursive: true, force: true }));
  const { source } = await makeFixture(root);
  const keyframes = await probeKeyframes(path.join(source, 'rgb.mp4'));
  const result = await exportSegments({
    sourceDir: source,
    keyframes,
    segments: [{ label: 'ライン調理', startSeconds: 1.2, endSeconds: 4.8 }],
    outputBase: path.join(root, 'out'),
    minDurationSeconds: 1,
    videoImuCalibration: {
      deviceModel: 'iPhone13,1',
      videoToImuOffsetMs: 20,
      quality: 'good',
      measuredAt: '2026-08-25T00:10:00Z',
      peakCorrelation: 0.9,
      standardDeviationMs: 1.5,
      algorithmVersion: 3,
    },
  });
  assert.equal(result.clips.length, 1);
  const clip = result.clips[0];
  assert.match(path.basename(clip.folder), /^[a-f0-9]{64}$/);
  assert.equal(path.basename(path.dirname(clip.folder)), 'raw');
  assert.deepEqual(await fs.readdir(result.outputRoot), ['raw']);
  assert.deepEqual(await fs.readdir(path.join(result.outputRoot, 'raw')), [path.basename(clip.folder)]);
  assert.deepEqual((await fs.readdir(clip.folder)).sort(), ['frames.jsonl', 'imu.jsonl', 'metadata.json', 'rgb.mp4']);
  const metadata = JSON.parse(await fs.readFile(path.join(clip.folder, 'metadata.json'), 'utf8'));
  assert.equal(metadata.content_hash, path.basename(clip.folder));
  assert.equal(metadata.segmentation.internal_cuts, 0);
  assert.equal(metadata.segmentation.video_reencoded, false);
  assert.equal(metadata.segmentation.raw_imu_timestamps_modified, false);
  assert.equal(metadata.segmentation.video_to_imu_association_recomputed, true);
  assert.equal(metadata.task_label, undefined);
  assert.equal(metadata.capture_configuration.video_to_imu_offset_ns, 20_000_000);
  assert.equal(metadata.capture_configuration.video_to_imu_calibration.measured_at, '2026-08-25T00:10:00Z');
  const firstFrame = JSON.parse((await fs.readFile(path.join(clip.folder, 'frames.jsonl'), 'utf8')).split('\n')[0]);
  assert.equal(firstFrame.video_to_imu_offset_ns, 20_000_000);
  assert.equal(
    firstFrame.imu_association_timestamp_ns,
    firstFrame.camera_timestamp_mapped_system_uptime_ns + 20_000_000);
  const validation = await validateClipFolder(clip.folder);
  assert.equal(validation.contentHash, metadata.content_hash);
  assert.equal(validation.frameCount, metadata.video_frame_count);
  if (process.env.KEEP_CLARU_FIXTURE) process.stdout.write(`fixture=${source}\n`);
});
