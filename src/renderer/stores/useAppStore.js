import { create } from 'zustand';

function fisherYatesShuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// shuffle plays every song once per round, in an order picked when the round starts.
// musicShuffledQueue is that order and musicShuffledIndex the song playing, so everything before it has played this round, whether it played through or was skipped.

// how many of a round's last songs are kept away from the next round's start, so nothing plays twice in a row across them.
const ROUND_GAP = 3;

// the gap always leaves at least one song free to open the round, so in a library of two or three the song that just ended still never plays twice in a row.
function newRound(files, recent = []) {
  const paths = new Set(files.map((f) => f.path));
  const gap = Math.min(ROUND_GAP, files.length - 1);
  const stillThere = recent.filter((f) => paths.has(f.path));
  const recentPaths = new Set(gap > 0 ? stillThere.slice(-gap).map((f) => f.path) : []);
  const round = fisherYatesShuffle(files.filter((f) => !recentPaths.has(f.path)));
  fisherYatesShuffle(files.filter((f) => recentPaths.has(f.path))).forEach((track) => {
    const from = Math.min(gap, round.length);
    round.splice(from + Math.floor(Math.random() * (round.length - from + 1)), 0, track);
  });
  return round;
}

// songs added while shuffling slip into random spots among the ones still to come, and removed ones drop out, so the round carries on.
function carryRound(queue, index, files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const known = new Set(queue.map((f) => f.path));
  const kept = (part) => part.filter((f) => byPath.has(f.path)).map((f) => byPath.get(f.path));
  const played = kept(queue.slice(0, index + 1));
  const upcoming = kept(queue.slice(index + 1));
  files.forEach((track) => {
    if (!known.has(track.path)) upcoming.splice(Math.floor(Math.random() * (upcoming.length + 1)), 0, track);
  });
  return { musicShuffledQueue: [...played, ...upcoming], musicShuffledIndex: played.length - 1 };
}

// a song picked by hand counts as played this round, without changing the order of the rest.
function pickInRound(queue, index, track) {
  const others = (part) => part.filter((f) => f.path !== track.path);
  const played = others(queue.slice(0, index + 1));
  return { musicShuffledQueue: [...played, track, ...others(queue.slice(index + 1))], musicShuffledIndex: played.length };
}

// with remember shuffle on, the round saved for this source picks up where it was, unless it had finished.
function savedRound(s) {
  if (!s.behaviorRememberShuffle) return null;
  try {
    const saved = JSON.parse(localStorage.getItem('shuffleRound'));
    if (saved?.source !== s.musicFolder || !Array.isArray(saved.order)) return null;
    const round = carryRound(saved.order.map((path) => ({ path })), saved.index, s.musicFiles);
    return round.musicShuffledIndex + 1 < round.musicShuffledQueue.length ? round : null;
  } catch {
    return null;
  }
}

// the round to shuffle from, with nothing played yet when it's new.
function startRound(s) {
  return savedRound(s) || { musicShuffledQueue: newRound(s.musicFiles), musicShuffledIndex: -1 };
}

// how the player looks and feels, each starting at the app's original look.
export const LOOK_DEFAULTS = {
  lookVisualizerLift: 0,
  lookVisualizerBrightness: 1,
  lookBlurQuality: 'high',
  lookBlurIntensity: 30,
  lookBackgroundDim: 50,
  lookPanelOpacity: 0.82,
};
// the rest of the settings the player can be tuned with, outside the look.
export const TUNING_DEFAULTS = {
  voyagerFadeAfter: '5',
  voyagerStarDensity: 1,
  seekStep: 5,
  // seconds of quiet before a song that comes up on its own, whether new songs fade in, and whether play and pause ease in and out.
  advanceDelay: 1,
  fadeInSongs: false,
  fadePlayPause: true,
  homeStarfield: false,
  homeOriginal: false,
};

// a saved setting, read back as the type its default has.
function savedSetting(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  if (typeof fallback === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  if (typeof fallback === 'boolean') return raw === 'true';
  return raw;
}

const savedSettings = (defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, savedSetting(key, value)]));

