'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { unblockFile, redownloadYtDlp, YT_DLP_WIN_VERSION } = require('../src/binaryRecovery');

const root = path.resolve(__dirname, '..');

// pinned yt-dlp release for the macos standalone binary, bump this to update yt-dlp on macos builds.
// windows's pin (YT_DLP_WIN_VERSION) lives in src/binaryRecovery.js, shared with the runtime recovery path in main.js.
const YT_DLP_MACOS_VERSION = '2026.06.09';

function ensureElectron() {
  const electronDir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(electronDir, 'path.txt');
  if (fs.existsSync(pathFile)) return;

  console.log('Installing Electron binary...');

  if (process.platform === 'darwin') {
    // extract-zip silently fails on macos .app bundles (symlinks / resource forks), so this downloads the zip via @electron/get and extracts with ditto.
    const { version } = require(path.join(electronDir, 'package.json'));
    const arch = process.arch;
    const getScript = `
      const { downloadArtifact } = require('@electron/get');
      downloadArtifact({
        version: '${version}',
        artifactName: 'electron',
        platform: 'darwin',
        arch: '${arch}',
      }).then(p => process.stdout.write(p));
    `;
    const zipPath = execFileSync(process.execPath, ['-e', getScript], {
      cwd: electronDir,
      encoding: 'utf8',
    }).trim();
    const distDir = path.join(electronDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    execFileSync('ditto', ['-xk', zipPath, distDir], { stdio: 'inherit' });
    fs.writeFileSync(pathFile, 'Electron.app/Contents/MacOS/Electron');
  } else {
    execFileSync(process.execPath,
      [path.join(electronDir, 'install.js')],
      { stdio: 'inherit', cwd: electronDir });
  }
}

function ensureFFmpeg() {
  const bin = path.join(root, 'node_modules', 'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(bin)) {
    unblockFile(bin);
    return;
  }
  console.log('Downloading ffmpeg binary...');
  execFileSync(process.execPath,
    [path.join(root, 'node_modules', 'ffmpeg-static', 'install.js')],
    { stdio: 'inherit' });
  // ffmpeg-static's own install.js downloads via plain https, so this is normally a no-op, but it's cheap insurance against windows tagging the file as internet-sourced anyway.
  unblockFile(bin);
}

// a zipapp starts with a "#!" shebang, a mach-o binary does not.
function isShebangScript(file) {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf[0] === 0x23 && buf[1] === 0x21; // '#' '!'
}

async function ensureYtDlp() {
  const isWin = process.platform === 'win32';
  const bin = path.join(root, 'node_modules', 'yt-dlp-exec', 'bin',
    isWin ? 'yt-dlp.exe' : 'yt-dlp');

  if (process.platform === 'darwin') {
    // yt-dlp-exec ships a python zipapp that needs an external python3 >= 3.10 on path.
    // gui-launched macos apps get a minimal path where `env python3` resolves to the system commandlinetools python (3.9), which yt-dlp rejects.
    // ships the standalone yt-dlp_macos binary instead, a self-contained universal (x86_64 + arm64) mach-o with its own bundled python.
    if (fs.existsSync(bin) && !isShebangScript(bin)) return;
    console.log('Downloading standalone yt-dlp_macos binary...');
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_MACOS_VERSION}/yt-dlp_macos`;
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync('curl', ['-sSfL', '-o', bin, url], { stdio: 'inherit' });
    fs.chmodSync(bin, 0o755);
    return;
  }

  if (fs.existsSync(bin)) {
    unblockFile(bin);
    return;
  }

  if (isWin) {
    // deliberately pinned (YT_DLP_WIN_VERSION), not "latest", see the comment on that constant in src/binaryRecovery.js for why.
    // yt-dlp-exec's own installer always grabs whatever's newest on github, which means every install gets a different, reputation-less binary that smart app control blocks outright.
    // this shares one known-good hash across every install.
    console.log(`Downloading pinned yt-dlp binary (${YT_DLP_WIN_VERSION})...`);
    await redownloadYtDlp(bin);
    return;
  }

  console.log('Downloading yt-dlp binary...');
  execFileSync(process.execPath,
    [path.join(root, 'node_modules', 'yt-dlp-exec', 'scripts', 'postinstall.js')],
    { stdio: 'inherit' });
  unblockFile(bin);
}

function ensurePermissions() {
  if (process.platform !== 'darwin') return;
  const bins = [
    path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(root, 'node_modules', 'ffprobe-static', 'bin', 'darwin', process.arch, 'ffprobe'),
    path.join(root, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp'),
  ];
  for (const bin of bins) {
    try { fs.chmodSync(bin, 0o755); } catch {}
  }
}

function ensureForgeNatives() {
  if (process.platform !== 'darwin') return;
  // these native modules are used by @electron-forge/maker-dmg (appdmg stack) at build time, and must be compiled against system node, not electron's node.
  const checks = [
    path.join(root, 'node_modules', 'macos-alias', 'build', 'Release', 'volume.node'),
    path.join(root, 'node_modules', 'fs-xattr', 'build', 'Release', 'xattr.node'),
  ];
  if (checks.every(fs.existsSync)) return;
  console.log('Building maker-dmg native modules...');
  execFileSync('npm', ['rebuild', 'macos-alias', 'fs-xattr'], { cwd: root, stdio: 'inherit' });
}

function ensureSquirrelSevenZip() {
  if (process.platform !== 'win32') return;
  // electron-winstaller vendors 7-zip as arch-suffixed binaries (7z-x64.exe, 7z-arm64.exe), but the bundled squirrel.exe/syncreleases.exe were compiled against the plain "7z.exe" filename and look for it (and its "7z.dll") next to themselves.
  // without the plain-named copies, squirrel fails during `make` while releasifying the nupkg.
  const vendorDir = path.join(root, 'node_modules', 'electron-winstaller', 'vendor');
  const exe = path.join(vendorDir, '7z.exe');
  const dll = path.join(vendorDir, '7z.dll');
  if (fs.existsSync(exe) && fs.existsSync(dll)) return;

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const srcExe = path.join(vendorDir, `7z-${arch}.exe`);
  const srcDll = path.join(vendorDir, `7z-${arch}.dll`);
  if (!fs.existsSync(srcExe) || !fs.existsSync(srcDll)) return;

  fs.copyFileSync(srcExe, exe);
  fs.copyFileSync(srcDll, dll);
  console.log('Linked plain-named 7z.exe/7z.dll for Squirrel (Windows maker).');
}

function patchExtractZip() {
  const indexPath = path.join(root, 'node_modules', 'extract-zip', 'index.js');
  if (!fs.existsSync(indexPath)) return;
  const current = fs.readFileSync(indexPath, 'utf8');

  if (process.platform === 'darwin') {
    if (current.includes('DITTO_PATCH')) return;
    // extract-zip hangs on macos when unzipping .app bundles (yauzl + symlinks).
    // replaced with ditto, which handles macos archives correctly.
    fs.writeFileSync(indexPath, `'use strict'; // DITTO_PATCH
const { spawnSync } = require('child_process');
const fs = require('fs');
module.exports = async function extract(file, options) {
  const dir = options.dir;
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('ditto', ['-xk', file, dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ditto: extraction failed (exit ' + r.status + ')');
};
`);
    console.log('Patched extract-zip to use ditto on macOS.');
  } else if (process.platform === 'win32') {
    if (current.includes('BSDTAR_PATCH')) return;
    // @electron/packager uses extract-zip (yauzl) internally to unpack the electron distribution during the "copying files" packaging step.
    // yauzl's serialized, one-entry-at-a-time extraction can stall indefinitely on windows when a file write gets held up (e.g. real-time antivirus scanning a freshly written .exe/.dll).
    // replaced with the bsdtar shipped in system32 (windows 10 1803+ / windows 11), which extracts zips natively and isn't affected by yauzl's extraction model.
    const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    fs.writeFileSync(indexPath, `'use strict'; // BSDTAR_PATCH
const { spawnSync } = require('child_process');
const fs = require('fs');
const BSDTAR = ${JSON.stringify(bsdtar)};
module.exports = async function extract(file, options) {
  const dir = options.dir;
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(BSDTAR, ['-xf', file, '-C', dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar: extraction failed (exit ' + r.status + ')');
};
`);
    console.log('Patched extract-zip to use bsdtar on Windows.');
  }
}

(async () => {
  try {
    ensureElectron();
    ensureFFmpeg();
    await ensureYtDlp();
    ensurePermissions();
    ensureForgeNatives();
    ensureSquirrelSevenZip();
    patchExtractZip();
    console.log('Binaries ready.');
  } catch (err) {
    console.error('Binary setup failed:', err.message);
    process.exit(1);
  }
})();
