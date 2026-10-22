import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { moveLoudnessRecords } from './loudnessService';
import { dbg } from './debugLog';

// a mixtape plays its folders as one library, and is stored as the current source under this prefix.
export const MIXTAPE_PREFIX = 'mixtape:';
// the temporary mixtape's id, which is never saved.
export const TEMP = 'temporary';
// the folders section, as a drop target.
export const LIBRARY = 'library';

export const FOLDER_COLORS = ['#4cd0c1', '#5b8def', '#9b7bf0', '#e86ca8', '#f07a5f', '#f2b84b', '#6cc96a', '#8a99ab'];

const app = () => useAppStore.getState();

function update(change) {
  const { library, setLibrary } = app();
  setLibrary(change(library));
}

export function baseName(path) {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export const folderName = (folder) => baseName(folder.path);

export const mixtapeKey = (id) => `${MIXTAPE_PREFIX}${id}`;

// the player wants the folder screen when nothing is loaded, or when the folder chip was pressed.
// the store's folderScreen follows this once the player has faded out.
export const wantsFolderScreen = (s) => !s.musicFolder || s.musicFolderView || (!s.musicPlaying && !s.musicCurrent);

// the folder paths in a mixtape, saved or temporary.
export function mixtapeFolders(id, state = app()) {
  if (id === TEMP) return state.tempMixtape;
  return state.library.mixtapes.find((m) => m.id === id)?.folders || [];
}

// the folders a source plays: one folder, or every folder on a mixtape that's still in the library.
export function sourcePaths(key, state = app()) {
  if (!key) return [];
  if (!key.startsWith(MIXTAPE_PREFIX)) return [key];
  const known = new Set(state.library.folders.map((f) => f.path));
  return mixtapeFolders(key.slice(MIXTAPE_PREFIX.length), state).filter((p) => known.has(p));
}

export function sourceName(key, state = app()) {
  if (!key) return '';
  if (!key.startsWith(MIXTAPE_PREFIX)) return baseName(key);
  const id = key.slice(MIXTAPE_PREFIX.length);
  if (id === TEMP) return 'Temporary mixtape';
  return state.library.mixtapes.find((m) => m.id === id)?.name || 'Mixtape';
}

// every playable file in a source, folder by folder.
export async function readSource(key) {
  const exts = getAcceptedExtensions(app());
  const lists = await Promise.all(sourcePaths(key).map((p) => window.electronAPI.readMusicFolder(p, exts)));
  return lists.flat();
}

// what startup loads ahead of time: the last thing played, or the first folder.
// the temporary mixtape is gone by then, so it falls back to the first folder.
export function startupSource(library = app().library) {
  const state = { library, tempMixtape: [] };
  if (library.lastSource && sourcePaths(library.lastSource, state).length > 0) return library.lastSource;
  return library.folders[0]?.path || null;
}

function markPlayed(key) {
  const now = Date.now();
  update((lib) => ({
    ...lib,
    lastSource: key,
    folders: lib.folders.map((f) => (f.path === key ? { ...f, lastPlayed: now } : f)),
    mixtapes: lib.mixtapes.map((m) => (mixtapeKey(m.id) === key ? { ...m, lastPlayed: now } : m)),
  }));
}

// plays a folder or mixtape.
// the source that's already playing just goes back to the player.
// returns a message when there's nothing to play.
export async function playSource(key) {
  const state = app();
  if (state.musicFolder === key && state.musicCurrent) {
    state.setMusicFolderView(false);
    return null;
  }
  const exts = getAcceptedExtensions(state);
  const isMixtape = key.startsWith(MIXTAPE_PREFIX);
  dbg('library', `loading ${isMixtape ? 'mixtape' : 'folder'} "${sourceName(key)}" (accepts ${exts.join(', ')})`);
  const files = await readSource(key);

  if (files.length === 0) {
    dbg('library', '!', 'no supported files found');
    const kinds = exts.map((e) => `.${e}`).join(', ');
    return isMixtape
      ? `Nothing to play on this mixtape yet. Drag folders with ${kinds} files onto it.`
      : `No supported files found. Add ${kinds} files to this folder.`;
  }

  // when shuffle will be active (already on, or about to be enabled by shuffle on start below), the first track must be random too.
  // toggleMusicShuffle anchors its queue on the current track, so seeding with files[0] made the same alphabetically-first song open every session even though the rest of the queue was shuffled.
  const willShuffle = state.musicShuffle || state.behaviorShuffleOnStart;
  const first = willShuffle ? files[Math.floor(Math.random() * files.length)] : files[0];
  dbg('library', `loaded ${files.length} track(s), auto-selecting "${first.name}"${willShuffle ? ' (random start)' : ''}`);
  state.setMusicFolder(key);
  state.setMusicFiles(files);
  state.setMusicCurrent(first);
  state.setMusicFolderView(false);
  markPlayed(key);

  if (state.behaviorNormalizeOnStart && !state.musicNormalize) {
    state.toggleMusicNormalize();
  }
  if (state.behaviorShuffleOnStart && !state.musicShuffle) {
    state.toggleMusicShuffle();
  }
  return null;
}

// a mixtape that's playing picks up its new folders without stopping the song.
async function refreshIfPlaying(id) {
  const key = mixtapeKey(id);
  if (app().musicFolder !== key || !app().musicCurrent) return;
  const files = await readSource(key);
  if (app().musicFolder !== key) return;
  app().setMusicFiles(files);
  dbg('library', `playing mixtape now has ${files.length} track(s)`);
}

// adds folders not already saved, and returns the ones that were new.
export function addFolders(paths) {
  const known = new Set(app().library.folders.map((f) => f.path));
  const fresh = [...new Set(paths)].filter((p) => !known.has(p));
  if (fresh.length) {
    update((lib) => ({ ...lib, folders: [...lib.folders, ...fresh.map((path) => ({ path }))] }));
    dbg('library', `added ${fresh.length} folder(s)`);
  }
  return fresh;
}

function setList(id, change) {
  if (id === TEMP) {
    app().setTempMixtape(change(app().tempMixtape));
  } else {
    update((lib) => ({ ...lib, mixtapes: lib.mixtapes.map((m) => (m.id === id ? { ...m, folders: change(m.folders) } : m)) }));
  }
  refreshIfPlaying(id);
}

function insert(list, path, before) {
  const rest = list.filter((p) => p !== path);
  const at = before ? rest.indexOf(before) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, path);
  return rest;
}

