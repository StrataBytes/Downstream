import { LOOK_DEFAULTS, LITE_DEFAULTS, TUNING_DEFAULTS } from '../stores/useAppStore';

const MAC = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

// the settings window's two sides, the app itself and the player, in the order the switch shows them.
export const SIDES = [
  { id: 'app', name: 'App' },
  { id: 'player', name: 'Player' },
];

// each side's pages, in the order its side menu lists them.
export const PAGES = [
  { id: 'general', side: 'app', name: 'General' },
  { id: 'downloads', side: 'app', name: 'Downloads' },
  { id: 'library', side: 'app', name: 'Library' },
  { id: 'performance', side: 'app', name: 'Performance' },
  { id: 'touchbar', side: 'app', name: 'Touch Bar', mac: true },
  { id: 'advanced', side: 'app', name: 'Advanced' },
  { id: 'view', side: 'player', name: 'View' },
  { id: 'background', side: 'player', name: 'Background' },
  { id: 'visualizer', side: 'player', name: 'Visualizer' },
  { id: 'sound', side: 'player', name: 'Sound' },
  { id: 'playback', side: 'player', name: 'Playback' },
].filter((p) => !p.mac || MAC);

export const page = (id) => PAGES.find((p) => p.id === id);
export const sidePages = (side) => PAGES.filter((p) => p.side === side);

// every setting the window shows, with the words it's found by.
// one with a key and its original value gets a dot while it's changed, and goes back with its page's reset.
// under names what it folds away inside, or a few things in order, which search falls back to while it's hidden.
const TOUCH = (sub, label, words) => ({ id: `touchBarPrefs.${sub}`, page: 'touchbar', label, words: `touch bar ${words}`, key: `touchBarPrefs.${sub}`, original: true });

