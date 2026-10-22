import { create } from 'zustand';

function fisherYatesShuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const EMPTY_LIBRARY = { folders: [], mixtapes: [], collapsed: {}, sort: 'custom', lastSource: null };

// mixtapes started out as collections, which each folder belonged to one of.
function fromCollections(saved) {
  const mixtapes = (saved.collections || []).map((c) => ({
    id: c.id,
    name: c.name,
    folders: saved.folders.filter((f) => f.collection === c.id).map((f) => f.path),
  }));
  const folders = saved.folders.map(({ path, color, pinned, lastPlayed }) => ({ path, color, pinned, lastPlayed }));
  const lastSource = saved.lastSource?.replace(/^collection:/, 'mixtape:') || null;
  const { collections, ...rest } = saved;
  return { ...rest, folders, mixtapes, lastSource };
}

// saved music folders and mixtapes.
// older versions kept a plain list of folder paths, which becomes the starting library.
function loadLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem('musicLibrary'));
    if (Array.isArray(saved?.folders)) return { ...EMPTY_LIBRARY, ...(saved.mixtapes ? saved : fromCollections(saved)) };
  } catch { /* rebuilt below */ }
  const paths = JSON.parse(localStorage.getItem('savedMusicFolders') || '[]');
  return { ...EMPTY_LIBRARY, folders: paths.map((path) => ({ path })) };
}

// lite turns off only the blur, which is what slows downstream down, and the other effects cost little without it.
const LITE_DEFAULTS = { liteDisableBlur: true, liteDisableAnimations: false, liteDisableVisualizer: false, liteDisableVideoBackground: false };

function saveLiteDefaults() {
  Object.entries(LITE_DEFAULTS).forEach(([key, val]) => localStorage.setItem(key, String(val)));
}

// lite used to turn off every effect.
// anyone already in it is moved to the blur-only lite once, after which their own choices stick.
if (localStorage.getItem('renderProfile') === 'lite' && !localStorage.getItem('liteBlurOnlyApplied')) saveLiteDefaults();
localStorage.setItem('liteBlurOnlyApplied', 'true');