// where a dragged folder lands.
// from the folders section onto a mixtape it's added, between mixtapes it moves, and back onto the folders section it leaves its mixtape.
// within the folders section it's reordered, taking on the pin of the folder it lands before.
export function placeFolder(path, { list, before = null, from = LIBRARY }) {
  if (before === path) return;
  if (list === LIBRARY) {
    if (from !== LIBRARY) {
      removeFromMixtape(from, path);
      return;
    }
    update((lib) => {
      const moving = lib.folders.find((f) => f.path === path);
      if (!moving) return lib;
      const target = lib.folders.find((f) => f.path === before);
      const rest = lib.folders.filter((f) => f.path !== path);
      const at = target ? rest.indexOf(target) : rest.length;
      rest.splice(at, 0, { ...moving, pinned: !!target?.pinned });
      return { ...lib, folders: rest };
    });
    return;
  }
  setList(list, (folders) => insert(folders, path, before));
  if (from !== LIBRARY && from !== list) removeFromMixtape(from, path);
}

// adds several folders to the end of a mixtape, skipping any already on it.
export function addToMixtape(id, paths) {
  setList(id, (folders) => [...folders, ...paths.filter((p) => !folders.includes(p))]);
  dbg('library', `added ${paths.length} folder(s) to "${sourceName(mixtapeKey(id))}"`);
}

export function removeFromMixtape(id, path) {
  setList(id, (folders) => folders.filter((p) => p !== path));
}

// takes a folder out of the library, and off every mixtape.
export function removeFolder(path) {
  update((lib) => ({
    ...lib,
    folders: lib.folders.filter((f) => f.path !== path),
    mixtapes: lib.mixtapes.map((m) => ({ ...m, folders: m.folders.filter((p) => p !== path) })),
  }));
  app().setTempMixtape(app().tempMixtape.filter((p) => p !== path));
  dbg('library', `removed "${baseName(path)}"`);
}

const inside = (file, dir) => file.startsWith(dir) && /^[/\\]/.test(file.slice(dir.length));

