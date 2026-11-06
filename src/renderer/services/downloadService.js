import useAppStore, { queueItemWaiting } from '../stores/useAppStore';
import { dbg } from './debugLog';
import { toMediaUrl } from '../utils/mediaUrl';
import { canonicalVideoUrl, validateMediaLink } from '../utils/linkCheck';

const RATE_LIMIT = {
  API_CALL_DELAY: 1500,
  DOWNLOAD_DELAY: 3000,
  BATCH_PAUSE: 5000,
  BATCH_SIZE: 5,
  FAST_DOWNLOAD_DELAY: 1000,
};

// batches this big get longer, uneven gaps and regular rests, since hundreds of downloads in a row trip youtube's limits.
// the biggest use the 10 to 20 second gaps yt-dlp itself suggests.
export const LARGE_BATCH = 100;
const PACING_TIERS = [
  { from: 300, gap: [10000, 20000], restEvery: 50, rest: 120000 },
  { from: LARGE_BATCH, gap: [5000, 10000], restEvery: 50, rest: 60000 },
];
// a download youtube turned away waits longer each time before it's tried again.
const COOLDOWNS = [60000, 120000, 240000];
// waits at least this long show a countdown on the item.
const SHOWN_WAIT = 5000;

// the downloader shows the current download's thumbnail, and every other screen keeps its own background.
export function downloadOwnsBackground() {
  const { currentView, nowPlaying } = useAppStore.getState();
  return currentView === 'download' && !!nowPlaying?.thumbnail;
}

function showDownloadThumbnail(thumbnail) {
  if (useAppStore.getState().currentView === 'download') useAppStore.getState().setBackgroundThumbnail(thumbnail);
}

function restoreAlbumBackground() {
  const { behaviorAlbumBackground, musicCurrent, setBackgroundThumbnail, setBackgroundVideo, clearBackgroundThumbnail } = useAppStore.getState();
  if (behaviorAlbumBackground && musicCurrent) {
    if (/\.mp4$/i.test(musicCurrent.path)) {
      setBackgroundVideo(toMediaUrl(musicCurrent.path));
      return;
    }
    window.electronAPI.getAlbumArt(musicCurrent.path).then((dataUrl) => {
      // a download thumbnail that landed in the meantime wins.
      if (downloadOwnsBackground()) return;
      if (dataUrl) setBackgroundThumbnail(dataUrl);
      else clearBackgroundThumbnail();
    });
  } else {
    clearBackgroundThumbnail();
  }
}

// the wait before the next download, after `started` downloads of `total` have begun.
function nextWait(started, total) {
  const tier = PACING_TIERS.find((t) => total >= t.from);
  if (tier) {
    if (started % tier.restEvery === 0) return { ms: tier.rest, rest: true };
    const [min, max] = tier.gap;
    return { ms: min + Math.random() * (max - min) };
  }
  if (useAppStore.getState().fastDownloadPacing) return { ms: RATE_LIMIT.FAST_DOWNLOAD_DELAY };
  return { ms: started % RATE_LIMIT.BATCH_SIZE === 0 ? RATE_LIMIT.BATCH_PAUSE : RATE_LIMIT.DOWNLOAD_DELAY };
}

function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// waits before a download, counting down on the item when a label is given.
// cancelling the batch ends the wait right away.
async function waitBeforeDownload(url, ms, label) {
  const until = Date.now() + ms;
  let shown = null;
  while (Date.now() < until) {
    if (useAppStore.getState().downloadCancelled) return;
    if (label) {
      const text = label(formatWait(until - Date.now()));
      if (text !== shown) {
        shown = text;
        useAppStore.getState().updateQueueItem(url, { status: text });
      }
    }
    await new Promise((r) => setTimeout(r, Math.min(100, until - Date.now())));
  }
}

const startingLabel = (t) => `Starting in ${t}`;
const restLabel = (t) => `Resting ${t} so YouTube doesn't block downloads`;
const cooldownLabel = (t) => `YouTube is limiting downloads, retrying in ${t}`;

