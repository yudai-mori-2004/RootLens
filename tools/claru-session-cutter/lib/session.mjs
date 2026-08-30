import fs from 'node:fs/promises';
import path from 'node:path';

import { run, streamLines } from './process.mjs';

export const REQUIRED_FILES = ['rgb.mp4', 'frames.jsonl', 'imu.jsonl', 'metadata.json'];

function parseRate(value) {
  if (!value || value === '0/0') return 0;
  const [a, b = '1'] = value.split('/').map(Number);
  return b ? a / b : 0;
}

export async function assertSourceSession(sourceDir) {
  const resolved = path.resolve(sourceDir);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`収録フォルダが見つかりません: ${resolved}`);
  for (const name of REQUIRED_FILES) {
    const info = await fs.stat(path.join(resolved, name)).catch(() => null);
    if (!info?.isFile() || info.size === 0) throw new Error(`必須ファイルがありません: ${name}`);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(resolved, 'metadata.json'), 'utf8'));
  if (metadata.recording_config !== 'iphone') {
    throw new Error(`iPhone RGB+IMU収録ではありません: ${metadata.recording_config ?? 'unknown'}`);
  }
  if (metadata.timestamp_timebase?.raw_timestamps_modified !== false) {
    throw new Error('metadataがraw timestamp非改変を証明していません');
  }
  return { sourceDir: resolved, metadata };
}

export async function probeMedia(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels',
    '-of', 'json',
    file,
  ]);
  const value = JSON.parse(stdout);
  const video = value.streams?.find((stream) => stream.codec_type === 'video');
  const audio = value.streams?.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error('rgb.mp4にvideo trackがありません');
  if (!audio) throw new Error('rgb.mp4にaudio trackがありません');
  return {
    durationSeconds: Number(value.format?.duration ?? 0),
    sizeBytes: Number(value.format?.size ?? 0),
    video: {
      codec: video.codec_name,
      width: Number(video.width),
      height: Number(video.height),
      fps: parseRate(video.avg_frame_rate),
    },
    audio: {
      codec: audio.codec_name,
      sampleRate: Number(audio.sample_rate),
      channels: Number(audio.channels),
    },
  };
}

export async function probeKeyframes(file) {
  const keyframes = [];
  await streamLines('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-skip_frame', 'nokey',
    '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time',
    '-of', 'csv=p=0',
    file,
  ], (line) => {
    const value = Number(line.trim().split(',')[0]);
    if (Number.isFinite(value)) keyframes.push(value);
  });
  if (keyframes.length === 0) throw new Error('H.264 keyframeを検出できません');
  return keyframes;
}

export async function probeVideoPackets(file) {
  const packets = [];
  await streamLines('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_packets',
    '-show_entries', 'packet=pts_time,size,flags',
    '-of', 'csv=p=0',
    file,
  ], (line) => {
    const parts = line.trim().split(',');
    const ptsSeconds = Number(parts[0]);
    const sizeBytes = Number(parts[1]);
    const flags = parts[2] ?? '';
    if (Number.isFinite(ptsSeconds)) {
      packets.push({ ptsSeconds, sizeBytes, keyFrame: flags.includes('K') });
    }
  });
  if (packets.length === 0) throw new Error(`video packetを検出できません: ${file}`);
  return packets;
}

export async function countAudioPackets(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-count_packets',
    '-show_entries', 'stream=nb_read_packets',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const value = Number(stdout.trim());
  if (!Number.isInteger(value) || value <= 0) throw new Error('audio packet数を検出できません');
  return value;
}

export async function loadSessionSummary(sourceDir) {
  const { sourceDir: resolved, metadata } = await assertSourceSession(sourceDir);
  const videoPath = path.join(resolved, 'rgb.mp4');
  const [media, keyframes] = await Promise.all([probeMedia(videoPath), probeKeyframes(videoPath)]);
  if (media.video.codec !== 'h264') throw new Error(`H.264ではありません: ${media.video.codec}`);
  return {
    ready: true,
    sourceDir: resolved,
    sourceName: path.basename(resolved),
    media,
    keyframes,
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
