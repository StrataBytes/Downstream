import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { QUALITIES, FORMATS } from '../utils/qualities';
import { SHUFFLE_ICON, REPEAT_ICON } from '../utils/toggleIcons';
import { SIDES, sidePages } from '../utils/settingsCatalog';
import { DownloadIcon, SearchIcon, PlusIcon } from './InputBar';
import { ResultRow, SkeletonRow } from './SearchPanel';
import TagSelect from './TagSelect';
import ScrollingText from './ScrollingText';
import { CheckIcon, PinIcon, MoreIcon, Chevron } from './FolderGrid';
import { MediaRow, NoteGlyph } from './FolderMedia';
import { PageButton, SideButton } from './SettingsModal';
import { ViewPage } from './SettingsPages';
import { useBars } from './SettingsPreviews';

// the guide's moving pictures, each a piece of the real app played out by a pointer.
// they're drawn with the app's own styles, and the real pieces where those stand on their own, so they look just like what they show.

const noop = () => {};

// how often a scene moves on.
const TICK_MS = 50;
// how long a press holds down.
const PRESS_MS = 200;

const stopped = (s) => s.renderProfile === 'lite' && s.liteDisableAnimations;

// the time into a scene's loop.
// while lite mode holds animations still, it stays on the moment that tells the most.
function useClock(loopMs, still) {
  const frozen = useAppStore(stopped);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (frozen) return undefined;
    const start = performance.now();
    const timer = setInterval(() => setT((performance.now() - start) % loopMs), TICK_MS);
    return () => clearInterval(timer);
  }, [loopMs, frozen]);
  return frozen ? still : t;
}

// what the pointer is over at a moment, from stops of [time, place, press].
// a place is a named spot in the scene or a selector, and a stop with no place lets it fade out where it is.
function follow(t, stops) {
  let place = null;
  let down = false;
  for (const [time, at, press] of stops) {
    if (t < time) break;
    place = at;
    down = !!press && t < time + PRESS_MS;
  }
  return { place, down, pressing: down ? place : null };
}

