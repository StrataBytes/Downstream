import { useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { downloadAll, requestCancelDownloads, chooseDownloadFolder } from '../services/downloadService';
import { SHUFFLE_ICON, REPEAT_ICON } from '../utils/toggleIcons';
import { dbg } from '../services/debugLog';

// macos touch bar bridge.
// sends what the bar shows and runs its button presses.

let actionsRegistered = false;

// the touch bar title is drawn here as an image.
// sizes are pixels at 2x, matching the touch bar's own labels.
const TITLE_FONT = '30px system-ui';
const TITLE_COLOR = 'rgb(192, 192, 192)';
const TITLE_HEIGHT = 44;
// fixed width the title scrolls inside.
const TITLE_BOX = 280;

function drawTitle(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = TITLE_FONT;
  canvas.width = Math.max(1, Math.ceil(ctx.measureText(text).width));
  canvas.height = TITLE_HEIGHT;
  // resizing the canvas resets the font.
  ctx.font = TITLE_FONT;
  ctx.fillStyle = TITLE_COLOR;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, TITLE_HEIGHT / 2);
  return canvas.toDataURL();
}

// ellipsized version for when sliding titles are off.
function fitTitle(text) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = TITLE_FONT;
  if (ctx.measureText(text).width <= TITLE_BOX) return text;
  const chars = [...text];
  let end = chars.length;
  while (end > 0 && ctx.measureText(`${chars.slice(0, end).join('').trimEnd()}…`).width > TITLE_BOX) end--;
  return `${chars.slice(0, end).join('').trimEnd()}…`;
}

function renderTitle(text) {
  return { text, full: drawTitle(text), fitted: drawTitle(fitTitle(text)), box: TITLE_BOX };
}

// shuffle/repeat glyphs for the touch bar, drawn black for macos to tint.
// 18pt at 2x.
const ICON_SIZE = 36;

async function drawIcon(shapes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL();
}

// only what the bar shows, so unrelated store updates are skipped.
function snapshot(s) {
  return {
    view: s.currentView,
    starting: s.startupStep,
    optionsOpen: s.optionsOpen,
    prefs: s.touchBarPrefs,
    music: s.musicCurrent
      ? {
          title: s.musicCurrent.name,
          playing: s.musicPlaying,
          volume: Math.round(s.musicVolume * 100),
          shuffle: s.musicShuffle,
          repeat: s.musicRepeat,
          slide: !s.behaviorDisableSlidingTitles,
        }
      : null,
    download: {
      busy: s.isDownloading,
      queued: s.queue.length,
      completed: s.totalProgress.completed,
      total: s.totalProgress.visible ? s.totalProgress.total : 0,
      folder: s.downloadFolder ? s.downloadFolder.split(/[\\/]/).pop() : null,
    },
  };
}

// same guards as the on-screen buttons.
const ACTIONS = {
  'go-home': (s) => { if (!s.isDownloading) s.goToView('home'); },
  'go-download': (s) => s.goToView('download'),
  'go-player': (s) => { if (!s.isDownloading) s.goToView('player'); },
  // also dismisses the auto lite mode notice, like the home options button.
  'open-options': (s) => { s.setOptionsOpen(true); s.setShowAutoLiteNotice(false); },
  'close-options': (s) => s.setOptionsOpen(false),
  'play-pause': (s) => { if (s.musicCurrent) s.setMusicPlaying(!s.musicPlaying); },
  'next': (s) => s.playNextTrack(),
  'prev': (s) => s.playPrevTrack(),
  'volume': (s, value) => s.setMusicVolume(Math.min(1, Math.max(0, value / 100))),
  'shuffle': (s) => s.toggleMusicShuffle(),
  'repeat': (s) => s.toggleMusicRepeat(),
  'download-all': (s) => { if (!s.isDownloading && s.queue.length > 0) downloadAll(); },
  'stop': () => requestCancelDownloads(),
  'open-folder': (s) => window.electronAPI.openDownloadsFolder(s.downloadFolder),
  'change-folder': (s) => { if (!s.isDownloading) chooseDownloadFolder(); },
  'format': (s, value) => { if (!s.isDownloading) s.setAllQueueFormat(value); },
};

export function useTouchBar() {
  useEffect(() => {
    if (window.electronAPI.platform !== 'darwin') return;

    if (!actionsRegistered) {
      actionsRegistered = true;
      window.electronAPI.onTouchBarAction((action, value) => {
        const state = useAppStore.getState();
        // nothing on the bar works until startup has finished.
        if (state.startupStep) {
          dbg('touchbar', `${action} ignored during startup`);
          return;
        }
        // the volume slider sends a value for every step it moves.
        if (action !== 'volume') dbg('touchbar', value === undefined ? action : `${action} ${value}`);
        ACTIONS[action]?.(state, value);
      });
      // the toggles keep text labels if this fails.
      Promise.all([drawIcon(SHUFFLE_ICON), drawIcon(REPEAT_ICON)])
        .then(([shuffle, repeat]) => window.electronAPI.setTouchBarIcons({ shuffle, repeat }))
        .catch(() => {});
    }

    let last = null;
    let lastTitle = null;
    const push = (state) => {
      // the title goes out before the state that shows it.
      const title = state.musicCurrent?.name;
      if (title && title !== lastTitle) {
        lastTitle = title;
        window.electronAPI.setTouchBarTitle(renderTitle(title));
      }

      const snap = snapshot(state);
      const next = JSON.stringify(snap);
      if (next === last) return;
      last = next;
      window.electronAPI.setTouchBarState(snap);
    };
    push(useAppStore.getState());
    return useAppStore.subscribe(push);
  }, []);
}
