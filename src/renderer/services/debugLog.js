// in-app log capture for the "debugging outlog" pane.
// dormant by design: capture is off until the pane is opened.
// while off, the console wrappers just call through to the real console (one boolean check of overhead), nothing is buffered, no subscribers are notified, and the main process is told not to forward its logs over ipc.
// opening the pane flips capture on, closing it flips capture off and frees the buffer.

import useAppStore from '../stores/useAppStore';

const MAX_ENTRIES = 800;
const buffer = [];
const subscribers = new Set();
let seq = 0;
let enabled = false;

function emit(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  subscribers.forEach((cb) => { try { cb(entry); } catch { /* ignore */ } });
}

function fmt(args) {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

export function pushLog(source, level, text) {
  if (!enabled) return;
  emit({ id: ++seq, ts: Date.now(), source, level, text });
}

// scoped instrumentation helper for the outlog.
// emits `[scope] message` at the given level (default 'log'), no-op while the pane is closed.
export function dbg(scope, ...args) {
  if (!enabled) return;
  const level = args[0] === '!' ? (args.shift(), 'error') : 'log';
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  pushLog('ui', level, `[${scope}] ${text}`);
}

// startup runs before the outlog can be opened, so its results are kept to show when it does.
let startupSummary = null;

export function noteStartup(summary) {
  startupSummary = summary;
}

const itemCount = (list) => `${list.length} item(s)`;
const quoted = (key) => (value) => (value ? `"${value[key]}"` : 'none');

// store fields worth seeing change, and how each is shown.
const WATCHED = {
  currentView: String,
  folderScreen: String,
  optionsOpen: String,
  isDownloading: String,
  downloadCancelled: String,
  queue: itemCount,
  nowPlaying: quoted('title'),
  downloadFolder: String,
  downloadQuality: String,
  downloadFormat: String,
  fastDownloadPacing: String,
  musicFolder: String,
  musicCurrent: quoted('name'),
  musicPlaying: String,
  musicShuffle: String,
  musicRepeat: String,
  playerViewMode: String,
  renderProfile: String,
  liteDisableBlur: String,
  liteDisableAnimations: String,
  liteDisableVisualizer: String,
  liteDisableVideoBackground: String,
  ffmpegReady: String,
  ytDlpReady: String,
  networkConnected: String,
};

function describe(state) {
  return Object.fromEntries(Object.entries(WATCHED).map(([key, show]) => [key, show(state[key])]));
}

let unwatch = null;

// logs each watched field as it changes, only while capturing.
function watchState() {
  let last = describe(useAppStore.getState());
  unwatch = useAppStore.subscribe((state) => {
    const next = describe(state);
    for (const key in next) {
      if (next[key] !== last[key]) pushLog('ui', 'log', `[state] ${key}: ${last[key]} → ${next[key]}`);
    }
    last = next;
  });
}

// where the app stands when capture starts.
function logSnapshot() {
  const s = useAppStore.getState();
  const lite = Object.entries({ blur: 'Blur', animations: 'Animations', visualizer: 'Visualizer', 'video background': 'VideoBackground' })
    .filter(([, key]) => s[`liteDisable${key}`])
    .map(([label]) => label);
  dbg('env', `window ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x, ${s.renderProfile} rendering${lite.length ? `, lite mode turned off ${lite.join(', ')}` : ''}`);
  dbg('env', `view ${s.currentView}, queue ${s.queue.length}, history ${s.queueHistory.length}${s.isDownloading ? ', downloading now' : ''}`);
  dbg('env', `downloads go to ${s.downloadFolder || 'the default folder'} as ${s.downloadFormat}/${s.downloadQuality}${s.fastDownloadPacing ? ', shorter pauses on' : ''}`);
  dbg('env', `library ${s.library.folders.length} folder(s), ${s.library.mixtapes.length} mixtape(s), ${s.tempMixtape.length} folder(s) on the temporary one, playing from ${s.musicFolder || 'nothing'} (${s.musicFiles.length} track(s))${s.musicCurrent ? `, current "${s.musicCurrent.name}"` : ''}`);
  dbg('env', `ffmpeg ready ${s.ffmpegReady}, yt-dlp ready ${s.ytDlpReady}, online ${s.networkConnected}`);
  if (startupSummary) dbg('env', startupSummary);
}

// toggles capture, called by the debugconsole when it opens or closes.
// turning off also frees the buffer and tells the main process to stop forwarding.
export function setDebugCaptureEnabled(on) {
  on = !!on;
  if (on === enabled) return;
  enabled = on;
  window.electronAPI?.setDebugCapture?.(on);
  if (on) {
    pushLog('ui', 'log', 'Capture started.');
    logSnapshot();
    watchState();
  } else {
    unwatch?.();
    unwatch = null;
    buffer.length = 0;
  }
}

export function getLogs() {
  return buffer.slice();
}

export function clearLogs() {
  buffer.length = 0;
  subscribers.forEach((cb) => { try { cb(null); } catch { /* ignore */ } });
}

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

let installed = false;

export function initDebugLog() {
  if (installed) return;
  installed = true;

  // tees renderer console.* into the buffer while preserving original output.
  // the `enabled` guard makes these near-free when capture is off.
  ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
    const orig = console[method] ? console[method].bind(console) : () => {};
    const level = method === 'debug' ? 'log' : method;
    console[method] = (...args) => {
      orig(...args);
      if (!enabled) return;
      try { pushLog('ui', level, fmt(args)); } catch { /* ignore */ }
    };
  });

  // global errors / unhandled rejections, the highest-signal failures.
  window.addEventListener('error', (e) => {
    if (!enabled) return;
    const loc = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
    pushLog('ui', 'error', `${e.message}${loc}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!enabled) return;
    const r = e.reason;
    pushLog('ui', 'error', 'Unhandled rejection: ' + (r?.stack || r?.message || String(r)));
  });

  // main-process logs forwarded over ipc (only sent while capture is on).
  if (window.electronAPI?.onDebugLog) {
    window.electronAPI.onDebugLog((entry) => {
      pushLog('main', entry?.level || 'log', entry?.text ?? '');
    });
  }
}
