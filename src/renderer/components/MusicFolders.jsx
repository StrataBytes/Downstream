import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import {
  TEMP, LIBRARY, MIXTAPE_PREFIX, FOLDER_COLORS, mixtapeKey, mixtapeFolders, addToMixtape, folderName, playSource, addFolders, removeFolder, relocateFolder,
  renameFolderOnDisk, setFolderColor, togglePin, placeFolder, removeFromMixtape, createMixtape, renameMixtape,
  deleteMixtape, saveTempMixtape, clearTempMixtape, toggleCollapsed, setSort,
} from '../services/musicLibrary';
import { SearchIcon, PlusIcon } from './InputBar';

const SORTS = [
  { id: 'custom', label: 'Your order' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'Recently played' },
];

const REVEAL_LABEL = { darwin: 'Show in Finder', win32: 'Show in File Explorer' }[window.electronAPI.platform] || 'Open folder';

// the drop target that starts a new mixtape.
const NEW_MIXTAPE = 'new';

const TABS = [
  { id: 'folders', label: 'Folders' },
  { id: 'mixtapes', label: 'Mixtapes' },
];

// how long a dragged folder rests on a tab before it opens.
const SPRING_MS = 450;

// the tab last looked at, for the next visit this session.
let lastTab = 'folders';

// covers and track counts last the whole session, so reopening the screen shows them right away.
// a cover is undefined while it loads, and null when the folder has no art.
const covers = new Map();
const counts = new Map();
const coverListeners = new Set();
let coverChain = Promise.resolve();

// video files are left out, since their first frame isn't album art.
const coverExts = () => getAcceptedExtensions(useAppStore.getState()).filter((e) => e !== 'mp4');

function requestCover(path, refresh = false) {
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

function useLibraryDetails(paths) {
  const [, redraw] = useState(0);
  const key = paths.join('\n');
  useEffect(() => {
    const fn = () => redraw((n) => n + 1);
    coverListeners.add(fn);
    return () => coverListeners.delete(fn);
  }, []);
  useEffect(() => {
    let alive = true;
    paths.forEach((p) => requestCover(p));
    window.electronAPI.scanMusicFolders(paths, getAcceptedExtensions(useAppStore.getState())).then((found) => {
      Object.entries(found).forEach(([p, n]) => counts.set(p, n));
      if (alive) redraw((n) => n + 1);
    });
    return () => { alive = false; };
  }, [key]);
}

function sortFolders(folders, sort) {
  if (sort === 'name') {
    return [...folders].sort((a, b) => folderName(a).localeCompare(folderName(b), undefined, { numeric: true, sensitivity: 'base' }));
  }
  if (sort === 'recent') return [...folders].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return folders;
}

const matcher = (query) => {
  const q = query.trim().toLowerCase();
  return (f) => !q || folderName(f).toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
};

// every folder, pinned ones leading.
function buildLibrary(library, query) {
  const shown = library.folders.filter(matcher(query));
  return {
    id: LIBRARY,
    name: 'Folders',
    folders: [...sortFolders(shown.filter((f) => f.pinned), library.sort), ...sortFolders(shown.filter((f) => !f.pinned), library.sort)],
  };
}

function sortMixtapes(mixtapes, sort) {
  if (sort === 'name') return [...mixtapes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (sort === 'recent') return [...mixtapes].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return mixtapes;
}

// the temporary mixtape first, then saved ones.
// a mixtape whose name matches the search shows all of its folders.
function buildMixtapes(library, temp, query) {
  const q = query.trim().toLowerCase();
  const byPath = new Map(library.folders.map((f) => [f.path, f]));
  const matches = matcher(query);
  const tapes = sortMixtapes(library.mixtapes, library.sort).map((m) => ({ id: m.id, name: m.name, mixtape: true, paths: m.folders }));
  if (temp.length) tapes.unshift({ id: TEMP, name: 'Temporary mixtape', mixtape: true, temp: true, paths: temp });
  return tapes
    .map((t) => {
      const all = t.paths.map((p) => byPath.get(p)).filter(Boolean);
      const named = !!q && t.name.toLowerCase().includes(q);
      return { ...t, named, folders: !q || named ? all : all.filter(matches) };
    })
    .filter((t) => !q || t.named || t.folders.length > 0);
}

function FolderGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TapeGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <circle cx="16" cy="11" r="2" />
      <path d="M6 19l2-4h8l2 4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function Chevron({ back = false }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={back ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" />
    </svg>
  );
}

