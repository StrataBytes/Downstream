'use strict';

// macos touch bar.
// the renderer sends app state here, and button presses go back to it as actions.

const { TouchBar, nativeImage, ipcMain } = require('electron');
const { createControlStrip } = require('./controlStrip');

const { TouchBarButton, TouchBarLabel, TouchBarPopover, TouchBarSlider, TouchBarSpacer, TouchBarSegmentedControl } = TouchBar;

// system glyphs taller than this came back at 2x.
const GLYPH_MAX_PT = 24;
// segments stretch icons to fit, so their glyphs are padded to this height.
const SEGMENT_CANVAS_PT = 26;

// dim teal for toggles that are on.
const TOGGLE_ON = '#163c38';

// [progress, position, opacity], matching the ambient scrolling text.
const MARQUEE_KEYFRAMES = [[0, 0, 1], [0.25, 0, 1], [0.65, 1, 1], [0.73, 1, 1], [0.78, 1, 0], [0.81, 0, 0], [0.85, 0, 1], [1, 0, 1]];
const MARQUEE_FRAME_MS = 33;
// a new song starts scrolling after this short hold.
const MARQUEE_FIRST_HOLD_MS = 600;

// a skip waits this long and is dropped if play/pause is pressed.
const SKIP_GUARD_MS = 300;
// skips this close together fire right away.
const SKIP_RUN_MS = 1500;

let win = null;
let lastState = null;
let lastSignature = null;
let volumeSlider = null;

// current track title as pre-rendered pixel strips.
let title = null;
// shuffle/repeat glyphs from the renderer.
let toggleIcons = {};
const marquee = { text: null, start: 0, timer: null, button: null, last: null };
const skipGuard = { pending: null, timer: null, lastPlayPause: 0, lastSkip: 0 };

// loads a system glyph as a template image.
function glyph(name, canvasPt = 0) {
  const raw = nativeImage.createFromNamedImage(name);
  if (raw.isEmpty()) return undefined;

  // electron returns 2x pixels marked as 1x, so the real scale is restored here.
  const { width, height } = raw.getSize();
  const scale = height > GLYPH_MAX_PT ? 2 : 1;
  const canvasHeight = Math.max(Math.round(canvasPt * scale), height);
  const top = Math.floor((canvasHeight - height) / 2);
  const src = raw.toBitmap();
  const out = Buffer.alloc(width * canvasHeight * 4);
  src.copy(out, top * width * 4);
  const img = nativeImage.createFromBitmap(out, { width, height: canvasHeight, scaleFactor: scale });

  // without the template flag, macos draws the glyph black.
  img.setTemplateImage(true);
  return img;
}

function send(action, value) {
  if (win && !win.isDestroyed()) win.webContents.send('touchbar-action', action, value);
}

function fireSkip(action) {
  skipGuard.lastSkip = Date.now();
  send(action);
}

function flushSkip() {
  clearTimeout(skipGuard.timer);
  skipGuard.timer = null;
  const action = skipGuard.pending;
  skipGuard.pending = null;
  if (action) fireSkip(action);
}

const TRANSPORT_ACTIONS = new Set(['prev', 'play-pause', 'next']);

// prev/next sit beside play/pause, so stray skips are filtered out.
function pressTransport(action) {
  const now = Date.now();
  if (action === 'play-pause') {
    // a pending skip was a stray touch.
    clearTimeout(skipGuard.timer);
    skipGuard.timer = null;
    skipGuard.pending = null;
    skipGuard.lastPlayPause = now;
    send(action);
    return;
  }
  // a skip right after play/pause is a bounce.
  if (now - skipGuard.lastPlayPause < SKIP_GUARD_MS) return;
  // a quick run of skips is on purpose.
  if (skipGuard.pending || now - skipGuard.lastSkip < SKIP_RUN_MS) {
    flushSkip();
    fireSkip(action);
    return;
  }
  skipGuard.pending = action;
  skipGuard.timer = setTimeout(flushSkip, SKIP_GUARD_MS);
}

// the player's bar in the control strip, for while another app is in front.
// its presses go through the same paths as this bar's.
const controlStrip = createControlStrip((action, value) => {
  if (TRANSPORT_ACTIONS.has(action)) pressTransport(action);
  else send(action, value);
});

function button({ label, action, icon, color }) {
  const img = icon && glyph(icon);
  return new TouchBarButton({
    label,
    accessibilityLabel: label,
    icon: img,
    iconPosition: 'left',
    backgroundColor: color,
    click: () => send(action),
  });
}

function segment({ label, icon, enabled = true }) {
  const img = icon && glyph(icon, SEGMENT_CANVAS_PT);
  return { label: img ? undefined : label, icon: img, enabled };
}

// related actions share one segmented control.
// selectedIndex -1 keeps the first segment from staying highlighted.
function buttons(...defs) {
  return new TouchBarSegmentedControl({
    mode: 'buttons',
    segments: defs.map(segment),
    selectedIndex: -1,
    change: (index) => {
      const { action, value } = defs[index];
      if (TRANSPORT_ACTIONS.has(action)) pressTransport(action);
      else send(action, value);
    },
  });
}