const selector = (place) => (/^[.[]/.test(place) ? place : `[data-guide="${place}"]`);

// the same pointer as the settings pictures, gliding to each place in a scene and pressing it.
// places are found in the scene itself, so it lands on them however they're laid out.
// anything it carries, like a dragged folder, rides along under it.
function Pointer({ scene, t, stops, carry }) {
  const { place, down } = follow(t, stops);
  const [at, setAt] = useState(null);
  useLayoutEffect(() => {
    const box = scene.current;
    if (!box) return;
    const el = place && box.querySelector(selector(place));
    let next = null;
    if (el) {
      const frame = box.getBoundingClientRect();
      const scale = frame.width / box.offsetWidth || 1;
      const r = el.getBoundingClientRect();
      next = [(r.left + r.width / 2 - frame.left) / scale, (r.top + r.height / 2 - frame.top) / scale];
    } else if (!at) {
      next = [box.offsetWidth * 0.82, box.offsetHeight * 0.92];
    }
    if (next && (!at || Math.abs(at[0] - next[0]) > 0.5 || Math.abs(at[1] - next[1]) > 0.5)) setAt(next);
  });
  if (!at) return null;
  return (
    <span className={`gs-pointer${place ? '' : ' gs-pointer-away'}${down ? ' gs-pointer-down' : ''}`} style={{ left: at[0], top: at[1] }}>
      {carry && <span className="gs-carry">{carry}</span>}
      <svg viewBox="0 0 12 12"><path d="M1 1l9 4-4 1.2L4.8 10z" fill="#fff" stroke="#000" strokeWidth="0.6" /></svg>
    </span>
  );
}

// a piece of the app at its real size, shrunk to fit its picture, on the app's own background.
// it's shrunk until the size asked for fits, then widened or deepened to fill the picture, like a window of that shape.
// nothing in it can be clicked or reached with the keyboard.
function Screen({ width, height, scene, children }) {
  const stageRef = useRef(null);
  const [fit, setFit] = useState(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const measure = () => {
      const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
      if (scale > 0) setFit({ scale, width: stage.clientWidth / scale, height: stage.clientHeight / scale });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(stage);
    return () => watch.disconnect();
  }, [width, height]);
  return (
    <div ref={stageRef} className="gs-stage" aria-hidden="true">
      <div
        ref={scene}
        className="gs-screen"
        inert
        style={{ width: fit?.width ?? width, height: fit?.height ?? height, transform: `scale(${fit?.scale ?? 0})`, '--gs-unscale': fit ? 1 / fit.scale : 1 }}
      >
        {children}
      </div>
    </div>
  );
}

// --- what the scenes are made of ---

// small covers in the app's teals and slate blues, layered like the example background's paper shapes.
const PALETTES = [
  ['#2E4A63', '#4CD0C1', '#E6FBF8'],
  ['#3B6280', '#A6EEE5', '#253D52'],
  ['#253D52', '#35A89E', '#E6FBF8'],
  ['#4F86A0', '#E6FBF8', '#2E4A63'],
  ['#1D3A4D', '#4CD0C1', '#A6EEE5'],
  ['#35A89E', '#253D52', '#E6FBF8'],
];

function art([ground, hill, sun], w, h) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>`
    + `<rect width='${w}' height='${h}' fill='${ground}'/>`
    + `<circle cx='${w * 0.68}' cy='${h * 0.34}' r='${h * 0.15}' fill='${sun}'/>`
    + `<path d='M0 ${h * 0.72} L${w * 0.38} ${h * 0.42} L${w * 0.7} ${h * 0.8} L${w} ${h * 0.56} V${h} H0Z' fill='${hill}'/>`
    + `<path d='M0 ${h * 0.88} L${w * 0.55} ${h * 0.7} L${w} ${h * 0.9} V${h} H0Z' fill='${ground}' opacity='0.6'/>`
    + '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const COVERS = PALETTES.map((p) => art(p, 64, 64));
const THUMBS = PALETTES.map((p, i) => art(PALETTES[(i + 1) % PALETTES.length], 160, 90));

const SONGS = ['Lofi beats to study and relax to', 'Rainy day study session', 'Late night lofi mix'];
const RESULTS = SONGS.map((title, i) => ({
  url: `guide-result-${i}`,
  kind: 'video',
  title,
  channel: ['Quiet Hours', 'Paper Lanterns', 'Slow Tide'][i],
  views: [1200000, 84000, 56000][i],
  duration: [3600, 2710, 1500][i],
  thumbnail: THUMBS[i],
}));
const QUERY = 'lofi beats to study';
const LINK = 'https://youtu.be/k3Lm9QxT2bA';

const FOLDERS = ['Road Trip', 'Late Night', 'Focus', 'Summer', 'Acoustic', 'Workout'].map((name, i) => ({
  name,
  cover: COVERS[i],
  tracks: [12, 31, 8, 22, 15, 40][i],
}));
const folderOf = (name) => FOLDERS.find((f) => f.name === name);
const TRACKS = ['Golden Hour', 'Paper Moons'];

function Icon({ size = 16, width = 2, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const Back = () => <Icon width={2.5}><polyline points="15 18 9 12 15 6" /></Icon>;
const Close = ({ size }) => <Icon size={size} width={2.5}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
const FolderIcon = () => <Icon size={14}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>;

// --- the downloader ---

// the downloader's widget as it first shows, with whatever's been typed or pasted.
function InputDrawing({ text = '', link = false, busy = false, done = false, pressing = false, children }) {
  const intro = busy ? 'Downloading your selections' : done ? 'Your selections are ready' : 'What are you looking for?';
  return (
    <div className="input-bar">
      <div className={`input-bar-intro${busy ? ' input-bar-intro-busy' : ''}${done ? ' input-bar-intro-done' : ''}`}>
        <DownloadIcon size={28} busy={busy} done={done} />
        <div className="input-bar-intro-text">
          <span>{intro}</span>
          <span className="input-bar-sub">You can keep browsing while they download</span>
        </div>
      </div>
      <div className="url-field">
        <input type="text" className="url-input" placeholder="Search for anything, or paste a link" value={text} readOnly />
        <button type="button" className={`url-submit${pressing ? ' gs-pressed' : ''}`} data-guide="submit" disabled={!text}>
          {link ? <PlusIcon /> : <SearchIcon />}
        </button>
      </div>
      {children}
    </div>
  );
}

function SearchPanelDrawing({ loaded, picked, queued, pressing }) {
  return (
    <div className="search-panel">
      <div className="search-panel-top">
        <button type="button" className="search-panel-back"><Back /></button>
        <div className="url-field search-panel-field">
          <input type="text" className="url-input" value={QUERY} readOnly />
          <button type="button" className="url-submit"><SearchIcon /></button>
        </div>
      </div>
      <div className="search-tabs">
        {['General', 'Music', 'Playlists'].map((label, i) => (
          <button key={label} type="button" className={`search-tab${i === 0 ? ' search-tab-active' : ''}`}>
            {label}
            {i === 0 && picked.length > 0 && <span className="search-tab-badge">{picked.length}</span>}
          </button>
        ))}
        <button type="button" className="search-refresh">
          <Icon size={13} width={2.5}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Icon>
        </button>
      </div>
      <div className="search-body">
        <div className="search-list">
          {loaded
            ? RESULTS.map((r, i) => <ResultRow key={r.url} result={r} tab="general" picked={picked.includes(i)} queued={queued.includes(i)} />)
            : RESULTS.map((r) => <SkeletonRow key={r.url} />)}
        </div>
        <div className="search-footer">
          <div className="search-footer-status">
            {picked.length > 0 ? (
              <>
                <span>{picked.length} selected</span>
                <button type="button" className="search-footer-clear">Clear</button>
              </>
            ) : (
              <span className="search-footer-hint">Select results to add them</span>
            )}
          </div>
          <div className="search-footer-options">
            <select defaultValue="high">{QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</select>
            <select defaultValue="mp4">{FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
          </div>
          <button type="button" className={`search-add${pressing ? ' gs-pressed' : ''}`} data-guide="add" disabled={picked.length === 0}>
            <PlusIcon size={14} />
            Add selected to queue
          </button>
        </div>
      </div>
    </div>
  );
}

const SEARCH_STOPS = [
  [0, null],
  [3200, '.search-row:nth-child(1) .search-row-check'],
  [3900, '.search-row:nth-child(1) .search-row-check', true],
  [4200, '.search-row:nth-child(2) .search-row-check'],
  [4700, '.search-row:nth-child(2) .search-row-check', true],
  [5200, 'add'],
  [5900, 'add', true],
  [6700, null],
];

// a search typed into the downloader opens the search panel, two results are ticked, and both go to the queue.
export function SearchScene() {
  const scene = useRef(null);
  const t = useClock(9000, 5000);
  const { pressing } = follow(t, SEARCH_STOPS);
  const open = t >= 2200;
  const added = t >= 5900;
  const picked = added ? [] : [t >= 3900 && 0, t >= 4700 && 1].filter((i) => i !== false);
  const typed = QUERY.slice(0, Math.max(0, Math.floor((t - 400) / 70)));
  return (
    <Screen width={970} height={440} scene={scene}>
      <div className="gs-center">
        <div className={`primary-widget gs-morph${open ? ' primary-widget-search' : ''}`} style={open ? { width: 680, height: 410, marginTop: 0 } : { height: 196 }}>
          <div key={open ? 'search' : 'start'} className="primary-content gs-swap">
            {open
              ? <SearchPanelDrawing loaded={t >= 2900} picked={picked} queued={added ? [0, 1] : []} pressing={pressing === 'add'} />
              : <InputDrawing text={typed} pressing={t >= 1950 && t < 2150} />}
          </div>
        </div>
      </div>
      <Pointer scene={scene} t={t} stops={SEARCH_STOPS} />
    </Screen>
  );
}

const LINK_STOPS = [
  [0, null],
  [1700, 'quality'],
  [2300, 'quality', true],
  [3000, 'format'],
  [3600, 'format', true],
  [4300, 'submit'],
  [4900, 'submit', true],
  [5600, null],
];

// a link pasted into the downloader brings up its quality and format, which are picked before it's added.
export function LinkScene() {
  const scene = useRef(null);
  const t = useClock(8000, 4300);
  const { pressing } = follow(t, LINK_STOPS);
  const pasted = t >= 900 && t < 4900;
  return (
    <Screen width={730} height={330} scene={scene}>
      <div className="gs-center">
        <div className="primary-widget">
          <div className="primary-content">
            <InputDrawing text={pasted ? LINK : ''} link={pasted} pressing={pressing === 'submit'}>
              {t >= 900 && (
                <div className="input-controls input-controls-reveal">
                  <select data-guide="quality" value={t >= 2500 ? 'medium' : 'high'} onChange={noop}>
                    {QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                  </select>
                  <select data-guide="format" value={t >= 3800 ? 'mp3' : 'mp4'} onChange={noop}>
                    {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              )}
            </InputDrawing>
          </div>
        </div>
      </div>
      <Pointer scene={scene} t={t} stops={LINK_STOPS} />
    </Screen>
  );
}

// a queue row as the queue draws it, folding away once it's done.
function RowDrawing({ item }) {
  const { title, quality, format, status, progress, completed, active, fadingOut } = item;
  const editable = !completed && !active;
  const rowRef = useRef(null);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!fadingOut || !el) return;
    const instant = document.body.classList.contains('lite-no-anim');
    el.animate([
      { height: `${el.offsetHeight}px`, opacity: 1, marginBottom: '0px' },
      { height: '0px', opacity: 0, marginBottom: '-8px', paddingTop: '0px', paddingBottom: '0px', borderWidth: '0px' },
    ], { duration: instant ? 0 : 420, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
  }, [fadingOut]);

  const fill = completed ? ' fill-done' : status === 'Finalizing...' ? ' fill-finalizing' : '';
  return (
    <div ref={rowRef} className="queue-row">
      <div className="queue-row-top">
        <ScrollingText text={title} className="queue-row-title" />
        <button type="button" className="btn-row-remove" disabled={!editable}><Close size={14} /></button>
      </div>
      <div className="mini-progress-track">
        <div className={`mini-progress-fill${fill}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="queue-row-bottom">
        <span className={`queue-row-label${completed ? ' status-done' : ''}`}>{status}</span>
        <span className="queue-row-tags">
          {format !== 'mp3' && <TagSelect value={quality} options={QUALITIES} onChange={noop} disabled={!editable} />}
          <TagSelect value={format} options={FORMATS} onChange={noop} disabled={!editable} />
        </span>
      </div>
    </div>
  );
}

