import { create } from 'zustand';

function fisherYatesShuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const useAppStore = create((set) => ({
  currentView: 'home',
  setCurrentView: (view) => set({ currentView: view }),

  queue: [],
  queueOpen: false,
  setQueueOpen: (val) => set({ queueOpen: val }),
  addToQueue: (item) =>
    set((state) => ({
      queue: [...state.queue, { ...item, status: 'Queued', progress: 0 }],
      queueOpen: true,
    })),
  updateQueueItem: (url, updates) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.url === url ? { ...item, ...updates } : item
      ),
    })),
  setQueueItemFormat: (url, format) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.url === url ? { ...item, format } : item
      ),
    })),
  setAllQueueFormat: (format) =>
    set((state) => ({
      queue: state.queue.map((item) => ({ ...item, format })),
    })),
  removeFromQueue: (url) =>
    set((state) => ({
      queue: state.queue.filter((item) => item.url !== url),
    })),
  fadeOutToHistory: (url) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.url === url ? { ...item, fadingOut: true } : item
      ),
    })),
  moveToHistory: (url) =>
    set((state) => {
      const item = state.queue.find((q) => q.url === url);
      return {
        queue: state.queue.filter((q) => q.url !== url),
        queueHistory: item
          ? [...state.queueHistory, { ...item, fadingOut: false }]
          : state.queueHistory,
      };
    }),

  queueHistory: [],
  showHistory: false,
  setShowHistory: (val) => set({ showHistory: val }),

  clearAndCloseQueue: () =>
    set({ queue: [], queueHistory: [], queueOpen: false, showHistory: false }),

  isDownloading: false,
  setIsDownloading: (val) => set({ isDownloading: val }),
  downloadCancelled: false,
  setDownloadCancelled: (val) => set({ downloadCancelled: val }),

  isQueueing: false,
  setIsQueueing: (val) => set({ isQueueing: val }),
  queueingCancelled: false,
  setQueueingCancelled: (val) => set({ queueingCancelled: val }),

  nowPlaying: null,
  setNowPlaying: (info) => set({ nowPlaying: info }),
  clearNowPlaying: () => set({ nowPlaying: null }),

  totalProgress: { completed: 0, total: 0, text: 'Ready', visible: false },
  setTotalProgress: (progress) =>
    set((state) => ({
      totalProgress: { ...state.totalProgress, ...progress },
    })),

  playlistModal: { open: false, info: null, quality: '', format: '' },
  openPlaylistModal: (info, quality, format) =>
    set({ playlistModal: { open: true, info, quality, format } }),
  closePlaylistModal: () =>
    set({ playlistModal: { open: false, info: null, quality: '', format: '' } }),

  cancelModal: { open: false, remainingCount: 0 },
  openCancelModal: (remainingCount) =>
    set({ cancelModal: { open: true, remainingCount } }),
  closeCancelModal: () =>
    set({ cancelModal: { open: false, remainingCount: 0 } }),

  backgroundThumbnail: null,
  setBackgroundThumbnail: (url) => set({ backgroundThumbnail: url }),
  clearBackgroundThumbnail: () => set({ backgroundThumbnail: null }),

  isLoading: false,
  loadingText: 'Loading...',
  setLoading: (isLoading, text) =>
    set({ isLoading, loadingText: text || 'Loading...' }),

  musicFolder: null,
  musicFiles: [],
  musicCurrent: null,
  musicPlaying: false,
  musicLibraryOpen: false,
  musicRepeat: false,
  musicShuffle: false,
  musicShuffledQueue: [],
  musicShuffledIndex: 0,
  musicAnalyser: null,
  musicAudioRef: null,
  musicVolume: 0.25,
  musicNormalize: false,
  toggleMusicNormalize: () => set((s) => ({ musicNormalize: !s.musicNormalize })),
  musicFolderView: false,
  setMusicFolderView: (val) => set({ musicFolderView: val }),
  savedFolders: JSON.parse(localStorage.getItem('savedMusicFolders') || '[]'),
  addSavedFolder: (folder) =>
    set((s) => {
      if (s.savedFolders.includes(folder)) return s;
      const updated = [...s.savedFolders, folder];
      localStorage.setItem('savedMusicFolders', JSON.stringify(updated));
      return { savedFolders: updated };
    }),
  removeSavedFolder: (folder) =>
    set((s) => {
      const updated = s.savedFolders.filter((f) => f !== folder);
      localStorage.setItem('savedMusicFolders', JSON.stringify(updated));
      return { savedFolders: updated };
    }),
  setMusicFolder: (folder) => set({ musicFolder: folder }),
  setMusicFiles: (files) =>
    set((s) => {
      const updates = { musicFiles: files };
      if (s.musicShuffle) {
        updates.musicShuffledQueue = fisherYatesShuffle(files);
        updates.musicShuffledIndex = 0;
      }
      return updates;
    }),
  setMusicCurrent: (track) =>
    set((s) => {
      const updates = { musicCurrent: track };
      if (s.musicShuffle && s.musicShuffledQueue.length > 0 && track) {
        const idx = s.musicShuffledQueue.findIndex((f) => f.path === track.path);
        if (idx !== -1) updates.musicShuffledIndex = idx;
      }
      return updates;
    }),
  setMusicPlaying: (val) => set({ musicPlaying: val }),
  setMusicLibraryOpen: (val) => set({ musicLibraryOpen: val }),
  toggleMusicRepeat: () => set((s) => ({ musicRepeat: !s.musicRepeat })),
  toggleMusicShuffle: () =>
    set((s) => {
      const newShuffle = !s.musicShuffle;
      if (!newShuffle) {
        return { musicShuffle: false, musicShuffledQueue: [], musicShuffledIndex: 0 };
      }
      const current = s.musicCurrent;
      const others = s.musicFiles.filter((f) => f.path !== current?.path);
      const shuffled = current
        ? [current, ...fisherYatesShuffle(others)]
        : fisherYatesShuffle(s.musicFiles);
      return {
        musicShuffle: true,
        musicShuffledQueue: shuffled,
        musicShuffledIndex: 0,
      };
    }),
  playNextTrack: () =>
    set((s) => {
      if (s.musicFiles.length === 0 || !s.musicCurrent) return s;
      if (s.musicShuffle) {
        const nextIndex = s.musicShuffledIndex + 1;
        if (nextIndex >= s.musicShuffledQueue.length) {
          const newQueue = fisherYatesShuffle(s.musicFiles);
          return { musicShuffledQueue: newQueue, musicShuffledIndex: 0, musicCurrent: newQueue[0] || null };
        }
        return { musicShuffledIndex: nextIndex, musicCurrent: s.musicShuffledQueue[nextIndex] };
      }
      const idx = s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path);
      return { musicCurrent: s.musicFiles[(idx + 1) % s.musicFiles.length] };
    }),
  playPrevTrack: () =>
    set((s) => {
      if (s.musicFiles.length === 0 || !s.musicCurrent) return s;
      if (s.musicShuffle) {
        const prevIndex = s.musicShuffledIndex - 1;
        if (prevIndex < 0) {
          const lastIndex = s.musicShuffledQueue.length - 1;
          return lastIndex >= 0
            ? { musicShuffledIndex: lastIndex, musicCurrent: s.musicShuffledQueue[lastIndex] }
            : s;
        }
        return { musicShuffledIndex: prevIndex, musicCurrent: s.musicShuffledQueue[prevIndex] };
      }
      const idx = s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path);
      return { musicCurrent: s.musicFiles[(idx - 1 + s.musicFiles.length) % s.musicFiles.length] };
    }),
  setMusicAnalyser: (node) => set({ musicAnalyser: node }),
  setMusicAudioRef: (ref) => set({ musicAudioRef: ref }),
  setMusicVolume: (val) => set({ musicVolume: val }),

  eqOpen: false,
  setEqOpen: (val) => set({ eqOpen: val }),
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  setEqBand: (index, gain) =>
    set((s) => {
      const bands = [...s.eqBands];
      bands[index] = gain;
      return { eqBands: bands };
    }),
  resetEq: () => set({ eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
}));

export default useAppStore;
