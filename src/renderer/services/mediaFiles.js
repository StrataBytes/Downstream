// adding, moving and deleting media one file at a time, from the folder screen and the library sidebar.
// main does the work on disk, and this keeps the player, the shuffle round and the measurements in step with it.

import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { readSource, loadDeleted, baseName } from './musicLibrary';
import { moveLoudnessFiles } from './loudnessService';
import { dbg } from './debugLog';

const app = () => useAppStore.getState();

export const dirOf = (file) => file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));

// a file's name as the library shows it, without its extension.
export const mediaName = (file) => baseName(file).replace(/\.[^.]+$/, '');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const trackCount = (n) => plural(n, 'track');

// screens that show folders' media, told which folders just changed.
const listeners = new Set();

export function onMediaChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(folders) {
  const dirs = [...new Set(folders)];
  if (dirs.length) listeners.forEach((listener) => listener(dirs));
}

// the songs of a drop from finder or file explorer, by path.
export function droppedPaths(dataTransfer) {
  return [...(dataTransfer?.files || [])].map((file) => {
    try {
      return window.electronAPI.pathForFile(file) || file.path;
    } catch {
      return file.path;
    }
  }).filter(Boolean);
}

// files held over the window from outside it, rather than something dragged inside downstream.
export const holdsFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

export const playableHere = (paths) => {
  const exts = getAcceptedExtensions(app());
  return paths.filter((p) => exts.includes(p.split('.').pop().toLowerCase()));
};

// the playing source picks up what changed in its folders without stopping the song.
// a song that moved keeps its place in the round, and one moved out of the source plays on from its new place.
async function followPlaying(pairs = []) {
  const s = app();
  const key = s.musicFolder;
  if (!key) return;
  const moved = new Map(pairs.map((p) => [p.from, p.to]));
  const swap = (f) => (moved.has(f.path) ? { ...f, path: moved.get(f.path) } : f);
  if (moved.size) {
    useAppStore.setState({ musicShuffledQueue: s.musicShuffledQueue.map(swap) });
    try {
      const round = JSON.parse(localStorage.getItem('shuffleRound'));
      if (round) localStorage.setItem('shuffleRound', JSON.stringify({ ...round, order: round.order.map((p) => moved.get(p) || p) }));
    } catch { /* nothing remembered */ }
  }
  const files = await readSource(key);
  const now = app();
  if (now.musicFolder !== key) return;
  const current = now.musicCurrent;
  const to = current && moved.get(current.path);
  const place = current ? now.musicFiles.findIndex((f) => f.path === current.path) : -1;
  now.mergeMusicFiles(files);
  if (!to) return;
  const there = files.find((f) => f.path === to);
  useAppStore.setState({
    musicCurrent: there
      ? { ...there, movedFrom: current.path }
      : { ...current, name: mediaName(to), path: to, movedFrom: current.path, movedOut: true, place: Math.max(place, 0) },
  });
  dbg('player', `"${current.name}" moved while playing, carrying on`);
}

// what plays once the playing song is gone, or null when nothing's left.
function nextAfter(s, leaving) {
  const out = new Set(leaving);
  const rest = s.musicFiles.filter((f) => !out.has(f.path));
  if (!rest.length) return null;
  if (s.musicShuffle) {
    const upcoming = s.musicShuffledQueue.slice(s.musicShuffledIndex + 1).find((f) => !out.has(f.path));
    if (upcoming) return rest.find((f) => f.path === upcoming.path) || rest[0];
  }
  const idx = s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path);
  const start = idx < 0 ? (s.musicCurrent.place ?? 0) : idx + 1;
  for (let i = 0; i < s.musicFiles.length; i++) {
    const f = s.musicFiles[(start + i) % s.musicFiles.length];
    if (!out.has(f.path)) return f;
  }
  return rest[0];
}

async function place(items, copy) {
  const results = await window.electronAPI.placeMedia({ items, copy });
  const done = results.filter((r) => r.to && !r.same);
  const failed = results.filter((r) => r.error);
  if (!copy && done.length) moveLoudnessFiles(done);
  failed.forEach((r) => dbg('library', '!', `couldn't ${copy ? 'copy' : 'move'} "${baseName(r.from)}": ${r.error}`));
  return { done, failed };
}

// a short message about what didn't go, for the end of a notice.
function failures(failed, verb) {
  if (!failed.length) return '';
  if (failed.length === 1) return ` "${mediaName(failed[0].from)}" couldn't be ${verb}: ${failed[0].error}`;
  return ` ${failed.length} couldn't be ${verb}. ${failed[0].error}`;
}

