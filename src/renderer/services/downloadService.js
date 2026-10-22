import useAppStore from '../stores/useAppStore';
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

function restoreAlbumBackground() {
  const { behaviorAlbumBackground, musicCurrent, setBackgroundThumbnail, setBackgroundVideo, clearBackgroundThumbnail } = useAppStore.getState();
  if (behaviorAlbumBackground && musicCurrent) {
    if (/\.mp4$/i.test(musicCurrent.path)) {
      setBackgroundVideo(toMediaUrl(musicCurrent.path));
      return;
    }
    window.electronAPI.getAlbumArt(musicCurrent.path).then((dataUrl) => {
      // a download thumbnail that landed in the meantime wins.
      if (useAppStore.getState().nowPlaying?.thumbnail) return;
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
  const { nowPlaying, queue, queueHistory, setNowPlaying, setBackgroundThumbnail } = useAppStore.getState();
  if (nowPlaying?.url !== url) return;
  const item = queue.find((q) => q.url === url) || queueHistory.find((q) => q.url === url);
  if (!item) return;
  setNowPlaying(nowPlayingFrom(item));
  if (item.thumbnail) setBackgroundThumbnail(item.thumbnail);
}

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
export async function loadPlaylist(url) {
  if (!playlistListening) {
    playlistListening = true;
    window.electronAPI.onPlaylistProgress(({ id, ...progress }) => {
      if (id === playlistJob) useAppStore.getState().setPlaylistLoading(progress);
    });
  }
  const id = `playlist-${++playlistJobs}`;
  playlistJob = id;
  useAppStore.getState().setPlaylistLoading({ title: null, found: 0, total: null, endless: false });
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

  let info;
  try {
    info = await loadPlaylist(check.url);
  } catch (err) {
    dbg('link', '!', `playlist check failed: ${err.message}, adding as single`);
    addLinkToQueue(check.url, quality, format);
    return null;
  }
  if (info?.cancelled) return { cancelled: true };
  if (info?.error) {
    // yt-dlp itself failed (e.g. missing/blocked binary), don't queue the playlist link as a fake "single video", tell the user instead.
    dbg('link', '!', `playlist enumeration failed: ${info.message}`);
    return { error: info.message };
  }
  if (!info) {
    dbg('link', 'not a playlist, adding as single');
    addLinkToQueue(check.url, quality, format);
  } else if (info.videos.length === 0) {
    return { error: 'This playlist has no videos that can be downloaded.' };
  } else if (info.videos.length === 1) {
    addPlaylistToQueue(info.videos, quality, format);
  } else {
    useAppStore.getState().openPlaylistModal(info, quality, format);
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
  const remaining = state.queue.filter(
    (item) => !item.status?.includes('Completed') && !item.status?.includes('Complete')
  ).length;
  if (remaining <= 1) {
    state.setDownloadCancelled(true);
    window.electronAPI.cancelDownload().catch(() => {});
  } else {
    state.openCancelModal(remaining);
  }
}

export async function chooseDownloadFolder() {
  const selected = await window.electronAPI.selectDownloadFolder();
  if (selected) useAppStore.getState().setDownloadFolder(selected);
}

export async function downloadAll() {
  const state = useAppStore.getState();
  const queue = [...state.queue];

  if (queue.length === 0) return;
  const paced = queue.length >= LARGE_BATCH;
  dbg('download', `starting batch of ${queue.length}${paced ? ', paced for a large batch' : ''}`);

  state.setIsDownloading(true);
  state.setDownloadCancelled(false);
  state.setTotalProgress({
    visible: true,
    completed: 0,
    total: queue.length,
    text: 'Downloading...',
  });

  let completedVideos = 0;
  let cooldowns = 0;
  let retrying = false;
  let stopped = false;

  for (let i = 0; i < queue.length; i++) {
    if (useAppStore.getState().downloadCancelled) {
      useAppStore.getState().setTotalProgress({ text: 'Cancelled' });
      break;
    }

    const item = queue[i];
    useAppStore.getState().updateQueueItem(item.url, { status: 'Working...' });

    const latestItem = useAppStore.getState().queue.find((q) => q.url === item.url) || item;
    if (latestItem.thumbnail) {
      useAppStore.getState().setBackgroundThumbnail(latestItem.thumbnail);
    } else {
      // the previous download's thumbnail shouldn't linger while this one's metadata loads.
      restoreAlbumBackground();
    }
    useAppStore.getState().setNowPlaying(nowPlayingFrom(latestItem));
    if (!latestItem.titleLoaded) prioritizeMetadata(item.url);

    // the gap goes between downloads, so the first one starts right away.
    if (i > 0 && !retrying) {
      const wait = nextWait(i, queue.length);
      if (wait.rest) dbg('download', `resting ${formatWait(wait.ms)} after ${i} downloads`);
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
        i--;
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

    completedVideos++;
    useAppStore.getState().setTotalProgress({
      completed: completedVideos,
      total: queue.length,
      text: i === queue.length - 1 ? 'Complete!' : 'Downloading...',
    });

    if (i === queue.length - 1 && !useAppStore.getState().downloadCancelled) {
      // The thumbnail background deliberately lingers after the last download, but
      // it must not keep the queue controls locked. Schedule that visual handoff
      // independently so isDownloading can reset immediately below.
      setTimeout(() => {
        useAppStore.getState().clearNowPlaying();
        restoreAlbumBackground();
        setTimeout(() => {
          useAppStore.getState().setTotalProgress({
            visible: false,
            text: 'Ready',
            completed: 0,
            total: 0,
          });
        }, 1000);
      }, 5000);
    }
  }

  if (stopped || useAppStore.getState().downloadCancelled) {
    useAppStore.getState().clearNowPlaying();
    restoreAlbumBackground();
    setTimeout(() => {
      useAppStore.getState().setTotalProgress({
        visible: false,
        text: 'Ready',
        completed: 0,
        total: 0,
      });
    }, stopped ? 6000 : 2000);
  }

  dbg('download', `batch finished: ${completedVideos} of ${queue.length}${stopped ? ', stopped by rate limiting' : ''}`);
  useAppStore.getState().setIsDownloading(false);
}
