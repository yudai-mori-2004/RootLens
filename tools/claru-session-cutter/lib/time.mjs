export function formatTime(seconds, { milliseconds = true } = {}) {
  if (!Number.isFinite(seconds)) return '--:--:--';
  const safe = Math.max(0, seconds);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

export function parseTime(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    throw new Error(`時刻は HH:MM:SS.mmm で入力してください: ${text}`);
  }
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (minutes >= 60 || seconds >= 60) throw new Error(`時刻の範囲が不正です: ${text}`);
  return hours * 3600 + minutes * 60 + seconds;
}

export function snapStartAtOrBefore(seconds, keyframes) {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (keyframes[mid] <= seconds + 1e-6) low = mid + 1;
    else high = mid;
  }
  return keyframes[Math.max(0, low - 1)];
}
