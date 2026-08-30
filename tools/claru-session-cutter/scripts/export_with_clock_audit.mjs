#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { exportSegments } from '../lib/exporter.mjs';
import { loadSessionSummary } from '../lib/session.mjs';

function argument(name, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && !value) throw new Error(`${name}を指定してください`);
  return value;
}

const sourceDir = path.resolve(argument('--source'));
const boundariesPath = path.resolve(argument('--boundaries'));
const auditPath = path.resolve(argument('--clock-audit'));
const outputBase = path.resolve(argument('--output-base'));

const [session, boundaries, audit] = await Promise.all([
  loadSessionSummary(sourceDir),
  fs.readFile(boundariesPath, 'utf8').then(JSON.parse),
  fs.readFile(auditPath, 'utf8').then(JSON.parse),
]);

let lastProgressKey = '';
let lastProgressBucket = -1;

const result = await exportSegments({
  sourceDir,
  segments: boundaries.segments,
  keyframes: session.keyframes,
  outputBase,
  videoClockAudit: audit,
  onProgress(value) {
    const key = `${value.phase}:${value.clipIndex ?? ''}:${value.label ?? ''}`;
    const bucket = Math.floor(Math.max(0, Math.min(1, Number(value.progress ?? 0))) * 20);
    if (key === lastProgressKey && bucket === lastProgressBucket) return;
    lastProgressKey = key;
    lastProgressBucket = bucket;
    process.stdout.write(`${JSON.stringify({ event: 'progress', ...value })}\n`);
  },
});

process.stdout.write(`${JSON.stringify({ event: 'complete', ...result }, null, 2)}\n`);
