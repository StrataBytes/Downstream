'use strict';

// the player's controls in the macos control strip, so they work while another app is in front.
// electron can't reach the private api this needs, so a small helper owns the button and its bar (src/native/controlStrip.m).
// it talks over stdin and stdout, one json message per line.
// if the helper is missing or keeps crashing, only this goes away.

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HELPER = 'DownstreamControlStrip';
// a crashed helper is restarted, up to this many times.
const MAX_RESTARTS = 3;
const BLUR_SETTLE_MS = 100;

function helperPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, HELPER);
  return path.join(__dirname, '..', '..', 'build', 'control-strip', HELPER);
}

function createControlStrip(onAction) {
  let proc = null;
  let restarts = 0;
  let gone = false;
  let quitting = false;
  // the last message of each type, sent again to a restarted helper.
  const latest = {};

  const write = (msg) => {
    if (proc?.stdin.writable) proc.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const receive = (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.action) {
      onAction(msg.action, msg.value);
    } else if (msg.event === 'unavailable') {
      gone = true;
      console.warn(`[touchbar] control strip unavailable: ${msg.reason}`);
    } else if (msg.event) {
      console.log(`[touchbar] control strip ${msg.event}`);
    }
  };

  const start = () => {
    const file = helperPath();
    if (!fs.existsSync(file)) {
      gone = true;
      console.warn(`[touchbar] control strip helper missing at ${file}`);
      return;
    }
    // what macos itself prints from the helper isn't useful, so only its messages are read.
    proc = spawn(file, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(receive);
    });
    proc.stdin.on('error', () => {});
    proc.on('error', (err) => {
      gone = true;
      console.warn(`[touchbar] control strip helper failed to start: ${err.message}`);
    });
    proc.on('exit', (code, signal) => {
      proc = null;
      if (gone || quitting) return;
      console.warn(`[touchbar] control strip helper stopped (${signal || `exit ${code}`})`);
      if (restarts++ < MAX_RESTARTS) start();
      else gone = true;
    });
    latest.focus = { type: 'focus', focused: BrowserWindow.getFocusedWindow() !== null };
    // focus goes first, so the button never flashes up while downstream is in front.
    [latest.focus, latest.icons, latest.state].filter(Boolean).forEach(write);
  };

  // only changes are sent, and the helper starts the first time there's something to show.
  const post = (msg) => {
    if (JSON.stringify(latest[msg.type]) === JSON.stringify(msg)) return;
    latest[msg.type] = msg;
    if (proc) write(msg);
    else if (!gone && msg.type === 'state' && msg.show) start();
  };

  // downstream's own bar takes over while it's in front.
  // a blur is checked a moment later, so moving between downstream's own windows doesn't count as leaving.
  const checkFocus = () => post({ type: 'focus', focused: BrowserWindow.getFocusedWindow() !== null });
  app.on('browser-window-focus', checkFocus);
  app.on('browser-window-blur', () => setTimeout(checkFocus, BLUR_SETTLE_MS));
  // closing the pipe ends the helper, which takes its button with it.
  app.once('will-quit', () => {
    quitting = true;
    proc?.stdin.end();
  });

  return {
    update({ starting, music, prefs }) {
      post({
        type: 'state',
        show: !!(prefs.controlStrip && music && !starting),
        music,
        items: { title: prefs.trackTitle, volume: prefs.volume, shuffleRepeat: prefs.shuffleRepeat },
      });
    },
    hide() {
      post({ type: 'state', show: false, music: null, items: {} });
    },
    // the renderer's glyphs arrive as png data urls.
    setIcons({ shuffle, repeat }) {
      post({ type: 'icons', shuffle: shuffle.split(',')[1], repeat: repeat.split(',')[1] });
    },
  };
}

module.exports = { createControlStrip };
