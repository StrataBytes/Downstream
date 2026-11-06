import { useEffect, useState } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { onMediaChanged, dirOf, trackCount } from '../services/mediaFiles';
import { folderName, baseName } from '../services/musicLibrary';
import { Cover, MoreIcon, CheckIcon, counts } from './FolderGrid';

// lengths read this session, so rows show them straight away when they come back into view.
const lengths = new Map();
const lengthListeners = new Set();

function readLengths(paths) {
  const wanted = paths.filter((p) => !lengths.has(p));
  if (!wanted.length) return;
  wanted.forEach((p) => lengths.set(p, undefined));
  const show = (found) => {
    Object.entries(found).forEach(([p, d]) => { if (d.duration !== null) lengths.set(p, d.duration); });
    lengthListeners.forEach((redraw) => redraw());
  };
  // the ones already known come back first, and the rest are read after.
  window.electronAPI.mediaDetails(wanted, false).then((found) => {
    show(found);
    const unknown = wanted.filter((p) => found[p]?.duration === null);
    if (unknown.length) window.electronAPI.mediaDetails(unknown, true).then(show);
  });
}

// each song's length in seconds, undefined until it's known.
export function useMediaLengths(paths) {
  const [, redraw] = useState(0);
  const key = paths.join('\n');
  useEffect(() => {
    const fn = () => redraw((n) => n + 1);
    lengthListeners.add(fn);
    return () => lengthListeners.delete(fn);
  }, []);
  useEffect(() => {
    readLengths(paths);
  }, [key]);
  return lengths;
}

export function formatLength(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

// a folder's media, read again whenever it changes inside downstream or downstream is back in front.
// null while it's first read.
export function useFolderMedia(path) {
  const [files, setFiles] = useState(null);
  useEffect(() => {
    setFiles(null);
    if (!path) return;
    let alive = true;
    const read = () => window.electronAPI.readMusicFolder(path, getAcceptedExtensions(useAppStore.getState())).then((found) => {
      if (alive) setFiles([...found].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    });
    read();
    const stop = onMediaChanged((dirs) => { if (dirs.includes(path)) read(); });
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      stop();
      window.removeEventListener('focus', read);
    };
  }, [path]);
  return files;
}

export function NoteGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

// a song as a row to tick, with its length and a menu.
// in search results it also shows the folder it's in.
export function MediaRow({ file, folder = null, picked = false, playing = false, dragging = false, length, onMore, className = '', ...rest }) {
  const classes = [
    'search-row',
    'folders-song-row',
    className,
    picked && 'search-row-picked',
    playing && 'folders-song-playing',
    dragging && 'folders-song-dragging',
  ].filter(Boolean).join(' ');
  return (
    <div role="button" tabIndex={0} data-media={file.path} className={classes} title={file.path} {...rest}>
      <span className="search-row-check"><CheckIcon /></span>
      {folder && <Cover folder={folder} />}
      <span className="search-row-info">
        <span className="search-row-title">{file.name}</span>
        {folder && <span className="search-row-meta">In {folderName(folder)}</span>}
      </span>
      <span className="folders-song-length">{formatLength(length)}</span>
      <button className="folder-card-more" title="More" onClick={(e) => { e.stopPropagation(); onMore(e); }}>
        <MoreIcon />
      </button>
    </div>
  );
}

export const REVEAL_LABEL = { darwin: 'Show in Finder', win32: 'Show in File Explorer', linux: 'Show in Files' }[window.electronAPI.platform] || 'Open folder';

// the folders media can move to, with the one it's in now set aside, and those on another drive marked since moving there copies.
export function MoveList({ files, folders, drives, head, onMove, onNew }) {
  const here = [...new Set(files.map((f) => dirOf(f.path)))];
  const drive = drives[here[0]];
  return (
    <>
      {head}
      <div className="folders-menu-sep" />
      <div className="folders-menu-scroll">
        {folders.filter((f) => counts.get(f.path) !== null).map((f) => {
          const isHere = here.length === 1 && here[0] === f.path;
          const far = !isHere && drive !== undefined && drives[f.path] !== undefined && drives[f.path] !== drive;
          return (
            <button key={f.path} className="queue-ctx-item folders-menu-folder" disabled={isHere} onClick={() => onMove(f.path)}>
              <Cover folder={f} />
              <span className="folders-menu-name">{folderName(f)}</span>
              {isHere ? <span className="folders-menu-note">Here</span> : far && <span className="folders-menu-note">Other drive</span>}
            </button>
          );
        })}
      </div>
      <div className="folders-menu-sep" />
      <button className="queue-ctx-item" onClick={onNew}>New folder...</button>
    </>
  );
}

// the choice media from elsewhere asks for, in the words importing a folder uses.
export function AddChoice({ paths, dir, skipped, onChoose }) {
  const from = [...new Set(paths.map(dirOf))];
  return (
    <>
      <div className="folders-menu-title">{`Add ${trackCount(paths.length)} to ${baseName(dir)}`}</div>
      <p className="folders-menu-text">
        {from.length === 1 ? `From ${baseName(from[0])}.` : `From ${from.length} folders.`}
        {skipped > 0 && ` ${skipped === 1 ? 'One file' : `${skipped} files`} Downstream can't play will be left out.`}
      </p>
      <button className="queue-ctx-item" onClick={() => onChoose(false)}>
        <span>Copy</span>
        <span className="folders-menu-note">Keeps the originals</span>
      </button>
      <button className="queue-ctx-item" onClick={() => onChoose(true)}>
        <span>Move</span>
        <span className="folders-menu-note">Removes the originals</span>
      </button>
    </>
  );
}

// which drive each folder is on, read while a list of folders to move to is open.
export function useDrives(open) {
  const [drives, setDrives] = useState({});
  useEffect(() => {
    if (!open) return;
    window.electronAPI.folderDrives(useAppStore.getState().library.folders.map((f) => f.path)).then(setDrives);
  }, [open]);
  return drives;
}