// what a notice says went where, and about any that had to take a numbered name since theirs was taken.
function summary(verb, done, dirName) {
  if (done.length === 1) {
    const was = mediaName(done[0].from);
    const now = mediaName(done[0].to);
    return was === now ? `${verb} "${was}" to ${dirName}.` : `${verb} "${was}" to ${dirName} as "${now}", since that name was taken.`;
  }
  const n = done.filter((r) => baseName(r.to) !== baseName(r.from)).length;
  const numbered = n ? ` ${n === 1 ? 'One was' : `${n} were`} given a number, since ${n === 1 ? 'its name was' : 'their names were'} taken.` : '';
  return `${verb} ${trackCount(done.length)} to ${dirName}.${numbered}`;
}

// moves songs between folders, as a real move that leaves nothing behind.
// returns a notice, with a way to put them back where they were.
export async function moveMedia(paths, dir, dirName = baseName(dir)) {
  const { done, failed } = await place(paths.map((from) => ({ from, dir })), false);
  await followPlaying(done);
  changed([dir, ...paths.map(dirOf)]);
  dbg('library', `moved ${done.length} track(s) to "${dirName}"`);
  const text = done.length
    ? `${summary('Moved', done, dirName)}${failures(failed, 'moved')}`
    : `Nothing was moved.${failures(failed, 'moved')}`;
  return {
    text,
    ok: done.length > 0,
    moved: done,
    undo: done.length ? () => putBack(done) : null,
  };
}

// the songs go back to the folders and names they had.
async function putBack(done) {
  const back = await place(done.map((r) => ({ from: r.to, dir: dirOf(r.from), name: baseName(r.from) })), false);
  await followPlaying(back.done);
  changed(done.flatMap((r) => [dirOf(r.from), dirOf(r.to)]));
  return back.failed.length ? { error: failures(back.failed, 'put back').trim() } : {};
}

// brings songs in from elsewhere on the computer, copied or moved as asked.
export async function addMedia(paths, dir, move) {
  const wanted = playableHere(paths);
  const skipped = paths.length - wanted.length;
  const { done, failed } = await place(wanted.map((from) => ({ from, dir })), !move);
  await followPlaying(move ? done : []);
  changed([dir, ...(move ? done.map((r) => dirOf(r.from)) : [])]);
  dbg('library', `${move ? 'moved' : 'copied'} ${done.length} track(s) into "${baseName(dir)}"${skipped ? `, ${skipped} skipped` : ''}`);
  const left = skipped ? ` ${skipped === 1 ? 'One file' : `${skipped} files`} Downstream can't play ${skipped === 1 ? 'was' : 'were'} left where ${skipped === 1 ? 'it was' : 'they were'}.` : '';
  const text = done.length
    ? `${summary('Added', done, baseName(dir))}${left}${failures(failed, 'added')}`
    : `Nothing was added.${left}${failures(failed, 'added')}`;
  const undo = !done.length ? null : move
    ? () => putBack(done)
    : async () => {
      await window.electronAPI.discardCopies(done.map((r) => r.to));
      changed([dir]);
      await followPlaying();
      return {};
    };
  return { text, ok: done.length > 0, added: done, undo };
}

// sends songs to recently deleted, where they wait 30 days.
// the playing song moves on first, so it isn't held open while it goes.
export async function deleteMedia(paths) {
  const s = app();
  if (s.musicCurrent && paths.includes(s.musicCurrent.path)) {
    const next = nextAfter(s, paths);
    if (next) s.setMusicCurrent(next);
    else s.clearMusic();
  }
  const results = await window.electronAPI.deleteMedia(paths);
  const done = results.filter((r) => r.id);
  const failed = results.filter((r) => r.error).map((r) => ({ from: r.file, error: r.error }));
  await followPlaying();
  await loadDeleted();
  changed(paths.map(dirOf));
  dbg('library', `deleted ${done.length} track(s) into recently deleted`);
  const text = done.length
    ? `Deleted ${done.length === 1 ? `"${mediaName(done[0].file)}"` : trackCount(done.length)}.${failures(failed, 'deleted')}`
    : `Nothing was deleted.${failures(failed, 'deleted')}`;
  return {
    text,
    ok: done.length > 0,
    undo: done.length ? () => restoreMedia(done.map((r) => r.id)) : null,
  };
}

// brings songs back from recently deleted to where they were.
export async function restoreMedia(ids) {
  const errors = [];
  const back = [];
  for (const id of ids) {
    const res = await window.electronAPI.restoreDeleted(id);
    if (res.error) errors.push(res.error);
    else back.push({ from: res.note.from, to: res.path });
  }
  if (back.length) moveLoudnessFiles(back);
  await followPlaying();
  await loadDeleted();
  changed(back.map((r) => dirOf(r.to)));
  return errors.length ? { error: errors[0] } : { paths: back.map((r) => r.to) };
}

// songs across every folder in the library whose names hold the search.
export async function searchMedia(query) {
  const s = app();
  return window.electronAPI.searchMedia(s.library.folders.map((f) => f.path), query, getAcceptedExtensions(s));
}

export const pickMediaFiles = () => window.electronAPI.pickMediaFiles(getAcceptedExtensions(app()));