const EMPTY_LIBRARY = { folders: [], mixtapes: [], collapsed: {}, sort: 'custom', lastSource: null };

// contextual is the original normalization, and anyone who'd used the player before it was keeps reactive, which was theirs.
// that's decided only once, so resetting every setting later goes to contextual like anything else.
function startingNormalizerMode() {
  const saved = localStorage.getItem('normalizerMode');
  if (saved === 'reactive' || saved === 'contextual') return saved;
  const settled = localStorage.getItem('normalizerDefaultSettled');
  localStorage.setItem('normalizerDefaultSettled', 'true');
  if (!settled && localStorage.getItem('disclaimerPlayerAccepted')) {
    localStorage.setItem('normalizerMode', 'reactive');
    return 'reactive';
  }
  return 'contextual';
}

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
export const LITE_DEFAULTS = { liteDisableBlur: true, liteDisableAnimations: false, liteDisableVisualizer: false, liteDisableVideoBackground: false };

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
  // changes the format or quality of one item, or of every item when no url is given.
  // only items still waiting change, since a running batch reads each one as it starts it.
  setQueueOptions: (options, url) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        (!url || item.url === url) && queueItemEditable(item, state) ? { ...item, ...options } : item
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

  downloadFolder: null,
  setDownloadFolder: (path) => set({ downloadFolder: path }),

  // shared by the link controls and the search footer.
  downloadQuality: 'high',
  setDownloadQuality: (quality) => set({ downloadQuality: quality }),
  downloadFormat: 'mp4',
  setDownloadFormat: (format) => set({ downloadFormat: format }),
  // swaps the courtesy pauses between downloads for a short one.
  // download all asks where to save first, unless this is turned off.
  askWhereToSave: localStorage.getItem('askWhereToSave') !== 'false',
  setAskWhereToSave: (val) => {
    localStorage.setItem('askWhereToSave', String(val));
    return set({ askWhereToSave: val });
  },
  savePickerOpen: false,
  setSavePickerOpen: (savePickerOpen) => set({ savePickerOpen }),
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

  totalProgress: { completed: 0, total: 0, text: 'Ready', visible: false, leaving: false },
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
  // the player has had no input for a while as music plays, in any view mode, so its corner buttons fade like voyager's controls.
  playerIdle: false,
  setPlayerIdle: (val) => set({ playerIdle: val }),

  isLoading: false,
  loadingText: 'Loading...',
  setLoading: (isLoading, text) =>
    set({ isLoading, loadingText: text || 'Loading...' }),

  // how far along a playlist's video list is, while it loads.
  playlistLoading: null,
  setPlaylistLoading: (playlistLoading) => set({ playlistLoading }),
  // which of the lined-up playlists is loading or being picked from, as in "playlist 2 of 4".
  playlistTurn: { at: 0, of: 0 },
  setPlaylistTurn: (playlistTurn) => set({ playlistTurn }),

  musicFolder: null,
  musicFiles: [],
  musicCurrent: null,
  musicPlaying: false,
  musicLibraryOpen: false,
  musicRepeat: false,
  musicShuffle: false,
  musicShuffledQueue: [],
  musicShuffledIndex: -1,
  musicAnalyser: null,
  musicAudioRef: null,
  musicVolume: 0.25,
  // songs play at about the same loudness unless it's turned off in settings.
  // anyone who'd turned off normalizing when the player opens starts with it off.
  musicNormalize: localStorage.getItem('musicNormalize') === null
    ? localStorage.getItem('behaviorNormalizeOnStart') !== 'false'
    : localStorage.getItem('musicNormalize') === 'true',
  setMusicNormalize: (val) => {
    localStorage.setItem('musicNormalize', String(val));
    return set({ musicNormalize: val });
  },
  musicFolderView: false,
  setMusicFolderView: (val) => set({ musicFolderView: val }),
  // folders keep the order they were arranged in.
  // changes go through services/musicLibrary.js.
  library: loadLibrary(),
  setLibrary: (library) => {
    localStorage.setItem('musicLibrary', JSON.stringify(library));
    return set({ library });
  },
  // downstream's own folder, known once the library has been checked against it.
  nativeRoot: null,
  setNativeRoot: (nativeRoot) => set({ nativeRoot }),
  // folders waiting in recently deleted, as main lists them.
  deletedFolders: [],
  setDeletedFolders: (deletedFolders) => set({ deletedFolders }),
  // the folder being imported, with how much of it has been copied.
  folderImport: null,
  setFolderImport: (folderImport) => set({ folderImport }),
  // folder paths in the temporary mixtape, which lasts until the app closes.
  tempMixtape: [],
  setTempMixtape: (tempMixtape) => set({ tempMixtape }),
  // a folder path, or a mixtape as "mixtape:<id>".
  setMusicFolder: (folder) => set({ musicFolder: folder }),
  // the songs of a newly opened source, which start a new shuffle round.
  setMusicFiles: (files) =>
    set((s) => (s.musicShuffle ? { musicFiles: files, ...startRound({ ...s, musicFiles: files }) } : { musicFiles: files })),
  // the playing source's songs changed, so shuffle carries on with them instead of starting over.
  mergeMusicFiles: (files) =>
    set((s) => (s.musicShuffle
      ? { musicFiles: files, ...carryRound(s.musicShuffledQueue, s.musicShuffledIndex, files) }
      : { musicFiles: files })),
  setMusicCurrent: (track) =>
    set((s) => (s.musicShuffle && track
      ? { musicCurrent: track, ...pickInRound(s.musicShuffledQueue, s.musicShuffledIndex, track) }
      : { musicCurrent: track })),
  setMusicPlaying: (val) => set({ musicPlaying: val }),
  // nothing loaded, as when the playing folder is deleted.
  clearMusic: () => set({ musicFolder: null, musicFiles: [], musicCurrent: null, musicPlaying: false, musicShuffledQueue: [], musicShuffledIndex: -1 }),
  setMusicLibraryOpen: (val) => set({ musicLibraryOpen: val }),
  toggleMusicRepeat: () => set((s) => ({ musicRepeat: !s.musicRepeat })),
  // turning shuffle on counts the song playing as the first of the round.
  toggleMusicShuffle: () =>
    set((s) => {
      if (s.musicShuffle) return { musicShuffle: false, musicShuffledQueue: [], musicShuffledIndex: -1 };
      const round = startRound(s);
      return {
        musicShuffle: true,
        ...(s.musicCurrent ? pickInRound(round.musicShuffledQueue, round.musicShuffledIndex, s.musicCurrent) : round),
      };
    }),
  playNextTrack: () =>
    set((s) => {
      if (s.musicFiles.length === 0 || !s.musicCurrent) return s;
      if (s.musicShuffle) {
        const nextIndex = s.musicShuffledIndex + 1;
        if (nextIndex >= s.musicShuffledQueue.length) {
          // the new round keeps the songs that just played away from its start, which also means it never opens with the song that just ended.
          // that matters, since zustand would see no change and the ended handler would never fire.
          const round = newRound(s.musicFiles, s.musicShuffledQueue.slice(-ROUND_GAP));
          return { musicShuffledQueue: round, musicShuffledIndex: 0, musicCurrent: round[0] || null };
        }
        return { musicShuffledIndex: nextIndex, musicCurrent: s.musicShuffledQueue[nextIndex] };
      }
      const idx = s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path);
      // a song moved out of the source while it played goes on to the one that came after it.
      if (idx < 0 && s.musicCurrent.place !== undefined) return { musicCurrent: s.musicFiles[s.musicCurrent.place % s.musicFiles.length] };
      return { musicCurrent: s.musicFiles[(idx + 1) % s.musicFiles.length] };
    }),
  playPrevTrack: () =>
    set((s) => {
      if (s.musicFiles.length === 0 || !s.musicCurrent) return s;
      // shuffle walks back through what played this round, and at the round's first song it starts that song over.
      if (s.musicShuffle) {
        const prevIndex = s.musicShuffledIndex - 1;
        if (prevIndex < 0) {
          const audio = s.musicAudioRef?.current;
          if (audio) audio.currentTime = 0;
          return {};
        }
        return { musicShuffledIndex: prevIndex, musicCurrent: s.musicShuffledQueue[prevIndex] };
      }
      const idx = s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path);
      const from = idx < 0 && s.musicCurrent.place !== undefined ? s.musicCurrent.place : idx;
      return { musicCurrent: s.musicFiles[(from - 1 + s.musicFiles.length) % s.musicFiles.length] };
    }),
  setMusicAnalyser: (node) => set({ musicAnalyser: node }),
  setMusicAudioRef: (ref) => set({ musicAudioRef: ref }),
  setMusicVolume: (val) => set({ musicVolume: val }),

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

  // normalization engine (dual system).
  // 'reactive' is live rms auto-gain, tuned by the preset below, adjusting while the music plays.
  // 'contextual' is pre-measured per-track loudness (ebu r128 via bundled ffmpeg) with one fixed gain per track, and unmeasured tracks fall back to reactive for that play.
  normalizerMode: startingNormalizerMode(),
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
  ...savedSettings(LOOK_DEFAULTS),
  ...savedSettings(TUNING_DEFAULTS),
  // one setter for the look and tuning settings, which are each a plain saved value.
  setSetting: (key, value) => {
    localStorage.setItem(key, String(value));
    return set({ [key]: value });
  },
  // keeps shuffle's round across launches, so songs that already played don't come back after a restart.
  behaviorRememberShuffle: localStorage.getItem('behaviorRememberShuffle') === 'true',
  setBehaviorRememberShuffle: (val) => {
    localStorage.setItem('behaviorRememberShuffle', String(val));
    if (!val) localStorage.removeItem('shuffleRound');
    return set({ behaviorRememberShuffle: val });
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
  // the latest songs that showed up in the playing source, which the new media toast announces.
  // a song the player skipped since it couldn't be read, for the toast.
  skippedTrack: null,
  setSkippedTrack: (skippedTrack) => set({ skippedTrack }),
  newMediaAdded: null,
  setNewMediaAdded: (val) => set({ newMediaAdded: val }),

  // the settings window, opened from home or the player, which each start it on their own page.
  // a page asked for by name, like lite mode's notice asking for appearance, comes first.
  settingsOpen: null,
  settingsPage: null,
  openSettings: (door, page = null) => set({ settingsOpen: door, settingsPage: page }),
  closeSettings: () => set({ settingsOpen: null, settingsPage: null }),

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

// with remember shuffle on, the round's order and place are saved for the source it belongs to.
useAppStore.subscribe((s, prev) => {
  if (!s.behaviorRememberShuffle || !s.musicShuffle || !s.musicFolder) return;
  if (s.musicShuffledQueue === prev.musicShuffledQueue && s.musicShuffledIndex === prev.musicShuffledIndex) return;
  try {
    localStorage.setItem('shuffleRound', JSON.stringify({
      source: s.musicFolder,
      order: s.musicShuffledQueue.map((f) => f.path),
      index: s.musicShuffledIndex,
    }));
  } catch { /* the round just isn't remembered */ }
});

// the song shuffle plays next, or null when the round is over.
export function shuffleUpNext(s) {
  return s.musicShuffledQueue[s.musicShuffledIndex + 1] || null;
}

// an item can still be changed or removed until its download starts.
export function queueItemEditable(item, state) {
  return !item.completed && !(state.isDownloading && state.nowPlaying?.url === item.url);
}

// what download all still has to fetch, which leaves out finished items and live streams.
export function queueItemWaiting(item) {
  return !item.completed && !item.live;
}

export function getAcceptedExtensions(state) {
  const exts = [];
  if (state.acceptMp3) exts.push('mp3');
  if (state.acceptFlac) exts.push('flac');
  if (state.acceptWav) exts.push('wav');
  if (state.acceptMp4) exts.push('mp4');
  return exts.length > 0 ? exts : ['mp3', 'flac', 'wav'];
}

export default useAppStore;