// points everything that knew the folder's old path at its new one, including saved folders inside it and what's playing right now.
function movePaths(oldPath, newPath) {
  const swap = (p) => (p && (p === oldPath || inside(p, oldPath)) ? newPath + p.slice(oldPath.length) : p);
  update((lib) => ({
    ...lib,
    lastSource: swap(lib.lastSource),
    folders: lib.folders.map((f) => ({ ...f, path: swap(f.path) })),
    mixtapes: lib.mixtapes.map((m) => ({ ...m, folders: m.folders.map(swap) })),
  }));
  const state = app();
  state.setTempMixtape(state.tempMixtape.map(swap));
  if (swap(state.musicFolder) !== state.musicFolder) state.setMusicFolder(swap(state.musicFolder));
  const moveFile = (f) => (inside(f.path, oldPath) ? { ...f, path: swap(f.path) } : f);
  if (state.musicFiles.some((f) => inside(f.path, oldPath))) {
    useAppStore.setState({
      musicFiles: state.musicFiles.map(moveFile),
      musicShuffledQueue: state.musicShuffledQueue.map(moveFile),
    });
  }
  if (state.musicCurrent && inside(state.musicCurrent.path, oldPath)) {
    state.setMusicCurrent({ ...moveFile(state.musicCurrent), movedFrom: state.musicCurrent.path });
  }
}

// a folder that was moved outside downstream keeps its color, pin and mixtapes.
export function relocateFolder(path, newPath) {
  if (app().library.folders.some((f) => f.path === newPath)) return false;
  movePaths(path, newPath);
  return true;
}

// renames the folder on the computer, and returns a message if it couldn't.
export async function renameFolderOnDisk(path, name) {
  if (!name || name.trim() === baseName(path)) return null;
  const res = await window.electronAPI.renameFolder(path, name);
  if (res?.error) {
    dbg('library', '!', `rename of "${baseName(path)}" failed: ${res.error}`);
    return res.error;
  }
  if (res.path !== path) {
    movePaths(path, res.path);
    moveLoudnessRecords(path, res.path);
    dbg('library', `renamed "${baseName(path)}" to "${baseName(res.path)}" on disk`);
  }
  return null;
}

// null goes back to album art.
export function setFolderColor(path, color) {
  update((lib) => ({ ...lib, folders: lib.folders.map((f) => (f.path === path ? { ...f, color } : f)) }));
}

export function togglePin(path) {
  update((lib) => {
    const folder = lib.folders.find((f) => f.path === path);
    if (!folder) return lib;
    const rest = lib.folders.filter((f) => f.path !== path);
    const pinned = !folder.pinned;
    // pinning goes to the end of the pinned folders, unpinning to the start of the rest.
    const lastPinned = rest.findLastIndex((f) => f.pinned);
    rest.splice(lastPinned + 1, 0, { ...folder, pinned });
    return { ...lib, folders: rest };
  });
}

function uniqueName(base) {
  const names = new Set(app().library.mixtapes.map((m) => m.name));
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  return name;
}

// returns the new mixtape's id.
export function createMixtape(folders = [], name = uniqueName('New mixtape')) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  update((lib) => ({ ...lib, mixtapes: [...lib.mixtapes, { id, name, folders }] }));
  dbg('library', `created mixtape "${name}" with ${folders.length} folder(s)`);
  return id;
}

export function renameMixtape(id, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  update((lib) => ({ ...lib, mixtapes: lib.mixtapes.map((m) => (m.id === id ? { ...m, name: trimmed } : m)) }));
}

export function deleteMixtape(id) {
  update((lib) => {
    const { [id]: _, ...collapsed } = lib.collapsed;
    return { ...lib, collapsed, mixtapes: lib.mixtapes.filter((m) => m.id !== id) };
  });
}

// keeps the temporary mixtape as a real one, and carries on playing it if it's playing.
export function saveTempMixtape() {
  const id = createMixtape(app().tempMixtape, uniqueName('My mixtape'));
  const playing = app().musicFolder === mixtapeKey(TEMP);
  app().setTempMixtape([]);
  if (playing) {
    app().setMusicFolder(mixtapeKey(id));
    markPlayed(mixtapeKey(id));
  }
  return id;
}

export function clearTempMixtape() {
  app().setTempMixtape([]);
}

export function toggleCollapsed(sectionId) {
  update((lib) => ({ ...lib, collapsed: { ...lib.collapsed, [sectionId]: !lib.collapsed[sectionId] } }));
}

export function setSort(sort) {
  update((lib) => ({ ...lib, sort }));
}
