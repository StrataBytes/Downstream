import useAppStore, { getAcceptedExtensions, shuffleUpNext } from '../stores/useAppStore';
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
  const next = change(library);
  if (next !== library) setLibrary(next);
}

export function baseName(path) {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export const folderName = (folder) => baseName(folder.path);

// a folder directly inside downstream's own folder.
export function isNative(path, root = app().nativeRoot) {
  return !!root && path.startsWith(root) && /^[/\\][^/\\]+$/.test(path.slice(root.length));
}

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

// plays a folder or mixtape, from one of its songs when one is given.
// the source that's already playing just goes back to the player, or on to that song.
// returns a message when there's nothing to play.
export async function playSource(key, startAt = null) {
  const state = app();
  if (state.musicFolder === key && state.musicCurrent) {
    const song = startAt && state.musicFiles.find((f) => f.path === startAt);
    if (song && song.path !== state.musicCurrent.path) state.setMusicCurrent(song);
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

  state.setMusicFolder(key);
  // shuffle on start turns on before the songs arrive, so they start a shuffle round.
  if (state.behaviorShuffleOnStart && !app().musicShuffle) useAppStore.setState({ musicShuffle: true });
  state.setMusicFiles(files);
  // with shuffle on, the first song is the round's next one, which is random in a new round and picks up a remembered one.
  const shuffled = app().musicShuffle;
  const first = (startAt && files.find((f) => f.path === startAt)) || (shuffled && shuffleUpNext(app())) || files[0];
  dbg('library', `loaded ${files.length} track(s), auto-selecting "${first.name}"${shuffled ? ` (shuffle, ${app().musicShuffledIndex + 1} played this round)` : ''}`);
  state.setMusicCurrent(first);
  state.setMusicFolderView(false);
  markPlayed(key);
  return null;
}

// a mixtape that's playing picks up its new folders without stopping the song.
async function refreshIfPlaying(id) {
  const key = mixtapeKey(id);
  if (app().musicFolder !== key || !app().musicCurrent) return;
  const files = await readSource(key);
  if (app().musicFolder !== key) return;
  app().mergeMusicFiles(files);
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
export function placeFolder(path, { list, before = null, after = null, from = LIBRARY }) {
  if (before === path) return;
  if (list === LIBRARY) {
    if (from !== LIBRARY) {
      removeFromMixtape(from, path);
      return;
    }
    update((lib) => {
      const moving = lib.folders.find((f) => f.path === path);
      if (!moving) return lib;
      const rest = lib.folders.filter((f) => f.path !== path);
      const next = rest.find((f) => f.path === before);
      const prev = rest.find((f) => f.path === after);
      if (!next && !prev) return lib;
      // pinned folders come first, so a folder before a pinned one is pinned and one after an unpinned one isn't.
      // between the two groups it keeps its pin.
      const pinned = next?.pinned ? true : prev && !prev.pinned ? false : !!moving.pinned;
      const at = next && !!next.pinned === pinned ? rest.indexOf(next) : prev ? rest.indexOf(prev) + 1 : rest.length;
      if (at === lib.folders.indexOf(moving) && pinned === !!moving.pinned) return lib;
      rest.splice(at, 0, { ...moving, pinned });
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

// what the library knows about a folder beyond its path: its color, pin, id and where it sits on each mixtape.
function knownAbout(path) {
  const { library } = app();
  return {
    entry: library.folders.find((f) => f.path === path),
    mixtapes: library.mixtapes.filter((m) => m.folders.includes(path)).map((m) => ({ id: m.id, at: m.folders.indexOf(path) })),
  };
}

// puts a folder back in the library with what was known about it, at its old place on each mixtape that's still around.
function putBack(path, { entry = {}, mixtapes = [] }) {
  update((lib) => ({
    ...lib,
    folders: lib.folders.some((f) => f.path === path)
      ? lib.folders.map((f) => (f.path === path ? { ...entry, ...f, path } : f))
      : [...lib.folders, { ...entry, path }],
    mixtapes: lib.mixtapes.map((m) => {
      const was = mixtapes.find((t) => t.id === m.id);
      if (!was || m.folders.includes(path)) return m;
      const folders = [...m.folders];
      folders.splice(Math.min(was.at, folders.length), 0, path);
      return { ...m, folders };
    }),
  }));
  mixtapes.forEach((t) => refreshIfPlaying(t.id));
}

// takes a folder out of the library, and off every mixtape.
// returns a way to undo it.
export function removeFolder(path) {
  const known = knownAbout(path);
  const onTapes = [...known.mixtapes.map((t) => t.id), ...(app().tempMixtape.includes(path) ? [TEMP] : [])];
  update((lib) => ({
    ...lib,
    folders: lib.folders.filter((f) => f.path !== path),
    mixtapes: lib.mixtapes.map((m) => ({ ...m, folders: m.folders.filter((p) => p !== path) })),
  }));
  app().setTempMixtape(app().tempMixtape.filter((p) => p !== path));
  onTapes.forEach(refreshIfPlaying);
  dbg('library', `removed "${baseName(path)}"`);
  return () => {
    putBack(path, known);
    dbg('library', `put "${baseName(path)}" back`);
  };
}

function followFolder(from, to) {
  movePaths(from, to);
  moveLoudnessRecords(from, to);
  dbg('library', `"${baseName(from)}" turned up as "${baseName(to)}"`);
}

// brings the library in step with downstream's own folder.
// new folders join it, and a saved folder that turns up there, or renamed where it was, keeps its place, color and mixtapes.
// a folder that's gone shows as missing like any other, and nothing changes when the folder can't be read.
export async function syncNativeFolders() {
  const res = await window.electronAPI.listNativeFolders(app().library.folders.map((f) => f.path));
  app().setNativeRoot(res.root);
  if (!res.error) {
    const known = new Set(app().library.folders.map((f) => f.path));
    const arrived = new Map(res.folders.filter((f) => !known.has(f.path)).map((f) => [f.id, f.path]));
    app().library.folders.forEach((folder) => {
      const moved = folder.id && !res.ids[folder.path] && arrived.get(folder.id);
      if (!moved) return;
      arrived.delete(folder.id);
      followFolder(folder.path, moved);
    });
  }
  const present = new Set([...Object.keys(res.ids), ...(res.folders || []).map((f) => f.path)]);
  const lost = app().library.folders.filter((f) => f.id && !present.has(f.path) && !isNative(f.path, res.root));
  if (lost.length) {
    const found = await window.electronAPI.findMovedFolders(lost.map(({ path, id }) => ({ path, id })));
    Object.entries(found).forEach(([from, to]) => {
      if (!app().library.folders.some((f) => f.path === to)) followFolder(from, to);
    });
  }
  // ids are kept for every folder that can be found, so a later move can be followed.
  const ids = { ...res.ids, ...Object.fromEntries((res.folders || []).map((f) => [f.path, f.id])) };
  update((lib) => {
    const known = new Set(lib.folders.map((f) => f.path));
    const fresh = (res.folders || []).filter((f) => !known.has(f.path)).map(({ path, id }) => ({ path, id }));
    const folders = lib.folders.map((f) => (ids[f.path] && ids[f.path] !== f.id ? { ...f, id: ids[f.path] } : f));
    if (!fresh.length && folders.every((f, i) => f === lib.folders[i])) return lib;
    if (fresh.length) dbg('library', `${fresh.length} new folder(s) in the Downstream folder`);
    return { ...lib, folders: [...folders, ...fresh] };
  });
}

// makes a native folder and adds it to the library, returning its path, or a message when it couldn't.
export async function createFolder(name = 'New folder') {
  const res = await window.electronAPI.createNativeFolder(name);
  if (res.error) {
    dbg('library', '!', `couldn't create "${name}": ${res.error}`);
    return { error: res.error };
  }
  update((lib) => (lib.folders.some((f) => f.path === res.path) ? lib : { ...lib, folders: [...lib.folders, { path: res.path, id: res.id }] }));
  if (!app().nativeRoot) syncNativeFolders();
  dbg('library', `created "${baseName(res.path)}"`);
  return { path: res.path };
}

// brings an external folder into downstream's own folder, copied or moved.
// the library switches to the new folder either way, so its color, pin, mixtapes, measurements and what's playing follow it.
// returns anything worth knowing, an error, or nothing when it was cancelled.
export async function importFolder(path, move) {
  dbg('library', `importing "${baseName(path)}" (${move ? 'move' : 'copy'})`);
  app().setFolderImport({ path, move, done: 0, total: 0 });
  const res = await window.electronAPI.importFolder({ folderPath: path, move });
  app().setFolderImport(null);
  if (res.cancelled) {
    dbg('library', `import of "${baseName(path)}" cancelled`);
    return {};
  }
  if (res.error) {
    dbg('library', '!', `import of "${baseName(path)}" failed: ${res.error}`);
    return { error: res.error };
  }
  // a check of the downstream folder during the import may have already found the new folder.
  update((lib) => ({ ...lib, folders: lib.folders.filter((f) => f.path !== res.path) }));
  movePaths(path, res.path);
  moveLoudnessRecords(path, res.path);
  update((lib) => ({ ...lib, folders: lib.folders.map((f) => (f.path === res.path ? { ...f, id: res.id } : f)) }));
  dbg('library', `imported "${baseName(path)}" as "${baseName(res.path)}"`);
  return { notice: res.leftover ? "The folder was imported, but some of its files couldn't be removed from where it was." : null };
}

export const cancelImport = () => window.electronAPI.cancelImport();

// the folders in recently deleted, newest first.
export async function loadDeleted() {
  app().setDeletedFolders(await window.electronAPI.listDeleted());
}

// moves a native folder into recently deleted and out of the library.
// what the library knew about it goes along, so a restore brings back its color, pin and place on mixtapes.
// the music stops when the folder is what's playing.
// returns the deleted folder's id, or a message when it couldn't.
export async function deleteFolder(path, tracks = null) {
  const res = await window.electronAPI.deleteNativeFolder(path, { ...knownAbout(path), tracks });
  if (res.error) {
    dbg('library', '!', `couldn't delete "${baseName(path)}": ${res.error}`);
    return { error: res.error };
  }
  if (app().musicFolder === path) app().clearMusic();
  if (app().downloadFolder === path) app().setDownloadFolder(null);
  removeFolder(path);
  await loadDeleted();
  dbg('library', `deleted "${baseName(path)}" into recently deleted`);
  return { id: res.id };
}

export async function restoreDeleted(id) {
  const res = await window.electronAPI.restoreDeleted(id);
  if (res.error) {
    dbg('library', '!', `couldn't restore: ${res.error}`);
    await loadDeleted();
    return { error: res.error };
  }
  const { from } = res.note;
  // a song goes back into its folder, which the media service follows up.
  if (res.note.kind === 'media') {
    await loadDeleted();
    return { path: res.path, media: true };
  }
  if (from && from !== res.path) moveLoudnessRecords(from, res.path);
  putBack(res.path, res.note);
  await loadDeleted();
  dbg('library', `restored "${baseName(res.path)}"`);
  return { path: res.path };
}

// deleted for good, with nothing left to restore.
export async function purgeDeleted(ids) {
  const res = await window.electronAPI.purgeDeleted(ids);
  await loadDeleted();
  return res.error ? { error: res.error } : {};
}

// things outside the library that know folders by path, told before a folder moves.
const moveListeners = new Set();

export function onFolderMoved(listener) {
  moveListeners.add(listener);
  return () => moveListeners.delete(listener);
}

const inside = (file, dir) => file.startsWith(dir) && /^[/\\]/.test(file.slice(dir.length));

// points everything that knew the folder's old path at its new one, including saved folders inside it and what's playing right now.
function movePaths(oldPath, newPath) {
  window.electronAPI.folderMoved(oldPath, newPath);
  moveListeners.forEach((listener) => listener(oldPath, newPath));
  const swap = (p) => (p && (p === oldPath || inside(p, oldPath)) ? newPath + p.slice(oldPath.length) : p);
  update((lib) => ({
    ...lib,
    lastSource: swap(lib.lastSource),
    folders: lib.folders.map((f) => ({ ...f, path: swap(f.path) })),
    mixtapes: lib.mixtapes.map((m) => ({ ...m, folders: m.folders.map(swap) })),
  }));
  const state = app();
  state.setTempMixtape(state.tempMixtape.map(swap));
  if (state.downloadFolder && swap(state.downloadFolder) !== state.downloadFolder) state.setDownloadFolder(swap(state.downloadFolder));
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
  // a remembered shuffle round follows too, so it still picks up where it was.
  try {
    const round = JSON.parse(localStorage.getItem('shuffleRound'));
    if (round) localStorage.setItem('shuffleRound', JSON.stringify({ ...round, source: swap(round.source), order: round.order.map(swap) }));
  } catch { /* nothing remembered */ }
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
