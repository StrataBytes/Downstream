import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { folderName, onFolderMoved } from '../services/musicLibrary';
import { onMediaChanged } from '../services/mediaFiles';

// covers and track counts last the whole session, so reopening the screen shows them right away.
// a cover is undefined while it loads, and null when the folder has no art.
export const covers = new Map();
export const counts = new Map();
const coverListeners = new Set();
let coverChain = Promise.resolve();

// a folder that's renamed, imported or moved keeps its cover and count.
onFolderMoved((from, to) => {
  if (covers.has(from)) covers.set(to, covers.get(from));
  if (counts.has(from)) counts.set(to, counts.get(from));
});

// folders whose media changed inside downstream are counted again straight away, and their covers looked at again.
onMediaChanged(async (dirs) => {
  const known = new Set(useAppStore.getState().library.folders.map((f) => f.path));
  const mine = dirs.filter((d) => known.has(d));
  if (!mine.length) return;
  const found = await window.electronAPI.scanMusicFolders(mine, getAcceptedExtensions(useAppStore.getState()));
  Object.entries(found).forEach(([p, n]) => counts.set(p, n));
  coverListeners.forEach((redraw) => redraw());
  mine.forEach((p) => requestCover(p, true));
});

// video files are left out, since their first frame isn't album art.
const coverExts = () => getAcceptedExtensions(useAppStore.getState()).filter((e) => e !== 'mp4');

export function requestCover(path, refresh = false) {
  if (!refresh && covers.has(path)) return;
  if (!refresh) covers.set(path, undefined);
  coverChain = coverChain
    .then(() => window.electronAPI.getFolderCover(path, coverExts(), refresh))
    .catch(() => null)
    .then((url) => {
      covers.set(path, url || null);
      coverListeners.forEach((redraw) => redraw());
    });
}

export function useLibraryDetails(paths) {
  const [, redraw] = useState(0);
  const key = paths.join('\n');
  useEffect(() => {
    const fn = () => redraw((n) => n + 1);
    coverListeners.add(fn);
    return () => coverListeners.delete(fn);
  }, []);
  // counts are read again when downstream is back in front, since files may have changed in finder or file explorer.
  useEffect(() => {
    let alive = true;
    paths.forEach((p) => requestCover(p));
    const scan = () => window.electronAPI.scanMusicFolders(paths, getAcceptedExtensions(useAppStore.getState())).then((found) => {
      Object.entries(found).forEach(([p, n]) => {
        // a folder that was empty may have album art now.
        if (n && !counts.get(p) && covers.get(p) === null) {
          covers.delete(p);
          requestCover(p);
        }
        counts.set(p, n);
      });
      if (alive) redraw((n) => n + 1);
    });
    scan();
    window.addEventListener('focus', scan);
    return () => {
      alive = false;
      window.removeEventListener('focus', scan);
    };
  }, [key]);
}

export function FolderGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function TapeGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <circle cx="16" cy="11" r="2" />
      <path d="M6 19l2-4h8l2 4" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function Chevron({ back = false }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={back ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function PinIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" />
    </svg>
  );
}

export function Cover({ folder }) {
  const art = covers.get(folder.path);
  if (!folder.color && art) {
    return <span className="folder-cover"><img src={art} alt="" draggable={false} /></span>;
  }
  return (
    <span className={`folder-cover${folder.color ? ' folder-cover-tinted' : ''}`} style={folder.color ? { '--folder-color': folder.color } : undefined}>
      <FolderGlyph />
    </span>
  );
}

