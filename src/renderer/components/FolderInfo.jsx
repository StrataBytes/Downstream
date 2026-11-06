import { useEffect, useState } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { folderName, isNative, sourceName, baseName } from '../services/musicLibrary';
import { onMediaChanged, dirOf, trackCount } from '../services/mediaFiles';
import { Cover, Mosaic, counts } from './FolderGrid';
import { NoteGlyph, formatLength } from './FolderMedia';

// details already read this session, shown straight away while they're read again.
const remembered = new Map();

// tracks, size and formats come back at once, and the total length follows once every song's length is known.
function useDetails(paths) {
  const key = paths.join('\n');
  const [details, setDetails] = useState(() => remembered.get(key) || null);
  useEffect(() => {
    setDetails(remembered.get(key) || null);
    if (!paths.length) return;
    let alive = true;
    const read = () => {
      const exts = getAcceptedExtensions(useAppStore.getState());
      const show = (d) => {
        remembered.set(key, d);
        if (alive) setDetails(d);
      };
      window.electronAPI.folderDetails(paths, exts, false).then((d) => {
        show(d);
        if (d.unknown > 0 && alive) window.electronAPI.folderDetails(paths, exts, true).then(show);
      });
    };
    read();
    // songs added in finder or by a download are counted when downstream is back in front, and ones moved inside downstream straight away.
    window.addEventListener('focus', read);
    const stop = onMediaChanged((dirs) => { if (paths.some((p) => dirs.includes(p))) read(); });
    return () => {
      alive = false;
      stop();
      window.removeEventListener('focus', read);
    };
  }, [key]);
  return details;
}

// size, format and length of single songs, with every length read.
function useMediaDetails(paths) {
  const key = paths.join('\n');
  const [details, setDetails] = useState(null);
  useEffect(() => {
    setDetails(null);
    let alive = true;
    window.electronAPI.mediaDetails(paths, true).then((d) => { if (alive) setDetails(d); });
    return () => { alive = false; };
  }, [key]);
  return details;
}

function playtime(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return seconds > 0 ? 'Under a minute' : 'None';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function bytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function when(time) {
  if (!time) return 'Never';
  const day = (t) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(Date.now()) - day(time)) / 86400000);
  if (days < 7) return relative.format(-days, 'day').replace(/^./, (c) => c.toUpperCase());
  const sameYear = new Date(time).getFullYear() === new Date().getFullYear();
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function formats(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, n]) => `${ext.toUpperCase()} ${n}`)
    .join(', ');
}

