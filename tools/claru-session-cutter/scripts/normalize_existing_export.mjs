#!/usr/bin/env node

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('export rootを指定してください');

const rawRoot = path.join(root, 'raw');
const entries = (await fs.readdir(rawRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
if (entries.length === 0) throw new Error(`clipがありません: ${rawRoot}`);

function normalizedFrame(row) {
  const value = { ...row };
  delete value.video_frame_timestamp_system_uptime_ns;
  delete value.camera_timestamp_mapped_system_uptime_ns;
  delete value.camera_to_system_uptime_offset_ns;
  delete value.camera_timestamp_legacy_unmapped_ns;
  delete value.mapping_quality;
  return value;
}

function normalizedMetadata(metadata) {
  const value = structuredClone(metadata);
  delete value.camera_imu_model;
  const timebase = value.timestamp_timebase;
  if (!timebase?.clock_model || !timebase.video_clock_model_schema) {
    throw new Error('canonical clock modelがありません');
  }
  delete timebase.canonical_timestamps_derived;
  delete timebase.clock_model_quality;
  delete timebase.clock_model_affine_fit;
  delete timebase.clock_model_contains_sensor_validity_residual;
  delete timebase.mapping_method;

  delete value.capture_configuration?.video_to_imu_calibration;
  return value;
}

async function rewriteFrames(file) {
  const temporary = `${file}.normalizing-${process.pid}`;
  const input = fsSync.createReadStream(file, { encoding: 'utf8' });
  const output = fsSync.createWriteStream(temporary, { encoding: 'utf8', flags: 'wx' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (!output.write(`${JSON.stringify(normalizedFrame(JSON.parse(line)))}\n`)) {
        await new Promise((resolve) => output.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });
    await fs.rename(temporary, file);
  } catch (error) {
    input.destroy();
    output.destroy();
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

for (const [index, entry] of entries.entries()) {
  const folder = path.join(rawRoot, entry.name);
  const names = (await fs.readdir(folder)).sort();
  const expected = ['frames.jsonl', 'imu.jsonl', 'metadata.json', 'rgb.mp4'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`manifest不一致: ${folder}`);
  }
  await rewriteFrames(path.join(folder, 'frames.jsonl'));
  const metadataFile = path.join(folder, 'metadata.json');
  const metadata = normalizedMetadata(JSON.parse(await fs.readFile(metadataFile, 'utf8')));
  await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'w' });
  process.stdout.write(`${JSON.stringify({ clip: index + 1, total: entries.length, content_hash: entry.name })}\n`);
}
