const $ = (selector) => document.querySelector(selector);

const elements = {
  workspace: $('#workspace'), sourceGate: $('#sourceGate'), chooseSource: $('#chooseSource'), enterPath: $('#enterPath'),
  changeSource: $('#changeSource'), gateError: $('#gateError'), sessionChip: $('#sessionChip'), sessionName: $('#sessionName'),
  video: $('#video'), timecode: $('#timecode'),
  shuttleIndicator: $('#shuttleIndicator'), scrubber: $('#scrubber'), timeline: $('#timeline'), segmentLayer: $('#segmentLayer'),
  draftRange: $('#draftRange'), durationLabel: $('#durationLabel'), forwardRate: $('#forwardRate'),
  playToggle: $('#playToggle'), playIcon: $('#playIcon'),
  startInput: $('#startInput'), endInput: $('#endInput'), markStart: $('#markStart'), markEnd: $('#markEnd'), snapReport: $('#snapReport'),
  draftDuration: $('#draftDuration'), draftStatus: $('#draftStatus'), addClip: $('#addClip'),
  clipList: $('#clipList'), clipCount: $('#clipCount'), deliveryTotal: $('#deliveryTotal'), exportButton: $('#exportButton'), exportOverlay: $('#exportOverlay'), exportCard: $('#exportCard'),
  exportPhase: $('#exportPhase'), exportMessage: $('#exportMessage'), progressFill: $('#progressFill'), progressDetail: $('#progressDetail'),
  exportComplete: $('#exportComplete'), outputPath: $('#outputPath'), revealOutput: $('#revealOutput'), closeExport: $('#closeExport'),
  undoToast: $('#undoToast'), undoRemove: $('#undoRemove'),
};

let session = null;
let segments = [];
let draftStart = null;
let draftEnd = null;
let reverseFrame = null;
let reverseLastTime = 0;
let shuttle = null;
let shuttleRate = 2;
let lastPlaybackTime = 0;
let removedSegment = null;
let undoTimer = null;
let pollTimer = null;
let boundarySaveSequence = Promise.resolve();
let boundarySaveError = null;

const SEEK_PADDING_SECONDS = 0.05;

function formatTime(seconds, millis = true) {
  if (!Number.isFinite(seconds)) return '--:--:--';
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return millis ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

function parseTime(text) {
  const value = String(text ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) throw new Error('HH:MM:SS.mmm で入力してください');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (minutes >= 60 || seconds >= 60) throw new Error('時刻の範囲が不正です');
  return hours * 3600 + minutes * 60 + seconds;
}

function snapStart(seconds) {
  const values = session.keyframes;
  let low = 0; let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] <= seconds + 1e-6) low = mid + 1; else high = mid;
  }
  return values[Math.max(0, low - 1)];
}

function blockedSegmentAt(seconds) {
  return segments.find((segment) => seconds > segment.startSeconds + 1e-6 && seconds < segment.endSeconds - 1e-6) ?? null;
}

function availableTime(target, direction = 1) {
  const duration = session?.media.durationSeconds ?? 0;
  let resolved = Math.min(duration, Math.max(0, target));
  for (let index = 0; index <= segments.length; index += 1) {
    const blocked = blockedSegmentAt(resolved);
    if (!blocked) return resolved;
    if (direction < 0 && blocked.startSeconds > 0) resolved = Math.max(0, blocked.startSeconds - SEEK_PADDING_SECONDS);
    else if (direction >= 0 && blocked.endSeconds < duration) resolved = Math.min(duration, blocked.endSeconds + SEEK_PADDING_SECONDS);
    else if (blocked.startSeconds > 0) resolved = Math.max(0, blocked.startSeconds - SEEK_PADDING_SECONDS);
    else resolved = Math.min(duration, blocked.endSeconds + SEEK_PADDING_SECONDS);
  }
  return resolved;
}

