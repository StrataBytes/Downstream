import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import {
  TEMP, LIBRARY, MIXTAPE_PREFIX, FOLDER_COLORS, mixtapeKey, addToMixtape, folderName, playSource, addFolders, removeFolder, relocateFolder,
  renameFolderOnDisk, setFolderColor, togglePin, placeFolder, removeFromMixtape, createMixtape, renameMixtape,
  deleteMixtape, saveTempMixtape, clearTempMixtape, setSort, isNative, syncNativeFolders, createFolder, deleteFolder,
  importFolder, cancelImport, onFolderMoved, loadDeleted, restoreDeleted, purgeDeleted, baseName,
} from '../services/musicLibrary';
import { SearchIcon, PlusIcon } from './InputBar';
import Menu from './Menu';
import FolderInfo from './FolderInfo';
import DragZones from './DragZones';
import { MediaRow, NoteGlyph, MoveList, AddChoice, REVEAL_LABEL, useFolderMedia, useMediaLengths, useDrives } from './FolderMedia';
import {
  moveMedia, addMedia, deleteMedia, restoreMedia, searchMedia, pickMediaFiles, droppedPaths, holdsFiles, playableHere, dirOf, trackCount, mediaName,
  onMediaChanged,
} from '../services/mediaFiles';
import {
  covers, counts, requestCover, useLibraryDetails, FolderGlyph, TapeGlyph, MoreIcon, Chevron, CheckIcon, Cover, NameInput, FolderCard, Mosaic, folderMeta, SlidingGrid,
} from './FolderGrid';

const SORTS = [
  { id: 'custom', label: 'Your order' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'Recently played' },
];

// an open folder's media sorts the way the library beside the player does, and shares its choice.
const MEDIA_SORTS = [
  { id: 'name-asc', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) },
  { id: 'date-desc', label: 'Newest first', compare: (a, b) => (b.mtime || 0) - (a.mtime || 0) },
  { id: 'date-asc', label: 'Oldest first', compare: (a, b) => (a.mtime || 0) - (b.mtime || 0) },
];

const TABS = [
  { id: 'folders', label: 'Folders' },
  { id: 'mixtapes', label: 'Mixtapes' },
];

// the tab last looked at, for the next visit this session.
let lastTab = 'folders';

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function sortFolders(folders, sort) {
  if (sort === 'name') return [...folders].sort((a, b) => byName(folderName(a), folderName(b)));
  if (sort === 'recent') return [...folders].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return folders;
}

const matcher = (query) => {
  const q = query.trim().toLowerCase();
  return (f) => !q || folderName(f).toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
};

// the folders tab's two groups, folders in downstream first, each with its pinned folders leading.
function buildFolderSections(library, query, root) {
  const shown = library.folders.filter(matcher(query));
  const order = (list) => [...sortFolders(list.filter((f) => f.pinned), library.sort), ...sortFolders(list.filter((f) => !f.pinned), library.sort)];
  return [
    { id: 'native', name: 'In Downstream', folders: order(shown.filter((f) => isNative(f.path, root))) },
    { id: 'external', name: 'Elsewhere on your computer', folders: order(shown.filter((f) => !isNative(f.path, root))) },
  ];
}

function sortMixtapes(mixtapes, sort) {
  if (sort === 'name') return [...mixtapes].sort((a, b) => byName(a.name, b.name));
  if (sort === 'recent') return [...mixtapes].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return mixtapes;
}

// the temporary mixtape first, then saved ones, each with the library entries of its folders.
// a mixtape whose name matches the search shows all of its folders.
function buildMixtapes(library, temp, query) {
  const q = query.trim().toLowerCase();
  const byPath = new Map(library.folders.map((f) => [f.path, f]));
  const matches = matcher(query);
  const tapes = sortMixtapes(library.mixtapes, library.sort).map((m) => ({ id: m.id, name: m.name, lastPlayed: m.lastPlayed, paths: m.folders }));
  if (temp.length) tapes.unshift({ id: TEMP, name: 'Temporary mixtape', temp: true, paths: temp });
  return tapes.map((t) => {
    const all = t.paths.map((p) => byPath.get(p)).filter(Boolean);
    const named = !!q && t.name.toLowerCase().includes(q);
    return { ...t, key: mixtapeKey(t.id), all, named, folders: !q || named ? all : all.filter(matches) };
  });
}

