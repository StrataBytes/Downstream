import useAppStore from '../stores/useAppStore';
import { dbg } from './debugLog';
import { toMediaUrl } from '../utils/mediaUrl';
import { canonicalVideoUrl } from '../utils/linkCheck';

const RATE_LIMIT = {
  API_CALL_DELAY: 1500,
  DOWNLOAD_DELAY: 3000,
  BATCH_PAUSE: 5000,
  BATCH_SIZE: 5,
};

let downloadCount = 0;

function restoreAlbumBackground() {
  const { behaviorAlbumBackground, musicCurrent, setBackgroundThumbnail, setBackgroundVideo, clearBackgroundThumbnail } = useAppStore.getState();
  if (behaviorAlbumBackground && musicCurrent) {
    if (/\.mp4$/i.test(musicCurrent.path)) {
      setBackgroundVideo(toMediaUrl(musicCurrent.path));
      return;
    }
    window.electronAPI.getAlbumArt(musicCurrent.path).then((dataUrl) => {
      if (dataUrl) setBackgroundThumbnail(dataUrl);
      else clearBackgroundThumbnail();
    });
  } else {
    clearBackgroundThumbnail();
  }
}

async function downloadRateLimitDelay() {
  downloadCount++;
  if (downloadCount > 0 && downloadCount % RATE_LIMIT.BATCH_SIZE === 0) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT.BATCH_PAUSE));
  } else {
    await new Promise((r) => setTimeout(r, RATE_LIMIT.DOWNLOAD_DELAY));
  }
}

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
      if (!isQueued(url)) continue; // removed while waiting, skip the fetch
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
      if (metaQueue.length > 0) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT.API_CALL_DELAY));
      }
    }
  } finally {
    metaPumping = false;
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

export async function downloadAll() {
  const state = useAppStore.getState();
  const queue = [...state.queue];

  if (queue.length === 0) return;
  dbg('download', `starting batch of ${queue.length}`);

  state.setIsDownloading(true);
  state.setDownloadCancelled(false);
  state.setTotalProgress({
    visible: true,
    completed: 0,
    total: queue.length,
    text: 'Downloading...',
  });

  downloadCount = 0;
  let completedVideos = 0;

  for (let i = 0; i < queue.length; i++) {
    if (useAppStore.getState().downloadCancelled) {
      useAppStore.getState().setTotalProgress({ text: 'Cancelled' });
      break;
    }

    const item = queue[i];
    useAppStore.getState().updateQueueItem(item.url, { status: 'Working...' });

    const latestItem = useAppStore.getState().queue.find((q) => q.url === item.url) || item;
    useAppStore.getState().setNowPlaying({
      title: latestItem.title,
      thumbnail: latestItem.thumbnail,
      uploader: latestItem.uploader,
      uploadDate: latestItem.uploadDate,
    });

    if (latestItem.thumbnail) {
      useAppStore.getState().setBackgroundThumbnail(latestItem.thumbnail);
    }

    await downloadRateLimitDelay();

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
      });

      if (result && !result.success) {
        dbg('download', '!', `"${latestItem.title}" failed: ${result.error || 'unknown'}`);
        useAppStore.getState().updateQueueItem(item.url, { status: 'Error' });
      } else {
        dbg('download', `"${latestItem.title}" done`);
      }
    } catch (err) {
      dbg('download', '!', `"${latestItem.title}" threw: ${err.message}`);
      useAppStore.getState().updateQueueItem(item.url, { status: 'Error' });
    }

    completedVideos++;
    useAppStore.getState().setTotalProgress({
      completed: completedVideos,
      total: queue.length,
      text: i === queue.length - 1 ? 'Complete!' : 'Downloading...',
    });

    if (i === queue.length - 1 && !useAppStore.getState().downloadCancelled) {
      await new Promise((r) => setTimeout(r, 5000));
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
    }
  }

  if (useAppStore.getState().downloadCancelled) {
    useAppStore.getState().clearNowPlaying();
    restoreAlbumBackground();
    setTimeout(() => {
      useAppStore.getState().setTotalProgress({
        visible: false,
        text: 'Ready',
        completed: 0,
        total: 0,
      });
    }, 2000);
  }

  useAppStore.getState().setIsDownloading(false);
}