function formatUploadDate(raw) {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${m}/${d}/${y}`;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString();
}

function isQueued(url) {
  return useAppStore.getState().queue.some((q) => q.url === url);
}

// still in the queue or already downloaded, rather than removed.
function isTracked(url) {
  const { queue, queueHistory } = useAppStore.getState();
  return queue.some((q) => q.url === url) || queueHistory.some((q) => q.url === url);
}

// the item's title as it is now, since it can arrive while the item downloads.
function titleOf(url) {
  const { queue, queueHistory } = useAppStore.getState();
  return (queue.find((q) => q.url === url) || queueHistory.find((q) => q.url === url))?.title || url;
}

function nowPlayingFrom(item) {
  return {
    url: item.url,
    title: item.title,
    thumbnail: item.thumbnail,
    uploader: item.uploader,
    uploadDate: item.uploadDate,
    titleLoaded: item.titleLoaded,
  };
}

// updates the main widget and background when the current download's metadata lands.
function refreshNowPlaying(url) {
  const { nowPlaying, queue, queueHistory, setNowPlaying } = useAppStore.getState();
  if (nowPlaying?.url !== url) return;
  const item = queue.find((q) => q.url === url) || queueHistory.find((q) => q.url === url);
  if (!item) return;
  setNowPlaying(nowPlayingFrom(item));
  if (item.thumbnail) showDownloadThumbnail(item.thumbnail);
}

// leaving the downloader mid-download hands the background back, and coming back takes it again.
let shownView = useAppStore.getState().currentView;
useAppStore.subscribe((s) => {
  if (s.currentView === shownView) return;
  const left = shownView === 'download';
  shownView = s.currentView;
  if (!s.nowPlaying) return;
  if (s.currentView === 'download' && s.nowPlaying.thumbnail) s.setBackgroundThumbnail(s.nowPlaying.thumbnail);
  else if (left) restoreAlbumBackground();
});

// background metadata fetcher.
// only pasted links need this, since search results and playlist entries arrive with metadata already attached.
// items are queued and downloadable the instant they're added, this pump just fills in titles/thumbnails as it goes, serially, with a courtesy delay between yt-dlp spawns so a paste spree never hammers the platform. nothing ever waits on it.
const metaQueue = [];
let metaPumping = false;

async function pumpMetadata() {
  if (metaPumping) return;
  metaPumping = true;
  try {
    while (metaQueue.length > 0) {
      const url = metaQueue.shift();
      // skips links removed before their fetch started.
      if (!isTracked(url)) continue;
      try {
        const info = await window.electronAPI.getVideoInfo(url);
        // updateQueueItem no-ops if the row was removed mid-fetch.
        useAppStore.getState().updateQueueItem(url, {
          title: info?.title || url,
          thumbnail: info?.thumbnail || null,
          uploader: info?.uploader,
          uploadDate: formatUploadDate(info?.uploadDate),
          duration: info?.duration,
          titleLoaded: true,
          ...(info?.live && LIVE_ITEM),
        });
        dbg('queue', `resolved "${info?.title || url}"`);
      } catch {
        // display falls back to the url, the item downloads fine regardless since yt-dlp resolves the real title itself at download time.
        useAppStore.getState().updateQueueItem(url, { title: url, titleLoaded: true });
        dbg('queue', '!', `metadata fetch failed for ${url} -- item still downloadable`);
      }
      refreshNowPlaying(url);
      if (metaQueue.length > 0) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT.API_CALL_DELAY));
      }
    }
  } finally {
    metaPumping = false;
  }
}

// moves a link's pending fetch to the front.
function prioritizeMetadata(url) {
  const i = metaQueue.indexOf(url);
  if (i > 0) {
    metaQueue.splice(i, 1);
    metaQueue.unshift(url);
  }
}

// a live stream would record until stopped, so it stays in the queue only to say why it won't download.
const LIVE_ITEM = { live: true, failed: true, status: "Live streams can't be downloaded" };

// pasted link: queues instantly with a placeholder title, resolves in the background, never blocks or locks the ui.
// the url is canonicalized first so share-link variants of the same video dedupe to one entry.
export function addLinkToQueue(rawUrl, quality, format) {
  const url = canonicalVideoUrl(rawUrl);
  if (isQueued(url)) return;
  useAppStore.getState().addToQueue({
    url, title: 'Fetching title…', quality, format, titleLoaded: false,
  });
  dbg('queue', `add (link) ${url} (${format}/${quality})`);
  if (!metaQueue.includes(url)) metaQueue.push(url);
  pumpMetadata();
}

let playlistJob = null;
let playlistJobs = 0;
let playlistListening = false;

// lists a playlist's videos while the loading screen shows how far along it is.
// a title already known from search shows until youtube sends its own.
export async function loadPlaylist(url, title = null) {
  if (!playlistListening) {
    playlistListening = true;
    window.electronAPI.onPlaylistProgress(({ id, ...progress }) => {
      const { playlistLoading, setPlaylistLoading } = useAppStore.getState();
      if (id === playlistJob) setPlaylistLoading({ ...progress, title: progress.title || playlistLoading?.title || null });
    });
  }
  const id = `playlist-${++playlistJobs}`;
  playlistJob = id;
  useAppStore.getState().setPlaylistLoading({ title, found: 0, total: null, endless: false });
  dbg('playlist', `loading ${url}`);
  try {
    const info = await window.electronAPI.playlistStart({ id, url });
    if (info?.videos) dbg('playlist', `"${info.title}": ${info.videos.length} video(s)${info.truncated ? ', cut short' : ''}`);
    return info;
  } finally {
    if (playlistJob === id) {
      playlistJob = null;
      useAppStore.getState().setPlaylistLoading(null);
    }
  }
}

export function cancelPlaylistLoad() {
  if (!playlistJob) return;
  dbg('playlist', 'cancelled from the loading screen');
  window.electronAPI.playlistCancel(playlistJob).catch(() => {});
}

// playlists open one at a time, each waiting for the picker before it to close.
let playlistLine = Promise.resolve();
// cancelling a loading playlist also drops the ones lined up behind it.
let playlistRound = 0;

function pickerClosed() {
  return new Promise((resolve) => {
    if (!useAppStore.getState().playlistModal.open) {
      resolve();
      return;
    }
    const unsubscribe = useAppStore.subscribe((s) => {
      if (!s.playlistModal.open) {
        unsubscribe();
        resolve();
      }
    });
  });
}

// opens the picker, or queues a playlist of one video straight away.
async function showPlaylist(url, quality, format, title) {
  let info;
  try {
    info = await loadPlaylist(url, title);
  } catch (err) {
    return { failed: err.message };
  }
  if (info?.cancelled) return { cancelled: true };
  if (info?.error) return { error: info.message };
  if (!info) return { single: true };
  if (info.videos.length === 0) return { error: 'This playlist has no videos that can be downloaded.' };
  if (info.videos.length === 1) addPlaylistToQueue(info.videos, quality, format);
  else useAppStore.getState().openPlaylistModal(info, quality, format);
  return {};
}

// lines a playlist up behind the ones already loading or being picked from.
// resolves once it has loaded, with { cancelled }, { error }, { failed }, or { single } when the link isn't a playlist after all.
export function openPlaylist(url, quality, format, title) {
  const round = playlistRound;
  const app = useAppStore.getState;
  const turn = () => app().playlistTurn;
  app().setPlaylistTurn({ ...turn(), of: turn().of + 1 });
  let settle;
  const outcome = new Promise((resolve) => { settle = resolve; });
  playlistLine = playlistLine.then(async () => {
    app().setPlaylistTurn({ ...turn(), at: turn().at + 1 });
    if (round !== playlistRound) {
      settle({ cancelled: true });
      return;
    }
    const result = await showPlaylist(url, quality, format, title);
    if (result.cancelled) playlistRound++;
    settle(result);
    await pickerClosed();
  }).catch((err) => settle({ failed: err.message })).finally(() => {
    // the count starts over once the line is empty.
    if (turn().at === turn().of) app().setPlaylistTurn({ at: 0, of: 0 });
  });
  return outcome;
}

// a typed or pasted link, where playlist links open the picker.
// returns { error } when the link can't be used, or { cancelled } when its playlist stopped loading.
export async function submitLink(text, quality, format) {
  // links: validates before anything touches the network, so a rejected typo costs zero requests.
  const check = validateMediaLink(text);
  if (!check.ok) {
    dbg('link', '!', `rejected "${text}": ${check.reason}`);
    return { error: check.reason };
  }

  // playlist detection is a local url-param check, only actual playlists need the enumeration call (which the modal requires anyway).
  // plain video links queue instantly with zero upfront fetches.
  let isPlaylistLink = false;
  try {
    const parsed = new URL(check.url);
    isPlaylistLink = parsed.searchParams.has('list') || parsed.searchParams.has('start_radio');
  } catch { /* validator already vetted it */ }

  if (!isPlaylistLink) {
    dbg('link', `add ${check.url}`);
    addLinkToQueue(check.url, quality, format);
    return null;
  }

  const outcome = await openPlaylist(check.url, quality, format);
  if (outcome.cancelled) return { cancelled: true };
  if (outcome.error) {
    // yt-dlp itself failed (e.g. missing/blocked binary), don't queue the playlist link as a fake "single video", tell the user instead.
    dbg('link', '!', `playlist enumeration failed: ${outcome.error}`);
    return { error: outcome.error };
  }
  if (outcome.failed) {
    dbg('link', '!', `playlist check failed: ${outcome.failed}, adding as single`);
    addLinkToQueue(check.url, quality, format);
  } else if (outcome.single) {
    dbg('link', 'not a playlist, adding as single');
    addLinkToQueue(check.url, quality, format);
  }
  return null;
}

// search result: all display metadata is already in hand, zero fetches.
export function addResolvedToQueue(result, quality, format) {
  const url = canonicalVideoUrl(result.url);
  if (isQueued(url)) return;
  useAppStore.getState().addToQueue({
    url,
    title: result.title || result.url,
    thumbnail: result.thumbnail || null,
    uploader: result.channel || result.uploader,
    uploadDate: formatUploadDate(result.uploadDate),
    duration: result.duration,
    titleLoaded: true,
    quality,
    format,
  });
  dbg('queue', `add (search) "${result.title}"`);
}

// playlist selection: one batched store update with the titles the flat playlist already gave us, so a 50-video add is instant and costs zero additional platform requests.
// thumbnails come from youtube's static image cdn, same pattern search results already use.
export function addPlaylistToQueue(videos, quality, format) {
  const items = videos.map((v) => ({
    url: canonicalVideoUrl(v.url),
    title: v.title || v.url,
    thumbnail: v.id ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null,
    uploader: v.uploader,
    duration: v.duration,
    titleLoaded: true,
    quality,
    format,
  }));
  useAppStore.getState().addManyToQueue(items);
  dbg('queue', `added ${items.length} playlist item(s) instantly`);
}

// one remaining item stops right away, more than one asks first.
export function requestCancelDownloads() {
  const state = useAppStore.getState();
  if (!state.isDownloading) return;
  const remaining = state.queue.filter(queueItemWaiting).length;
  if (remaining <= 1) {
    state.setDownloadCancelled(true);
    window.electronAPI.cancelDownload().catch(() => {});
  } else {
    state.openCancelModal(remaining);
  }
}

// a folder picked from anywhere on the computer, or null when the dialog was cancelled.
export function chooseDownloadFolder() {
  return window.electronAPI.selectDownloadFolder();
}

// download all asks where to save first.
// with that turned off, downloads go straight to the downloads folder.
export function requestDownloadAll() {
  const state = useAppStore.getState();
  if (state.isDownloading || state.queue.length === 0) return;
  if (state.askWhereToSave) {
    state.setSavePickerOpen(true);
    return;
  }
  state.setDownloadFolder(null);
  downloadAll();
}

// cleanup left for after a batch, skipped when another batch has started by then.
function whenIdle(ms, fn) {
  setTimeout(() => {
    if (!useAppStore.getState().isDownloading) fn();
  }, ms);
}

// the batch's summary fades for a moment before it goes, so the download pill fades with it.
const SUMMARY_FADE = 300;

function hideTotalProgress(after) {
  whenIdle(after - SUMMARY_FADE, () => {
    useAppStore.getState().setTotalProgress({ leaving: true });
    whenIdle(SUMMARY_FADE, () => {
      useAppStore.getState().setTotalProgress({ visible: false, leaving: false, text: 'Ready', completed: 0, total: 0 });
    });
  });
}

export async function downloadAll() {
  const state = useAppStore.getState();
  if (state.queue.length === 0) return;
  dbg('download', `starting batch of ${state.queue.length}${state.queue.length >= LARGE_BATCH ? ', paced for a large batch' : ''}`);

  // items added while the batch runs join it, so nothing is left waiting once it ends.
  // a finished item from the last batch can still be fading out of the queue, and isn't downloaded again.
  const tried = new Set();
  const untried = (q) => !tried.has(q.url) && queueItemWaiting(q);
  const nextItem = () => useAppStore.getState().queue.find(untried);
  const batchSize = () => tried.size + useAppStore.getState().queue.filter(untried).length;

  state.setIsDownloading(true);
  state.setDownloadCancelled(false);
  state.setTotalProgress({
    visible: true,
    leaving: false,
    completed: 0,
    total: batchSize(),
    text: 'Downloading...',
  });

  let completedVideos = 0;
  let cooldowns = 0;
  let retrying = false;
  let stopped = false;

  for (let item = nextItem(); item; item = nextItem()) {
    if (useAppStore.getState().downloadCancelled) {
      useAppStore.getState().setTotalProgress({ text: 'Cancelled' });
      break;
    }

    const total = batchSize();
    const paced = total >= LARGE_BATCH;
    useAppStore.getState().setTotalProgress({ total });
    // an item that failed in an earlier batch starts clean.
    useAppStore.getState().updateQueueItem(item.url, { status: 'Working...', failed: false });

    const latestItem = useAppStore.getState().queue.find((q) => q.url === item.url) || item;
    if (latestItem.thumbnail) {
      showDownloadThumbnail(latestItem.thumbnail);
    } else if (useAppStore.getState().currentView === 'download') {
      // the previous download's thumbnail shouldn't linger while this one's metadata loads.
      restoreAlbumBackground();
    }
    useAppStore.getState().setNowPlaying(nowPlayingFrom(latestItem));
    if (!latestItem.titleLoaded) prioritizeMetadata(item.url);

    // the gap goes between downloads, so the first one starts right away.
    if (tried.size > 0 && !retrying) {
      const wait = nextWait(tried.size, total);
      if (wait.rest) dbg('download', `resting ${formatWait(wait.ms)} after ${tried.size} downloads`);
      const label = wait.rest ? restLabel : wait.ms >= SHOWN_WAIT ? startingLabel : null;
      await waitBeforeDownload(item.url, wait.ms, label);
      if (label) useAppStore.getState().updateQueueItem(item.url, { status: 'Working...' });
    }
    retrying = false;

    if (useAppStore.getState().downloadCancelled) {
      useAppStore.getState().updateQueueItem(item.url, { status: 'Cancelled' });
      break;
    }

    try {
      const result = await window.electronAPI.downloadVideo({
        url: item.url,
        quality: item.quality,
        format: item.format,
        outputDir: useAppStore.getState().downloadFolder || null,
        gentle: paced,
      });

      if (result?.cancelled) {
        dbg('download', `cancelled "${titleOf(item.url)}"`);
        useAppStore.getState().updateQueueItem(item.url, { status: 'Cancelled' });
        break;
      } else if (result?.live) {
        dbg('download', `skipped "${titleOf(item.url)}", it's a live stream`);
        useAppStore.getState().updateQueueItem(item.url, LIVE_ITEM);
      } else if (result?.rateLimited) {
        // the same item is tried again after a pause, until the pauses run out.
        if (cooldowns === COOLDOWNS.length) {
          dbg('download', '!', 'still rate limited after every pause, stopping the batch');
          useAppStore.getState().updateQueueItem(item.url, { status: 'YouTube is limiting downloads, try again later', progress: 0 });
          useAppStore.getState().setTotalProgress({ text: 'Stopped by YouTube' });
          stopped = true;
          break;
        }
        const ms = COOLDOWNS[cooldowns++];
        dbg('download', '!', `rate limited on "${titleOf(item.url)}", trying again in ${formatWait(ms)}`);
        useAppStore.getState().updateQueueItem(item.url, { progress: 0 });
        await waitBeforeDownload(item.url, ms, cooldownLabel);
        if (useAppStore.getState().downloadCancelled) {
          useAppStore.getState().updateQueueItem(item.url, { status: 'Cancelled' });
          break;
        }
        retrying = true;
        continue;
      } else if (result && !result.success) {
        dbg('download', '!', `"${titleOf(item.url)}" failed: ${result.error || 'unknown'}`);
        useAppStore.getState().updateQueueItem(item.url, { status: 'Error' });
      } else {
        cooldowns = 0;
        dbg('download', `"${titleOf(item.url)}" done`);
      }
    } catch (err) {
      dbg('download', '!', `"${titleOf(item.url)}" threw: ${err.message}`);
      useAppStore.getState().updateQueueItem(item.url, { status: 'Error' });
    }

    tried.add(item.url);
    completedVideos++;
    useAppStore.getState().setTotalProgress({ completed: completedVideos, total: batchSize() });
  }

  // only the downloader has a download's thumbnail to hand back.
  const handBack = () => {
    const onDownloader = downloadOwnsBackground();
    useAppStore.getState().clearNowPlaying();
    if (onDownloader) restoreAlbumBackground();
  };
  if (stopped || useAppStore.getState().downloadCancelled) {
    handBack();
    hideTotalProgress(stopped ? 6000 : 2000);
  } else {
    useAppStore.getState().setTotalProgress({ text: 'Complete!' });
    // the last thumbnail lingers a moment, without keeping the queue controls locked.
    whenIdle(5000, () => {
      handBack();
      hideTotalProgress(1000);
    });
  }

  dbg('download', `batch finished: ${completedVideos} of ${batchSize()}${stopped ? ', stopped by rate limiting' : ''}`);
  useAppStore.getState().setIsDownloading(false);
}
