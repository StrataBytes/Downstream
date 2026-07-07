// contextual normalization: background loudness-measurement service.
// owns the scan queue, the persistent measurement cache, and all gating.
// the main process is a dumb serial executor (one ffmpeg at a time), and this service decides what gets measured and when: only while normalization is on and the contextual engine is selected, never during a download batch, and the playing track jumps the queue while the folder scans in order behind it.
// fast-click safety: rapid track skips just reorder a deduped queue with a single in-flight scan.
// results are cached keyed by path+size+mtime and are never applied to the audio graph from here, since audioengine reads the cache synchronously at track load, so a scan that finishes late can't touch the wrong track.

import useAppStore from '../stores/useAppStore';
import { dbg } from './debugLog';

const CACHE_KEY = 'loudnessCache';
const CACHE_CAP = 2000;
const BREATHER_MS = 500;

function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const cache = loadCache();
let queue = [];
let scanning = false;
let inFlight = null;
let needsRebuild = true;

function saveCache() {
  const paths = Object.keys(cache);
  if (paths.length > CACHE_CAP) {
    paths.sort((a, b) => (cache[a].used || 0) - (cache[b].used || 0));
    for (const p of paths.slice(0, paths.length - CACHE_CAP)) delete cache[p];
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full, skip */ }
}

// file: { path, size?, mtime? }.
// returns the cache entry ({ i, tp } for a good measurement, { failed: true } for a known-bad file), or null when unmeasured or stale (file changed since it was measured).
export function getLoudness(file) {
  if (!file?.path) return null;
  const entry = cache[file.path];
  if (!entry) return null;
  if (file.size !== undefined && (entry.size !== file.size || entry.mtime !== file.mtime)) return null;
  entry.used = Date.now();
  return entry;
}

// processed count (good + failed) for the behavior modal's status line.
export function countMeasured(files) {
  return files.filter((f) => getLoudness(f) !== null).length;
}

// wipes every cached measurement, global across every media library ever pointed at (the cache is keyed by absolute path, not scoped to a folder).
// if contextual is currently active, immediately requeues the whole visible library so scanning resumes instead of sitting idle until the next folder/mode change would normally trigger a rebuild.
export function clearLoudnessCache() {
  for (const key of Object.keys(cache)) delete cache[key];
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  queue = [];
  needsRebuild = false;
  useAppStore.setState((s) => ({ loudnessScanTick: s.loudnessScanTick + 1 }));
  if (gatesOpen()) {
    const s = useAppStore.getState();
    queue = s.musicFiles.filter((f) => f.path !== inFlight);
    if (queue.length > 0 && !scanning) pump();
  }
}

function gatesOpen() {
  const s = useAppStore.getState();
  return s.musicNormalize && s.normalizerMode === 'contextual' && !s.isDownloading;
}

// called by audioengine when an unmeasured track starts playing, jumps the queue so the next play of that track is contextual.
export function requestScan(file, priority = false) {
  if (!file?.path || !window.electronAPI?.measureLoudness) return;
  if (getLoudness(file) || inFlight === file.path) return;
  queue = queue.filter((f) => f.path !== file.path);
  if (priority) queue.unshift(file);
  else queue.push(file);
  pump();
}

async function pump() {
  if (scanning) return;
  scanning = true;
  try {
    while (queue.length > 0 && gatesOpen()) {
      const file = queue.shift();
      if (getLoudness(file) || inFlight === file.path) continue;
      inFlight = file.path;
      // drives the "measuring..." toast in the player.
      // stays set across consecutive scans (name just updates) and clears when the loop ends.
      useAppStore.setState({ loudnessScanningTrack: file.name || null });
      let res = null;
      try {
        res = await window.electronAPI.measureLoudness(file.path);
      } catch {
        res = null;
      }
      inFlight = null;
      // failures are memoized too (keyed to this exact file identity) so a corrupt file doesn't get rescanned every session.
      cache[file.path] = res
        ? { i: res.lufs, tp: res.truePeak, size: file.size, mtime: file.mtime, used: Date.now(), v: 1 }
        : { failed: true, size: file.size, mtime: file.mtime, used: Date.now(), v: 1 };
      saveCache();
      dbg('loudness', res
        ? `"${file.name || file.path}" → ${res.lufs} LUFS (TP ${res.truePeak} dBTP)`
        : `"${file.name || file.path}" → scan failed (won't retry until the file changes)`);
      useAppStore.setState((s) => ({ loudnessScanTick: s.loudnessScanTick + 1 }));
      await new Promise((r) => setTimeout(r, BREATHER_MS));
    }
  } finally {
    scanning = false;
    useAppStore.setState({ loudnessScanningTrack: null });
  }
}

let installed = false;

// watches the store: rebuilds the queue when the folder changes or the contextual gates open, and resumes a paused scan when downloads finish.
// the subscription body is a few property compares, trivial per store tick.
export function initLoudnessService() {
  if (installed) return;
  installed = true;
  let prevFiles = null;
  let prevMode = null;
  let prevNorm = null;
  useAppStore.subscribe((s) => {
    if (s.musicFiles !== prevFiles) {
      prevFiles = s.musicFiles;
      needsRebuild = true;
    }
    if (s.normalizerMode !== prevMode) {
      prevMode = s.normalizerMode;
      if (s.normalizerMode === 'contextual') needsRebuild = true;
    }
    if (s.musicNormalize !== prevNorm) {
      prevNorm = s.musicNormalize;
      if (s.musicNormalize) needsRebuild = true;
    }
    if (!gatesOpen()) return;
    if (needsRebuild) {
      needsRebuild = false;
      // preserves the front item (a priority request for the playing track) across rebuilds, everything else follows folder order.
      const keepFront = queue.length > 0 ? queue[0] : null;
      queue = s.musicFiles.filter((f) => !getLoudness(f) && f.path !== inFlight);
      if (keepFront && !getLoudness(keepFront) && keepFront.path !== inFlight) {
        queue = [keepFront, ...queue.filter((f) => f.path !== keepFront.path)];
      }
      if (queue.length > 0) {
        dbg('loudness', `queue rebuilt -- ${queue.length} track(s) to measure`);
      }
    }
    if (queue.length > 0 && !scanning) pump();
  });
}