function toggle({ label, action, icon }, on) {
  return new TouchBarButton({
    label: icon ? undefined : label,
    accessibilityLabel: label,
    icon,
    iconPosition: 'overlay',
    backgroundColor: on ? TOGGLE_ON : undefined,
    click: () => send(action),
  });
}

// renderer-drawn glyph as a template image.
function templateImage(dataURL) {
  const raw = nativeImage.createFromDataURL(dataURL);
  const { width, height } = raw.getSize();
  const img = nativeImage.createFromBitmap(raw.toBitmap(), { width, height, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

// decodes a strip once so frames can be cut from its raw pixels.
function decodeStrip(dataURL) {
  const img = nativeImage.createFromDataURL(dataURL);
  const { width, height } = img.getSize();
  return { width, height, pixels: img.toBitmap() };
}

// cuts a window out of a strip, faded to the given opacity.
function stripImage(strip, offset = 0, width = strip.width, opacity = 1) {
  const out = Buffer.alloc(width * strip.height * 4);
  for (let y = 0; y < strip.height; y++) {
    const from = (y * strip.width + offset) * 4;
    strip.pixels.copy(out, y * width * 4, from, from + width * 4);
  }
  // pixels are premultiplied, so every channel is faded.
  if (opacity < 1) {
    for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * opacity);
  }
  return nativeImage.createFromBitmap(out, { width, height: strip.height, scaleFactor: 2 });
}

// same cycle length as the ambient scrolling text.
function marqueeCycle(distance) {
  return (distance / 2 / 6 + 16) * 1000;
}

function marqueeFrame(elapsed, distance) {
  const cycle = marqueeCycle(distance);
  const progress = (elapsed % cycle) / cycle;
  const next = MARQUEE_KEYFRAMES.findIndex(([at]) => at > progress);
  const [p0, x0, o0] = MARQUEE_KEYFRAMES[next - 1];
  const [p1, x1, o1] = MARQUEE_KEYFRAMES[next];
  const t = (progress - p0) / (p1 - p0);
  return {
    offset: Math.round((x0 + (x1 - x0) * t) * distance),
    // a few opacity steps keep updates down.
    opacity: Math.round((o0 + (o1 - o0) * t) * 10) / 10,
  };
}

function stopMarquee() {
  clearInterval(marquee.timer);
  marquee.timer = null;
  marquee.button = null;
}

// a rebuild keeps the current scroll position.
function startMarquee(item, distance) {
  if (marquee.text !== title.text) {
    marquee.text = title.text;
    // a new song skips most of the first hold.
    const firstHold = MARQUEE_KEYFRAMES[1][0] * marqueeCycle(distance);
    marquee.start = Date.now() - (firstHold - MARQUEE_FIRST_HOLD_MS);
  }
  marquee.button = item;
  marquee.last = null;
  // no update while the bar is hidden or the frame hasn't changed.
  const tick = () => {
    if (!win || win.isDestroyed() || !win.isFocused()) return;
    const { offset, opacity } = marqueeFrame(Date.now() - marquee.start, distance);
    const key = `${offset}:${opacity}`;
    if (key === marquee.last) return;
    marquee.last = key;
    marquee.button.icon = stripImage(title.full, offset, title.box, opacity);
  };
  tick();
  marquee.timer = setInterval(tick, MARQUEE_FRAME_MS);
}

// the title is an image so it can scroll inside a fixed width.
function titleItem(slide) {
  const { full, fitted, box } = title;
  const scrolls = slide && full.width > box;
  // the ellipsized strip is used when sliding is off.
  const strip = full.width > box && !slide ? fitted : full;
  const item = new TouchBarButton({
    accessibilityLabel: title.text,
    icon: stripImage(strip, 0, Math.min(strip.width, box)),
    iconPosition: 'overlay',
    // a black bezel makes it look like a label.
    backgroundColor: '#000000',
  });
  if (scrolls) startMarquee(item, full.width - box);
  return item;
}

function playPause(music) {
  return music.playing
    ? { label: 'Pause', action: 'play-pause', icon: 'NSTouchBarPauseTemplate' }
    : { label: 'Play', action: 'play-pause', icon: 'NSTouchBarPlayTemplate' };
}

function transport(music) {
  return buttons(
    { label: 'Previous', action: 'prev', icon: 'NSTouchBarSkipBackTemplate' },
    playPause(music),
    { label: 'Next', action: 'next', icon: 'NSTouchBarSkipAheadTemplate' },
  );
}

function back(enabled = true) {
  return buttons({ label: 'Home', action: 'go-home', icon: 'NSTouchBarGoBackTemplate', enabled });
}

function homeItems({ music, prefs }) {
  const items = [
    button({ label: 'Downloader', action: 'go-download', icon: 'NSTouchBarDownloadTemplate' }),
    button({ label: 'Music Player', action: 'go-player', icon: 'NSTouchBarAudioOutputVolumeHighTemplate' }),
    button({ label: 'Options', action: 'open-options', icon: 'NSActionTemplate' }),
  ];
  if (music && prefs.musicEverywhere) {
    items.push(new TouchBarSpacer({ size: 'flexible' }), transport(music));
  }
  return items;
}

// shown while the options modal is open.
function optionsItems({ view, music, prefs }) {
  const items = [button({ label: 'Close Options', action: 'close-options' })];
  if (music && (view === 'player' || prefs.musicEverywhere)) {
    items.push(new TouchBarSpacer({ size: 'flexible' }), transport(music));
  }
  return items;
}

function downloadItems({ download, music, prefs }) {
  const idle = !download.busy;
  const items = [
    back(idle),
    // download and stop both stay, only which one is enabled swaps.
    buttons(
      { label: 'Download', action: 'download-all', icon: 'NSTouchBarDownloadTemplate', enabled: idle && download.queued > 0 },
      { label: 'Stop', action: 'stop', icon: 'NSTouchBarRecordStopTemplate', enabled: !idle },
    ),
    buttons(
      { label: 'Open Folder', action: 'open-folder', icon: 'NSRevealFreestandingTemplate', enabled: idle },
      { label: 'Change Folder', action: 'change-folder', icon: 'NSTouchBarFolderTemplate', enabled: idle },
    ),
  ];

  if (prefs.formatSwitch && idle && download.queued > 0) {
    items.push(buttons(
      { label: 'All MP4', action: 'format', value: 'mp4' },
      { label: 'All MP3', action: 'format', value: 'mp3' },
    ));
  }

  if (prefs.downloadStatus) {
    const status = download.total > 0
      ? `${download.completed}/${download.total} done`
      : `${download.queued} queued`;
    items.push(new TouchBarLabel({ label: status }));
  }

  // only play/pause fits next to the downloader controls.
  if (music && prefs.musicEverywhere) {
    items.push(new TouchBarSpacer({ size: 'flexible' }), buttons(playPause(music)));
  }
  return items;
}

function playerItems({ music, prefs }) {
  const items = [back()];
  if (!music) {
    items.push(new TouchBarLabel({ label: 'Pick a folder to start listening' }));
    return items;
  }

  items.push(transport(music));
  if (prefs.trackTitle && title?.text === music.title) {
    items.push(titleItem(music.slide));
  }
  if (prefs.volume) {
    // volume is a button that expands into the slider.
    volumeSlider = new TouchBarSlider({
      label: 'Volume',
      minValue: 0,
      maxValue: 100,
      value: music.volume,
      change: (value) => send('volume', value),
    });
    items.push(new TouchBarPopover({
      icon: glyph('NSTouchBarAudioOutputVolumeMediumTemplate'),
      items: new TouchBar({ items: [volumeSlider] }),
      // the close button only shows when this is set.
      showCloseButton: true,
    }));
  }
  if (prefs.shuffleRepeat) {
    items.push(
      toggle({ label: 'Shuffle', action: 'shuffle', icon: toggleIcons.shuffle }, music.shuffle),
      toggle({ label: 'Repeat', action: 'repeat', icon: toggleIcons.repeat }, music.repeat),
    );
  }
  return items;
}

function buildItems(state) {
  volumeSlider = null;
  stopMarquee();
  // startup shows its progress with nothing to press.
  if (state.starting) return [new TouchBarLabel({ label: `${state.starting}...` })];
  if (state.optionsOpen) return optionsItems(state);
  if (state.view === 'player') return playerItems(state);
  if (state.view === 'download') return downloadItems(state);
  return homeItems(state);
}

function applyState(state) {
  if (!win || win.isDestroyed()) return;
  lastState = state;
  controlStrip.update(state);

  // a volume-only change moves the slider instead of rebuilding mid-drag.
  const signature = JSON.stringify({ ...state, music: state.music && { ...state.music, volume: null } });
  if (signature === lastSignature) {
    if (volumeSlider && state.music) volumeSlider.value = state.music.volume;
    return;
  }
  lastSignature = signature;
  win.setTouchBar(new TouchBar({ items: buildItems(state) }));
}

let listening = false;

function attachTouchBar(window) {
  win = window;
  lastSignature = null;
  // the music stops with the window, so its controls go too.
  window.on('closed', () => controlStrip.hide());
  if (listening) return;
  listening = true;
  const fromWindow = (event) => win && !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.on('touchbar-state', (event, state) => {
    if (fromWindow(event)) applyState(state);
  });

  ipcMain.on('touchbar-title', (event, { text, full, fitted, box }) => {
    if (!fromWindow(event)) return;
    title = { text, box, full: decodeStrip(full), fitted: decodeStrip(fitted) };
    // rebuilds if the bar is already showing this track.
    if (lastState?.music?.title === text) {
      lastSignature = null;
      applyState(lastState);
    }
  });

  ipcMain.on('touchbar-icons', (event, { shuffle, repeat }) => {
    if (!fromWindow(event)) return;
    toggleIcons = { shuffle: templateImage(shuffle), repeat: templateImage(repeat) };
    controlStrip.setIcons({ shuffle, repeat });
    if (lastState) {
      lastSignature = null;
      applyState(lastState);
    }
  });
}

module.exports = { attachTouchBar };
