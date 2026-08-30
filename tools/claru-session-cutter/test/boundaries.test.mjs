import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  boundaryCheckpointPath,
  loadBoundaryCheckpoint,
  normalizeBoundarySegments,
  saveBoundaryCheckpoint,
} from '../lib/boundaries.mjs';

async function makeSource(root, name = 'rec-boundary-fixture') {
  const sourceDir = path.join(root, name);
  await fs.mkdir(sourceDir, { recursive: true });
  const metadata = {
    schema: 'rootlens.iphone.raw.v1',
    created_at: '2026-08-25T00:00:00Z',
    device_model: 'iPhone13,1',
    video_frame_count: 18_000,
    accelerometer_sample_count: 60_000,
    gyroscope_sample_count: 60_000,
  };
  await Promise.all([
    fs.writeFile(path.join(sourceDir, 'rgb.mp4'), 'video-bytes'),
    fs.writeFile(path.join(sourceDir, 'frames.jsonl'), '{"frame_index":0}\n'),
    fs.writeFile(path.join(sourceDir, 'imu.jsonl'), '{"sample_index":0}\n'),
    fs.writeFile(path.join(sourceDir, 'metadata.json'), `${JSON.stringify(metadata)}\n`),
  ]);
  return {
    sourceDir,
    sourceName: name,
    media: { durationSeconds: 600 },
    metadata: {
      schema: metadata.schema,
      createdAt: metadata.created_at,
      deviceModel: metadata.device_model,
      videoFrameCount: metadata.video_frame_count,
      accelerometerSampleCount: metadata.accelerometer_sample_count,
      gyroscopeSampleCount: metadata.gyroscope_sample_count,
    },
  };
}

test('boundary checkpoints are atomic, hashed, versioned, and source-bound', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claru-boundaries-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const session = await makeSource(root);
  const boundaryDir = path.join(root, 'repo-boundaries');
  const segments = [
    { id: 'a', label: 'clip-001', startSeconds: 10, endSeconds: 140 },
    { id: 'b', label: 'clip-002', startSeconds: 180, endSeconds: 320 },
  ];
  const saved = await saveBoundaryCheckpoint(
    boundaryDir,
    session,
    segments,
    new Date('2026-08-25T02:00:00Z'),
  );

  assert.equal(saved.path, boundaryCheckpointPath(boundaryDir, session));
  assert.equal(saved.checkpoint.segment_count, 2);
  assert.equal((await fs.readFile(`${saved.path}.sha256`, 'utf8')).split(/\s+/)[0], saved.checksum);
  assert.deepEqual((await loadBoundaryCheckpoint(boundaryDir, session)).checkpoint.segments, segments);
  assert.equal((await fs.readdir(path.dirname(saved.historyPath))).length, 1);

  await saveBoundaryCheckpoint(boundaryDir, session, [], new Date('2026-08-25T02:01:00Z'));
  assert.deepEqual((await loadBoundaryCheckpoint(boundaryDir, session)).checkpoint.segments, []);
  assert.equal((await fs.readdir(path.dirname(saved.historyPath))).length, 2);

  await fs.writeFile(path.join(session.sourceDir, 'metadata.json'), '{"changed":true}\n');
  await assert.rejects(loadBoundaryCheckpoint(boundaryDir, session), /metadata SHA-256/);
});

test('boundary validation rejects short, overlapping, and out-of-range segments', () => {
  assert.throws(
    () => normalizeBoundarySegments([{ label: 'clip-001', startSeconds: 0, endSeconds: 119 }], 600),
    /120秒未満/,
  );
  assert.throws(
    () => normalizeBoundarySegments([
      { label: 'clip-001', startSeconds: 0, endSeconds: 130 },
      { label: 'clip-002', startSeconds: 120, endSeconds: 260 },
    ], 600),
    /重複/,
  );
  assert.throws(
    () => normalizeBoundarySegments([{ label: 'clip-001', startSeconds: 500, endSeconds: 700 }], 600),
    /収録範囲外/,
  );
});
