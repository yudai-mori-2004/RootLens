import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundaryCheckpointPath,
  loadBoundaryCheckpoint,
  saveBoundaryCheckpoint,
} from './lib/boundaries.mjs';
import { exportSegments } from './lib/exporter.mjs';
import { run } from './lib/process.mjs';
import { loadSessionSummary } from './lib/session.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(TOOL_DIR, 'public');
const HOST = '127.0.0.1';
const DELIVERY_TARGET_SECONDS = 5 * 60 * 60;
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const sourceArg = args.indexOf('--source');
const outputArg = args.indexOf('--output');
const calibrationArg = args.indexOf('--calibration');
const boundaryDirArg = args.indexOf('--boundary-dir');
const clockAuditDirArg = args.indexOf('--clock-audit-dir');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4318;
const outputBase = outputArg >= 0 ? path.resolve(args[outputArg + 1]) : undefined;
const boundaryDir = boundaryDirArg >= 0
  ? path.resolve(args[boundaryDirArg + 1])
  : path.join(TOOL_DIR, 'boundaries');
const clockAuditDir = clockAuditDirArg >= 0
  ? path.resolve(args[clockAuditDirArg + 1])
  : path.resolve(TOOL_DIR, '../../tmp/claru-clock-audits');
const videoImuCalibration = calibrationArg >= 0
  ? JSON.parse(await fs.readFile(path.resolve(args[calibrationArg + 1]), 'utf8'))
  : undefined;

let session = null;
let exportJob = { status: 'idle', progress: null, result: null, error: null };

function clockAuditPath(sourceName) {
  return path.join(clockAuditDir, `${sourceName}.clock-model.audit.json`);
}

async function loadClockAudit(currentSession) {
  const file = clockAuditPath(currentSession.sourceName);
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    const auditedSourceName = path.basename(value.source ?? '');
    if (auditedSourceName && auditedSourceName !== currentSession.sourceName) {
      throw new Error(`clock auditの原本が一致しません: ${auditedSourceName}`);
    }
    return { file, value };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function completedBoundarySeconds(excludedSourceName) {
  const entries = await fs.readdir(boundaryDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.boundaries.json')) continue;
    const checkpoint = JSON.parse(await fs.readFile(path.join(boundaryDir, entry.name), 'utf8'));
    if (checkpoint.source?.directory_name === excludedSourceName) continue;
    for (const segment of checkpoint.segments ?? []) {
      const start = Number(segment.startSeconds);
      const end = Number(segment.endSeconds);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start;
    }
  }
  return total;
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error('requestが大きすぎます');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function setSource(sourceDir) {
  const nextSession = await loadSessionSummary(sourceDir);
  const saved = await loadBoundaryCheckpoint(boundaryDir, nextSession);
  const audit = await loadClockAudit(nextSession);
  const completedOtherSeconds = await completedBoundarySeconds(nextSession.sourceName);
  session = {
    ...nextSession,
    boundaries: saved?.checkpoint.segments ?? null,
    boundaryCheckpoint: {
      exists: Boolean(saved),
      path: saved?.path ?? boundaryCheckpointPath(boundaryDir, nextSession),
      checksum: saved?.checksum ?? null,
    },
    clockAudit: {
      exists: Boolean(audit),
      path: audit?.file ?? clockAuditPath(nextSession.sourceName),
      quality: audit?.value?.quality ?? null,
    },
    deliveryProgress: {
      targetSeconds: DELIVERY_TARGET_SECONDS,
      completedOtherSeconds,
    },
  };
  exportJob = { status: 'idle', progress: null, result: null, error: null };
  return session;
}

async function chooseSource() {
  const script = 'POSIX path of (choose folder with prompt "RootLensの長時間収録フォルダを選択")';
  const { stdout } = await run('osascript', ['-e', script]);
  return setSource(stdout.trim().replace(/\/$/, ''));
}

function serveVideo(request, response) {
  if (!session) return json(response, 404, { error: '収録フォルダが未選択です' });
  const file = path.join(session.sourceDir, 'rgb.mp4');
  const stat = fsSync.statSync(file);
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    fsSync.createReadStream(file).pipe(response);
    return;
  }
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) return json(response, 416, { error: 'Rangeが不正です' });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (start > end || start >= stat.size) {
    response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  fsSync.createReadStream(file, { start, end }).pipe(response);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(urlPath, response) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    return json(response, 403, { error: 'forbidden' });
  }
  const data = await fs.readFile(file).catch(() => null);
  if (!data) return json(response, 404, { error: 'not found' });
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/session') {
      return json(response, 200, session ?? { ready: false });
    }
    if (request.method === 'POST' && url.pathname === '/api/source') {
      const body = await readJson(request);
      return json(response, 200, await setSource(body.path));
    }
    if (request.method === 'POST' && url.pathname === '/api/choose-source') {
      return json(response, 200, await chooseSource());
    }
    if (request.method === 'POST' && url.pathname === '/api/boundaries') {
      if (!session) return json(response, 400, { error: '収録フォルダが未選択です' });
      const body = await readJson(request);
      if (body.sourceName !== session.sourceName) {
        return json(response, 409, { error: '境界保存中に収録が切り替わりました。現在の収録で再保存してください' });
      }
      const saved = await saveBoundaryCheckpoint(boundaryDir, session, body.segments);
      session.boundaries = saved.checkpoint.segments;
      session.boundaryCheckpoint = {
        exists: true,
        path: saved.path,
        checksum: saved.checksum,
      };
      return json(response, 200, {
        ok: true,
        path: saved.path,
        historyPath: saved.historyPath,
        checksum: saved.checksum,
        savedAt: saved.checkpoint.saved_at,
        segmentCount: saved.checkpoint.segment_count,
      });
    }
    if (request.method === 'GET' && url.pathname === '/media/rgb.mp4') {
      return serveVideo(request, response);
    }
    if (request.method === 'GET' && url.pathname === '/api/export-status') {
      return json(response, 200, exportJob);
    }
    if (request.method === 'POST' && url.pathname === '/api/export') {
      if (!session) return json(response, 400, { error: '収録フォルダが未選択です' });
      if (exportJob.status === 'running') return json(response, 409, { error: '書き出し中です' });
      const body = await readJson(request);
      const audit = await loadClockAudit(session);
      exportJob = { status: 'running', progress: { phase: 'queued', progress: 0 }, result: null, error: null };
      void exportSegments({
        sourceDir: session.sourceDir,
        segments: body.segments,
        keyframes: session.keyframes,
        outputBase,
        videoImuCalibration,
        videoClockAudit: audit?.value,
        onProgress(progress) {
          exportJob = { ...exportJob, progress };
        },
      }).then((result) => {
        exportJob = { status: 'complete', progress: { phase: 'complete', progress: 1 }, result, error: null };
      }).catch((error) => {
        exportJob = { status: 'error', progress: exportJob.progress, result: null, error: error.message };
      });
      return json(response, 202, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/reveal-output') {
      const target = exportJob.result?.outputRoot;
      if (!target) return json(response, 400, { error: '完成フォルダがありません' });
      await run('open', ['-R', target]);
      return json(response, 200, { ok: true });
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

if (sourceArg >= 0) {
  await setSource(args[sourceArg + 1]);
}

server.listen(PORT, HOST, () => {
  process.stdout.write(`RootLens Claru Cut Desk: http://${HOST}:${PORT}\n`);
  if (session) process.stdout.write(`Source: ${session.sourceDir}\n`);
});