export const ENTRIES = [
  { id: 'interfaceSize', page: 'general', label: 'Interface size', words: 'zoom scale bigger smaller text large tv display' },
  { id: 'checkUpdatesOnStart', page: 'general', label: 'Check for updates on start', words: 'update version release new', key: 'checkUpdatesOnStart', original: true },

  { id: 'askWhereToSave', page: 'downloads', label: 'Ask where to save downloads', words: 'download folder location destination save to', key: 'askWhereToSave', original: true },
  { id: 'fastDownloadPacing', page: 'downloads', label: 'Shorter pauses between downloads', words: 'download fast speed pacing delay wait queue', key: 'fastDownloadPacing', original: false },
  { id: 'ytdlp', page: 'downloads', label: 'Downloader version (yt-dlp)', words: 'yt-dlp youtube update repair nightly version broken failing search' },

  { id: 'acceptMp3', page: 'library', label: 'Play MP3 files', words: 'mp3 format file type audio', key: 'acceptMp3', original: true },
  { id: 'acceptFlac', page: 'library', label: 'Play FLAC files', words: 'flac lossless format file type audio', key: 'acceptFlac', original: true },
  { id: 'acceptWav', page: 'library', label: 'Play WAV files', words: 'wav format file type audio', key: 'acceptWav', original: true },
  { id: 'acceptMp4', page: 'library', label: 'Play MP4 files', words: 'mp4 video format file type', key: 'acceptMp4', original: true },
  { id: 'behaviorWatchFolder', page: 'library', label: 'Watch folders for changes', words: 'scan new files refresh automatic watch', key: 'behaviorWatchFolder', original: true },

  { id: 'renderProfile', page: 'performance', label: 'Lite Mode', words: 'rendering profile standard performance slow fast old computer laptop battery' },
  { id: 'liteDisableBlur', page: 'performance', label: 'Lite Mode: blur', words: 'lite blur performance', key: 'liteDisableBlur', original: LITE_DEFAULTS.liteDisableBlur, lite: true, under: 'renderProfile' },
  { id: 'liteDisableAnimations', page: 'performance', label: 'Lite Mode: animations', words: 'lite animations motion transitions reduce', key: 'liteDisableAnimations', original: LITE_DEFAULTS.liteDisableAnimations, lite: true, under: 'renderProfile' },
  { id: 'liteDisableVisualizer', page: 'performance', label: 'Lite Mode: visualizer', words: 'lite visualizer bars', key: 'liteDisableVisualizer', original: LITE_DEFAULTS.liteDisableVisualizer, lite: true, under: 'renderProfile' },
  { id: 'liteDisableVideoBackground', page: 'performance', label: 'Lite Mode: video backgrounds', words: 'lite video mp4 background', key: 'liteDisableVideoBackground', original: LITE_DEFAULTS.liteDisableVideoBackground, lite: true, under: 'renderProfile' },
  { id: 'hardwareAcceleration', page: 'performance', label: 'Hardware acceleration', words: 'gpu graphics flicker black crash' },
  { id: 'dedicatedGpu', page: 'performance', label: 'Dedicated graphics', words: 'gpu battery graphics card', mac: true },

  TOUCH('trackTitle', 'Track title', 'song name player'),
  TOUCH('volume', 'Volume control', 'volume player'),
  TOUCH('shuffleRepeat', 'Shuffle and repeat', 'shuffle repeat player'),
  TOUCH('formatSwitch', 'Format switch', 'mp3 mp4 downloader'),
  TOUCH('downloadStatus', 'Download progress', 'queue downloader'),
  TOUCH('musicEverywhere', 'Media controls outside the player', 'home play pause'),
  TOUCH('controlStrip', 'Player in the Control Strip', 'control strip'),

  { id: 'debugLog', page: 'advanced', label: 'Debugging outlog', words: 'log console report bug problem' },
  { id: 'appData', page: 'advanced', label: 'App data folder', words: 'settings files location' },
  { id: 'tempFiles', page: 'advanced', label: 'Temporary files', words: 'clean cleanup leftover disk space' },
  { id: 'homeOriginal', page: 'advanced', label: 'Original home screen', words: 'home main menu screen start classic old legacy original cards panel look', key: 'homeOriginal', original: false },
  { id: 'resetAll', page: 'advanced', label: 'Reset all settings', words: 'defaults factory restore original' },

  { id: 'playerViewMode', page: 'view', label: 'View mode', words: 'explorer commander voyager layout compact full screen', key: 'playerViewMode', original: 'explorer' },
  { id: 'voyagerStarDensity', page: 'view', label: 'Star density', words: 'voyager stars starfield space sky', key: 'voyagerStarDensity', original: TUNING_DEFAULTS.voyagerStarDensity, under: 'playerViewMode' },
  { id: 'behaviorHideProgressBar', page: 'view', label: 'Progress bar', words: 'seek bar timeline top', key: 'behaviorHideProgressBar', original: false },
  { id: 'behaviorDisableSlidingTitles', page: 'view', label: 'Sliding titles', words: 'scrolling marquee long names song title', key: 'behaviorDisableSlidingTitles', original: false },
  { id: 'voyagerFadeAfter', page: 'view', label: 'Fade away after', words: 'controls hide idle fade back arrow timeout voyager', key: 'voyagerFadeAfter', original: TUNING_DEFAULTS.voyagerFadeAfter },

  { id: 'behaviorAlbumBackground', page: 'background', label: 'Album art background', words: 'cover art image backdrop wallpaper video', key: 'behaviorAlbumBackground', original: true },
  { id: 'lookBlurQuality', page: 'background', label: 'Blur quality', words: 'blur background performance gpu sharp', key: 'lookBlurQuality', original: LOOK_DEFAULTS.lookBlurQuality, under: ['liteDisableBlur', 'behaviorAlbumBackground'] },
  { id: 'lookBlurIntensity', page: 'background', label: 'Blur intensity', words: 'blur background strength soft', key: 'lookBlurIntensity', original: LOOK_DEFAULTS.lookBlurIntensity, under: 'lookBlurQuality' },
  { id: 'lookBackgroundDim', page: 'background', label: 'Background dimness', words: 'dark bright dim brightness background art', key: 'lookBackgroundDim', original: LOOK_DEFAULTS.lookBackgroundDim, under: 'behaviorAlbumBackground' },
  { id: 'behaviorHoldVideoFrame', page: 'background', label: 'Hold the video frame on pause', words: 'mp4 video pause still frame background', key: 'behaviorHoldVideoFrame', original: false, under: ['liteDisableVideoBackground', 'behaviorAlbumBackground'] },
  { id: 'lookPanelOpacity', page: 'background', label: 'Panel transparency', words: 'glass see through opacity transparent solid panels', key: 'lookPanelOpacity', original: LOOK_DEFAULTS.lookPanelOpacity, under: 'liteDisableBlur' },

  { id: 'behaviorHideVisualizer', page: 'visualizer', label: 'Show the visualizer', words: 'visualizer bars spectrum show hide', key: 'behaviorHideVisualizer', original: false },
  { id: 'visualizerStyle', page: 'visualizer', label: 'Visualizer style', words: 'modern legacy original old classic', key: 'visualizerStyle', original: 'modern', under: 'behaviorHideVisualizer' },
  { id: 'visualizerDetail', page: 'visualizer', label: 'Visualizer detail', words: 'bars resolution standard high ultra', key: 'visualizerDetail', original: 'standard', under: 'behaviorHideVisualizer' },
  { id: 'lookVisualizerLift', page: 'visualizer', label: 'Visualizer height', words: 'tall short loud sensitivity gain bars', key: 'lookVisualizerLift', original: LOOK_DEFAULTS.lookVisualizerLift, under: 'behaviorHideVisualizer' },
  { id: 'lookVisualizerBrightness', page: 'visualizer', label: 'Visualizer brightness', words: 'bright faint bold opacity bars', key: 'lookVisualizerBrightness', original: LOOK_DEFAULTS.lookVisualizerBrightness, under: 'behaviorHideVisualizer' },

  { id: 'musicNormalize', page: 'sound', label: 'Normalize volume', words: 'volume normalization loudness level norm even quiet loud', key: 'musicNormalize', original: true },
  { id: 'normalizerMode', page: 'sound', label: 'Normalization mode', words: 'reactive contextual loudness lufs volume normalization', key: 'normalizerMode', original: 'contextual', under: 'musicNormalize' },
  { id: 'normalizerReactivePreset', page: 'sound', label: 'Normalization aggressiveness', words: 'reactive normal aggressive rigorous normalization', key: 'normalizerReactivePreset', original: 'normal', under: 'normalizerMode' },
  { id: 'loudnessMemory', page: 'sound', label: 'Saved loudness measurements', words: 'contextual memory cache measured delete normalization', under: 'normalizerMode' },

  { id: 'behaviorShuffleOnStart', page: 'playback', label: 'Shuffle when a folder opens', words: 'random order start shuffle', key: 'behaviorShuffleOnStart', original: false },
  { id: 'behaviorRememberShuffle', page: 'playback', label: 'Remember shuffle between launches', words: 'resume restart shuffle round', key: 'behaviorRememberShuffle', original: false },
  { id: 'advanceDelay', page: 'playback', label: 'Pause before the next song', words: 'gap delay wait silence between songs autoplay advance next track seconds', key: 'advanceDelay', original: TUNING_DEFAULTS.advanceDelay },
  { id: 'fadeInSongs', page: 'playback', label: 'Fade in new songs', words: 'fade soft start volume ramp skip next track', key: 'fadeInSongs', original: TUNING_DEFAULTS.fadeInSongs },
  { id: 'fadePlayPause', page: 'playback', label: 'Fade on play and pause', words: 'fade soft resume stop volume ease cut', key: 'fadePlayPause', original: TUNING_DEFAULTS.fadePlayPause },
  { id: 'seekStep', page: 'playback', label: 'Arrow key seek step', words: 'keyboard skip jump forward back seconds shortcut', key: 'seekStep', original: TUNING_DEFAULTS.seekStep },
].filter((e) => !e.mac || MAC);

