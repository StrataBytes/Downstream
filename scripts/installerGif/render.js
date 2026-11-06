// renders the windows installer's loading animation, installing.html, into the looping gif squirrel shows while it installs.
// run it with the project's electron: npx electron scripts/installerGif/render.js
// it writes assets/icons/win/installing.gif, which forge.config.js hands to the squirrel maker.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const extract = require('extract-zip');
const ffmpegPath = require('ffmpeg-static');
const { downloadToFile } = require('../../src/binaryRecovery');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = path.join(ROOT, 'build', 'installer-gif');
const OUT = path.join(ROOT, 'assets', 'icons', 'win', 'installing.gif');
// selawik is microsoft's open stand-in for segoe ui, under the sil open font license, and is only used to draw the gif.
const FONT_ZIP = 'https://github.com/microsoft/Selawik/releases/download/1.01/Selawik_Release.zip';
const FONTS = ['selawk.ttf', 'selawksb.ttf'];
const WIDTH = 420;
const HEIGHT = 280;
const FPS = 25;

app.commandLine.appendSwitch('force-device-scale-factor', '1');

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name) {
      return full;
    }
  }
  return null;
}

async function ensureFonts() {
  if (FONTS.every((name) => fs.existsSync(path.join(WORK, name)))) return;
  fs.mkdirSync(WORK, { recursive: true });
  const zip = path.join(WORK, 'selawik.zip');
  const unpacked = path.join(WORK, 'selawik');
  await downloadToFile(FONT_ZIP, zip);
  await extract(zip, { dir: unpacked });
  for (const name of FONTS) {
    const found = findFile(unpacked, name);
    if (!found) throw new Error(`${name} isn't in the selawik release.`);
    fs.copyFileSync(found, path.join(WORK, name));
  }
  fs.rmSync(zip, { force: true });
  fs.rmSync(unpacked, { recursive: true, force: true });
}

async function render() {
  await ensureFonts();
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'installing.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.check("600 17px Selawik"))').then((ok) => {
    if (!ok) throw new Error('selawik did not load.');
  });
  const loop = await win.webContents.executeJavaScript('window.LOOP');
  const frames = Math.round(loop * FPS);
  const dir = path.join(WORK, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < frames; i++) {
    // each frame is drawn, then given two paints to land before it's captured.
    await win.webContents.executeJavaScript(`frameAt(${i / FPS}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `frame_${String(i).padStart(3, '0')}.png`), image.resize({ width: WIDTH, height: HEIGHT }).toPNG());
  }
  // one palette for the whole loop keeps the colors steady from frame to frame.
  execFileSync(ffmpegPath, [
    '-y', '-v', 'error',
    '-framerate', String(FPS),
    '-i', path.join(dir, 'frame_%03d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    OUT,
  ]);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${frames} frames at ${FPS} fps, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
}

app.whenReady().then(() => render().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
})).finally(() => app.quit());
