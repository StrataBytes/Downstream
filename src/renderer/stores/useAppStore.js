import { create } from 'zustand';

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
  musicAnalyser: null,
  musicAudioRef: null,
  musicVolume: 0.25,
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
  setMusicFiles: (files) => set({ musicFiles: files }),
  setMusicCurrent: (track) => set({ musicCurrent: track }),
  setMusicPlaying: (val) => set({ musicPlaying: val }),
  setMusicLibraryOpen: (val) => set({ musicLibraryOpen: val }),
  toggleMusicRepeat: () => set((s) => ({ musicRepeat: !s.musicRepeat })),
  toggleMusicShuffle: () => set((s) => ({ musicShuffle: !s.musicShuffle })),
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
