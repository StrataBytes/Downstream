import useAppStore from '../stores/useAppStore';

const RATE_LIMIT = {
  API_CALL_DELAY: 1500,
  DOWNLOAD_DELAY: 3000,
  BATCH_PAUSE: 5000,
  BATCH_SIZE: 5,
};

let lastApiCall = 0;
let downloadCount = 0;

async function rateLimitedDelay() {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < RATE_LIMIT.API_CALL_DELAY) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT.API_CALL_DELAY - timeSinceLastCall));
  }
  lastApiCall = Date.now();
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

export async function addVideoToQueue(url, quality, format) {
  const { addToQueue } = useAppStore.getState();
  addToQueue({ url, title: 'Loading...', quality, format, titleLoaded: false });

  await rateLimitedDelay();
  const info = await window.electronAPI.getVideoInfo(url);
  useAppStore.getState().updateQueueItem(url, {
    title: info.title,
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    uploadDate: formatUploadDate(info.uploadDate),
    duration: info.duration,
    titleLoaded: true,
  });
}

export async function downloadAll() {
  const state = useAppStore.getState();
  const queue = [...state.queue];

  if (queue.length === 0) return;

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
      });

      if (result && !result.success) {
        useAppStore.getState().updateQueueItem(item.url, { status: 'Error' });
      }
    } catch (err) {
      console.error(`Download failed for ${item.url}:`, err);
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
      useAppStore.getState().clearBackgroundThumbnail();
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
    useAppStore.getState().clearBackgroundThumbnail();
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
