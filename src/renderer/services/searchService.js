import { create } from 'zustand';
import useAppStore from '../stores/useAppStore';
import { addResolvedToQueue, loadPlaylist } from './downloadService';
import { canonicalVideoUrl } from '../utils/linkCheck';
import { dbg } from './debugLog';

export const SEARCH_TABS = [
  { id: 'general', label: 'General' },
  { id: 'music', label: 'Music' },
  { id: 'playlists', label: 'Playlists' },
];

const emptyTab = () => ({ status: 'idle', results: [], offset: 0, more: false, error: null });
const emptyTabs = () => Object.fromEntries(SEARCH_TABS.map((t) => [t.id, emptyTab()]));

// each tab keeps the results of the current query until refreshed.
// the selection is keyed by url, so picks survive tab switches and new searches.
export const useSearchStore = create(() => ({
  open: false,
  query: '',
  tab: 'general',
  tabs: emptyTabs(),
  selected: {},
  notice: null,
}));

const set = useSearchStore.setState;
const get = useSearchStore.getState;

// the request each tab is waiting on, so results from a replaced one are dropped.
const running = {};
const owners = {};
let nextId = 1;
let listening = false;

function patchTab(tab, patch) {
  set((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], ...patch } } }));
}

function normalize(result) {
  return result.kind === 'video' ? { ...result, url: canonicalVideoUrl(result.url) } : result;
}

function listen() {
  if (listening) return;
  listening = true;
  window.electronAPI.onSearchResults(({ id, results }) => {
    const tab = owners[id];
    if (!tab || running[tab] !== id) return;
    set((s) => {
      const current = s.tabs[tab];
      const seen = new Set(current.results.map((r) => r.url));
      const fresh = results.map(normalize).filter((r) => !seen.has(r.url) && seen.add(r.url));
      return { tabs: { ...s.tabs, [tab]: { ...current, results: [...current.results, ...fresh] } } };
    });
  });
}

function cancelTab(tab) {
  const id = running[tab];
  if (!id) return;
  delete running[tab];
  delete owners[id];
  window.electronAPI.searchCancel(id).catch(() => {});
}

async function load(tab, more = false) {
  const { query, tabs } = get();
  const start = more ? tabs[tab].offset : 0;
  cancelTab(tab);
  const id = `search-${nextId++}`;
  running[tab] = id;
  owners[id] = tab;
  patchTab(tab, more ? { status: 'loading-more', error: null } : { ...emptyTab(), status: 'loading' });
  dbg('search', `${tab} "${query}" from ${start}`);

  let res;
  try {
    res = await window.electronAPI.searchStart({ id, query, tab, start });
  } catch (err) {
    res = { error: err.message };
  }
  if (running[tab] !== id) return;
  delete running[tab];
  delete owners[id];

  if (res?.error) {
    dbg('search', '!', `${tab} failed: ${res.error}`);
    patchTab(tab, { status: 'error', error: res.error });
    return;
  }
  dbg('search', `${tab} got ${res?.shown ?? 0} result(s)`);
  patchTab(tab, { status: 'done', offset: start + (res?.raw ?? 0), more: !!res?.more });
}

export function startSearch(text) {
  const query = text.trim();
  if (!query) return;
  listen();
  if (query !== get().query) {
    SEARCH_TABS.forEach((t) => cancelTab(t.id));
    set({ query, tabs: emptyTabs() });
  }
  set({ open: true, notice: null });
  openTab(get().tab);
}

export function openTab(tab) {
  set({ tab });
  if (get().tabs[tab].status === 'idle') load(tab);
}

export function refreshTab() {
  load(get().tab);
}

export function loadMore() {
  load(get().tab, true);
}

export function closeSearch() {
  set({ open: false });
}

export function toggleSelected(result, tab) {
  set((s) => {
    const selected = { ...s.selected };
    if (selected[result.url]) delete selected[result.url];
    else selected[result.url] = { result, tab };
    return { selected };
  });
}

export function clearSelected() {
  set({ selected: {} });
}

function waitForPlaylistModal() {
  return new Promise((resolve) => {
    const unsubscribe = useAppStore.subscribe((s) => {
      if (!s.playlistModal.open) {
        unsubscribe();
        resolve();
      }
    });
  });
}

// opens the playlist picker for each selected playlist, one after another.
// cancelling one while it loads skips the rest too.
async function pickPlaylists(playlists, quality, format) {
  const app = useAppStore.getState;
  for (const playlist of playlists) {
    let info = null;
    try {
      info = await loadPlaylist(playlist.url);
    } catch { /* reported below */ }
    if (info?.cancelled) {
      dbg('search', `stopped opening playlists at "${playlist.title}"`);
      return;
    }
    if (!info?.videos?.length) {
      dbg('search', '!', `couldn't load playlist ${playlist.url}`);
      set({ notice: `Couldn't load "${playlist.title}".` });
      continue;
    }
    app().openPlaylistModal(info, quality, format);
    await waitForPlaylistModal();
  }
}

export async function addSelected() {
  const picks = Object.values(get().selected).map((s) => s.result);
  if (picks.length === 0) return;
  const { downloadQuality: quality, downloadFormat: format } = useAppStore.getState();
  set({ selected: {}, notice: null });

  const videos = picks.filter((r) => r.kind === 'video');
  videos.forEach((r) => addResolvedToQueue(r, quality, format));
  dbg('search', `added ${videos.length} video(s)`);
  await pickPlaylists(picks.filter((r) => r.kind === 'playlist'), quality, format);
}