const byId = new Map(ENTRIES.map((e) => [e.id, e]));
export const entry = (id) => byId.get(id);

function read(state, key) {
  if (key.startsWith('touchBarPrefs.')) return state.touchBarPrefs[key.slice('touchBarPrefs.'.length)];
  return state[key];
}

// a setting's own setter when it has one, and the shared one for the plain saved settings.
function write(state, key, value) {
  if (key.startsWith('touchBarPrefs.')) return state.setTouchBarPref(key.slice('touchBarPrefs.'.length), value);
  const setter = state[`set${key[0].toUpperCase()}${key.slice(1)}`];
  return setter ? setter(value) : state.setSetting(key, value);
}

// lite mode's own settings only count while lite mode is on.
export function isChanged(id, state) {
  const e = byId.get(id);
  if (!e?.key || (e.lite && state.renderProfile !== 'lite')) return false;
  return read(state, e.key) !== e.original;
}

export const pageChanged = (id, state) => ENTRIES.some((e) => e.page === id && isChanged(e.id, state));

export function resetSetting(id, state) {
  const e = byId.get(id);
  if (e?.key) write(state, e.key, e.original);
}

export function resetPage(id, state) {
  ENTRIES.filter((e) => e.page === id && isChanged(e.id, state)).forEach((e) => write(state, e.key, e.original));
}

// settings whose name, words or page hold every word typed, the ones named by it first.
export function findSettings(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ENTRIES
    .map((e) => {
      const name = e.label.toLowerCase();
      const all = `${name} ${e.words} ${page(e.page)?.name.toLowerCase() || ''}`;
      if (!words.every((w) => all.includes(w))) return null;
      return { e, rank: words.every((w) => name.includes(w)) ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map(({ e }) => e);
}