const shared = (items, key) => {
  const values = new Set(items.map((item) => item[key]));
  return values.size === 1 ? [...values][0] : null;
};

// the queue beside the downloader, with its set all row, its items and download all.
// it's frosted over while save to is open, and the folder a batch is going to shows once it's under way.
function QueueDrawing({ items, done = 0, batch = null, folder = 'Downloads', pressing = false, frosted = false, style }) {
  const waiting = items.filter((item) => !item.completed && !item.active);
  const videos = waiting.filter((item) => item.format !== 'mp3');
  return (
    <div className={`queue-widget${frosted ? ' queue-widget-frosted' : ''}`} style={style}>
      <div className="queue-tabs">
        <button type="button" className="queue-tab queue-tab-active">Queue <span className="queue-tab-count">{items.length}</span></button>
        <button type="button" className="queue-tab queue-tab-history" disabled={!done}>Completed <span className="queue-tab-count">{done}</span></button>
      </div>
      <div className="queue-set-all">
        {waiting.length > 0 && <span className="queue-set-all-label">Set all</span>}
        {videos.length > 0 && <TagSelect value={shared(videos, 'quality')} options={QUALITIES} onChange={noop} placeholder="Mixed" />}
        {waiting.length > 0 && <TagSelect value={shared(waiting, 'format')} options={FORMATS} onChange={noop} placeholder="Mixed" />}
      </div>
      <div className="queue-list">
        {items.length === 0 && <div className="queue-empty">Queue is empty.</div>}
        {items.map((item) => <RowDrawing key={item.url} item={item} />)}
      </div>
      <div className="queue-footer">
        {batch ? (
          <div className="queue-batch">
            <div className="queue-batch-info">
              <div className="queue-batch-text">
                <span>{batch.text}</span>
                <span>{batch.done} of {batch.total}</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${Math.floor((batch.done / batch.total) * 100)}%` }} />
              </div>
            </div>
            <button type="button" className="queue-batch-cancel" disabled={!batch.running}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={`btn-primary queue-download${pressing ? ' gs-pressed' : ''}`} data-guide="download-all">
            <Icon width={2.5}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Icon>
            Download All
          </button>
        )}
        <div className="queue-footer-row">
          {batch && <button type="button" className="btn-folder-main"><FolderIcon /><span>{folder}</span></button>}
          <button type="button" className="queue-clear" disabled={!!batch?.running}>Clear</button>
        </div>
      </div>
    </div>
  );
}

const queueItem = (i, patch) => ({ url: `guide-item-${i}`, title: SONGS[i], quality: 'high', format: 'mp4', status: 'Queued', progress: 0, ...patch });

const QUEUE_STOPS = [
  [0, null],
  [1200, '.queue-row:nth-child(2) .queue-row-tags > :last-child'],
  [1900, '.queue-row:nth-child(2) .queue-row-tags > :last-child', true],
  [3000, '.queue-set-all > :last-child'],
  [3700, '.queue-set-all > :last-child', true],
  [4700, null],
];

// one item's format is changed in the queue, then every item's at once with set all.
export function QueueScene() {
  const scene = useRef(null);
  const t = useClock(8000, 4600);
  const items = [0, 1, 2].map((i) => queueItem(i, { format: t >= 3900 || (i === 1 && t >= 2100) ? 'mp3' : 'mp4' }));
  return (
    <Screen width={800} height={360} scene={scene}>
      <div className="gs-left">
        <div className="primary-widget"><div className="primary-content"><InputDrawing /></div></div>
      </div>
      <QueueDrawing items={items} style={{ top: 16, right: 20, bottom: -150 }} />
      <Pointer scene={scene} t={t} stops={QUEUE_STOPS} />
    </Screen>
  );
}

function FolderCardDrawing({ folder, className = '', meta, live = false }) {
  return (
    <div className={`folder-card${className ? ` ${className}` : ''}`} data-guide={folder.name}>
      <span className="folder-cover"><img src={folder.cover} alt="" draggable={false} /></span>
      <span className="folder-card-name">{folder.name}</span>
      <span className={`folder-card-meta${live ? ' folder-card-live' : ''}`}>{meta || `${folder.tracks} tracks`}</span>
    </div>
  );
}

// where download all sends the batch, picked from the downloads folder and the folders in downstream.
function SavePickerDrawing({ choice, pressing }) {
  return (
    <div className="save-picker">
      <div className="save-picker-head">
        <h2>Save to</h2>
        <span className="queue-count">3 downloads</span>
      </div>
      <div className="folders-body">
        <div className="folders-list save-picker-list">
          <div className="folders-grid">
            <div className={`folder-card save-picker-downloads${choice === null ? ' folder-card-selected' : ''}`}>
              <span className="folder-cover"><DownloadIcon size={22} /></span>
              <span className="folder-card-name">Downloads</span>
              <span className="folder-card-meta">On your computer</span>
            </div>
          </div>
          <div className="folders-heading">
            <span>In Downstream, where the player finds them</span>
            <span className="folders-divider-line" />
          </div>
          <div className="folders-grid">
            {FOLDERS.slice(0, 3).map((f) => <FolderCardDrawing key={f.name} folder={f} className={choice === f.name ? 'folder-card-selected' : ''} />)}
            <div className="folder-card folder-card-empty"><PlusIcon size={18} /><span>New folder</span></div>
          </div>
        </div>
        <div className="folders-footer">
          <span className="folders-footer-count">
            <button type="button" className="search-footer-clear save-picker-elsewhere">Choose a folder...</button>
          </span>
          <button type="button" className="folders-footer-btn">Cancel</button>
          <button type="button" className={`search-add folders-add${pressing ? ' gs-pressed' : ''}`} data-guide="save">
            {choice ? `Download to ${choice}` : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

// when each item starts, and how long it spends downloading, finishing and converting.
const ITEM_STARTS = [4400, 6000, 7600];
const STEP = { downloaded: 1000, finalized: 1300, converted: 1600, shown: 2300, folded: 2750 };

function downloading(i, t, format) {
  const e = t - ITEM_STARTS[i];
  const base = queueItem(i, { format });
  if (e < 0) return base;
  if (e < STEP.downloaded) {
    const progress = Math.round((e / STEP.downloaded) * 100);
    return { ...base, active: true, progress, status: `Downloading (${progress}%)` };
  }
  if (e < STEP.finalized) return { ...base, active: true, progress: 100, status: 'Finalizing...' };
  if (e < STEP.converted) return { ...base, active: true, progress: 100, status: 'Converting...' };
  if (e < STEP.folded) return { ...base, completed: true, progress: 100, status: 'Completed', fadingOut: e >= STEP.shown };
  return null;
}

const SAVE_STOPS = [
  [0, null],
  [500, 'download-all'],
  [1200, 'download-all', true],
  [2300, 'Road Trip'],
  [2900, 'Road Trip', true],
  [3500, 'save'],
  [4100, 'save', true],
  [4800, null],
];

// download all asks where the batch goes while the queue waits under frost, a folder in downstream is picked, and the queue works through it while the downloader says so.
export function SaveScene() {
  const scene = useRef(null);
  const t = useClock(11500, 3000);
  const { pressing } = follow(t, SAVE_STOPS);
  const picking = t >= 1400 && t < 4200;
  const started = t >= 4200;
  const formats = ['mp4', 'mp3', 'mp4'];
  const rows = [0, 1, 2].map((i) => downloading(i, t, formats[i]));
  const items = rows.filter(Boolean);
  const done = rows.filter((r) => !r || r.completed).length;
  const running = started && done < 3;
  const batch = started ? { text: running ? 'Downloading...' : 'Complete!', done, total: 3, running } : null;
  return (
    <Screen width={900} height={480} scene={scene}>
      <div className="gs-left">
        <div className={`primary-widget gs-morph${picking ? ' primary-widget-save' : ''}`} style={picking ? { width: 540, height: 396, marginRight: 0 } : { height: 196 }}>
          <div key={picking ? 'save' : 'start'} className="primary-content gs-swap">
            {picking
              ? <SavePickerDrawing choice={t >= 2900 ? 'Road Trip' : null} pressing={pressing === 'save'} />
              : <InputDrawing busy={running} done={started && !running} />}
          </div>
        </div>
      </div>
      <QueueDrawing
        items={items}
        done={rows.filter((r) => !r).length}
        batch={batch}
        folder="Road Trip"
        pressing={pressing === 'download-all'}
        frosted={picking}
        style={{ top: 16, right: 20, bottom: 16 }}
      />
      <Pointer scene={scene} t={t} stops={SAVE_STOPS} />
    </Screen>
  );
}

// --- the player ---

function Chip({ id, label, active, pressing, width = 2, children }) {
  return (
    <button type="button" className={`music-folder-name${active ? ' music-folder-name-active' : ''}${pressing === id ? ' gs-pressed' : ''}`} data-guide={id}>
      <Icon size={14} width={width}>{children}</Icon>
      <span>{label}</span>
    </button>
  );
}

// songs measured one after another in the background, as the notice under the player names them.
const MEASURED = ['Golden Hour', 'Paper Moons', 'Slow Tide', 'Night Drive', 'Harbor Lights', 'Blue Hour'];
const MEASURE_MS = 1600;

// the song the notice under the player names a while after music starts, as it does while a folder is measured for the first time.
// it only shows while normalizing measures songs, which is how settings has it.
function useMeasuring(since) {
  const measures = useAppStore((s) => s.musicNormalize && s.normalizerMode === 'contextual');
  if (!measures || since < 300) return null;
  return MEASURED[Math.floor((since - 300) / MEASURE_MS) % MEASURED.length];
}

// the player as it shows a song, with its controls, volume and chips.
function PlayerDrawing({ title, playing = false, shuffle = false, settings = false, measuring = null, folder = 'Road Trip', pressing = null }) {
  return (
    <div className="music-player">
      <ScrollingText text={title} variant="ambient" className="music-track-name" />
      <div className="music-controls">
        <button type="button" className={`btn-music-toggle${shuffle ? ' btn-music-toggle-active' : ''}${pressing === 'shuffle' ? ' gs-pressed' : ''}`} data-guide="shuffle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: SHUFFLE_ICON }} />
        </button>
        <button type="button" className="btn-music-control">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="3" height="14" rx="1" /><polygon points="21 5 10 12 21 19 21 5" /></svg>
        </button>
        <button type="button" className={`btn-music-play${pressing === 'play' ? ' gs-pressed' : ''}`} data-guide="play">
          {playing ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3" /></svg>
          )}
        </button>
        <button type="button" className={`btn-music-control${pressing === 'next' ? ' gs-pressed' : ''}`} data-guide="next">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="3 5 14 12 3 19 3 5" /><rect x="18" y="5" width="3" height="14" rx="1" /></svg>
        </button>
        <button type="button" className="btn-music-toggle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: REPEAT_ICON }} />
        </button>
      </div>
      <div className="music-player-extras">
        <div className="music-volume">
          <Icon><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></Icon>
          <input type="range" className="music-volume-slider" min="0" max="1" step="0.01" defaultValue={0.25} />
        </div>
        <div className="music-actions">
          <Chip id="folder" label={folder} pressing={pressing}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Chip>
          <Chip id="library" label="Library" pressing={pressing}>
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </Chip>
          <Chip id="eq" label="EQ" pressing={pressing}>
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
          </Chip>
          <Chip id="settings" label="Settings" active={settings} pressing={pressing}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
          </Chip>
        </div>
      </div>
      {measuring && (
        <div className="norm-scan-toast">
          <div className="norm-scan-title-row">
            <ScrollingText text="Normalizing your library..." className="norm-scan-title" />
            <svg className="norm-scan-info-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <ScrollingText text={measuring} className="norm-scan-track" />
        </div>
      )}
    </div>
  );
}

// the visualizer along the bottom while music plays, as the settings show it, or the song itself if one is playing.
function BarsDrawing() {
  const canvasRef = useRef(null);
  const shown = useAppStore((s) => !s.behaviorHideVisualizer && !(s.renderProfile === 'lite' && s.liteDisableVisualizer));
  const legacy = useAppStore((s) => s.visualizerStyle === 'legacy');
  useBars(canvasRef, { legacy, on: shown });
  return shown ? <canvas ref={canvasRef} className="audio-visualizer" /> : null;
}

function ProgressDrawing({ share }) {
  const shown = useAppStore((s) => !s.behaviorHideProgressBar);
  if (!shown) return null;
  return (
    <div className="song-progress-bar">
      <div className="song-progress-fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
    </div>
  );
}

// a playing song's screen, with the progress along the top and the visualizer along the bottom.
function PlayingScreen({ since, playing, children }) {
  return (
    <>
      {playing && <BarsDrawing />}
      <ProgressDrawing share={playing ? 0.04 + Math.max(0, since) / 60000 : 0} />
      <div className="gs-center">
        <div className="primary-widget"><div className="primary-content">{children}</div></div>
      </div>
    </>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="folder-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// the panel beside the folders, about the folder picked or the library as a whole.
function InfoDrawing({ folder, playing, tapes, open = false }) {
  if (!folder) {
    return (
      <aside className="folder-info">
        <div className="folder-info-head"><span className="folder-info-name">Your library</span></div>
        <dl className="folder-info-rows">
          <InfoRow label="In Downstream">{FOLDERS.length} folders</InfoRow>
          <InfoRow label="Elsewhere">0 folders</InfoRow>
          <InfoRow label="Mixtapes">1</InfoRow>
        </dl>
        <p className="folder-info-note">Click a folder or mixtape to open it, or double-click a folder to play it.</p>
      </aside>
    );
  }
  const on = tapes.filter((tape) => tape.folders.includes(folder.name)).map((tape) => tape.name);
  return (
    <aside className="folder-info">
      <div className="folder-info-head">
        <span className="folder-cover"><img src={folder.cover} alt="" draggable={false} /></span>
        <span className="folder-info-name">{folder.name}</span>
        <span className="folder-info-where">In the Downstream folder</span>
      </div>
      <button type="button" className="search-add folder-info-play" data-guide="folder-play">
        {playing ? 'Back to the player' : (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
            Play
          </>
        )}
      </button>
      {!open && <button type="button" className="folders-footer-btn folder-info-play">Show media</button>}
      <dl className="folder-info-rows">
        <InfoRow label="Tracks">{folder.tracks}</InfoRow>
        <InfoRow label="Playtime">{Math.round(folder.tracks * 3.4)} min</InfoRow>
        <InfoRow label="Size">{folder.tracks * 8} MB</InfoRow>
        <InfoRow label="Formats">MP3 {folder.tracks}</InfoRow>
        <InfoRow label="Mixtapes">{on.length ? on.join(', ') : 'None'}</InfoRow>
        <InfoRow label="Last played">Never</InfoRow>
      </dl>
    </aside>
  );
}

function MosaicDrawing({ folders, size }) {
  return (
    <span className={`folder-cover folder-mosaic${size ? ` folder-cover-${size}` : ''}`}>
      {folders.slice(0, size === 'small' ? 4 : 9).map((name) => <img key={name} src={folderOf(name).cover} alt="" draggable={false} />)}
    </span>
  );
}

// the player's folder screen, with its tabs, cards, footer and the panel about what's picked.
// an open folder takes the grid's place, with the way back where the tabs were, and brings its own search, footer and panel.
function FoldersDrawing({ tab = 'folders', selected = null, playing = null, dragging = null, tapes, toast = null, undo = false, pressing = null, open = null, counts = {} }) {
  const folder = folderOf(dragging || selected);
  return (
    <div className="folders">
      <div className="folders-top">
        <div className="folders-search">
          <SearchIcon size={14} />
          <input type="text" className="url-input" placeholder={open ? `Search ${open.name}` : tab === 'folders' ? `Search ${FOLDERS.length} folders and their media` : `Search ${tapes.length} mixtape${tapes.length === 1 ? '' : 's'}`} readOnly />
        </div>
        <select className="folders-sort" value={open ? 'name' : 'custom'} onChange={noop}>
          <option value="custom">Your order</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div className="folders-panes">
        {open ? (
          <div className="search-tabs folders-tabs folders-crumbs">
            <button type="button" className="search-tab folders-crumb-back"><Chevron back />Folders</button>
            <span className="search-tab search-tab-active folders-crumb-here">
              <span className="folders-crumb-name">{open.name}</span>
              <button type="button" className="folder-card-more folders-crumb-more"><MoreIcon /></button>
            </span>
          </div>
        ) : (
          <div className="search-tabs folders-tabs">
            <button type="button" className={`search-tab${tab === 'folders' ? ' search-tab-active' : ''}`} data-guide="tab-folders">
              Folders<span className="folders-tab-count">{FOLDERS.length}</span>
              {playing && <span className="folders-tab-live" />}
            </button>
            <button type="button" className={`search-tab${tab === 'mixtapes' ? ' search-tab-active' : ''}${pressing === 'tab-mixtapes' ? ' gs-pressed' : ''}`} data-guide="tab-mixtapes">
              Mixtapes<span className="folders-tab-count">{tapes.length}</span>
            </button>
          </div>
        )}
        <div className="folders-split">
          <div className="folders-body">
            <div className="folders-stage">
              <div className="folders-list gs-folders-list">
                {open ? open.page : tab === 'folders' ? (
                  <div className="folders-grid">
                    {FOLDERS.map((f) => (
                      <FolderCardDrawing
                        key={f.name}
                        folder={counts[f.name] ? { ...f, tracks: counts[f.name] } : f}
                        className={[selected === f.name && 'folder-card-selected', playing === f.name && 'folder-card-playing', dragging === f.name && 'folder-card-dragging'].filter(Boolean).join(' ')}
                        meta={playing === f.name ? 'Playing' : null}
                        live={playing === f.name}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="folders-grid">
                    {tapes.map((tape) => (
                      <div key={tape.name} className="folder-card folder-tile" data-guide={`tape-${tape.name}`}>
                        <MosaicDrawing folders={tape.folders} />
                        <span className="folder-card-name">{tape.name}</span>
                        <span className="folder-card-meta">{tape.folders.length} folders</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {open?.footer || <div className="folders-footer">
              {tab === 'folders' ? (
                <>
                  <span className="folders-footer-count">{FOLDERS.length} folders</span>
                  <button type="button" className="folders-footer-btn">Add folders</button>
                  <button type="button" className="search-add folders-add"><PlusIcon size={13} />New folder</button>
                </>
              ) : (
                <>
                  <span className="folders-footer-count">{tapes.length} mixtape{tapes.length === 1 ? '' : 's'}</span>
                  <button type="button" className="search-add folders-add"><PlusIcon size={13} />New mixtape</button>
                </>
              )}
            </div>}
          </div>
          {open?.info || <InfoDrawing folder={folder && counts[folder.name] ? { ...folder, tracks: counts[folder.name] } : folder} playing={playing && playing === folder?.name} tapes={tapes} open={!!open} />}
        </div>
      </div>
      {toast && (
        <div className="folder-toast folder-toast-done">
          <CheckIcon />
          <span>{toast}</span>
          {undo && <button type="button" className="folder-toast-undo">Undo</button>}
        </div>
      )}
    </div>
  );
}

const WEEKEND = { name: 'Weekend', folders: ['Road Trip', 'Summer'] };

const FOLDERS_STOPS = [
  [0, null],
  [900, 'Late Night'],
  [1600, 'Late Night', true],
  [2300, 'folder-play'],
  [3000, 'folder-play', true],
  [3400, null],
];

// a folder is opened from the folder screen and played from the panel beside it, which brings up the player.
export function FoldersScene() {
  const scene = useRef(null);
  const t = useClock(8500, 2600);
  const { pressing } = follow(t, FOLDERS_STOPS);
  const open = t >= 1600;
  const playing = t >= 3250;
  const measuring = useMeasuring(playing ? t - 3250 : -1);
  return (
    <Screen width={1050} height={480} scene={scene}>
      {playing ? (
        <div className="gs-swap gs-fill">
          <PlayingScreen since={t - 3250} playing>
            <PlayerDrawing title={TRACKS[0]} folder="Late Night" playing measuring={measuring} />
          </PlayingScreen>
        </div>
      ) : (
        <div className={`gs-center${t >= 3000 ? ' gs-leaving' : ''}`}>
          <div className="primary-widget primary-widget-folders" style={{ width: 760 }}>
            <div className="primary-content">
              <FoldersDrawing
                selected={t >= 1600 ? 'Late Night' : null}
                tapes={[WEEKEND]}
                pressing={pressing}
                open={open ? { name: 'Late Night', page: <OpenFolderDrawing />, footer: <OpenFooterDrawing /> } : null}
              />
            </div>
          </div>
        </div>
      )}
      <Pointer scene={scene} t={t} stops={FOLDERS_STOPS} />
    </Screen>
  );
}

const MIXTAPE_STOPS = [
  [0, null],
  [800, 'Focus'],
  [1500, 'Focus', true],
  [2100, 'zone-Weekend'],
  [3300, 'zone-Weekend', true],
  [4300, 'tab-mixtapes'],
  [5000, 'tab-mixtapes', true],
  [5800, null],
];

// a folder is dragged onto a mixtape in the row that comes up under the panel, which then has it on the mixtapes tab.
export function MixtapeScene() {
  const scene = useRef(null);
  const t = useClock(10000, 2800);
  const { pressing } = follow(t, MIXTAPE_STOPS);
  const dragging = t >= 1500 && t < 3300;
  const over = t >= 2650 && t < 3300;
  const dropped = t >= 3300;
  const tape = dropped ? { ...WEEKEND, folders: [...WEEKEND.folders, 'Focus'] } : WEEKEND;
  const focus = folderOf('Focus');
  return (
    <Screen width={860} height={450} scene={scene}>
      <div className="gs-frame" style={{ width: 860, height: 450 }}>
      <div className="primary-widget primary-widget-folders gs-anchored" style={{ left: 190, top: 10, width: 640 }}>
        <div className="primary-content">
          <FoldersDrawing
            tab={t >= 5000 ? 'mixtapes' : 'folders'}
            dragging={dragging ? 'Focus' : null}
            tapes={[tape]}
            toast={dropped && t < 7600 ? `Added "Focus" to ${WEEKEND.name}.` : null}
            pressing={pressing}
          />
        </div>
      </div>
      {dragging && (
        <>
          <div className="folders-zone folders-zone-side" style={{ right: 860 - 180, top: 183 }}>
            <div className="folders-zone-inner">
              <div className="folders-zone-target" data-danger="">
                <Icon size={18} width={1.8}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" /></Icon>
                <span>Delete</span>
              </div>
              <div className="folders-zone-target">
                <PinIcon size={16} />
                <span>Pin to top</span>
              </div>
            </div>
          </div>
          <div className="folders-zone folders-zone-below" style={{ left: 190 + 320, top: 367 }}>
            <div className="folders-zone-inner">
              <div className="folders-zone-target">
                <span className="folders-zone-tape-icon"><PlusIcon size={14} /></span>
                <span>New mixtape</span>
              </div>
              <div className={`folders-zone-target${over ? ' folders-zone-target-over' : ''}`} data-guide="zone-Weekend">
                <MosaicDrawing folders={WEEKEND.folders} size="small" />
                <span className="folders-zone-name">{WEEKEND.name}</span>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
      <Pointer scene={scene} t={t} stops={MIXTAPE_STOPS} carry={dragging && <FolderCardDrawing folder={focus} />} />
    </Screen>
  );
}

// late night's media, with lengths in seconds.
const MEDIA = [['Afterglow', 222], ['Blue Hour Radio', 255], ['Golden Hour', 209], ['Midnight Static', 231], ['Neon Rain', 242], ['Paper Moons', 178]]
  .map(([name, length]) => ({ name, length, path: `guide/${name}` }));
const MOVING = ['Golden Hour', 'Midnight Static'];
const checkOf = (name) => `[data-media="guide/${name}"] .search-row-check`;

const MEDIA_STOPS = [
  [0, null],
  [800, 'Late Night'],
  [1300, 'Late Night', true],
  [2100, checkOf('Golden Hour')],
  [2600, checkOf('Golden Hour'), true],
  [3200, checkOf('Midnight Static')],
  [3700, checkOf('Midnight Static'), true],
  [4400, 'move-to'],
  [4900, 'move-to', true],
  [5600, 'move-Focus'],
  [6100, 'move-Focus', true],
  [6600, null],
];

// late night opened in the grid's place, grown out of its card the way the folder screen works it out.
// the song under the pointer shows its tick circle, as a hovered row does.
function OpenFolderDrawing({ shown = MEDIA, picked = [], hovered = null }) {
  return (
    <div className="folders-view folders-view-open" style={{ '--open-x': '178px', '--open-y': '64px' }}>
      <div className={`folders-page folders-songs${picked.length ? ' folders-songs-picking' : ''}`}>
        {shown.map((m) => <MediaRow key={m.path} file={m} picked={picked.includes(m.name)} length={m.length} onMore={noop} className={hovered === m.name ? 'gs-row-hover' : ''} />)}
      </div>
    </div>
  );
}

function OpenFooterDrawing() {
  return (
    <div className="folders-footer">
      <span className="folders-footer-count">Drop files here to add them</span>
      <button type="button" className="search-add folders-add"><PlusIcon size={13} />Add media</button>
    </div>
  );
}

// the folders media can move to, opened from the footer, with the folder it's in set aside.
// like the app's, it floats over everything rather than inside the panel, starting at the button's left edge and ending just above it.
function MoveMenuDrawing({ scene, anchor, over }) {
  const [at, setAt] = useState(null);
  useLayoutEffect(() => {
    const box = scene.current;
    const el = box?.querySelector(selector(anchor));
    if (!el) return;
    const frame = box.getBoundingClientRect();
    const scale = frame.width / box.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    const next = { left: (r.left - frame.left) / scale, bottom: box.offsetHeight - (r.top - frame.top) / scale + 4 };
    if (!at || Math.abs(at.left - next.left) > 0.5 || Math.abs(at.bottom - next.bottom) > 0.5) setAt(next);
  });
  return (
    <div className="queue-ctx-menu folders-menu gs-menu-above" style={at || { visibility: 'hidden' }}>
      <div className="folders-menu-title">{`Move ${MOVING.length} tracks to`}</div>
      <div className="folders-menu-sep" />
      <div className="folders-menu-scroll">
        {FOLDERS.map((f) => (
          <button key={f.name} type="button" className={`queue-ctx-item folders-menu-folder${over === `move-${f.name}` ? ' gs-hover' : ''}`} disabled={f.name === 'Late Night'} data-guide={`move-${f.name}`}>
            <span className="folder-cover"><img src={f.cover} alt="" draggable={false} /></span>
            <span className="folders-menu-name">{f.name}</span>
            {f.name === 'Late Night' && <span className="folders-menu-note">Here</span>}
          </button>
        ))}
      </div>
      <div className="folders-menu-sep" />
      <button type="button" className="queue-ctx-item">New folder...</button>
    </div>
  );
}

// a click opens a folder to its media, two songs are ticked, and move to sends them to another folder.
export function MediaScene() {
  const scene = useRef(null);
  const t = useClock(10300, 5300);
  const { place, pressing } = follow(t, MEDIA_STOPS);
  const lateNight = folderOf('Late Night');
  const open = t >= 1350;
  const moved = t >= 6150;
  const picked = moved ? [] : [t >= 2650 && 'Golden Hour', t >= 3750 && 'Midnight Static'].filter(Boolean);
  const menu = t >= 4950 && !moved;
  const shown = moved ? MEDIA.filter((m) => !MOVING.includes(m.name)) : MEDIA;
  const count = lateNight.tracks - (moved ? MOVING.length : 0);
  const pickedInfo = picked.length === 1 ? (
    <aside className="folder-info">
      <div className="folder-info-head">
        <span className="folder-cover"><img src={lateNight.cover} alt="" draggable={false} /></span>
        <span className="folder-info-name">Golden Hour</span>
        <span className="folder-info-where">In Late Night</span>
      </div>
      <button type="button" className="search-add folder-info-play">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
        Play
      </button>
      <dl className="folder-info-rows">
        <InfoRow label="Length">3:29</InfoRow>
        <InfoRow label="Size">8 MB</InfoRow>
        <InfoRow label="Format">MP3</InfoRow>
        <InfoRow label="Modified">Mar 3</InfoRow>
      </dl>
    </aside>
  ) : (
    <aside className="folder-info">
      <div className="folder-info-head">
        <span className="folder-cover"><NoteGlyph /></span>
        <span className="folder-info-name">{MOVING.length} tracks</span>
        <span className="folder-info-where">From Late Night</span>
      </div>
      <dl className="folder-info-rows">
        <InfoRow label="Playtime">7 min</InfoRow>
        <InfoRow label="Size">15 MB</InfoRow>
        <InfoRow label="Formats">MP3 2</InfoRow>
      </dl>
      <p className="folder-info-note">Move them with Move to, or drag them onto another folder.</p>
    </aside>
  );
  const hovered = MEDIA.find((m) => place === checkOf(m.name))?.name || null;
  const page = <OpenFolderDrawing shown={shown} picked={picked} hovered={hovered} />;
  const footer = picked.length ? (
    <div className="folders-footer">
      <span className="folders-footer-count">
        {picked.length} selected
        <button type="button" className="search-footer-clear">Clear</button>
      </span>
      <button type="button" className="folders-footer-btn folder-info-danger">Delete</button>
      <button type="button" className={`search-add folders-add${pressing === 'move-to' ? ' gs-pressed' : ''}`} data-guide="move-to">Move to...</button>
    </div>
  ) : <OpenFooterDrawing />;
  return (
    <Screen width={1050} height={480} scene={scene}>
      <div className="gs-center">
        <div className="primary-widget primary-widget-folders" style={{ width: 760 }}>
          <div className="primary-content">
            <FoldersDrawing
              selected={t >= 1350 ? 'Late Night' : null}
              tapes={[WEEKEND]}
              pressing={pressing}
              counts={moved ? { 'Late Night': count, Focus: folderOf('Focus').tracks + MOVING.length } : {}}
              toast={moved && t < 9300 ? `Moved ${MOVING.length} tracks to Focus.` : null}
              undo
              open={open ? { name: 'Late Night', page, footer, info: picked.length ? pickedInfo : null } : null}
            />
          </div>
        </div>
      </div>
      {menu && <MoveMenuDrawing scene={scene} anchor="move-to" over={place} />}
      <Pointer scene={scene} t={t} stops={MEDIA_STOPS} />
    </Screen>
  );
}

const PLAYER_STOPS = [
  [0, null],
  [700, 'play'],
  [1300, 'play', true],
  [2800, 'shuffle'],
  [3400, 'shuffle', true],
  [4300, 'next'],
  [4900, 'next', true],
  [5900, null],
];

// play is pressed, shuffle turned on, and the next song played.
export function PlayerScene() {
  const scene = useRef(null);
  const t = useClock(9000, 3600);
  const { pressing } = follow(t, PLAYER_STOPS);
  const playing = t >= 1350;
  const next = t >= 4950;
  const measuring = useMeasuring(playing ? t - 1350 : -1);
  return (
    <Screen width={880} height={400} scene={scene}>
      <PlayingScreen since={next ? t - 4950 : t - 1350} playing={playing}>
        <PlayerDrawing title={TRACKS[next ? 1 : 0]} playing={playing} shuffle={t >= 3450} measuring={measuring} pressing={pressing} />
      </PlayingScreen>
      <Pointer scene={scene} t={t} stops={PLAYER_STOPS} />
    </Screen>
  );
}

const EQ_PRESETS = ['Balanced', 'Bass Boost', 'Treble', 'Smooth', 'Dynamic', 'Clear', 'Amplified'];
const BASS_BOOST = [5, 4.5, 3.5, 2, 0.5, 0, 0, 0, 0, 0];
const BANDS = ['31Hz', '63Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
const GROUPS = [['SUB BASS', '1 / 3'], ['BASS', '3 / 5'], ['LOW MIDS', '5 / 6'], ['MID RANGE', '6 / 8'], ['UPPER MID', '8 / 9'], ['TREBLE', '9 / 11']];

// the equalizer over the player, as the eq chip opens it.
function EqDrawing({ preset, closing, pressing }) {
  return (
    <div className={`eq-backdrop${closing ? ' eq-backdrop-closing' : ''}`}>
      <div className={`eq-panel${closing ? ' eq-panel-closing' : ''}`} style={{ height: 340 }}>
        <div className="eq-header">
          <h2>Equalizer</h2>
          <div className="eq-header-actions">
            <button type="button" className="eq-reset-btn">Reset</button>
            <button type="button" className={`eq-close-btn${pressing === 'eq-close' ? ' gs-pressed' : ''}`} data-guide="eq-close"><Close size={14} /></button>
          </div>
        </div>
        <div className="eq-presets">
          {EQ_PRESETS.map((name) => (
            <button key={name} type="button" className={`eq-preset-btn${preset === name ? ' eq-preset-active' : ''}`} data-guide={`preset-${name}`}>{name}</button>
          ))}
        </div>
        <div className="eq-db-labels"><span>+6dB</span><span>+3dB</span><span>0</span><span>-3dB</span><span>-6dB</span></div>
        <div className="eq-bands">
          {BANDS.map((label, i) => (
            <div className="eq-band" key={label}>
              <div className="eq-slider-track">
                <div className="eq-grid-line eq-grid-6" />
                <div className="eq-grid-line eq-grid-3" />
                <div className="eq-grid-line eq-grid-0" />
                <div className="eq-grid-line eq-grid-n3" />
                <div className="eq-grid-line eq-grid-n6" />
                <input type="range" className="eq-slider" min={-6} max={6} step={0.5} value={preset === 'Bass Boost' ? BASS_BOOST[i] : 0} onChange={noop} orient="vertical" />
              </div>
              <span className="eq-freq-label">{label}</span>
            </div>
          ))}
        </div>
        <div className="eq-group-labels">
          {GROUPS.map(([name, column]) => <span key={name} style={{ gridColumn: column }}>{name}</span>)}
        </div>
      </div>
    </div>
  );
}

// the settings window on the player's side, open on its view page, as the settings chip opens it.
// it doesn't change as the scene's clock ticks, so it's only drawn once.
const SettingsDrawing = memo(() => {
  return (
    <div className="settings-backdrop">
      <div className="settings-modal" style={{ width: 680, height: 400 }}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <div className="settings-sides">
            {SIDES.map((side) => <SideButton key={side.id} side={side} active={side.id === 'player'} onClick={noop} />)}
          </div>
          <button type="button" className="settings-close"><Close size={16} /></button>
        </div>
        <div className="settings-main">
          <nav className="settings-nav">
            <label className="settings-search">
              <SearchIcon size={12} />
              <input type="text" placeholder="Search all settings" readOnly />
            </label>
            {sidePages('player').map((p) => <PageButton key={p.id} page={p} active={p.id === 'view'} onClick={noop} />)}
          </nav>
          <div className="settings-body">
            <div className="settings-page-head"><h3 className="settings-page-title">View</h3></div>
            <ViewPage />
          </div>
        </div>
      </div>
    </div>
  );
});

// how long each chip's turn lasts.
const TURN_MS = 4200;

function chipStops(parts) {
  const stops = [[0, null]];
  parts.forEach((part, i) => {
    const s = i * TURN_MS;
    stops.push([s + 500, part], [s + 1100, part, true]);
    if (part === 'eq') stops.push([s + 1800, 'preset-Bass Boost'], [s + 2400, 'preset-Bass Boost', true], [s + 3100, 'eq-close'], [s + 3600, 'eq-close', true]);
    stops.push([s + (part === 'eq' ? 4000 : 1800), null]);
  });
  return stops;
}

// the chips under the player, each pressed in turn: eq opens the equalizer, and settings opens the settings.
// songs are measured under the player all the while, since normalizing just happens.
export function ChipsScene({ parts = ['eq', 'settings'] }) {
  const scene = useRef(null);
  const loop = parts.length * TURN_MS + (parts.includes('settings') ? 1800 : 600);
  const t = useClock(loop, 2700);
  const key = parts.join(' ');
  const stops = useMemo(() => chipStops(key.split(' ')), [key]);
  const { pressing } = follow(t, stops);
  const measuring = useMeasuring(t);
  const start = (part) => parts.indexOf(part) * TURN_MS;
  const since = (part) => (parts.includes(part) ? t - start(part) : -1);
  const eq = since('eq');
  const settings = since('settings');
  const eqOpen = eq >= 1150 && eq < 3950;
  return (
    <Screen width={970} height={440} scene={scene}>
      <PlayingScreen since={t} playing>
        <PlayerDrawing
          title={TRACKS[0]}
          playing
          measuring={measuring}
          settings={settings >= 1150}
          pressing={pressing}
        />
      </PlayingScreen>
      {eqOpen && <EqDrawing preset={eq >= 2450 ? 'Bass Boost' : 'Balanced'} closing={eq >= 3650} pressing={pressing} />}
      {settings >= 1150 && <SettingsDrawing />}
      <Pointer scene={scene} t={t} stops={stops} />
    </Screen>
  );
}