function Row({ label, children }) {
  return (
    <div className="folder-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// the rows every folder and mixtape shares.
function Totals({ details }) {
  if (!details) return <Row label="Tracks">...</Row>;
  return (
    <>
      <Row label="Tracks">{details.tracks}</Row>
      <Row label="Playtime">{details.unknown > 0 ? 'Measuring...' : playtime(details.duration)}</Row>
      <Row label="Size">{details.tracks ? bytes(details.size) : 'None'}</Row>
      {details.tracks > 0 && <Row label="Formats">{formats(details.formats)}</Row>}
    </>
  );
}

function PlayButton({ playing, disabled, onPlay }) {
  return (
    <button className="search-add folder-info-play" disabled={disabled} onClick={onPlay}>
      {playing ? (
        'Back to the player'
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          Play
        </>
      )}
    </button>
  );
}

function FolderDetails({ folder, playingKey, onPlay, onLocate, onShowMedia }) {
  const library = useAppStore((s) => s.library);
  const nativeRoot = useAppStore((s) => s.nativeRoot);
  const details = useDetails([folder.path]);
  const missing = counts.get(folder.path) === null;
  const native = isNative(folder.path, nativeRoot);
  const tapes = library.mixtapes.filter((m) => m.folders.includes(folder.path)).map((m) => m.name);
  return (
    <>
      <div className="folder-info-head">
        <Cover folder={folder} />
        <span className="folder-info-name">{folderName(folder)}</span>
        <span className="folder-info-where" title={folder.path}>
          {native ? 'In the Downstream folder' : folder.path}
        </span>
      </div>
      {missing ? (
        <>
          <p className="folder-info-note">Downstream can't find this folder. It may have been moved, renamed or deleted.</p>
          <button className="folders-footer-btn folder-info-play" onClick={() => onLocate(folder.path)}>Find it again...</button>
        </>
      ) : (
        <>
          <PlayButton playing={playingKey === folder.path} disabled={details?.tracks === 0} onPlay={() => onPlay(folder.path)} />
          {onShowMedia && <button className="folders-footer-btn folder-info-play" onClick={() => onShowMedia(folder.path)}>Show media</button>}
          <dl className="folder-info-rows">
            <Totals details={details} />
            <Row label="Mixtapes">{tapes.length ? tapes.join(', ') : 'None'}</Row>
            <Row label="Last played">{when(folder.lastPlayed)}</Row>
          </dl>
        </>
      )}
    </>
  );
}

function MixtapeDetails({ tape, playingKey, onPlay }) {
  const details = useDetails(tape.folders.map((f) => f.path));
  return (
    <>
      <div className="folder-info-head">
        <Mosaic folders={tape.folders} />
        <span className="folder-info-name">{tape.name}</span>
        <span className="folder-info-where">{tape.temp ? 'Gone when Downstream closes, unless saved' : 'Mixtape'}</span>
      </div>
      <PlayButton playing={playingKey === tape.key} disabled={!tape.folders.length || details?.tracks === 0} onPlay={() => onPlay(tape.key)} />
      <dl className="folder-info-rows">
        <Row label="Folders">{tape.folders.length}</Row>
        {tape.folders.length > 0 && <Totals details={details} />}
        {!tape.temp && <Row label="Last played">{when(tape.lastPlayed)}</Row>}
      </dl>
    </>
  );
}

// one song picked, with where it is and a way to go there.
function MediaDetails({ file, folder, playing, onPlay, onShowFolder }) {
  const details = useMediaDetails([file.path])?.[file.path];
  return (
    <>
      <div className="folder-info-head">
        {folder ? <Cover folder={folder} /> : <span className="folder-cover"><NoteGlyph /></span>}
        <span className="folder-info-name">{file.name}</span>
        <span className="folder-info-where" title={file.path}>In {folder ? folderName(folder) : baseName(dirOf(file.path))}</span>
      </div>
      <PlayButton playing={playing} onPlay={onPlay} />
      {onShowFolder && <button className="folders-footer-btn folder-info-play" onClick={onShowFolder}>Show in folder</button>}
      <dl className="folder-info-rows">
        <Row label="Length">{details ? (details.duration ? formatLength(details.duration) : 'Unknown') : '...'}</Row>
        <Row label="Size">{details ? bytes(details.size) : '...'}</Row>
        <Row label="Format">{details ? details.ext.toUpperCase() : '...'}</Row>
        <Row label="Modified">{details ? when(details.mtime) : '...'}</Row>
      </dl>
    </>
  );
}

// several songs picked, added up.
function PickedDetails({ files }) {
  const details = useMediaDetails(files.map((f) => f.path));
  const items = details ? Object.values(details) : [];
  const dirs = [...new Set(files.map((f) => dirOf(f.path)))];
  const kinds = {};
  items.forEach((d) => { kinds[d.ext] = (kinds[d.ext] || 0) + 1; });
  return (
    <>
      <div className="folder-info-head">
        <span className="folder-cover"><NoteGlyph /></span>
        <span className="folder-info-name">{trackCount(files.length)}</span>
        <span className="folder-info-where">{dirs.length === 1 ? `From ${baseName(dirs[0])}` : `From ${dirs.length} folders`}</span>
      </div>
      <dl className="folder-info-rows">
        <Row label="Playtime">{details ? playtime(items.reduce((n, d) => n + (d.duration || 0), 0)) : '...'}</Row>
        <Row label="Size">{details ? bytes(items.reduce((n, d) => n + d.size, 0)) : '...'}</Row>
        {items.length > 0 && <Row label="Formats">{formats(kinds)}</Row>}
      </dl>
      <p className="folder-info-note">Move them with Move to, or drag them onto another folder.</p>
    </>
  );
}

// how long deleted folders wait before they go for good, as main keeps them.
const DELETED_DAYS = 30;

function DeletedDetails({ item, onRestore, onPurge }) {
  const days = Math.floor((Date.now() - item.deletedAt) / 86400000);
  const left = Math.max(1, DELETED_DAYS - days);
  if (item.kind === 'media') {
    const was = baseName(dirOf(item.from));
    return (
      <>
        <div className="folder-info-head">
          <span className="folder-cover"><NoteGlyph /></span>
          <span className="folder-info-name">{item.name.replace(/\.[^.]+$/, '')}</span>
          <span className="folder-info-where">In Recently deleted</span>
        </div>
        <button className="search-add folder-info-play" onClick={() => onRestore(item.id)}>Restore</button>
        <dl className="folder-info-rows">
          <Row label="Was in">{was}</Row>
          {item.duration > 0 && <Row label="Length">{formatLength(item.duration)}</Row>}
          <Row label="Size">{bytes(item.size || 0)}</Row>
          <Row label="Deleted">{when(item.deletedAt)}</Row>
          <Row label="Gone for good">{`In ${left} ${left === 1 ? 'day' : 'days'}`}</Row>
        </dl>
        <p className="folder-info-note">{`Restoring puts it back in ${was}.`}</p>
        <button className="folders-footer-btn folder-info-play folder-info-danger" onClick={(e) => onPurge(e, [item.id])}>Delete for good...</button>
      </>
    );
  }
  return (
    <>
      <div className="folder-info-head">
        <Cover folder={{ path: item.from, color: item.entry?.color }} />
        <span className="folder-info-name">{item.name}</span>
        <span className="folder-info-where">In Recently deleted</span>
      </div>
      <button className="search-add folder-info-play" onClick={() => onRestore(item.id)}>Restore</button>
      <dl className="folder-info-rows">
        {item.tracks != null && <Row label="Tracks">{item.tracks}</Row>}
        <Row label="Size">{bytes(item.size || 0)}</Row>
        <Row label="Deleted">{when(item.deletedAt)}</Row>
        <Row label="Gone for good">{`In ${left} ${left === 1 ? 'day' : 'days'}`}</Row>
      </dl>
      <p className="folder-info-note">Restoring puts it back with its cover, pin and place on its mixtapes.</p>
      <button className="folders-footer-btn folder-info-play folder-info-danger" onClick={(e) => onPurge(e, [item.id])}>Delete for good...</button>
    </>
  );
}

function LibrarySummary({ playingKey, onPlay }) {
  const library = useAppStore((s) => s.library);
  const nativeRoot = useAppStore((s) => s.nativeRoot);
  const native = library.folders.filter((f) => isNative(f.path, nativeRoot)).length;
  return (
    <>
      <div className="folder-info-head">
        <span className="folder-info-name">Your library</span>
      </div>
      {playingKey && (
        <>
          <span className="folder-info-where">Playing from {sourceName(playingKey)}</span>
          <PlayButton playing onPlay={() => onPlay(playingKey)} />
        </>
      )}
      <dl className="folder-info-rows">
        <Row label="In Downstream">{native} {native === 1 ? 'folder' : 'folders'}</Row>
        <Row label="Elsewhere">{library.folders.length - native} {library.folders.length - native === 1 ? 'folder' : 'folders'}</Row>
        <Row label="Mixtapes">{library.mixtapes.length}</Row>
      </dl>
      <p className="folder-info-note">Click a folder or mixtape to open it, or double-click a folder to play it.</p>
    </>
  );
}

// the panel beside the grid, about the picked media, the selected folder, mixtape or deleted folder, or the library when nothing is selected.
export default function FolderInfo({ media = [], folder, tape, deleted, playingKey, playingPath, onPlay, onPlayMedia, onShowFolder, onShowMedia, onLocate, onRestore, onPurge }) {
  const one = media.length === 1 && media[0];
  return (
    <aside className="folder-info">
      {one ? (
        <MediaDetails
          key={one.path}
          file={one}
          folder={one.folder}
          playing={playingPath === one.path}
          onPlay={() => onPlayMedia(one)}
          onShowFolder={onShowFolder ? () => onShowFolder(one) : null}
        />
      ) : media.length > 1 ? (
        <PickedDetails files={media} />
      ) : deleted ? (
        <DeletedDetails key={deleted.id} item={deleted} onRestore={onRestore} onPurge={onPurge} />
      ) : folder ? (
        <FolderDetails key={folder.path} folder={folder} playingKey={playingKey} onPlay={onPlay} onLocate={onLocate} onShowMedia={onShowMedia} />
      ) : tape ? (
        <MixtapeDetails key={tape.key} tape={tape} playingKey={playingKey} onPlay={onPlay} />
      ) : (
        <LibrarySummary playingKey={playingKey} onPlay={onPlay} />
      )}
    </aside>
  );
}
