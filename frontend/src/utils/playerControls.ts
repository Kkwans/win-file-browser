const STORAGE_KEY = "win-file-browser-controls-timeout-v1";

export function readControlsTimeoutMs(): number {
  const fallback = 4000;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1000 || n > 30000) return fallback;
    return Math.round(n);
  } catch {
    return fallback;
  }
}

export function writeControlsTimeoutMs(ms: number): number {
  const clamped = Math.min(30000, Math.max(1000, Math.round(ms || 4000)));
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {}
  return clamped;
}