function seekAvailable(target, direction) {
  const resolved = availableTime(target, direction);
  elements.video.currentTime = resolved;
  lastPlaybackTime = resolved;
  return resolved;
}

function nextClipLabel() {
  const used = new Set(segments.map((segment) => segment.label));
  let sequence = 1;
  while (used.has(`clip-${String(sequence).padStart(3, '0')}`)) sequence += 1;
  return `clip-${String(sequence).padStart(3, '0')}`;
}

function storageKey() { return `rootlens-claru-boundaries:${session.sourceDir}`; }
function saveSegments() {
  const sourceName = session.sourceName;
  const snapshot = segments.map((segment) => ({ ...segment }));
  localStorage.setItem(storageKey(), JSON.stringify(snapshot));
  boundarySaveSequence = boundarySaveSequence.catch(() => undefined).then(async () => {
    const result = await api('/api/boundaries', {
      method: 'POST',
      body: JSON.stringify({ sourceName, segments: snapshot }),
    });
    boundarySaveError = null;
    if (session?.sourceName === sourceName) elements.sessionName.title = `境界保存済み: ${result.path}`;
    return result;
  }).catch((error) => {
    boundarySaveError = error;
    if (session?.sourceName === sourceName) {
      elements.draftStatus.textContent = `境界ファイル保存失敗: ${error.message}`;
      elements.draftStatus.className = 'bad';
    }
  });
  return boundarySaveSequence;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function loadSession(value) {
  session = value;
  elements.sourceGate.hidden = true;
  elements.workspace.hidden = false;
  elements.sessionChip.classList.add('ready');
  elements.sessionName.textContent = `${value.sourceName} · ${value.metadata.deviceModel ?? 'iPhone'}`;
  elements.durationLabel.textContent = formatTime(value.media.durationSeconds, false);
  elements.scrubber.max = String(value.media.durationSeconds);
  elements.video.src = `/media/rgb.mp4?v=${Date.now()}`;
  if (Array.isArray(value.boundaries)) {
    segments = value.boundaries;
  } else {
    try { segments = JSON.parse(localStorage.getItem(storageKey()) ?? '[]'); } catch { segments = []; }
    void saveSegments();
  }
  draftStart = null; draftEnd = null;
  lastPlaybackTime = 0;
  shuttleRate = 2;
  elements.forwardRate.textContent = `${shuttleRate}×`;
  elements.startInput.value = ''; elements.endInput.value = '';
  renderAll();
}

async function chooseFolder() {
  elements.gateError.textContent = '';
  elements.chooseSource.disabled = true;
  try { loadSession(await api('/api/choose-source', { method: 'POST' })); }
  catch (error) { elements.gateError.textContent = error.message; }
  finally { elements.chooseSource.disabled = false; }
}

async function enterPath() {
  const value = window.prompt('収録フォルダの絶対パス');
  if (!value) return;
  elements.gateError.textContent = '';
  try { loadSession(await api('/api/source', { method: 'POST', body: JSON.stringify({ path: value }) })); }
  catch (error) { elements.gateError.textContent = error.message; elements.sourceGate.hidden = false; }
}

function updatePlaybackUI() {
  let current = elements.video.currentTime || 0;
  if (blockedSegmentAt(current)) {
    const direction = shuttle?.direction ?? (current < lastPlaybackTime ? -1 : 1);
    current = seekAvailable(current, direction);
  } else {
    lastPlaybackTime = current;
  }
  const duration = session?.media.durationSeconds || 1;
  elements.timecode.textContent = formatTime(current);
  elements.scrubber.value = String(current);
  elements.timeline.style.setProperty('--playhead', `${current / duration * 100}%`);
  const paused = elements.video.paused;
  elements.playIcon.textContent = paused ? '▶' : 'Ⅱ';
}

function setMark(kind) {
  const value = availableTime(elements.video.currentTime, 1);
  if (kind === 'start') {
    draftStart = value; elements.startInput.value = formatTime(value);
  } else {
    draftEnd = value; elements.endInput.value = formatTime(value);
  }
  const input = kind === 'start' ? elements.startInput : elements.endInput;
  input.removeAttribute('aria-invalid');
  renderDraft();
}

function syncInput(kind) {
  const input = kind === 'start' ? elements.startInput : elements.endInput;
  try {
    const value = parseTime(input.value);
    if (value < 0 || value > session.media.durationSeconds) throw new Error('動画の範囲外です');
    if (blockedSegmentAt(value)) throw new Error('登録済み区間です');
    if (kind === 'start') draftStart = value; else draftEnd = value;
    input.value = formatTime(value);
    input.removeAttribute('aria-invalid');
    renderDraft();
  } catch (error) {
    input.setAttribute('aria-invalid', 'true');
    elements.draftStatus.textContent = error.message;
    elements.draftStatus.className = 'bad';
  }
}

function renderDraft() {
  const duration = draftStart != null && draftEnd != null ? draftEnd - draftStart : null;
  const overlaps = duration > 0 && segments.some((segment) => draftStart < segment.endSeconds - .001 && draftEnd > segment.startSeconds + .001);
  elements.draftDuration.textContent = duration == null ? '未設定' : formatTime(duration);
  elements.draftStatus.className = '';
  if (duration == null) elements.draftStatus.textContent = '—';
  else if (duration <= 0) { elements.draftStatus.textContent = '終了が開始以前'; elements.draftStatus.className = 'bad'; }
  else if (duration < 120) { elements.draftStatus.textContent = '2分未満'; elements.draftStatus.className = 'bad'; }
  else if (overlaps) { elements.draftStatus.textContent = '登録済み区間と重複'; elements.draftStatus.className = 'bad'; }
  else { elements.draftStatus.textContent = '登録可'; elements.draftStatus.className = 'ok'; }
  elements.addClip.disabled = duration == null || duration < 120 || overlaps;
  const total = session?.media.durationSeconds || 1;
  if (duration > 0) {
    elements.draftRange.style.left = `${draftStart / total * 100}%`;
    elements.draftRange.style.width = `${duration / total * 100}%`;
  } else {
    elements.draftRange.style.width = '0';
  }
  if (draftStart != null) {
    const snapped = snapStart(draftStart);
    elements.snapReport.hidden = false;
    elements.snapReport.textContent = `実開始 ${formatTime(snapped)}`;
  } else {
    elements.snapReport.hidden = true;
    elements.snapReport.textContent = '';
  }
}

function renderSegments() {
  elements.clipCount.textContent = `${segments.length}件`;
  const currentSeconds = segments.reduce(
    (total, segment) => total + Math.max(0, segment.endSeconds - segment.startSeconds),
    0,
  );
  const targetSeconds = session?.deliveryProgress?.targetSeconds ?? 5 * 60 * 60;
  const completedSeconds = (session?.deliveryProgress?.completedOtherSeconds ?? 0) + currentSeconds;
  const remainingSeconds = Math.max(0, targetSeconds - completedSeconds);
  elements.deliveryTotal.textContent = completedSeconds >= targetSeconds
    ? `${formatTime(completedSeconds, false)} / ${formatTime(targetSeconds, false)} · 達成`
    : `${formatTime(completedSeconds, false)} / ${formatTime(targetSeconds, false)} · 残り ${formatTime(remainingSeconds, false)}`;
  elements.exportButton.disabled = segments.length === 0;
  elements.segmentLayer.innerHTML = '';
  const total = session?.media.durationSeconds || 1;
  for (const segment of segments) {
    const bar = document.createElement('div');
    bar.className = 'segment-bar';
    bar.style.left = `${segment.startSeconds / total * 100}%`;
    bar.style.width = `${(segment.endSeconds - segment.startSeconds) / total * 100}%`;
    elements.segmentLayer.append(bar);
  }
  if (segments.length === 0) {
    elements.clipList.innerHTML = '<div class="empty-clips">0</div>';
    return;
  }
  elements.clipList.innerHTML = segments.map((segment, index) => `
    <article class="clip-row" data-id="${segment.id}">
      <div class="clip-row-head">
        <span class="clip-sequence">CLIP ${String(index + 1).padStart(2, '0')}</span>
        <button data-action="remove">削除</button>
      </div>
      <div class="clip-range-track" aria-hidden="true"><span></span></div>
      <div class="clip-time"><span>${formatTime(segment.startSeconds)}</span><span>→</span><span>${formatTime(segment.endSeconds)}</span></div>
      <div class="clip-duration">${formatTime(segment.endSeconds - segment.startSeconds)}</div>
    </article>`).join('');
  [...elements.clipList.querySelectorAll('.clip-row')].forEach((row, index) => {
    const segment = segments[index];
    const bar = row.querySelector('.clip-range-track span');
    bar.style.left = `${segment.startSeconds / total * 100}%`;
    bar.style.width = `${(segment.endSeconds - segment.startSeconds) / total * 100}%`;
  });
}

function renderAll() { renderDraft(); renderSegments(); updatePlaybackUI(); }

function addClip() {
  try {
    draftStart = parseTime(elements.startInput.value);
    draftEnd = parseTime(elements.endInput.value);
    elements.startInput.value = formatTime(draftStart);
    elements.endInput.value = formatTime(draftEnd);
    renderDraft();
  } catch (error) {
    elements.draftStatus.textContent = error.message;
    elements.draftStatus.className = 'bad';
    return;
  }
  if (draftStart == null || draftEnd == null || draftEnd - draftStart < 120) {
    elements.draftStatus.textContent = '開始・終了と2分要件を確認'; elements.draftStatus.className = 'bad'; return;
  }
  if (segments.some((segment) => draftStart < segment.endSeconds - .001 && draftEnd > segment.startSeconds + .001)) {
    elements.draftStatus.textContent = '登録済み区間と重複'; elements.draftStatus.className = 'bad'; return;
  }
  const completedEnd = draftEnd;
  segments.push({ id: crypto.randomUUID(), label: nextClipLabel(), startSeconds: draftStart, endSeconds: draftEnd });
  segments.sort((a, b) => a.startSeconds - b.startSeconds);
  saveSegments();
  draftStart = null; draftEnd = null; elements.startInput.value = ''; elements.endInput.value = '';
  seekAvailable(completedEnd, 1);
  renderAll();
}

function isTyping(event) {
  const target = event.target;
  return (target instanceof HTMLInputElement && target.type !== 'range')
    || target instanceof HTMLTextAreaElement
    || target?.isContentEditable;
}

function changeShuttleRate(delta) {
  shuttleRate = Math.max(2, Math.min(10, shuttleRate + delta));
  elements.forwardRate.textContent = `${shuttleRate}×`;
  if (shuttle?.direction === 1) {
    elements.video.playbackRate = shuttleRate;
    elements.shuttleIndicator.textContent = `${shuttleRate}×`;
  }
}

function startShuttle(direction) {
  if (shuttle) return;
  shuttle = { direction, wasPaused: elements.video.paused, playbackRate: elements.video.playbackRate };
  elements.shuttleIndicator.hidden = false;
  if (direction === 1) {
    seekAvailable(elements.video.currentTime, 1);
    elements.video.playbackRate = shuttleRate;
    void elements.video.play();
    elements.shuttleIndicator.textContent = `${shuttleRate}×`;
  } else {
    elements.video.pause();
    reverseLastTime = performance.now();
    elements.shuttleIndicator.textContent = '−2×';
    const step = (now) => {
      if (!shuttle || shuttle.direction !== -1) return;
      const elapsed = Math.min(.1, (now - reverseLastTime) / 1000);
      reverseLastTime = now;
      elements.video.currentTime = Math.max(0, elements.video.currentTime - elapsed * 2);
      reverseFrame = requestAnimationFrame(step);
    };
    reverseFrame = requestAnimationFrame(step);
  }
}

function stopShuttle() {
  if (!shuttle) return;
  const previous = shuttle;
  shuttle = null;
  if (reverseFrame) cancelAnimationFrame(reverseFrame);
  reverseFrame = null;
  elements.video.playbackRate = previous.playbackRate || 1;
  if (previous.wasPaused) elements.video.pause(); else void elements.video.play();
  elements.shuttleIndicator.hidden = true;
  updatePlaybackUI();
}

function seekFrames(delta) {
  const fps = session?.media.video.fps || 30;
  elements.video.pause();
  seekAvailable(elements.video.currentTime + delta / fps, Math.sign(delta));
}

function showUndo(segment) {
  removedSegment = segment;
  clearTimeout(undoTimer);
  elements.undoToast.hidden = false;
  undoTimer = setTimeout(() => {
    removedSegment = null;
    elements.undoToast.hidden = true;
  }, 6000);
}

function undoRemove() {
  if (!removedSegment) return;
  segments.push(removedSegment);
  segments.sort((a, b) => a.startSeconds - b.startSeconds);
  removedSegment = null;
  clearTimeout(undoTimer);
  elements.undoToast.hidden = true;
  saveSegments();
  renderAll();
}

function phaseLabel(phase) {
  return ({
    queued: ['準備中', '書き出しを準備しています'],
    'source-hash': ['原本を検証中', '長尺原本の整合性を固定しています'],
    'source-packets': ['映像を検証中', '映像パケットとキーフレームを検査しています'],
    video: ['映像を書き出し中', '映像・音声を再エンコードせず書き出しています'],
    frames: ['フレームを同期中', '各映像フレームを元タイムスタンプへ対応付けています'],
    imu: ['IMUを同期中', '加速度・ジャイロを同じ区間へ揃えています'],
    finalize: ['出力を検証中', '4ファイル・SHA-256・同期を検証しています'],
    complete: ['完了', '全クリップの検証が完了しました'],
  })[phase] ?? ['処理中', '処理しています'];
}

async function startExport() {
  elements.exportOverlay.hidden = false;
  elements.exportCard.dataset.state = 'loading';
  elements.exportComplete.hidden = true;
  elements.progressFill.style.transform = 'scaleX(0)';
  elements.progressFill.closest('[role="progressbar"]').setAttribute('aria-valuenow', '0');
  try {
    await boundarySaveSequence;
    if (boundarySaveError) throw new Error(`境界ファイルを保存できません: ${boundarySaveError.message}`);
    await api('/api/export', { method: 'POST', body: JSON.stringify({ segments }) });
    pollTimer = setInterval(pollExport, 700);
    await pollExport();
  } catch (error) { showExportError(error.message); }
}

function showExportError(message) {
  clearInterval(pollTimer);
  elements.exportCard.dataset.state = 'error';
  elements.exportPhase.textContent = '書き出し失敗';
  elements.exportMessage.textContent = message;
  elements.exportComplete.hidden = false;
  elements.outputPath.textContent = '入力ファイルは変更されていません。';
  elements.revealOutput.hidden = true;
}

async function pollExport() {
  const job = await api('/api/export-status');
  if (job.status === 'error') return showExportError(job.error);
  const progress = job.progress ?? { phase: 'queued', progress: 0 };
  const [label, message] = phaseLabel(progress.phase);
  elements.exportPhase.textContent = label;
  elements.exportMessage.textContent = progress.message ?? message;
  const percent = Math.round(Math.max(0, Math.min(1, progress.progress ?? 0)) * 100);
  elements.progressFill.style.transform = `scaleX(${percent / 100})`;
  elements.progressFill.closest('[role="progressbar"]').setAttribute('aria-valuenow', String(percent));
  const clipPart = Number.isInteger(progress.clipIndex) ? ` · 区間 ${progress.clipIndex + 1}/${progress.clipCount}` : '';
  elements.progressDetail.textContent = `${percent}%${clipPart}${progress.label ? ` · ${progress.label}` : ''}`;
  if (job.status === 'complete') {
    clearInterval(pollTimer);
    elements.exportCard.dataset.state = 'success';
    elements.exportComplete.hidden = false;
    elements.outputPath.textContent = `${job.result.outputRoot}\n${job.result.clips.length} clips · 全件同期検証済み`;
    elements.revealOutput.hidden = false;
  }
}

elements.chooseSource.addEventListener('click', chooseFolder);
elements.enterPath.addEventListener('click', enterPath);
elements.changeSource.addEventListener('click', () => { elements.sourceGate.hidden = false; });
elements.playToggle.addEventListener('click', () => elements.video.paused ? elements.video.play() : elements.video.pause());
elements.markStart.addEventListener('click', () => setMark('start'));
elements.markEnd.addEventListener('click', () => setMark('end'));
elements.startInput.addEventListener('change', () => syncInput('start'));
elements.endInput.addEventListener('change', () => syncInput('end'));
elements.addClip.addEventListener('click', addClip);
elements.scrubber.addEventListener('input', () => {
  const target = Number(elements.scrubber.value);
  const direction = target < lastPlaybackTime ? -1 : 1;
  elements.scrubber.value = String(seekAvailable(target, direction));
  updatePlaybackUI();
});
elements.video.addEventListener('timeupdate', updatePlaybackUI);
elements.video.addEventListener('play', updatePlaybackUI);
elements.video.addEventListener('pause', updatePlaybackUI);
elements.video.addEventListener('loadedmetadata', updatePlaybackUI);
elements.clipList.addEventListener('click', (event) => {
  const button = event.target.closest('button'); const row = event.target.closest('.clip-row');
  if (!button || !row) return;
  const index = segments.findIndex((segment) => segment.id === row.dataset.id);
  if (index < 0) return;
  if (button.dataset.action === 'remove') {
    const [removed] = segments.splice(index, 1);
    saveSegments();
    renderAll();
    showUndo(removed);
  }
});
elements.undoRemove.addEventListener('click', undoRemove);
elements.exportButton.addEventListener('click', startExport);
elements.revealOutput.addEventListener('click', () => api('/api/reveal-output', { method: 'POST' }));
elements.closeExport.addEventListener('click', () => { elements.exportOverlay.hidden = true; });

document.addEventListener('keydown', (event) => {
  if (isTyping(event)) return;
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) elements.playToggle.click(); }
  if (event.code === 'ArrowRight') { event.preventDefault(); if (!event.repeat) startShuttle(1); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); if (!event.repeat) startShuttle(-1); }
  if (event.code === 'ArrowUp' && shuttle?.direction === 1) { event.preventDefault(); if (!event.repeat) changeShuttleRate(1); }
  if (event.code === 'ArrowDown' && shuttle?.direction === 1) { event.preventDefault(); if (!event.repeat) changeShuttleRate(-1); }
  if (event.code === 'KeyS' && !event.repeat) setMark('start');
  if (event.code === 'KeyE' && !event.repeat) setMark('end');
  if (event.code === 'KeyJ' && !event.repeat) seekFrames(-1);
  if (event.code === 'KeyL' && !event.repeat) seekFrames(1);
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowRight' && shuttle?.direction === 1) stopShuttle();
  if (event.code === 'ArrowLeft' && shuttle?.direction === -1) stopShuttle();
});
window.addEventListener('blur', stopShuttle);

api('/api/session').then((value) => { if (value.ready) loadSession(value); }).catch((error) => { elements.gateError.textContent = error.message; });
