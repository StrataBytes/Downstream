import { useState, useRef, useEffect, useMemo } from 'react';
import useAppStore from '../stores/useAppStore';
import { MIXTAPE_PREFIX, sourceName, sourcePaths, folderName, createFolder } from '../services/musicLibrary';
import {
  moveMedia, addMedia, deleteMedia, pickMediaFiles, playableHere, droppedPaths, holdsFiles, dirOf, trackCount,
} from '../services/mediaFiles';
import Menu from './Menu';
import { Cover, Mosaic, CheckIcon, MoreIcon, Chevron } from './FolderGrid';
import { MoveList, AddChoice, REVEAL_LABEL, formatLength, useMediaLengths, useDrives } from './FolderMedia';
import { PlusIcon } from './InputBar';

const SORTS = {
  'name-asc': { label: 'Name (A–Z)', compare: (a, b) => a.name.localeCompare(b.name) },
  'date-desc': { label: 'Date Modified (Newest First)', compare: (a, b) => (b.mtime || 0) - (a.mtime || 0) },
  'date-asc': { label: 'Date Modified (Oldest First)', compare: (a, b) => (a.mtime || 0) - (b.mtime || 0) },
};

function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// the playing folder or mixtape's media beside the player, named for it, to play, search, move and delete.
// a mixtape's media sits under the folder each song lives in.
export default function MusicLibrary() {
  const musicFiles = useAppStore((s) => s.musicFiles);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicFolder = useAppStore((s) => s.musicFolder);
  const library = useAppStore((s) => s.library);
  const tempMixtape = useAppStore((s) => s.tempMixtape);
  const musicLibraryOpen = useAppStore((s) => s.musicLibraryOpen);
  const currentView = useAppStore((s) => s.currentView);
  // the wide folder screen has no room beside it.
  const folderScreen = useAppStore((s) => s.folderScreen);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicLibraryOpen = useAppStore((s) => s.setMusicLibraryOpen);
  const sortBy = useAppStore((s) => s.musicLibrarySort);
  const setSortBy = useAppStore((s) => s.setMusicLibrarySort);

  const [closing, setClosing] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // songs picked to move or delete together, and the last one clicked, which a shift-click picks a run from.
  const [picked, setPicked] = useState([]);
  const lastClicked = useRef(null);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [fileOver, setFileOver] = useState(false);

  const sortMenuRef = useRef(null);

  const mixtape = !!musicFolder?.startsWith(MIXTAPE_PREFIX);
  const folders = useMemo(
    () => sourcePaths(musicFolder, { library, tempMixtape }).map((p) => library.folders.find((f) => f.path === p)).filter(Boolean),
    [musicFolder, library, tempMixtape],
  );
  const lengths = useMediaLengths(useMemo(() => musicFiles.map((f) => f.path), [musicFiles]));
  const drives = useDrives(menu?.panel === 'move' || menu?.kind === 'move');

  // closes the sort menu on any click outside it.
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onClick = (e) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  // picks don't carry over to another folder, and ones that are gone drop out.
  useEffect(() => {
    setPicked((p) => {
      const kept = p.filter((path) => musicFiles.some((f) => f.path === path));
      return kept.length === p.length ? p : kept;
    });
  }, [musicFiles]);
  useEffect(() => setPicked([]), [musicFolder]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : toast.ok ? 2500 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // escape stops picking, unless a menu is open or something's being typed.
  useEffect(() => {
    if (!picked.length) return;
    const key = (e) => {
      if (e.key === 'Escape' && !menu && !e.target.closest?.('input')) setPicked([]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picked.length, menu]);

  const visibleTracks = useMemo(() => {
    const filtered = searchQuery.trim()
      ? musicFiles.filter((t) => fuzzyMatch(searchQuery, t.name))
      : musicFiles;
    const compare = (SORTS[sortBy] || SORTS['name-asc']).compare;
    return [...filtered].sort(compare);
  }, [musicFiles, searchQuery, sortBy]);

  // a mixtape's songs under their folders, in the mixtape's order.
  const groups = useMemo(() => {
    if (!mixtape) return null;
    return folders
      .map((f) => ({ folder: f, tracks: visibleTracks.filter((t) => dirOf(t.path) === f.path), all: musicFiles.filter((t) => dirOf(t.path) === f.path).length }))
      .filter((g) => g.tracks.length > 0);
  }, [mixtape, folders, visibleTracks, musicFiles]);
  const order = groups ? groups.flatMap((g) => g.tracks) : visibleTracks;

  if (!musicLibraryOpen || currentView !== 'player' || folderScreen) return null;

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setMusicLibraryOpen(false);
    }, 350);
  };

  const closeMenu = () => setMenu(null);
  const warn = (text) => setToast({ text });
  const pickedFiles = musicFiles.filter((f) => picked.includes(f.path));

  // a click plays, and shift or cmd (ctrl on windows) starts picking.
  // once picking, a click picks or lets go, and a shift-click picks every song from the last one clicked.
  const handleClick = (e, track) => {
    const adding = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!picked.length && !adding) {
      setMusicCurrent(track);
      return;
    }
    if (e.shiftKey && lastClicked.current) {
      const a = order.findIndex((t) => t.path === lastClicked.current);
      const b = order.findIndex((t) => t.path === track.path);
      if (a >= 0 && b >= 0) {
        const run = order.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.path);
        setPicked((p) => [...new Set([...p, ...run])]);
        return;
      }
    }
    lastClicked.current = track.path;
    setPicked((p) => (p.includes(track.path) ? p.filter((x) => x !== track.path) : [...p, track.path]));
  };

  // runs a change to media, saying what's happening while it does and how it went after.
  const change = async (label, step) => {
    closeMenu();
    setBusy(label);
    try {
      const res = await step();
      if (!res) return;
      const undo = res.undo && (async () => {
        const back = await res.undo();
        if (back?.error) warn(back.error);
      });
      setToast({ text: res.text, ok: res.ok, undo });
      setPicked([]);
    } finally {
      setBusy(null);
    }
  };

  const moveTo = (files, dir) => change(`Moving ${trackCount(files.length)}...`, () => moveMedia(files.map((f) => f.path), dir));
  const moveToNew = (files) => change(`Moving ${trackCount(files.length)}...`, async () => {
    const made = await createFolder();
    if (made.error) return { text: made.error };
    return moveMedia(files.map((f) => f.path), made.path);
  });
  const remove = (files) => change(`Deleting ${trackCount(files.length)}...`, () => deleteMedia(files.map((f) => f.path)));

  const below = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, flipTo: r.top - 4 };
  };

  // songs from elsewhere ask whether to keep the originals.
  const askToAdd = (paths, dir, point) => {
    const known = playableHere(paths);
    const wanted = known.filter((p) => dirOf(p) !== dir);
    if (!wanted.length) {
      warn(known.length ? 'Those are already in this folder.' : 'Downstream can\'t play those files.');
      return;
    }
    setMenu({ kind: 'add', dir, paths: wanted, skipped: paths.length - known.length, ...point });
  };

  const pickToAdd = async (dir, point) => {
    closeMenu();
    const chosen = await pickMediaFiles();
    if (chosen.length) askToAdd(chosen, dir, point);
  };

  // a folder adds straight to itself, and a mixtape asks which of its folders first.
  const handleAdd = (e) => {
    const point = below(e);
    if (mixtape) setMenu({ kind: 'add-to', ...point });
    else if (folders[0]) pickToAdd(folders[0].path, point);
  };

  const fileTarget = {
    onDragEnter: (e) => {
      if (!holdsFiles(e) || mixtape) return;
      e.preventDefault();
      setFileOver(true);
    },
    onDragOver: (e) => {
      if (!holdsFiles(e) || mixtape) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFileOver(false);
    },
    onDrop: (e) => {
      if (!holdsFiles(e) || mixtape || !folders[0]) return;
      e.preventDefault();
      setFileOver(false);
      askToAdd(droppedPaths(e.dataTransfer), folders[0].path, { x: e.clientX, y: e.clientY });
    },
  };

  const menuFiles = menu?.kind === 'track' ? (picked.includes(menu.track.path) ? pickedFiles : [menu.track]) : pickedFiles;
  const backItem = (label) => (
    <button className="queue-ctx-item folders-menu-back" onClick={() => setMenu((m) => ({ ...m, panel: null }))}>
      <Chevron back />
      <span>{label}</span>
    </button>
  );

  const trackMenu = () => {
    if (menu.panel === 'move') {
      return <MoveList files={menuFiles} folders={library.folders} drives={drives} head={backItem('Move to')} onMove={(dir) => moveTo(menuFiles, dir)} onNew={() => moveToNew(menuFiles)} />;
    }
    const one = menuFiles.length === 1;
    return (
      <>
        {!one && <div className="folders-menu-title">{trackCount(menuFiles.length)}</div>}
        <button className="queue-ctx-item" onClick={() => setMenu((m) => ({ ...m, panel: 'move' }))}>
          <span>Move to</span>
          <Chevron />
        </button>
        {one && <button className="queue-ctx-item" onClick={() => { window.electronAPI.showMedia(menu.track.path); closeMenu(); }}>{REVEAL_LABEL}</button>}
        <div className="folders-menu-sep" />
        <button className="queue-ctx-item folders-menu-danger" onClick={() => remove(menuFiles)}>Delete</button>
      </>
    );
  };

  const openTrackMenu = (e, track) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'contextmenu') setMenu({ kind: 'track', track, x: e.clientX, y: e.clientY });
    else setMenu({ kind: 'track', track, ...below(e) });
  };

  const renderTrack = (track) => {
    const active = musicCurrent?.path === track.path;
    const isPicked = picked.includes(track.path);
    return (
      <div
        key={track.path}
        role="button"
        tabIndex={0}
        title={track.name}
        className={`music-library-item${active ? ' music-library-item-active' : ''}${isPicked ? ' music-library-item-picked' : ''}`}
        onClick={(e) => handleClick(e, track)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick(e, track); }}
        onContextMenu={(e) => openTrackMenu(e, track)}
      >
        {picked.length > 0 ? (
          <span className="music-library-check"><CheckIcon /></span>
        ) : (
          <svg className="music-library-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {active ? (
              <>
                <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
                <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
              </>
            ) : (
              <polygon points="5 3 19 12 5 21 5 3" fill="none" />
            )}
          </svg>
        )}
        <span className="music-library-name">{track.name}</span>
        <span className="music-library-length">{formatLength(lengths.get(track.path))}</span>
        <button className={`music-library-more${menu?.track?.path === track.path ? ' music-library-more-open' : ''}`} title="More" onClick={(e) => openTrackMenu(e, track)}>
          <MoreIcon />
        </button>
      </div>
    );
  };

  const name = sourceName(musicFolder) || 'Library';

  return (
    <div className={`music-library music-library-next ${closing ? 'music-library-closing' : ''}`}>
      <div className="music-library-header">
        <div className="music-library-title">
          {mixtape ? <Mosaic folders={folders} size="small" /> : folders[0] && <Cover folder={folders[0]} />}
          <h2 title={name}>{name}</h2>
        </div>
        <div className="queue-header-right">
          <span className="queue-count">{trackCount(musicFiles.length)}</span>
          <button className="btn-row-remove" onClick={handleClose} title="Close library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="music-library-search-row">
        <svg className="music-library-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="22" y2="22" />
        </svg>
        <input
          className="music-library-search-input"
          type="text"
          placeholder={`Search ${name}`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
        />
        {searchQuery && (
          <button className="music-library-search-clear" onClick={() => setSearchQuery('')} title="Clear">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <div className="music-library-sort" ref={sortMenuRef}>
          <button
            className={`music-library-sort-btn${sortMenuOpen ? ' music-library-sort-btn-active' : ''}`}
            onClick={() => setSortMenuOpen((v) => !v)}
            title={`Sort: ${(SORTS[sortBy] || SORTS['name-asc']).label}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          {sortMenuOpen && (
            <div className="music-library-sort-menu">
              {Object.entries(SORTS).map(([id, { label }]) => (
                <button
                  key={id}
                  className={`music-library-sort-option${sortBy === id ? ' music-library-sort-option-active' : ''}`}
                  onClick={() => { setSortBy(id); setSortMenuOpen(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`music-library-list${fileOver ? ' folders-drop-over' : ''}`} {...fileTarget}>
        {musicFiles.length === 0 && (
          <div className="queue-empty">No media here yet.</div>
        )}
        {musicFiles.length > 0 && visibleTracks.length === 0 && (
          <div className="queue-empty">No media matches your search.</div>
        )}
        {groups
          ? groups.map((g) => (
            <div key={g.folder.path} className="music-library-group-block">
              <div className="music-library-group">
                <Cover folder={g.folder} />
                <span>{folderName(g.folder)}</span>
                <span className="folders-heading-count">{g.all}</span>
                <span className="folders-divider-line" />
              </div>
              {g.tracks.map(renderTrack)}
            </div>
          ))
          : visibleTracks.map(renderTrack)}
      </div>

      {toast && (
        <div className={`folder-toast${toast.ok ? ' folder-toast-done' : ''}`}>
          {toast.ok ? (
            <CheckIcon />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span>{toast.text}</span>
          {toast.undo && (
            <button className="folder-toast-undo" onClick={() => { toast.undo(); setToast(null); }}>Undo</button>
          )}
        </div>
      )}

      <div className="music-library-footer">
        {picked.length > 0 ? (
          <>
            <span className="folders-footer-count">
              {busy || `${picked.length} selected`}
              {!busy && <button className="search-footer-clear" onClick={() => setPicked([])}>Clear</button>}
            </span>
            <button className="folders-footer-btn folder-info-danger" disabled={!!busy} onClick={() => remove(pickedFiles)}>Delete</button>
            <button className="search-add" disabled={!!busy} onClick={(e) => setMenu({ kind: 'move', ...below(e) })}>Move to...</button>
          </>
        ) : (
          <button className="folders-footer-btn music-library-footer-wide" disabled={!!busy || !folders.length} onClick={handleAdd}>
            {busy || (
              <>
                <PlusIcon size={12} />
                Add media
              </>
            )}
          </button>
        )}
      </div>

      {menu?.kind === 'track' && (
        <Menu key={menu.panel || 'main'} x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          {trackMenu()}
        </Menu>
      )}
      {menu?.kind === 'move' && pickedFiles.length > 0 && (
        <Menu x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          <MoveList
            files={pickedFiles}
            folders={library.folders}
            drives={drives}
            head={<div className="folders-menu-title">{`Move ${trackCount(pickedFiles.length)} to`}</div>}
            onMove={(dir) => moveTo(pickedFiles, dir)}
            onNew={() => moveToNew(pickedFiles)}
          />
        </Menu>
      )}
      {menu?.kind === 'add-to' && (
        <Menu x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          <div className="folders-menu-title">Add media to</div>
          {folders.map((f) => (
            <button key={f.path} className="queue-ctx-item folders-menu-folder" onClick={() => pickToAdd(f.path, { x: menu.x, y: menu.y, flipTo: menu.flipTo })}>
              <Cover folder={f} />
              <span className="folders-menu-name">{folderName(f)}</span>
            </button>
          ))}
        </Menu>
      )}
      {menu?.kind === 'add' && (
        <Menu x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          <AddChoice paths={menu.paths} dir={menu.dir} skipped={menu.skipped} onChoose={(move) => change(`${move ? 'Moving' : 'Copying'} ${trackCount(menu.paths.length)}...`, () => addMedia(menu.paths, menu.dir, move))} />
        </Menu>
      )}
    </div>
  );
}