function Cover({ folder }) {
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
function NameInput({ value, onDone }) {
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

// a menu at a point, kept on screen, that closes on an outside click or escape.
// it renders at the page root, since the widget's backdrop blur would offset a fixed menu inside it.
function Menu({ x, y, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
    });
  }, [x, y]);
  useEffect(() => {
    const outside = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(<div ref={ref} className="queue-ctx-menu folders-menu" style={pos}>{children}</div>, document.body);
}

export default function MusicFolders() {
  const library = useAppStore((s) => s.library);
  const temp = useAppStore((s) => s.tempMixtape);
  const source = useAppStore((s) => s.musicFolder);
  const hasTrack = useAppStore((s) => !!s.musicCurrent);
  const setMusicFolderView = useAppStore((s) => s.setMusicFolderView);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [fresh, setFresh] = useState([]);
  const playingMixtape = hasTrack && !!source?.startsWith(MIXTAPE_PREFIX);
  const [tab, setTab] = useState(() => (playingMixtape ? 'mixtapes' : lastTab));
  const [bumped, setBumped] = useState(false);
  // the mixtape whose add folders list is open, and the folders ticked in it.
  const [picking, setPicking] = useState(null);
  const [picked, setPicked] = useState([]);
  const listRef = useRef(null);
  const foldersRef = useRef(null);
  const spring = useRef(null);

  const paths = useMemo(() => library.folders.map((f) => f.path), [library.folders]);
  useLibraryDetails(paths);
  const librarySection = useMemo(() => buildLibrary(library, query), [library, query]);
  const sections = useMemo(() => buildMixtapes(library, temp, query), [library, temp, query]);
  const searching = !!query.trim();
  const playingKey = hasTrack ? source : null;

  const switchTab = (id) => {
    lastTab = id;
    setTab(id);
    setOver(null);
    listRef.current?.scrollTo(0, 0);
  };

  // a quick pulse on the mixtapes tab, when a folder goes onto a mixtape from the folders tab.
  const bumpMixtapes = () => {
    if (tab !== 'folders') return;
    setBumped(true);
    setTimeout(() => setBumped(false), 700);
  };

  const cancelSpring = () => {
    clearTimeout(spring.current?.timer);
    spring.current = null;
  };

  // a folder held over the other tab opens it, so it can be dropped there.
  const springTab = (id) => {
    if (!drag || tab === id || spring.current?.id === id) return;
    cancelSpring();
    spring.current = { id, timer: setTimeout(() => { spring.current = null; switchTab(id); }, SPRING_MS) };
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // newly added folders are brought into view and briefly highlighted.
  useEffect(() => {
    if (!fresh.length) return;
    foldersRef.current?.querySelector(`[data-path="${CSS.escape(fresh[0])}"]`)?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFresh([]), 2400);
    return () => clearTimeout(t);
  }, [fresh]);

  const closeMenu = () => setMenu(null);

  const play = async (key) => {
    const message = await playSource(key);
    if (message) setToast(message);
  };

  const openFolder = (folder) => {
    if (counts.get(folder.path) === null) {
      setToast("Downstream can't find this folder. It may have been moved, renamed or deleted.");
      return;
    }
    play(folder.path);
  };

  const add = (picked) => {
    if (!picked.length) return;
    const wasEmpty = library.folders.length === 0;
    const added = addFolders(picked);
    if (!added.length) {
      setToast(picked.length === 1 ? 'That folder is already in your library.' : 'Those folders are already in your library.');
      return;
    }
    setQuery('');
    switchTab('folders');
    setFresh(added);
    // a very first folder starts playing, later ones wait to be picked.
    if (wasEmpty && added.length === 1 && !hasTrack) play(added[0]);
  };

  const pickFolders = async () => add(await window.electronAPI.selectMusicFolders());

  // an empty one goes on to its add folders list once it's named.
  const newMixtape = (folders = []) => {
    const id = createMixtape(folders);
    switchTab('mixtapes');
    setEditing({ kind: 'mixtape', id, thenPick: folders.length === 0 });
  };

  const openPicker = (id) => {
    setQuery('');
    setPicked([]);
    switchTab('mixtapes');
    setPicking(id);
  };

  const closePicker = () => {
    setPicking(null);
    setPicked([]);
    setQuery('');
  };

  const togglePicked = (path) => {
    setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));
  };

  const confirmPicker = () => {
    const id = picking;
    addToMixtape(id, picked);
    setFresh(picked);
    closePicker();
    setTimeout(() => listRef.current?.querySelector(`[data-tape="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  const rename = async (folder, name) => {
    setEditing(null);
    if (name === null) return;
    const old = folder.path;
    const message = await renameFolderOnDisk(old, name);
    if (message) {
      setToast(message);
      return;
    }
    // the cover and count follow the folder to its new path.
    const moved = useAppStore.getState().library.folders.find((f) => !paths.includes(f.path))?.path;
    if (moved) {
      if (covers.has(old)) covers.set(moved, covers.get(old));
      if (counts.has(old)) counts.set(moved, counts.get(old));
    }
  };

  const locate = async (path) => {
    const [picked] = await window.electronAPI.selectMusicFolders();
    if (!picked) return;
    if (!relocateFolder(path, picked)) setToast('That folder is already in your library.');
  };

  const markOver = (list, before = null) => {
    setOver((o) => (o?.list === list && o?.before === before ? o : { list, before }));
  };

  const endDrag = () => {
    cancelSpring();
    setDrag(null);
    setOver(null);
  };

  // only folders dragged within the screen are accepted.
  const listDragOver = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.from === LIBRARY && over?.list !== LIBRARY ? 'copy' : 'move';
    // a section or card under the pointer has already said where the drop goes.
    setOver((o) => o || { list: LIBRARY, before: null });
  };

  const listDrop = (e) => {
    e.preventDefault();
    const target = over;
    if (!drag) return;
    const { path, from } = drag;
    endDrag();
    if (!target) return;
    // a drop back onto its own list only matters when that list can be reordered.
    const canReorder = !searching && (from !== LIBRARY || library.sort === 'custom');
    if (target.list === from && !canReorder) return;
    if (target.list === NEW_MIXTAPE) {
      if (from !== LIBRARY) removeFromMixtape(from, path);
      newMixtape([path]);
    } else {
      placeFolder(path, { list: target.list, before: target.before, from });
      if (target.list !== LIBRARY) bumpMixtapes();
    }
  };

  // a section takes reordering drops when its order means something, and is shown in that order.
  const orderable = (section) => !searching && (section.id !== LIBRARY || (library.sort === 'custom' && drag?.from === LIBRARY));

  const cardDrag = (section, folder, index) => ({
    draggable: !editing,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', folder.path);
      // after the browser has taken its picture of the card, so the picture isn't faded.
      setTimeout(() => setDrag({ path: folder.path, from: section.id }));
    },
    onDragEnd: endDrag,
    onDragOver: (e) => {
      if (!drag) return;
      if (!orderable(section)) {
        markOver(section.id);
        return;
      }
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      markOver(section.id, after ? section.folders[index + 1]?.path ?? null : folder.path);
    },
  });

  const showPanel = (panel) => setMenu((m) => m && { ...m, panel });

  const backItem = (label) => (
    <button className="queue-ctx-item folders-menu-back" onClick={() => showPanel(null)}>
      <Chevron back />
      <span>{label}</span>
    </button>
  );

  // a short list, with the mixtape list and the cover colors one step in.
  const folderMenu = (folder, sectionId) => {
    const missing = counts.get(folder.path) === null;
    const art = covers.get(folder.path);
    const tape = sectionId !== LIBRARY && sections.find((s) => s.id === sectionId);

    if (menu.panel === 'mixtapes') {
      const lists = [
        ...(temp.length ? [{ id: TEMP, name: 'Temporary mixtape' }] : []),
        ...library.mixtapes,
      ].map((l) => ({ ...l, has: mixtapeFolders(l.id).includes(folder.path) }));
      return (
        <>
          {backItem('Add to mixtape')}
          <div className="folders-menu-sep" />
          {lists.map((l) => (
            <button
              key={l.id}
              className="queue-ctx-item"
              disabled={l.has}
              onClick={() => { placeFolder(folder.path, { list: l.id }); bumpMixtapes(); closeMenu(); }}
            >
              <span>{l.name}</span>
              {l.has && <span className="folders-menu-note">Added</span>}
            </button>
          ))}
          <button className="queue-ctx-item" onClick={() => { newMixtape([folder.path]); closeMenu(); }}>New mixtape</button>
        </>
      );
    }

    if (menu.panel === 'cover') {
      return (
        <>
          {backItem('Change cover')}
          <div className="folders-menu-sep" />
          <div className="folders-menu-swatches">
            <button
              className={`folders-swatch folders-swatch-art${!folder.color ? ' folders-swatch-active' : ''}`}
              title="Album art"
              onClick={() => { setFolderColor(folder.path, null); requestCover(folder.path, true); }}
            >
              {art ? <img src={art} alt="" /> : <FolderGlyph size={10} />}
            </button>
            {FOLDER_COLORS.map((color) => (
              <button
                key={color}
                className={`folders-swatch${folder.color === color ? ' folders-swatch-active' : ''}`}
                style={{ background: color }}
                title="Use this color"
                onClick={() => setFolderColor(folder.path, color)}
              />
            ))}
          </div>
        </>
      );
    }

    return (
      <>
        <button className="queue-ctx-item" onClick={() => showPanel('mixtapes')}>
          <span>Add to mixtape</span>
          <Chevron />
        </button>
        <button className="queue-ctx-item" onClick={() => showPanel('cover')}>
          <span>Change cover</span>
          <Chevron />
        </button>
        <button className="queue-ctx-item" disabled={missing} onClick={() => { setEditing({ kind: 'folder', id: folder.path, section: sectionId }); closeMenu(); }}>Rename</button>
        {!tape && (
          <button className="queue-ctx-item" onClick={() => { togglePin(folder.path); closeMenu(); }}>{folder.pinned ? 'Unpin' : 'Pin to top'}</button>
        )}
        <div className="folders-menu-sep" />
        {missing ? (
          <button className="queue-ctx-item" onClick={() => { closeMenu(); locate(folder.path); }}>Find it again...</button>
        ) : (
          <button className="queue-ctx-item" onClick={() => { window.electronAPI.openFolder(folder.path); closeMenu(); }}>{REVEAL_LABEL}</button>
        )}
        {tape ? (
          <button className="queue-ctx-item folders-menu-danger" onClick={() => { removeFromMixtape(tape.id, folder.path); closeMenu(); }}>Remove from {tape.name}</button>
        ) : (
          <button className="queue-ctx-item folders-menu-danger" onClick={() => { removeFolder(folder.path); closeMenu(); }}>Remove from library</button>
        )}
      </>
    );
  };

  const mixtapeMenu = (section) => (
    <>
      <button className="queue-ctx-item" onClick={() => { openPicker(section.id); closeMenu(); }}>Add folders</button>
      <button className="queue-ctx-item" onClick={() => { setEditing({ kind: 'mixtape', id: section.id }); closeMenu(); }}>Rename</button>
      <div className="folders-menu-sep" />
      <button className="queue-ctx-item folders-menu-danger" onClick={() => { deleteMixtape(section.id); closeMenu(); }}>Delete mixtape</button>
    </>
  );

  const openMenuAt = (e, kind, id, section) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'contextmenu') {
      setMenu({ kind, id, section, x: e.clientX, y: e.clientY });
    } else {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ kind, id, section, x: r.left, y: r.bottom + 4 });
    }
  };

  const renderCard = (section, folder, index) => {
    const count = counts.get(folder.path);
    const missing = count === null;
    const playing = playingKey === folder.path;
    const isEditing = editing?.kind === 'folder' && editing.id === folder.path && editing.section === section.id;
    const here = over?.list === section.id && drag;
    const last = index === section.folders.length - 1;
    const meta = missing ? 'Missing' : count === undefined ? '' : count === 0 ? 'No tracks' : `${count} ${count === 1 ? 'track' : 'tracks'}`;
    const classes = [
      'folder-card',
      playing && 'folder-card-playing',
      missing && 'folder-card-missing',
      drag?.path === folder.path && drag.from === section.id && 'folder-card-dragging',
      here && over.before === folder.path && 'folder-card-drop-before',
      here && over.before === null && last && orderable(section) && 'folder-card-drop-after',
      fresh.includes(folder.path) && 'folder-card-fresh',
    ].filter(Boolean).join(' ');

    return (
      <div
        key={folder.path}
        data-path={folder.path}
        role="button"
        tabIndex={0}
        className={classes}
        title={folder.path}
        onClick={() => { if (!isEditing) openFolder(folder); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !isEditing) openFolder(folder); }}
        onContextMenu={(e) => openMenuAt(e, 'folder', folder.path, section.id)}
        {...cardDrag(section, folder, index)}
      >
        <Cover folder={folder} />
        {folder.pinned && section.id === LIBRARY && <span className="folder-card-pin" title="Pinned"><PinIcon /></span>}
        {isEditing ? (
          <NameInput value={folderName(folder)} onDone={(name) => rename(folder, name)} />
        ) : (
          <span className="folder-card-name">{folderName(folder)}</span>
        )}
        <span className={`folder-card-meta${playing ? ' folder-card-live' : ''}`}>{playing ? 'Playing' : meta}</span>
        <button className="folder-card-more" title="More" onClick={(e) => openMenuAt(e, 'folder', folder.path, section.id)}>
          <MoreIcon />
        </button>
      </div>
    );
  };

  const renderSection = (section) => {
    const collapsed = !!library.collapsed[section.id] && !searching;
    const isEditing = editing?.kind === 'mixtape' && editing.id === section.id;
    const key = section.mixtape ? mixtapeKey(section.id) : null;
    const playing = key && playingKey === key;
    const grid = (
      <div className="folders-grid" onDragOver={(e) => { if (e.target === e.currentTarget) markOver(section.id); }}>
        {section.folders.map((folder, i) => renderCard(section, folder, i))}
        {section.mixtape && section.folders.length === 0 && (
          <div className="folder-card folder-card-empty" role="button" tabIndex={0} onClick={() => openPicker(section.id)} onDragOver={() => markOver(section.id)}>
            <PlusIcon size={18} />
            <span>Add folders</span>
          </div>
        )}
      </div>
    );
    return (
      <div
        key={section.id}
        data-tape={section.id}
        className={`folders-section${over?.list === section.id ? ' folders-section-over' : ''}`}
        onDragOver={(e) => { if (e.target === e.currentTarget) markOver(section.id); }}
      >
        <div
          className={`folders-divider${playing ? ' folders-divider-playing' : ''}`}
          onClick={() => { if (!isEditing) toggleCollapsed(section.id); }}
          onContextMenu={section.mixtape && !section.temp ? (e) => openMenuAt(e, 'mixtape', section.id) : undefined}
          onDragOver={() => markOver(section.id)}
        >
          <svg className={`folders-chevron${collapsed ? ' folders-chevron-closed' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {section.mixtape && <TapeGlyph size={13} />}
          {isEditing ? (
            <NameInput
              value={section.name}
              onDone={(name) => {
                if (name !== null) renameMixtape(section.id, name);
                if (editing.thenPick) openPicker(section.id);
                setEditing(null);
              }}
            />
          ) : (
            <span className="folders-divider-name">{section.name}</span>
          )}
          <span className="folders-divider-count">{playing ? 'Playing' : section.folders.length}</span>
          <span className="folders-divider-line" />
          {section.mixtape && (
            <button className="folders-divider-play" title="Add folders" onClick={(e) => { e.stopPropagation(); openPicker(section.id); }}>
              <PlusIcon size={10} />
            </button>
          )}
          {section.mixtape && (
            <button
              className="folders-divider-play"
              title={playing ? 'Back to the player' : 'Play this mixtape'}
              disabled={section.folders.length === 0}
              onClick={(e) => { e.stopPropagation(); play(key); }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4" /></svg>
            </button>
          )}
          {section.temp && (
            <>
              <button className="folders-divider-btn" title="Keep it as a mixtape" onClick={(e) => { e.stopPropagation(); setEditing({ kind: 'mixtape', id: saveTempMixtape() }); }}>Save</button>
              <button className="folders-divider-btn" title="Empty the temporary mixtape" onClick={(e) => { e.stopPropagation(); clearTempMixtape(); }}>Clear</button>
            </>
          )}
          {section.mixtape && !section.temp && (
            <button className="folder-card-more folders-divider-more" title="More" onClick={(e) => openMenuAt(e, 'mixtape', section.id)}>
              <MoreIcon />
            </button>
          )}
        </div>
        {!collapsed && grid}
      </div>
    );
  };

  const pickTape = picking && (picking === TEMP ? { name: 'Temporary mixtape' } : library.mixtapes.find((m) => m.id === picking));
  const onTape = new Set(picking ? mixtapeFolders(picking) : []);

  // every folder in the library as a list to tick, with the ones already on the mixtape set aside.
  const pickerPanel = pickTape && (
    librarySection.folders.length === 0 ? (
      <div className="folders-empty">{searching ? <>No folders match &ldquo;{query.trim()}&rdquo;.</> : 'Add a folder of music first.'}</div>
    ) : (
      <div className="folders-picker">
        {librarySection.folders.map((folder) => {
          const already = onTape.has(folder.path);
          const ticked = picked.includes(folder.path);
          const count = counts.get(folder.path);
          return (
            <button
              key={folder.path}
              type="button"
              className={`search-row folders-pick-row${ticked ? ' search-row-picked' : ''}${already ? ' search-row-queued' : ''}`}
              disabled={already}
              onClick={() => togglePicked(folder.path)}
              title={folder.path}
            >
              <span className="search-row-check"><CheckIcon /></span>
              <Cover folder={folder} />
              <span className="search-row-info">
                <span className="search-row-title">{folderName(folder)}</span>
                <span className="search-row-meta">{count === null ? 'Missing' : count === undefined ? '' : `${count} ${count === 1 ? 'track' : 'tracks'}`}</span>
              </span>
              {already && <span className="search-row-tag">Already on it</span>}
            </button>
          );
        })}
      </div>
    )
  );

  const menuFolder = menu?.kind === 'folder' && library.folders.find((f) => f.path === menu.id);
  const menuMixtape = menu?.kind === 'mixtape' && sections.find((s) => s.id === menu.id);
  const total = library.folders.length;
  const tapeCount = library.mixtapes.length + (temp.length ? 1 : 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = tab === 'folders' || pickTape ? plural(total, 'folder') : plural(library.mixtapes.length, 'mixtape');
  const showDropbar = !!drag && !searching;
  const live = { folders: !!playingKey && !playingMixtape, mixtapes: playingMixtape };

  const foldersPanel = total === 0 ? (
    <div className="folders-empty">
      <FolderGlyph size={28} />
      <span>Add a folder of music to start listening.</span>
    </div>
  ) : searching && librarySection.folders.length === 0 ? (
    <div className="folders-empty">No folders match &ldquo;{query.trim()}&rdquo;.</div>
  ) : (
    <div className="folders-grid" onDragOver={(e) => { if (e.target === e.currentTarget) markOver(LIBRARY); }}>
      {librarySection.folders.map((folder, i) => renderCard(librarySection, folder, i))}
    </div>
  );

  const mixtapesPanel = tapeCount === 0 ? (
    <div
      className={`folders-empty folders-empty-drop${over?.list === NEW_MIXTAPE ? ' folders-empty-drop-over' : ''}`}
      onDragOver={() => markOver(NEW_MIXTAPE)}
    >
      <TapeGlyph size={28} />
      <span>Mixtapes play several folders as one.</span>
      <span className="folders-empty-hint">Drag a folder here, or press New mixtape.</span>
    </div>
  ) : searching && sections.length === 0 ? (
    <div className="folders-empty">No mixtapes match &ldquo;{query.trim()}&rdquo;.</div>
  ) : (
    sections.map(renderSection)
  );

  return (
    <div className="folders">
      <div className="folders-top">
        {hasTrack && (
          <button className="search-panel-back" onClick={() => setMusicFolderView(false)} title="Back to the player">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <div className="folders-search">
          <SearchIcon size={14} />
          <input
            type="text"
            className="url-input"
            placeholder={`Search ${summary}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
          />
        </div>
        <select className="folders-sort" value={library.sort} onChange={(e) => setSort(e.target.value)} title={`Sort ${tab}`}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="folders-panes">
        {pickTape ? (
          <div className="search-tabs folders-tabs">
            <span className="search-tab search-tab-active">Add to {pickTape.name}</span>
            <button className="folders-pick-cancel" onClick={closePicker}>Cancel</button>
          </div>
        ) : (
        <div className="search-tabs folders-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              className={`search-tab${t.id === tab ? ' search-tab-active' : ''}${t.id === 'mixtapes' && bumped ? ' folders-tab-bumped' : ''}`}
              onClick={() => switchTab(t.id)}
              onDragOver={() => springTab(t.id)}
              onDragLeave={cancelSpring}
            >
              {t.label}
              <span className="folders-tab-count">{t.id === 'folders' ? total : tapeCount}</span>
              {live[t.id] && <span className="folders-tab-live" title="Playing from here" />}
            </button>
          ))}
        </div>
        )}

        <div className="folders-body">
          <div
            ref={listRef}
            className="folders-list"
            onDragOver={listDragOver}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={listDrop}
          >
            {pickerPanel}
            {/* both tabs stay mounted, so a folder dragged from one can still finish its drag on the other. */}
            <div ref={foldersRef} role="tabpanel" hidden={!!pickTape || tab !== 'folders'}>{foldersPanel}</div>
            <div role="tabpanel" hidden={!!pickTape || tab !== 'mixtapes'}>{mixtapesPanel}</div>
          </div>

          {/* while a folder is dragged, the footer turns into places to drop it. */}
          {pickTape ? (
            <div className="folders-footer">
              <span className="folders-footer-count">
                {picked.length ? `${picked.length} selected` : 'Pick folders to add'}
                {picked.length > 0 && <button className="search-footer-clear" onClick={() => setPicked([])}>Clear</button>}
              </span>
              <button className="search-add folders-add" disabled={!picked.length} onClick={confirmPicker}>
                <PlusIcon size={13} />
                {picked.length ? `Add ${picked.length} to ${pickTape.name}` : 'Add'}
              </button>
            </div>
          ) : showDropbar ? (
            <div className="folders-footer folders-dropbar" onDragOver={listDragOver} onDrop={listDrop}>
              <div className={`folders-drop-tile${over?.list === NEW_MIXTAPE ? ' folders-drop-tile-over' : ''}`} onDragOver={() => markOver(NEW_MIXTAPE)}>
                <PlusIcon size={13} />
                New mixtape
              </div>
              <div className={`folders-drop-tile${over?.list === TEMP ? ' folders-drop-tile-over' : ''}`} onDragOver={() => markOver(TEMP)}>
                <TapeGlyph size={14} />
                Temporary mixtape
              </div>
            </div>
          ) : (
            <div className="folders-footer">
              <span className="folders-footer-count">{summary}</span>
              {tab === 'folders' ? (
                <button className="search-add folders-add" onClick={pickFolders}>
                  <PlusIcon size={13} />
                  Add folders
                </button>
              ) : (
                <button className="search-add folders-add" onClick={() => newMixtape()}>
                  <PlusIcon size={13} />
                  New mixtape
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="folder-toast">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{toast}</span>
        </div>
      )}

      {(menuFolder || menuMixtape) && (
        <Menu key={menu.panel || 'main'} x={menu.x} y={menu.y} onClose={closeMenu}>
          {menuFolder ? folderMenu(menuFolder, menu.section) : mixtapeMenu(menuMixtape)}
        </Menu>
      )}
    </div>
  );
}