const useAppStore = create((set) => ({
  // where navigation is headed.
  // currentView and folderScreen are what's on screen, and only change once the old screen has faded out.
  nextView: 'home',
  goToView: (view) => set({ nextView: view }),
  currentView: 'home',
  folderScreen: false,
  showScreen: (screen) => set({ currentView: screen === 'folders' ? 'player' : screen, folderScreen: screen === 'folders' }),

  // what the startup sequence is doing, null once the home screen is showing.
  startupStep: 'Starting up',
  setStartupStep: (step) => set({ startupStep: step }),

  homeIdleMode: false,
  setHomeIdleMode: (val) => set({ homeIdleMode: val }),

  versionInfo: null,
  setVersionInfo: (info) => set({ versionInfo: info }),
  checkUpdatesOnStart: localStorage.getItem('checkUpdatesOnStart') !== 'false',
  setCheckUpdatesOnStart: (val) => {
    localStorage.setItem('checkUpdatesOnStart', String(val));
    return set({ checkUpdatesOnStart: val });
  },
  ffmpegReady: null,
  setFfmpegReady: (val) => set({ ffmpegReady: val }),
  ytDlpReady: null,
  setYtDlpReady: (val) => set({ ytDlpReady: val }),
  networkConnected: null,
  setNetworkConnected: (val) => set({ networkConnected: val }),

  queue: [],
  queueOpen: false,
  setQueueOpen: (val) => set({ queueOpen: val }),
  addToQueue: (item) =>
    set((state) => state.queue.some((q) => q.url === item.url)
      ? {} // already queued, deduped here since instant adds make double-clicks easy
      : {
          queue: [...state.queue, { ...item, status: 'Queued', progress: 0 }],
          queueOpen: true,
        }),
  // batch insert (playlists), one store update for n items, deduped against the queue and within the batch itself.
  addManyToQueue: (items) =>
    set((state) => {
      const seen = new Set(state.queue.map((q) => q.url));
      const fresh = [];
      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        fresh.push({ ...item, status: 'Queued', progress: 0 });
      }
      return fresh.length
        ? { queue: [...state.queue, ...fresh], queueOpen: true }
        : {};
    }),
  // patches both lists, since a fast download can move an item to history before its background title fetch lands.
  // the late metadata must still replace the "fetching title..." placeholder on the history row.
  updateQueueItem: (url, updates) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.url === url ? { ...item, ...updates } : item
      ),
      queueHistory: state.queueHistory.map((item) =>
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

  downloadFolder: null,
  setDownloadFolder: (path) => set({ downloadFolder: path }),

  // shared by the link controls and the search footer.
  downloadQuality: 'high',
  setDownloadQuality: (quality) => set({ downloadQuality: quality }),
  downloadFormat: 'mp4',
  setDownloadFormat: (format) => set({ downloadFormat: format }),
  // swaps the courtesy pauses between downloads for a short one.
  fastDownloadPacing: localStorage.getItem('fastDownloadPacing') === 'true',
  setFastDownloadPacing: (val) => {
    localStorage.setItem('fastDownloadPacing', String(val));
    return set({ fastDownloadPacing: val });
  },
  // stays on until the user leaves the downloader, once a link has been typed.
  linkControlsRevealed: false,
  setLinkControlsRevealed: (val) => set({ linkControlsRevealed: val }),

  isDownloading: false,
  setIsDownloading: (val) => set({ isDownloading: val }),
  downloadCancelled: false,
  setDownloadCancelled: (val) => set({ downloadCancelled: val }),

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
  setBackgroundThumbnail: (url) => set({ backgroundThumbnail: url, backgroundVideo: null, backgroundVideoReady: false }),
  backgroundVideo: null,
  setBackgroundVideo: (url) => set({ backgroundVideo: url, backgroundThumbnail: null, backgroundVideoReady: false }),
  clearBackgroundThumbnail: () => set({ backgroundThumbnail: null, backgroundVideo: null, backgroundVideoReady: false }),
  // true once the active background video has actually painted a frame, so dependent
  // effects (starfield crossfade) don't react to a video src that hasn't loaded yet.
  backgroundVideoReady: false,
  setBackgroundVideoReady: (val) => set({ backgroundVideoReady: val }),
  // true while the background video has faded out after a pause, so the starfield knows it's no longer showing.
  backgroundVideoFaded: false,
  setBackgroundVideoFaded: (val) => set({ backgroundVideoFaded: val }),

  // tracks the 5s no-activity idle state of the immersive player widget so other
  // immersive-mode visuals (starfield) can react without re-implementing the timer.
  immersiveIdle: false,
  setImmersiveIdle: (val) => set({ immersiveIdle: val }),

  isLoading: false,
  loadingText: 'Loading...',
  setLoading: (isLoading, text) =>
    set({ isLoading, loadingText: text || 'Loading...' }),

  // how far along a playlist's video list is, while it loads.
  playlistLoading: null,
  setPlaylistLoading: (playlistLoading) => set({ playlistLoading }),

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
  // folders keep the order they were arranged in.
  // changes go through services/musicLibrary.js.
  library: loadLibrary(),
  setLibrary: (library) => {
    localStorage.setItem('musicLibrary', JSON.stringify(library));
    return set({ library });
  },
  // folder paths in the temporary mixtape, which lasts until the app closes.
  tempMixtape: [],
  setTempMixtape: (tempMixtape) => set({ tempMixtape }),
  // a folder path, or a mixtape as "mixtape:<id>".
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
          const lastPath = s.musicCurrent.path;
          const newQueue = fisherYatesShuffle(s.musicFiles);
          // ensures the new queue doesn't open with the song that just ended, otherwise zustand sees no state change and the ended handler never fires.
          if (newQueue.length > 1 && newQueue[0].path === lastPath) {
            [newQueue[0], newQueue[1]] = [newQueue[1], newQueue[0]];
          }
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

  behaviorOpen: false,
  setBehaviorOpen: (val) => set({ behaviorOpen: val }),

  normInfoOpen: false,
  setNormInfoOpen: (val) => set({ normInfoOpen: val }),

  playerViewMode: localStorage.getItem('playerViewMode') || 'explorer',
  setPlayerViewMode: (mode) => {
    localStorage.setItem('playerViewMode', mode);
    return set({ playerViewMode: mode });
  },

  musicLibrarySort: ['name-asc', 'date-desc', 'date-asc'].includes(localStorage.getItem('musicLibrarySort'))
    ? localStorage.getItem('musicLibrarySort')
    : 'name-asc',
  setMusicLibrarySort: (sort) => {
    localStorage.setItem('musicLibrarySort', sort);
    return set({ musicLibrarySort: sort });
  },

  behaviorNormalizeOnStart: localStorage.getItem('behaviorNormalizeOnStart') !== 'false',
  setBehaviorNormalizeOnStart: (val) => {
    localStorage.setItem('behaviorNormalizeOnStart', String(val));
    return set({ behaviorNormalizeOnStart: val });
  },

  // normalization engine (dual system).
  // 'reactive' is live rms auto-gain, tuned by the preset below, adjusting while the music plays.
  // 'contextual' is pre-measured per-track loudness (ebu r128 via bundled ffmpeg) with one fixed gain per track, and unmeasured tracks fall back to reactive for that play.
  normalizerMode: localStorage.getItem('normalizerMode') === 'contextual' ? 'contextual' : 'reactive',
  setNormalizerMode: (mode) => {
    localStorage.setItem('normalizerMode', mode);
    return set({ normalizerMode: mode });
  },
  // bumped by loudnessService after each background scan so the ui (the scan status line in the behavior modal) re-renders as measurements land.
  loudnessScanTick: 0,
  // display name of the track currently being measured (null when idle), drives the "measuring..." toast under the player chips.
  loudnessScanningTrack: null,
  // reactive-only tuning, 'normal' (current behavior), 'aggressive' (faster reactions), or 'rigorous' (faster and wider range than +/-6 db).
  normalizerReactivePreset: ['aggressive', 'rigorous'].includes(localStorage.getItem('normalizerReactivePreset'))
    ? localStorage.getItem('normalizerReactivePreset')
    : 'normal',
  setNormalizerReactivePreset: (preset) => {
    localStorage.setItem('normalizerReactivePreset', preset);
    return set({ normalizerReactivePreset: preset });
  },
  behaviorAlbumBackground: localStorage.getItem('behaviorAlbumBackground') !== 'false',
  setBehaviorAlbumBackground: (val) => {
    localStorage.setItem('behaviorAlbumBackground', String(val));
    return set({ behaviorAlbumBackground: val });
  },
  behaviorShuffleOnStart: localStorage.getItem('behaviorShuffleOnStart') === 'true',
  setBehaviorShuffleOnStart: (val) => {
    localStorage.setItem('behaviorShuffleOnStart', String(val));
    return set({ behaviorShuffleOnStart: val });
  },
  behaviorHideProgressBar: localStorage.getItem('behaviorHideProgressBar') === 'true',
  setBehaviorHideProgressBar: (val) => {
    localStorage.setItem('behaviorHideProgressBar', String(val));
    return set({ behaviorHideProgressBar: val });
  },
  behaviorDisableSlidingTitles: localStorage.getItem('behaviorDisableSlidingTitles') === 'true',
  setBehaviorDisableSlidingTitles: (val) => {
    localStorage.setItem('behaviorDisableSlidingTitles', String(val));
    return set({ behaviorDisableSlidingTitles: val });
  },
  behaviorHoldVideoFrame: localStorage.getItem('behaviorHoldVideoFrame') === 'true',
  setBehaviorHoldVideoFrame: (val) => {
    localStorage.setItem('behaviorHoldVideoFrame', String(val));
    return set({ behaviorHoldVideoFrame: val });
  },

  behaviorHideVisualizer: localStorage.getItem('behaviorHideVisualizer') === 'true',
  setBehaviorHideVisualizer: (val) => {
    localStorage.setItem('behaviorHideVisualizer', String(val));
    return set({ behaviorHideVisualizer: val });
  },
  // how the visualizer reads the music: modern, or legacy for the original look.
  visualizerStyle: localStorage.getItem('visualizerStyle') || 'modern',
  setVisualizerStyle: (val) => {
    localStorage.setItem('visualizerStyle', val);
    return set({ visualizerStyle: val });
  },
  // how many bars the visualizer draws: standard, high or ultra.
  visualizerDetail: localStorage.getItem('visualizerDetail') || 'standard',
  setVisualizerDetail: (val) => {
    localStorage.setItem('visualizerDetail', val);
    return set({ visualizerDetail: val });
  },

  acceptMp3: localStorage.getItem('acceptMp3') !== 'false',
  setAcceptMp3: (val) => { localStorage.setItem('acceptMp3', String(val)); return set({ acceptMp3: val }); },
  acceptFlac: localStorage.getItem('acceptFlac') !== 'false',
  setAcceptFlac: (val) => { localStorage.setItem('acceptFlac', String(val)); return set({ acceptFlac: val }); },
  acceptWav: localStorage.getItem('acceptWav') !== 'false',
  setAcceptWav: (val) => { localStorage.setItem('acceptWav', String(val)); return set({ acceptWav: val }); },
  acceptMp4: localStorage.getItem('acceptMp4') !== 'false',
  setAcceptMp4: (val) => { localStorage.setItem('acceptMp4', String(val)); return set({ acceptMp4: val }); },

  behaviorWatchFolder: localStorage.getItem('behaviorWatchFolder') !== 'false',
  setBehaviorWatchFolder: (val) => {
    localStorage.setItem('behaviorWatchFolder', String(val));
    return set({ behaviorWatchFolder: val });
  },
  newFilesDetected: false,
  setNewFilesDetected: (val) => set({ newFilesDetected: val }),

  optionsOpen: false,
  setOptionsOpen: (val) => set({ optionsOpen: val }),

  // optional touch bar items, all on by default.
  touchBarPrefs: (() => {
    const defaults = { trackTitle: true, volume: true, shuffleRepeat: true, formatSwitch: true, downloadStatus: true, musicEverywhere: true, controlStrip: true };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('touchBarPrefs') || '{}') };
    } catch {
      return defaults;
    }
  })(),
  setTouchBarPref: (key, val) =>
    set((s) => {
      const prefs = { ...s.touchBarPrefs, [key]: val };
      localStorage.setItem('touchBarPrefs', JSON.stringify(prefs));
      return { touchBarPrefs: prefs };
    }),

  // hidden "debugging outlog" pane, toggled by tapping the version number 5x.
  debugConsoleOpen: false,
  setDebugConsoleOpen: (val) => set({ debugConsoleOpen: val }),
  toggleDebugConsole: () => set((s) => ({ debugConsoleOpen: !s.debugConsoleOpen })),

  renderProfile: localStorage.getItem('renderProfile') || 'standard',
  setRenderProfile: (profile) =>
    set((s) => {
      localStorage.setItem('renderProfile', profile);
      const updates = { renderProfile: profile };

      // switching to lite, by hand or by hardware detection, always starts from its defaults.
      // the other effects stay on unless turned off within lite.
      if (profile === 'lite' && s.renderProfile !== 'lite') {
        saveLiteDefaults();
        Object.assign(updates, LITE_DEFAULTS);
      }

      return updates;
    }),

  // set true once if hardware auto-detection picks lite on first launch.
  // dismissed permanently once the user notices it (via the bubble or by opening options), never re-prompts after that.
  showAutoLiteNotice: localStorage.getItem('showAutoLiteNotice') === 'true',
  setShowAutoLiteNotice: (val) => {
    localStorage.setItem('showAutoLiteNotice', String(val));
    return set({ showAutoLiteNotice: val });
  },

  liteDisableBlur: localStorage.getItem('liteDisableBlur') === 'true',
  setLiteDisableBlur: (val) => {
    localStorage.setItem('liteDisableBlur', String(val));
    return set({ liteDisableBlur: val });
  },
  liteDisableAnimations: localStorage.getItem('liteDisableAnimations') === 'true',
  setLiteDisableAnimations: (val) => {
    localStorage.setItem('liteDisableAnimations', String(val));
    return set({ liteDisableAnimations: val });
  },
  liteDisableVisualizer: localStorage.getItem('liteDisableVisualizer') === 'true',
  setLiteDisableVisualizer: (val) => {
    localStorage.setItem('liteDisableVisualizer', String(val));
    return set({ liteDisableVisualizer: val });
  },
  liteDisableVideoBackground: localStorage.getItem('liteDisableVideoBackground') === 'true',
  setLiteDisableVideoBackground: (val) => {
    localStorage.setItem('liteDisableVideoBackground', String(val));
    return set({ liteDisableVideoBackground: val });
  },

  eqOpen: false,
  setEqOpen: (val) => set({ eqOpen: val }),
  eqBands: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('eqBands') || 'null');
      if (Array.isArray(saved) && saved.length === 10) return saved;
    } catch {}
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  })(),
  setEqBand: (index, gain) =>
    set((s) => {
      const bands = [...s.eqBands];
      bands[index] = gain;
      localStorage.setItem('eqBands', JSON.stringify(bands));
      return { eqBands: bands };
    }),
  resetEq: () => {
    localStorage.removeItem('eqBands');
    return set({ eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  },
}));

export function getAcceptedExtensions(state) {
  const exts = [];
  if (state.acceptMp3) exts.push('mp3');
  if (state.acceptFlac) exts.push('flac');
  if (state.acceptWav) exts.push('wav');
  if (state.acceptMp4) exts.push('mp4');
  return exts.length > 0 ? exts : ['mp3', 'flac', 'wav'];
}

export default useAppStore;