// a name field that saves on enter or when it loses focus, and cancels on escape.
export function NameInput({ value, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (text) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <input
      ref={ref}
      className="folders-name-input"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}


// what a folder card says under its name.
export function folderMeta(folder, { playing = false, importing = null } = {}) {
  if (importing) {
    const share = importing.total ? Math.floor((importing.done / importing.total) * 100) : 0;
    return `${importing.move ? 'Moving' : 'Copying'} ${share}%`;
  }
  if (playing) return 'Playing';
  const count = counts.get(folder.path);
  if (count === null) return 'Missing';
  if (count === undefined) return '';
  return count === 0 ? 'No tracks' : `${count} ${count === 1 ? 'track' : 'tracks'}`;
}

// a folder as a card: its cover, name and a line about it.
// the screen showing it passes in how it's clicked, dragged and marked.
export function FolderCard({ folder, meta, live = false, pinned = false, naming = false, onNamed, onMore, progress = null, className = '', ...rest }) {
  return (
    <div data-path={folder.path} role="button" tabIndex={0} className={`folder-card${className ? ` ${className}` : ''}`} title={folder.path} {...rest}>
      <Cover folder={folder} />
      {pinned && <span className="folder-card-pin" title="Pinned"><PinIcon /></span>}
      {naming ? (
        <NameInput value={folderName(folder)} onDone={onNamed} />
      ) : (
        <span className="folder-card-name">{folderName(folder)}</span>
      )}
      <span className={`folder-card-meta${live ? ' folder-card-live' : ''}`}>{meta}</span>
      {onMore && (
        <button className="folder-card-more" title="More" onClick={onMore}>
          <MoreIcon />
        </button>
      )}
      {progress !== null && <span className="folder-card-progress" style={{ width: `calc((100% - 20px) * ${progress})` }} />}
    </div>
  );
}

// how long a card takes to slide to its new place.
const SLIDE_MS = 220;

// how far a card still is from where it's sliding to.
function slideLeft(card) {
  const [x = '0', y = '0'] = getComputedStyle(card).translate.split(' ');
  return { x: parseFloat(x) || 0, y: parseFloat(y) || 0 };
}

// cards slide from where they were to their new places whenever their order changes, even partway through a slide.
// anything else that moves them, like the window being resized, moves them straight away.
export function useSlidingCards(gridRef, order) {
  const places = useRef(new Map());
  const lastOrder = useRef(order);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // lite mode's no animations setting has them jump straight there.
    const reordered = lastOrder.current !== order && !document.body.classList.contains('lite-no-anim');
    lastOrder.current = order;
    const next = new Map();
    for (const card of grid.querySelectorAll(':scope > [data-path]')) {
      const to = { x: card.offsetLeft, y: card.offsetTop };
      const from = places.current.get(card.dataset.path);
      next.set(card.dataset.path, to);
      if (!reordered || !from || (from.x === to.x && from.y === to.y)) continue;
      const now = slideLeft(card);
      card.getAnimations().filter((a) => a.id === 'slide').forEach((a) => a.cancel());
      card.animate(
        [{ translate: `${from.x + now.x - to.x}px ${from.y + now.y - to.y}px` }, { translate: '0 0' }],
        { id: 'slide', duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      );
    }
    places.current = next;
  });
}

// a grid of folder cards that slide into their new places when they're reordered.
export function SlidingGrid({ order, children, ...rest }) {
  const ref = useRef(null);
  useSlidingCards(ref, order);
  return <div ref={ref} className="folders-grid" {...rest}>{children}</div>;
}

function MiniCover({ folder }) {
  const art = covers.get(folder.path);
  if (!folder.color && art) return <img src={art} alt="" draggable={false} />;
  return <span className="folder-mosaic-tint" style={folder.color ? { '--folder-color': folder.color } : undefined} />;
}

// a mixtape's cover, a frosted square holding the covers of its first folders, filled from the top left like a folder in launchpad.
// the small one in the drag zones only fits four.
export function Mosaic({ folders, size }) {
  const shown = folders.slice(0, size === 'small' ? 4 : 9);
  return (
    <span className={`folder-cover folder-mosaic${size ? ` folder-cover-${size}` : ''}`}>
      {shown.length === 0 ? <TapeGlyph size={size === 'small' ? 12 : 20} /> : shown.map((f) => <MiniCover key={f.path} folder={f} />)}
    </span>
  );
}