export default function MusicFolders() {
  const library = useAppStore((s) => s.library);
  const nativeRoot = useAppStore((s) => s.nativeRoot);
  const folderImport = useAppStore((s) => s.folderImport);
  const deleted = useAppStore((s) => s.deletedFolders);
  const temp = useAppStore((s) => s.tempMixtape);
  const source = useAppStore((s) => s.musicFolder);
  const hasTrack = useAppStore((s) => !!s.musicCurrent);
  const playingPath = useAppStore((s) => s.musicCurrent?.path || null);
  const setMusicFolderView = useAppStore((s) => s.setMusicFolderView);
  const mediaSort = useAppStore((s) => s.musicLibrarySort);
  const setMediaSort = useAppStore((s) => s.setMusicLibrarySort);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  // a message, or a done one with ok set, which can carry a way to undo what was done.
  const [toast, setToast] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [fresh, setFresh] = useState([]);
  const playingMixtape = hasTrack && !!source?.startsWith(MIXTAPE_PREFIX);
  const [tab, setTab] = useState(() => (playingMixtape ? 'mixtapes' : lastTab));
  // the selected folder's path, and the mixtape open on the mixtapes tab.
  const [selected, setSelected] = useState(null);
  const [openTape, setOpenTape] = useState(null);
  // the folder in recently deleted that's selected, by its id.
  const [pickedDeleted, setPickedDeleted] = useState(null);
  // deleting for good, waiting to be confirmed where it was asked for.
  const [confirm, setConfirm] = useState(null);
  // the mixtape whose add folders list is open, and the folders ticked in it.
  const [picking, setPicking] = useState(null);
  const [picked, setPicked] = useState([]);
  // the folder opened to show its media, the media ticked in it or in search results, and the last one clicked, which a shift-click ticks a run from.
  const [openFolder, setOpenFolder] = useState(null);
  const [pickedMedia, setPickedMedia] = useState([]);
  const lastClicked = useRef(null);
  // media in every folder that matches the search.
  const [found, setFound] = useState([]);
  // media being dragged, the folder that files from finder are held over, and what's being done while it's done.
  const [mediaDrag, setMediaDrag] = useState(null);
  const [fileOver, setFileOver] = useState(null);
  const [busy, setBusy] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  // what a mouse's back button does right now.
  const stepBackRef = useRef(null);
  // what the list showed last, and where the grid was scrolled to when a folder or mixtape opened in its place.
  const viewRef = useRef('');
  const gridScroll = useRef(0);
  const keepGridScroll = () => {
    if (listRef.current && !viewRef.current.includes(':')) gridScroll.current = listRef.current.scrollTop;
  };

  const paths = useMemo(() => library.folders.map((f) => f.path), [library.folders]);
  useLibraryDetails(paths);
  const openEntry = openFolder && tab === 'folders' ? library.folders.find((f) => f.path === openFolder) : null;
  // an open folder's search looks inside it, so the grid behind it shows every folder.
  const gridQuery = openEntry ? '' : query;
  const folderSections = useMemo(() => buildFolderSections(library, gridQuery, nativeRoot), [library, gridQuery, nativeRoot]);
  const tapes = useMemo(() => buildMixtapes(library, temp, query), [library, temp, query]);
  const allTapes = useMemo(() => buildMixtapes(library, temp, ''), [library, temp]);
  const searching = !!query.trim();
  const playingKey = hasTrack ? source : null;
  const tape = openTape && tapes.find((t) => t.id === openTape);
  const media = useFolderMedia(openEntry ? openEntry.path : null);
  const shownMedia = useMemo(() => {
    if (!media) return [];
    const q = query.trim().toLowerCase();
    const compare = (MEDIA_SORTS.find((m) => m.id === mediaSort) || MEDIA_SORTS[0]).compare;
    return (q ? media.filter((f) => f.name.toLowerCase().includes(q)) : media).slice().sort(compare);
  }, [media, query, mediaSort]);
  const lengths = useMediaLengths(useMemo(() => [...shownMedia, ...found].map((f) => f.path), [shownMedia, found]));
  const folderOf = (file) => library.folders.find((f) => f.path === dirOf(file.path)) || null;

  const switchTab = (id) => {
    lastTab = id;
    setTab(id);
    setOver(null);
    setSelected(null);
    setOpenFolder(null);
    setPickedMedia([]);
    listRef.current?.scrollTo(0, 0);
  };

  // folders made or renamed in finder or file explorer show up when the screen opens, or when downstream is back in front.
  useEffect(() => {
    const check = () => {
      syncNativeFolders();
      loadDeleted();
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // one thing is selected at a time, a folder or a deleted one.
  useEffect(() => {
    if (selected) setPickedDeleted(null);
  }, [selected]);

  // the selection follows a folder that's renamed or imported.
  useEffect(() => onFolderMoved((from, to) => {
    setSelected((p) => (p === from ? to : p));
    setOpenFolder((p) => (p === from ? to : p));
  }), []);

  // a folder that's deleted, or gone from the library, closes.
  useEffect(() => {
    if (openFolder && !library.folders.some((f) => f.path === openFolder)) setOpenFolder(null);
  }, [library.folders, openFolder]);

  // the search looks through every folder's media too, a moment after typing stops, and again when media changes.
  const [mediaTick, setMediaTick] = useState(0);
  useEffect(() => onMediaChanged(() => setMediaTick((n) => n + 1)), []);
  useEffect(() => {
    if (!searching || tab !== 'folders' || openEntry) {
      setFound([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => searchMedia(query).then((results) => {
      if (!alive) return;
      setFound(results);
      setPickedMedia((p) => p.filter((x) => results.some((r) => r.path === x.path)));
    }), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, tab, !!openEntry, mediaTick]);

  // ticked media that's gone, moved or deleted, drops out of the selection.
  useEffect(() => {
    if (!media) return;
    setPickedMedia((p) => {
      const kept = p.filter((x) => media.some((f) => f.path === x.path));
      return kept.length === p.length ? p : kept;
    });
  }, [media]);

  // escape lets go of ticked media first, then closes the open folder, unless something's being typed or a menu is open.
  useEffect(() => {
    if (!openEntry && !pickedMedia.length) return;
    const key = (e) => {
      if (e.key !== 'Escape' || menu || e.target.closest?.('input')) return;
      if (pickedMedia.length) setPickedMedia([]);
      else setOpenFolder(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [!!openEntry, pickedMedia.length, menu]);

  // a mouse's back button, over this screen, steps back one place.
  useEffect(() => {
    const up = (e) => {
      if (e.button !== 3 || !rootRef.current?.contains(e.target)) return;
      e.preventDefault();
      stepBackRef.current();
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // a song shown in its folder is brought into view once the folder's media is in.
  const focusMedia = useRef(null);
  useEffect(() => {
    if (!media || !focusMedia.current) return;
    rootRef.current?.querySelector(`[data-media="${CSS.escape(focusMedia.current)}"]`)?.scrollIntoView({ block: 'nearest' });
    focusMedia.current = null;
  }, [media]);

  const drives = useDrives(menu?.kind === 'move' || menu?.panel === 'move');

  // a mixtape that's deleted, or a temporary one that's cleared, closes.
  useEffect(() => {
    if (openTape && !allTapes.some((t) => t.id === openTape)) setOpenTape(null);
  }, [allTapes, openTape]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : toast.ok ? 2500 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // newly added folders are brought into view and briefly highlighted.
  useEffect(() => {
    if (!fresh.length) return;
    listRef.current?.querySelector(`[data-path="${CSS.escape(fresh[0])}"]`)?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFresh([]), 2400);
    return () => clearTimeout(t);
  }, [fresh]);

  const closeMenu = () => setMenu(null);
  const warn = (text) => setToast({ text });

  const play = async (key, startAt = null) => {
    const message = await playSource(key, startAt);
    if (message) warn(message);
  };

  const playFolder = (folder) => {
    if (counts.get(folder.path) === null) {
      warn("Downstream can't find this folder. It may have been moved, renamed or deleted.");
      return;
    }
    play(folder.path);
  };

  const add = (chosen) => {
    if (!chosen.length) return;
    const wasEmpty = library.folders.length === 0;
    const added = addFolders(chosen);
    if (!added.length) {
      warn(chosen.length === 1 ? 'That folder is already in your library.' : 'Those folders are already in your library.');
      return;
    }
    setQuery('');
    switchTab('folders');
    setFresh(added);
    setSelected(added[0]);
    // a very first folder starts playing, later ones wait to be picked.
    if (wasEmpty && added.length === 1 && !hasTrack) play(added[0]);
  };

  const pickFolders = async () => add(await window.electronAPI.selectMusicFolders());

  // a new folder goes straight to being named, like one made in finder.
  const newFolder = async () => {
    const res = await createFolder();
    if (res.error) {
      warn(res.error);
      return;
    }
    setQuery('');
    switchTab('folders');
    setFresh([res.path]);
    setSelected(res.path);
    setEditing({ kind: 'folder', id: res.path });
  };

  // deleting can be undone from the toast, or later from recently deleted.
  const remove = async (folder) => {
    closeMenu();
    const res = await deleteFolder(folder.path, counts.get(folder.path) ?? null);
    if (res.error) {
      warn(res.error);
      return;
    }
    setToast({ text: `Deleted "${folderName(folder)}".`, ok: true, undo: () => restoreDeleted(res.id) });
  };

  const unlink = (folder) => {
    closeMenu();
    const undo = removeFolder(folder.path);
    setToast({ text: `Removed "${folderName(folder)}" from your library.`, ok: true, undo });
  };

  const restore = async (id) => {
    closeMenu();
    setPickedDeleted(null);
    const item = deleted.find((d) => d.id === id);
    if (item?.kind === 'media') {
      const back = await restoreMedia([id]);
      if (back.error) warn(back.error);
      else setToast({ text: `Restored "${mediaName(back.paths[0])}" to ${baseName(dirOf(back.paths[0]))}.`, ok: true });
      return;
    }
    const res = await restoreDeleted(id);
    if (res.error) warn(res.error);
    else setSelected(res.path);
  };

  const purge = async (ids) => {
    setConfirm(null);
    setPickedDeleted(null);
    const res = await purgeDeleted(ids);
    if (res.error) warn(res.error);
  };

  // deleting for good asks first, from wherever it was asked for.
  const askToPurge = (e, ids) => {
    closeMenu();
    const r = e.currentTarget.getBoundingClientRect();
    setConfirm({ ids, x: r.left, y: r.bottom + 4, flipTo: r.top - 4 });
  };

  const bringIn = async (folder, move) => {
    closeMenu();
    const res = await importFolder(folder.path, move);
    if (res.error || res.notice) warn(res.error || res.notice);
  };

  // --- media ---

  // what the grid was searched for before a folder opened, so going back finds it again.
  const gridSearch = useRef('');
  // when a click last opened a folder, so the second click of a double-click plays it instead of landing on its media.
  const openedByClick = useRef(0);

  // a folder opens to its media, growing out of its card.
  // a song shown in its folder comes along ticked.
  const showMedia = (path, focus = null) => {
    closeMenu();
    keepGridScroll();
    if (!openEntry) gridSearch.current = query;
    const card = listRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (card && listRef.current) {
      const box = card.getBoundingClientRect();
      const list = listRef.current.getBoundingClientRect();
      setOpenFrom({ x: box.left + box.width / 2 - list.left, y: box.top + box.height / 2 - list.top });
    } else {
      setOpenFrom(null);
    }
    if (tab !== 'folders') switchTab('folders');
    setQuery('');
    setSelected(path);
    setOpenFolder(path);
    setPickedMedia(focus ? [focus] : []);
    focusMedia.current = focus?.path || null;
    lastClicked.current = focus?.path || null;
  };

  const closeFolder = () => {
    setOpenFolder(null);
    setPickedMedia([]);
    setQuery(gridSearch.current);
    gridSearch.current = '';
  };

  // a click on a folder in the library opens it, and one in a mixtape selects it.
  // a folder that can't be found is only selected, so its panel can help find it again.
  const openCard = (e, list, folder) => {
    if (e.detail > 1) return;
    if (list !== LIBRARY || counts.get(folder.path) === null) {
      setSelected(folder.path);
      return;
    }
    openedByClick.current = e.type === 'click' ? performance.now() : 0;
    showMedia(folder.path);
  };

  // the second click of the double-click that opened a folder lands on its media, so it plays the folder rather than ticking a song.
  const doubleClicked = (e) => e.detail > 1 && performance.now() - openedByClick.current < 800;

  const playMedia = (file) => {
    closeMenu();
    play(dirOf(file.path), file.path);
  };

  const isPicked = (file) => pickedMedia.some((p) => p.path === file.path);

  // a click ticks a song, and a shift-click ticks every song from the last one clicked.
  const clickMedia = (e, file, list) => {
    if (e.shiftKey && lastClicked.current) {
      const a = list.findIndex((f) => f.path === lastClicked.current);
      const b = list.findIndex((f) => f.path === file.path);
      if (a >= 0 && b >= 0) {
        const run = list.slice(Math.min(a, b), Math.max(a, b) + 1);
        setPickedMedia((p) => [...p.filter((x) => !run.some((r) => r.path === x.path)), ...run]);
        return;
      }
    }
    lastClicked.current = file.path;
    setPickedMedia((p) => (p.some((x) => x.path === file.path) ? p.filter((x) => x.path !== file.path) : [...p, file]));
  };

  // a song acted on that's ticked takes the other ticked ones along.
  const withPicked = (file) => (isPicked(file) ? pickedMedia : [file]);

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
    } finally {
      setBusy(null);
    }
  };

  const moveTo = (files, dir) => change(`Moving ${trackCount(files.length)}...`, async () => {
    const res = await moveMedia(files.map((f) => f.path), dir, baseName(dir));
    setPickedMedia([]);
    return res;
  });

  // a new folder takes the media, and then waits to be named like any new one.
  const moveToNew = (files) => change(`Moving ${trackCount(files.length)}...`, async () => {
    const made = await createFolder();
    if (made.error) return { text: made.error };
    const res = await moveMedia(files.map((f) => f.path), made.path, baseName(made.path));
    closeFolder();
    setFresh([made.path]);
    setSelected(made.path);
    setEditing({ kind: 'folder', id: made.path });
    return res;
  });

  const removeMedia = (files) => change(`Deleting ${trackCount(files.length)}...`, async () => {
    const res = await deleteMedia(files.map((f) => f.path));
    setPickedMedia([]);
    return res;
  });

  // songs from elsewhere ask whether to keep the originals, the way importing a folder does.
  const askToAdd = (paths, dir, x, y, flipTo = y) => {
    const known = playableHere(paths);
    const wanted = known.filter((p) => dirOf(p) !== dir);
    if (!wanted.length) {
      warn(known.length ? 'Those are already in this folder.' : 'Downstream can\'t play those files.');
      return;
    }
    setMenu({ kind: 'add', id: dir, paths: wanted, skipped: paths.length - known.length, x, y, flipTo });
  };

  const pickToAdd = async (dir, point) => {
    closeMenu();
    const chosen = await pickMediaFiles();
    if (chosen.length) askToAdd(chosen, dir, point.x, point.y, point.flipTo);
  };

  // where a menu opened from a button goes, below it or else above it.
  const below = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, flipTo: r.top - 4 };
  };

  const addFrom = (move) => {
    const { paths: from, id: dir } = menu;
    change(`${move ? 'Moving' : 'Copying'} ${trackCount(from.length)}...`, () => addMedia(from, dir, move));
  };

  // a folder takes media held over it from finder or file explorer, once it's dropped.
  const fileTarget = (key, dir) => {
    const holding = (e) => holdsFiles(e) && !drag && !mediaDrag;
    return {
      onDragEnter: (e) => {
        if (!holding(e)) return;
        e.preventDefault();
        setFileOver(key);
      },
      onDragOver: (e) => {
        if (!holding(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (fileOver !== key) setFileOver(key);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFileOver((o) => (o === key ? null : o));
      },
      onDrop: (e) => {
        if (!holding(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setFileOver(null);
        askToAdd(droppedPaths(e.dataTransfer), dir, e.clientX, e.clientY);
      },
    };
  };

  // dragging media brings up the places to drop it, with the system's picture of it a pill saying what's carried.
  const mediaDragProps = (file) => ({
    draggable: true,
    onDragStart: (e) => {
      const files = withPicked(file);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', files.map((f) => f.path).join('\n'));
      const pill = document.createElement('div');
      pill.className = 'songs-carry songs-carry-image';
      pill.textContent = files.length === 1 ? files[0].name : trackCount(files.length);
      document.body.appendChild(pill);
      e.dataTransfer.setDragImage(pill, 14, 14);
      setTimeout(() => pill.remove());
      const anchor = (rootRef.current.closest('.primary-widget') || rootRef.current).getBoundingClientRect();
      setTimeout(() => setMediaDrag({ files, anchor }));
    },
    onDragEnd: () => setMediaDrag(null),
  });

  const mediaZoneDrop = (action) => {
    const moving = mediaDrag;
    setMediaDrag(null);
    if (!moving) return;
    if (action === 'trash') removeMedia(moving.files);
    else if (action === 'new') moveToNew(moving.files);
    else if (action.startsWith('folder:')) moveTo(moving.files, action.slice('folder:'.length));
  };

  const renderMediaRow = (file, list, withFolder) => (
    <MediaRow
      key={file.path}
      file={file}
      folder={withFolder ? folderOf(file) : null}
      picked={isPicked(file)}
      playing={playingPath === file.path}
      dragging={!!mediaDrag?.files.some((f) => f.path === file.path)}
      length={lengths.get(file.path)}
      onMore={(e) => openMenuAt(e, 'media', file.path, null, { file })}
      onClick={(e) => clickMedia(e, file, list)}
      onDoubleClick={() => playMedia(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') playMedia(file);
        if (e.key === ' ') {
          e.preventDefault();
          clickMedia(e, file, list);
        }
      }}
      onContextMenu={(e) => openMenuAt(e, 'media', file.path, null, { file })}
      {...mediaDragProps(file)}
    />
  );

  // where an opened mixtape grows from, so it opens out of its tile.
  const [openFrom, setOpenFrom] = useState(null);

  const openMixtape = (id, from = null) => {
    keepGridScroll();
    if (from && listRef.current) {
      const tile = from.getBoundingClientRect();
      const list = listRef.current.getBoundingClientRect();
      setOpenFrom({ x: tile.left + tile.width / 2 - list.left, y: tile.top + tile.height / 2 - list.top });
    } else {
      setOpenFrom(null);
    }
    setOpenTape(id);
    setSelected(null);
  };

  // escape closes an open mixtape, unless its name is being typed.
  useEffect(() => {
    if (!openTape || picking) return;
    const key = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input')) setOpenTape(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [openTape, picking]);

  // a new one opens straight to being named, and an empty one goes on to its add folders list after.
  const newMixtape = (folders = []) => {
    const id = createMixtape(folders);
    if (tab !== 'mixtapes') switchTab('mixtapes');
    openMixtape(id);
    setEditing({ kind: 'mixtape', id, thenPick: folders.length === 0 });
  };

  const openPicker = (id) => {
    setQuery('');
    setPicked([]);
    if (tab !== 'mixtapes') switchTab('mixtapes');
    setOpenTape(id);
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
    addToMixtape(picking, picked);
    setFresh(picked);
    closePicker();
  };

  const rename = async (folder, name) => {
    setEditing(null);
    if (name === null) return;
    const message = await renameFolderOnDisk(folder.path, name);
    if (message) warn(message);
  };

  const locate = async (path) => {
    const [chosen] = await window.electronAPI.selectMusicFolders();
    if (!chosen) return;
    if (!relocateFolder(path, chosen)) warn('That folder is already in your library.');
  };

  // --- dragging ---

  const markOver = (list, before, after) => {
    setOver((o) => (o?.list === list && o?.before === before ? o : { list, before, after }));
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  // a list takes reordering drops when its order means something.
  // the folders tab only reorders within the group the folder is in.
  const orderable = (list, section) => {
    if (!drag || searching || drag.from !== list) return false;
    if (list !== LIBRARY) return true;
    return library.sort === 'custom' && section === drag.section;
  };

  const cardDrag = (list, section, folder) => ({
    draggable: !editing,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', folder.path);
      const panel = rootRef.current.closest('.primary-widget') || rootRef.current;
      const anchor = panel.getBoundingClientRect();
      // after the browser has taken its picture of the card, so the picture isn't faded.
      setTimeout(() => setDrag({ path: folder.path, from: list, section, anchor }));
    },
    onDragEnd: endDrag,
  });

  // the dragged folder takes the place of the card nearest the pointer, and the others move aside for it.
  // the target is the place rather than the card in it, so the cards moving aside never moves the target.
  const gridDragOver = (e, list, section, shown) => {
    if (!orderable(list, section)) return;
    const grid = e.currentTarget;
    const box = grid.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let nearest = null;
    let best = Infinity;
    for (const card of grid.querySelectorAll(':scope > [data-path]')) {
      const dx = Math.max(card.offsetLeft - x, 0, x - card.offsetLeft - card.offsetWidth);
      const dy = Math.max(card.offsetTop - y, 0, y - card.offsetTop - card.offsetHeight);
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        nearest = card.dataset.path;
      }
    }
    const place = shown.findIndex((f) => f.path === nearest);
    if (place < 0) return;
    const rest = shown.filter((f) => f.path !== drag.path);
    markOver(list, rest[place]?.path ?? null, rest[place - 1]?.path ?? null);
  };

  // the folders in the order they'd be in if the dragged one were dropped now.
  const arranged = (list, folders) => {
    const moving = drag && over?.list === list && folders.find((f) => f.path === drag.path);
    if (!moving) return folders;
    const rest = folders.filter((f) => f !== moving);
    const at = over.before === null ? rest.length : rest.findIndex((f) => f.path === over.before);
    if (at < 0) return folders;
    return [...rest.slice(0, at), moving, ...rest.slice(at)];
  };

  // the cards slide under a still pointer, so a card can be new under it when the folder is dropped.
  // chromium asks that card's dragenter whether it takes the drop, so both are accepted.
  const listDragOver = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const listDrop = (e) => {
    e.preventDefault();
    const target = over;
    const moving = drag;
    endDrag();
    if (!moving || !target) return;
    placeFolder(moving.path, { list: target.list, before: target.before, after: target.after, from: moving.from });
  };

  // what a drop on one of the zones around the panel does.
  const zoneDrop = (action, rect) => {
    const moving = drag;
    endDrag();
    if (!moving) return;
    const folder = library.folders.find((f) => f.path === moving.path);
    if (!folder) return;
    if (action === 'trash') remove(folder);
    else if (action === 'remove') unlink(folder);
    else if (action === 'pin') togglePin(folder.path);
    else if (action === 'leave') removeFromMixtape(moving.from, folder.path);
    else if (action === 'new') newMixtape([folder.path]);
    else if (action.startsWith('tape:')) {
      const onto = allTapes.find((t) => t.id === action.slice('tape:'.length));
      if (!onto) return;
      addToMixtape(onto.id, [folder.path]);
      setToast({ text: `Added "${folderName(folder)}" to ${onto.name}.`, ok: true });
    }
  };

  // --- menus ---

  const showPanel = (panel) => setMenu((m) => m && { ...m, panel });

  const backItem = (label) => (
    <button className="queue-ctx-item folders-menu-back" onClick={() => showPanel(null)}>
      <Chevron back />
      <span>{label}</span>
    </button>
  );

  // what deleting for good takes with it, and the button that does it.
  const purgeConfirm = (ids) => {
    const items = deleted.filter((d) => ids.includes(d.id));
    const folders = items.filter((d) => d.kind !== 'media');
    const loose = items.length - folders.length;
    const tracks = folders.reduce((n, d) => n + (d.tracks || 0), 0);
    const named = (d) => (d.kind === 'media' ? mediaName(d.name) : d.name);
    const what = items.length === 1
      ? `"${named(items[0])}"`
      : [folders.length && `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`, loose && trackCount(loose)].filter(Boolean).join(' and ');
    const songs = tracks ? ` and ${folders.length === 1 ? 'its' : 'their'} ${tracks} ${tracks === 1 ? 'track' : 'tracks'}` : '';
    return (
      <>
        <p className="folders-menu-text">{`${what}${songs} will be gone for good. This can't be undone.`}</p>
        <button className="queue-ctx-item folders-menu-danger folders-menu-confirm" onClick={() => purge(ids)}>
          {ids.length === deleted.length && ids.length > 1 ? 'Empty Recently deleted' : 'Delete for good'}
        </button>
      </>
    );
  };

  const deletedMenu = (d) => (
    <>
      <button className="queue-ctx-item" onClick={() => restore(d.id)}>Restore</button>
      <div className="folders-menu-sep" />
      <button className="queue-ctx-item folders-menu-danger" onClick={(e) => askToPurge(e, [d.id])}>Delete for good...</button>
    </>
  );

  // a short list, with the mixtape list, cover colors and the import choice one step in.
  const folderMenu = (folder, list) => {
    const missing = counts.get(folder.path) === null;
    const art = covers.get(folder.path);
    const onTape = list !== LIBRARY && allTapes.find((t) => t.id === list);
    const native = isNative(folder.path, nativeRoot);

    // a folder on its way in can only have its import stopped.
    if (folderImport?.path === folder.path) {
      return <button className="queue-ctx-item folders-menu-danger" onClick={() => { cancelImport(); closeMenu(); }}>Cancel import</button>;
    }

    if (menu.panel === 'import') {
      return (
        <>
          {backItem('Import into Downstream')}
          <div className="folders-menu-sep" />
          <p className="folders-menu-text">{`"${folderName(folder)}" becomes a folder in the Downstream folder, keeping its cover, pin and mixtapes.`}</p>
          <button className="queue-ctx-item" onClick={() => bringIn(folder, false)}>
            <span>Copy</span>
            <span className="folders-menu-note">Keeps the original</span>
          </button>
          <button className="queue-ctx-item" onClick={() => bringIn(folder, true)}>
            <span>Move</span>
            <span className="folders-menu-note">Removes the original</span>
          </button>
        </>
      );
    }

    if (menu.panel === 'mixtapes') {
      return (
        <>
          {backItem('Add to mixtape')}
          <div className="folders-menu-sep" />
          {allTapes.map((t) => {
            const has = t.paths.includes(folder.path);
            return (
              <button key={t.id} className="queue-ctx-item" disabled={has} onClick={() => { addToMixtape(t.id, [folder.path]); closeMenu(); }}>
                <span>{t.name}</span>
                {has && <span className="folders-menu-note">Added</span>}
              </button>
            );
          })}
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

    // a click already opens a folder in the library, and an open one has add media in its footer, so the menu only offers what's out of reach.
    const reach = !missing && (list !== LIBRARY
      ? <button className="queue-ctx-item" onClick={() => showMedia(folder.path)}>Show media</button>
      : openFolder !== folder.path && <button className="queue-ctx-item" onClick={() => pickToAdd(folder.path, { x: menu.x, y: menu.y })}>Add media...</button>);
    return (
      <>
        {reach && (
          <>
            {reach}
            <div className="folders-menu-sep" />
          </>
        )}
        <button className="queue-ctx-item" onClick={() => showPanel('mixtapes')}>
          <span>Add to mixtape</span>
          <Chevron />
        </button>
        <button className="queue-ctx-item" onClick={() => showPanel('cover')}>
          <span>Change cover</span>
          <Chevron />
        </button>
        <button className="queue-ctx-item" disabled={missing} onClick={() => { setEditing({ kind: 'folder', id: folder.path }); closeMenu(); }}>Rename</button>
        {!onTape && (
          <button className="queue-ctx-item" onClick={() => { togglePin(folder.path); closeMenu(); }}>{folder.pinned ? 'Unpin' : 'Pin to top'}</button>
        )}
        <div className="folders-menu-sep" />
        {!native && !missing && (
          <button className="queue-ctx-item" disabled={!!folderImport} onClick={() => showPanel('import')}>
            <span>Import into Downstream</span>
            {folderImport ? <span className="folders-menu-note">Another is importing</span> : <Chevron />}
          </button>
        )}
        {missing ? (
          <button className="queue-ctx-item" onClick={() => { closeMenu(); locate(folder.path); }}>Find it again...</button>
        ) : (
          <button className="queue-ctx-item" onClick={() => { window.electronAPI.openFolder(folder.path); closeMenu(); }}>{REVEAL_LABEL}</button>
        )}
        <div className="folders-menu-sep" />
        {onTape ? (
          <button className="queue-ctx-item folders-menu-danger" onClick={() => { removeFromMixtape(onTape.id, folder.path); closeMenu(); }}>Remove from {onTape.name}</button>
        ) : native && !missing ? (
          <button className="queue-ctx-item folders-menu-danger" onClick={() => remove(folder)}>Delete</button>
        ) : (
          <button className="queue-ctx-item folders-menu-danger" onClick={() => unlink(folder)}>Remove from library</button>
        )}
      </>
    );
  };

  const mixtapeMenu = (t) => (
    <>
      <button className="queue-ctx-item" onClick={() => { openPicker(t.id); closeMenu(); }}>Add folders</button>
      <button className="queue-ctx-item" onClick={() => { openMixtape(t.id); setEditing({ kind: 'mixtape', id: t.id }); closeMenu(); }}>Rename</button>
      <div className="folders-menu-sep" />
      <button className="queue-ctx-item folders-menu-danger" onClick={() => { deleteMixtape(t.id); closeMenu(); }}>Delete mixtape</button>
    </>
  );

  const moveItems = (files, head) => (
    <MoveList files={files} folders={library.folders} drives={drives} head={head} onMove={(dir) => moveTo(files, dir)} onNew={() => moveToNew(files)} />
  );

  // a song's menu, which acts on every ticked song when it's one of them.
  const mediaMenu = (file) => {
    const files = withPicked(file);
    if (menu.panel === 'move') return moveItems(files, backItem('Move to'));
    const one = files.length === 1;
    return (
      <>
        {!one && <div className="folders-menu-title">{trackCount(files.length)}</div>}
        {one && (
          <button className="queue-ctx-item" onClick={() => playMedia(file)}>{playingPath === file.path ? 'Back to the player' : 'Play'}</button>
        )}
        <button className="queue-ctx-item" onClick={() => showPanel('move')}>
          <span>Move to</span>
          <Chevron />
        </button>
        {one && <button className="queue-ctx-item" onClick={() => { window.electronAPI.showMedia(file.path); closeMenu(); }}>{REVEAL_LABEL}</button>}
        <div className="folders-menu-sep" />
        <button className="queue-ctx-item folders-menu-danger" onClick={() => removeMedia(files)}>Delete</button>
      </>
    );
  };

  const addMenu = () => <AddChoice paths={menu.paths} dir={menu.id} skipped={menu.skipped} onChoose={addFrom} />;

  const openMenuAt = (e, kind, id, list, extra = {}) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'contextmenu') {
      setMenu({ kind, id, list, x: e.clientX, y: e.clientY, ...extra });
    } else {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ kind, id, list, x: r.left, y: r.bottom + 4, ...extra });
    }
  };

  // --- cards ---

  const renderCard = (list, section, folder, place) => {
    const importing = folderImport?.path === folder.path ? folderImport : null;
    const playing = playingKey === folder.path;
    const naming = editing?.kind === 'folder' && editing.id === folder.path;
    const classes = [
      selected === folder.path && 'folder-card-selected',
      playing && 'folder-card-playing',
      counts.get(folder.path) === null && 'folder-card-missing',
      section === 'external' && 'folder-card-external',
      drag?.path === folder.path && drag.from === list && 'folder-card-dragging',
      fresh.includes(folder.path) && 'folder-card-fresh',
      fileOver === folder.path && 'folder-card-drop',
    ].filter(Boolean).join(' ');
    const takesFiles = list === LIBRARY && counts.get(folder.path) !== null;
    return (
      <FolderCard
        key={folder.path}
        folder={folder}
        className={classes}
        meta={folderMeta(folder, { playing: playing && !importing, importing })}
        live={playing || !!importing}
        pinned={folder.pinned && list === LIBRARY}
        naming={naming}
        onNamed={(name) => rename(folder, name)}
        onMore={(e) => openMenuAt(e, 'folder', folder.path, list)}
        progress={importing ? (importing.total ? importing.done / importing.total : 0) : null}
        onClick={(e) => { if (!naming) openCard(e, list, folder); }}
        onDoubleClick={() => { if (!naming) playFolder(folder); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !naming) openCard(e, list, folder); }}
        onFocus={() => setSelected(folder.path)}
        onContextMenu={(e) => openMenuAt(e, 'folder', folder.path, list)}
        style={{ order: place }}
        {...cardDrag(list, section, folder)}
        {...(takesFiles ? fileTarget(folder.path, folder.path) : {})}
      />
    );
  };

  // a drag rearranges the cards by their places in the grid rather than in the page.
  // moving the dragged card in the page would end its drag without a drop.
  const renderGrid = (list, section, folders, extra = null) => {
    const shown = arranged(list, folders);
    const places = new Map(shown.map((f, i) => [f.path, i]));
    return (
      <SlidingGrid order={shown.map((f) => f.path).join('\n')} onDragOver={(e) => gridDragOver(e, list, section, shown)}>
        {folders.map((folder) => renderCard(list, section, folder, places.get(folder.path)))}
        {extra}
      </SlidingGrid>
    );
  };

  const renderTile = (t) => {
    const playing = playingKey === t.key;
    return (
      <div
        key={t.id}
        data-tape={t.id}
        role="button"
        tabIndex={0}
        className={`folder-card folder-tile${playing ? ' folder-card-playing' : ''}`}
        title={t.name}
        onClick={(e) => openMixtape(t.id, e.currentTarget)}
        onKeyDown={(e) => { if (e.key === 'Enter') openMixtape(t.id, e.currentTarget); }}
        onContextMenu={t.temp ? undefined : (e) => openMenuAt(e, 'mixtape', t.id)}
      >
        <Mosaic folders={t.all} />
        <span className="folder-card-name">{t.name}</span>
        <span className={`folder-card-meta${playing ? ' folder-card-live' : ''}`}>
          {playing ? 'Playing' : `${t.all.length} ${t.all.length === 1 ? 'folder' : 'folders'}`}
        </span>
        {!t.temp && (
          <button className="folder-card-more" title="More" onClick={(e) => openMenuAt(e, 'mixtape', t.id)}>
            <MoreIcon />
          </button>
        )}
      </div>
    );
  };

  // --- panels ---

  const pickTape = picking && allTapes.find((t) => t.id === picking);
  const onPickTape = new Set(pickTape ? pickTape.paths : []);
  const pickable = library.folders.filter(matcher(query));

  // every folder in the library as a list to tick, with the ones already on the mixtape set aside.
  const pickerPanel = pickTape && (
    pickable.length === 0 ? (
      <div className="folders-empty">{searching ? <>No folders match &ldquo;{query.trim()}&rdquo;.</> : 'Add a folder of music first.'}</div>
    ) : (
      <div className="folders-picker">
        {pickable.map((folder) => {
          const already = onPickTape.has(folder.path);
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

  const total = library.folders.length;
  const shownFolders = folderSections.reduce((n, s) => n + s.folders.length, 0);
  const savedTapes = library.mixtapes.length;
  const tapeCount = savedTapes + (temp.length ? 1 : 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const live = { folders: !!playingKey && !playingMixtape, mixtapes: playingMixtape };
  // headings only matter once there's more than one group to tell apart.
  const headed = folderSections[1].folders.length > 0 || found.length > 0;

  const deletedAgo = (time) => {
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
    return days <= 0 ? 'Deleted today' : days === 1 ? 'Deleted yesterday' : `Deleted ${days} days ago`;
  };
  const shownDeleted = deleted.filter((d) => !searching || d.name.toLowerCase().includes(query.trim().toLowerCase()));
  const deletedBytes = deleted.reduce((n, d) => n + (d.size || 0), 0);

  const deletedPanel = shownDeleted.length > 0 && (
    <div className="folders-section folders-deleted">
      <div className="folders-heading">
        <span>Recently deleted</span>
        <span className="folders-heading-count">{deleted.length}</span>
        <span className="folders-divider-line" />
        <span className="folders-heading-count">{deletedBytes >= 1e9 ? `${(deletedBytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(deletedBytes / 1e6))} MB`}</span>
        <button className="folders-divider-btn" title="Delete everything here for good" onClick={(e) => askToPurge(e, deleted.map((d) => d.id))}>Empty</button>
      </div>
      <div className="folders-grid">
        {shownDeleted.map((d) => (
          <div
            key={d.id}
            role="button"
            tabIndex={0}
            className={`folder-card folder-card-deleted${pickedDeleted === d.id ? ' folder-card-selected' : ''}`}
            title={`Was at ${d.from}`}
            onClick={() => { setSelected(null); setPickedMedia([]); setPickedDeleted(d.id); }}
            onFocus={() => { setSelected(null); setPickedDeleted(d.id); }}
            onContextMenu={(e) => openMenuAt(e, 'deleted', d.id)}
          >
            {d.kind === 'media' ? <span className="folder-cover"><NoteGlyph /></span> : <Cover folder={{ path: d.from, color: d.entry?.color }} />}
            <span className="folder-card-name">{d.kind === 'media' ? mediaName(d.name) : d.name}</span>
            <span className="folder-card-meta">{deletedAgo(d.deletedAt)}</span>
            <button className="folder-card-more" title="More" onClick={(e) => openMenuAt(e, 'deleted', d.id)}>
              <MoreIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const foldersPanel = total === 0 && !deleted.length ? (
    <div className="folders-empty">
      <FolderGlyph size={28} />
      <span>Make a new folder, or add one of yours, to start listening.</span>
    </div>
  ) : searching && shownFolders === 0 && shownDeleted.length === 0 && found.length === 0 ? (
    <div className="folders-empty">No folders or media match &ldquo;{query.trim()}&rdquo;.</div>
  ) : (
    <>
      {folderSections.filter((s) => s.folders.length > 0).map((s) => (
        <div key={s.id} className="folders-section">
          {headed && (
            <div className="folders-heading">
              <span>{s.name}</span>
              <span className="folders-heading-count">{s.folders.length}</span>
              <span className="folders-divider-line" />
            </div>
          )}
          {renderGrid(LIBRARY, s.id, s.folders)}
        </div>
      ))}
      {found.length > 0 && (
        <div className="folders-section">
          <div className="folders-heading">
            <span>Media</span>
            <span className="folders-heading-count">{found.length}</span>
            <span className="folders-divider-line" />
          </div>
          <div className={`folders-songs${pickedMedia.length ? ' folders-songs-picking' : ''}`}>{found.map((file) => renderMediaRow(file, found, true))}</div>
        </div>
      )}
      {deletedPanel}
    </>
  );

  // an open folder takes the grid's place, growing out of its card, with its media to tick, play and move.
  // the folders tab above it, escape or a mouse's back button goes back to the grid.
  const folderPage = openEntry && !pickTape && (
    <div
      className={`folders-page folders-songs${pickedMedia.length ? ' folders-songs-picking' : ''}${fileOver === 'open' ? ' folders-drop-over' : ''}`}
      {...fileTarget('open', openEntry.path)}
      onClickCapture={(e) => { if (doubleClicked(e)) e.stopPropagation(); }}
      onDoubleClickCapture={(e) => {
        if (!doubleClicked(e)) return;
        e.stopPropagation();
        openedByClick.current = 0;
        closeFolder();
        playFolder(openEntry);
      }}
      onClick={(e) => { if (!e.target.closest('[data-media], button')) setPickedMedia([]); }}
    >
      {media === null ? null : shownMedia.length === 0 ? (
        <div className="folders-empty">
          {searching ? (
            <>No media matches &ldquo;{query.trim()}&rdquo;.</>
          ) : (
            <>
              <NoteGlyph size={26} />
              <span>Nothing in this folder yet.</span>
              <span className="folders-empty-hint">Drop files here, or press Add media.</span>
            </>
          )}
        </div>
      ) : shownMedia.map((file) => renderMediaRow(file, shownMedia, false))}
    </div>
  );

  // an open mixtape takes the grid's place the same way, with its folders to play, reorder and add to.
  const tapePage = tape && !pickTape && tab === 'mixtapes' && (
    <div className="folders-page">
      {renderGrid(tape.id, tape.id, tape.folders, tape.all.length === 0 && (
        <div className="folder-card folder-card-empty" role="button" tabIndex={0} onClick={() => openPicker(tape.id)}>
          <PlusIcon size={18} />
          <span>Add folders</span>
        </div>
      ))}
    </div>
  );

  // inside a folder or mixtape, the tabs give way to the way back and the name of what's open.
  const crumbs = ({ back, onBack, name, live = false, more = null }) => (
    <div className="search-tabs folders-tabs folders-crumbs">
      <button className="search-tab folders-crumb-back" onClick={onBack} title={`Back to ${back.toLowerCase()}`}>
        <Chevron back />
        {back}
      </button>
      <span className="search-tab search-tab-active folders-crumb-here">
        {name}
        {live && <span className="folders-tab-live" title="Playing from here" />}
        {more}
      </span>
    </div>
  );

  const shownTapes = tapes.filter((t) => !searching || t.named || t.folders.length > 0);
  const mixtapesPanel = tapeCount === 0 ? (
    <div className="folders-empty">
      <TapeGlyph size={28} />
      <span>Mixtapes play several folders as one.</span>
      <span className="folders-empty-hint">Drag a folder to the row under the panel, or press New mixtape.</span>
    </div>
  ) : searching && shownTapes.length === 0 ? (
    <div className="folders-empty">No mixtapes match &ldquo;{query.trim()}&rdquo;.</div>
  ) : (
    <div className="folders-grid">{shownTapes.map(renderTile)}</div>
  );

  const menuFolder = menu?.kind === 'folder' && library.folders.find((f) => f.path === menu.id);
  const menuTape = menu?.kind === 'mixtape' && allTapes.find((t) => t.id === menu.id);
  const menuDeleted = menu?.kind === 'deleted' && deleted.find((d) => d.id === menu.id);
  const deletedEntry = pickedDeleted && deleted.find((d) => d.id === pickedDeleted);
  const dragged = drag && library.folders.find((f) => f.path === drag.path);
  const selectedFolder = selected && library.folders.find((f) => f.path === selected);
  const openTapeEntry = !pickTape && tab === 'mixtapes' && openTape && allTapes.find((t) => t.id === openTape);
  // a mouse's back button steps out of whatever's open over the grid first, then goes back to the player.
  const stepBack = () => {
    if (pickTape) closePicker();
    else if (openEntry) closeFolder();
    else if (openTapeEntry) setOpenTape(null);
    else if (hasTrack) setMusicFolderView(false);
  };
  stepBackRef.current = stepBack;
  const summary = tab === 'folders' || pickTape
    ? plural(total, 'folder')
    : tape ? `${plural(tape.all.length, 'folder')} on ${tape.name}` : plural(savedTapes, 'mixtape');
  const placeholder = openEntry ? `Search ${folderName(openEntry)}` : tab === 'folders' && !pickTape ? `Search ${summary} and their media` : `Search ${summary}`;
  const dropName = fileOver === 'open' ? openEntry && folderName(openEntry) : fileOver && baseName(fileOver);
  const pickedInfo = pickedMedia.map((f) => ({ ...f, folder: folderOf(f) }));
  // what the list shows, so each change of view starts fresh with its own little entrance.
  const viewKey = pickTape ? `pick:${pickTape.id}` : openEntry ? `folder:${openEntry.path}` : openTapeEntry && tape ? `tape:${tape.id}` : tab;
  // a folder or mixtape opens at its top, and going back finds the grid where it was.
  useLayoutEffect(() => {
    const was = viewRef.current;
    viewRef.current = viewKey;
    if (!was || was === viewKey || !listRef.current) return;
    if (viewKey.includes(':')) listRef.current.scrollTop = 0;
    else if (was.includes(':')) listRef.current.scrollTop = gridScroll.current;
  }, [viewKey]);

  return (
    <div className="folders" ref={rootRef}>
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
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              if (query) setQuery('');
              else if (openEntry) closeFolder();
              else if (openTapeEntry) setOpenTape(null);
            }}
          />
        </div>
        {openEntry ? (
          <select className="folders-sort" value={MEDIA_SORTS.some((m) => m.id === mediaSort) ? mediaSort : 'name-asc'} onChange={(e) => setMediaSort(e.target.value)} title="Sort media">
            {MEDIA_SORTS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        ) : (
          <select className="folders-sort" value={library.sort} onChange={(e) => setSort(e.target.value)} title={`Sort ${tab}`}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>

      <div className="folders-panes">
        {pickTape ? (
          <div className="search-tabs folders-tabs">
            <span className="search-tab search-tab-active">Add to {pickTape.name}</span>
            <button className="folders-pick-cancel" onClick={closePicker}>Cancel</button>
          </div>
        ) : openEntry ? crumbs({
          back: 'Folders',
          onBack: closeFolder,
          name: <span className="folders-crumb-name">{folderName(openEntry)}</span>,
          live: playingKey === openEntry.path,
          more: (
            <button className="folder-card-more folders-crumb-more" title="More" onClick={(e) => openMenuAt(e, 'folder', openEntry.path, LIBRARY)}>
              <MoreIcon />
            </button>
          ),
        }) : openTapeEntry && tape ? crumbs({
          back: 'Mixtapes',
          onBack: () => setOpenTape(null),
          name: editing?.kind === 'mixtape' && editing.id === tape.id ? (
            <NameInput
              value={tape.name}
              onDone={(name) => {
                if (name !== null) renameMixtape(tape.id, name);
                if (editing.thenPick) openPicker(tape.id);
                setEditing(null);
              }}
            />
          ) : (
            <span
              className="folders-crumb-name"
              title={tape.temp ? undefined : 'Double-click to rename'}
              onDoubleClick={() => { if (!tape.temp) setEditing({ kind: 'mixtape', id: tape.id }); }}
            >
              {tape.name}
            </span>
          ),
          live: playingKey === tape.key,
          more: !tape.temp && (
            <button className="folder-card-more folders-crumb-more" title="More" onClick={(e) => openMenuAt(e, 'mixtape', tape.id)}>
              <MoreIcon />
            </button>
          ),
        }) : (
          <div className="search-tabs folders-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === tab}
                className={`search-tab${t.id === tab ? ' search-tab-active' : ''}`}
                onClick={() => { switchTab(t.id); if (t.id === 'mixtapes') setOpenTape(null); }}
              >
                {t.label}
                <span className="folders-tab-count">{t.id === 'folders' ? total : tapeCount}</span>
                {live[t.id] && <span className="folders-tab-live" title="Playing from here" />}
              </button>
            ))}
          </div>
        )}

        <div className="folders-split">
          <div className="folders-body">
            <div className="folders-stage">
            <div
              ref={listRef}
              className="folders-list"
              onDragEnter={listDragOver}
              onDragOver={listDragOver}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
              onDrop={listDrop}
              onClick={(e) => { if (!openEntry && !e.target.closest('.folder-card, button, input')) { setSelected(null); setPickedDeleted(null); } }}
            >
              <div
                key={viewKey}
                className={`folders-view${viewKey.includes(':') ? ' folders-view-open' : ''}`}
                style={openFrom && viewKey.includes(':') ? { '--open-x': `${openFrom.x}px`, '--open-y': `${openFrom.y}px` } : undefined}
              >
                {pickTape ? pickerPanel : folderPage || tapePage || (tab === 'folders' ? foldersPanel : mixtapesPanel)}
              </div>
            </div>
            {dropName && (
              <div className="folders-drop-label">
                <PlusIcon size={12} />
                Drop to add to {dropName}
              </div>
            )}
            </div>

            {pickedMedia.length > 0 && !pickTape ? (
              <div className="folders-footer">
                <span className="folders-footer-count">
                  {busy || `${pickedMedia.length} selected`}
                  {!busy && <button className="search-footer-clear" onClick={() => setPickedMedia([])}>Clear</button>}
                </span>
                <button className="folders-footer-btn folder-info-danger" disabled={!!busy} onClick={() => removeMedia(pickedMedia)}>Delete</button>
                <button className="search-add folders-add" disabled={!!busy} onClick={(e) => setMenu({ kind: 'move', id: null, ...below(e) })}>Move to...</button>
              </div>
            ) : openEntry && !pickTape ? (
              <div className="folders-footer">
                <span className="folders-footer-count">{busy || (media?.length ? 'Drop files here to add them' : '')}</span>
                <button className="search-add folders-add" disabled={!!busy} onClick={(e) => pickToAdd(openEntry.path, below(e))}>
                  <PlusIcon size={13} />
                  Add media
                </button>
              </div>
            ) : openTapeEntry && tape ? (
              <div className="folders-footer">
                <span className="folders-footer-count">{busy || (tape.all.length > 1 && !searching ? 'Drag folders to change their order' : '')}</span>
                {tape.temp && <button className="folders-footer-btn" title="Empty the temporary mixtape" onClick={() => clearTempMixtape()}>Clear</button>}
                <button className={tape.temp ? 'folders-footer-btn' : 'search-add folders-add'} onClick={() => openPicker(tape.id)}>
                  {!tape.temp && <PlusIcon size={13} />}
                  Add folders
                </button>
                {tape.temp && (
                  <button className="search-add folders-add" title="Keep it as a mixtape" onClick={() => { const id = saveTempMixtape(); openMixtape(id); setEditing({ kind: 'mixtape', id }); }}>
                    Save
                  </button>
                )}
              </div>
            ) : pickTape ? (
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
            ) : (
              <div className="folders-footer">
                <span className="folders-footer-count">{busy || summary}</span>
                {tab === 'folders' ? (
                  <>
                    <button className="folders-footer-btn" onClick={pickFolders} title="Add folders from anywhere on your computer, where they stay">
                      Add folders
                    </button>
                    <button className="search-add folders-add" onClick={newFolder} title={nativeRoot ? `Make a folder in ${nativeRoot}` : 'Make a folder in the Downstream folder'}>
                      <PlusIcon size={13} />
                      New folder
                    </button>
                  </>
                ) : (
                  <button className="search-add folders-add" onClick={() => newMixtape()}>
                    <PlusIcon size={13} />
                    New mixtape
                  </button>
                )}
              </div>
            )}
          </div>

          <FolderInfo
            media={dragged ? [] : pickedInfo}
            playingPath={playingPath}
            onPlayMedia={playMedia}
            onShowFolder={openEntry ? null : (file) => showMedia(dirOf(file.path), file)}
            onShowMedia={openEntry ? null : (path) => showMedia(path)}
            deleted={!dragged && deletedEntry}
            onRestore={restore}
            onPurge={askToPurge}
            folder={dragged || selectedFolder}
            tape={!dragged && !selectedFolder && openTapeEntry ? { ...openTapeEntry, folders: openTapeEntry.all } : null}
            playingKey={playingKey}
            onPlay={play}
            onLocate={locate}
          />
        </div>
      </div>

      {mediaDrag && (
        <DragZones
          anchor={mediaDrag.anchor}
          media={{
            files: mediaDrag.files,
            folders: library.folders.filter((f) => counts.get(f.path) !== null),
            here: [...new Set(mediaDrag.files.map((f) => dirOf(f.path)))],
          }}
          onDrop={mediaZoneDrop}
        />
      )}

      {drag && dragged && (
        <DragZones
          anchor={drag.anchor}
          folder={dragged}
          from={drag.from}
          native={isNative(dragged.path, nativeRoot) && counts.get(dragged.path) !== null}
          tapes={allTapes.map((t) => ({ ...t, folders: t.all }))}
          onDrop={zoneDrop}
        />
      )}

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

      {(menuFolder || menuTape || menuDeleted) && (
        <Menu key={menu.panel || 'main'} x={menu.x} y={menu.y} onClose={closeMenu}>
          {menuFolder ? folderMenu(menuFolder, menu.list) : menuTape ? mixtapeMenu(menuTape) : deletedMenu(menuDeleted)}
        </Menu>
      )}

      {menu?.kind === 'media' && (
        <Menu key={menu.panel || 'main'} x={menu.x} y={menu.y} onClose={closeMenu}>
          {mediaMenu(menu.file)}
        </Menu>
      )}

      {menu?.kind === 'move' && pickedMedia.length > 0 && (
        <Menu x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          {moveItems(pickedMedia, <div className="folders-menu-title">{`Move ${trackCount(pickedMedia.length)} to`}</div>)}
        </Menu>
      )}

      {menu?.kind === 'add' && (
        <Menu x={menu.x} y={menu.y} flipTo={menu.flipTo} onClose={closeMenu}>
          {addMenu()}
        </Menu>
      )}

      {confirm && (
        <Menu x={confirm.x} y={confirm.y} flipTo={confirm.flipTo} onClose={() => setConfirm(null)}>
          <div className="folders-menu-title">{confirm.ids.length > 1 ? 'Empty Recently deleted' : 'Delete for good'}</div>
          {purgeConfirm(confirm.ids)}
        </Menu>
      )}
    </div>
  );
}
