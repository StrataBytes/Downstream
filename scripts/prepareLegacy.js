'use strict';

// prepares the legacy build's downloader in build/legacy (see duild-legacy.sh).
// the official yt-dlp macos build needs 10.15, so the legacy build brings a standalone python and runs yt-dlp's platform-independent build with it.
// both are pinned and checked against their release checksums, and are only fetched again when a pin changes.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { downloadToFile } = require('../src/binaryRecovery');
const { installRelease, EXE_NAME } = require('../src/ytDlpMacos');

const root = path.resolve(__dirname, '..');
const OUT = path.join(root, 'build', 'legacy');

// intel only, since every mac that stops at 10.13 or 10.14 is intel.
const PYTHON_RELEASE = '20261021';
const PYTHON_ASSET = 'cpython-3.12.15+20261021-x86_64-apple-darwin-install_only_stripped.tar.gz';
// the pinned bootstrap copy, matching scripts/postinstall.js, which the app updates to nightly at runtime.
const YT_DLP_VERSION = '2026.06.09';

// parts of python yt-dlp never uses.
const PYTHON_UNUSED = [
  'include', 'share', 'lib/pkgconfig',
  'lib/python3.12/idlelib', 'lib/python3.12/tkinter', 'lib/python3.12/turtledemo', 'lib/python3.12/ensurepip',
  'lib/python3.12/site-packages/pip',
];
const PYTHON_UNUSED_PATTERNS = [/^lib\/(tcl|tk|itcl|thread)/, /^lib\/libtcl/, /^lib\/python3\.12\/lib-dynload\/_tkinter/, /^lib\/python3\.12\/site-packages\/pip-/];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stamp(dir) {
  try {
    return fs.readFileSync(path.join(dir, '.pinned'), 'utf8').trim();
  } catch {
    return null;
  }
}

function prune(dir) {
  for (const rel of PYTHON_UNUSED) fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (PYTHON_UNUSED_PATTERNS.some((p) => p.test(child))) fs.rmSync(path.join(dir, child), { recursive: true, force: true });
      else if (entry.isDirectory() && child.split('/').length < 4) walk(child);
    }
  };
  walk('');
}

async function preparePython() {
  const dir = path.join(OUT, 'python');
  if (stamp(dir) === PYTHON_ASSET) return;
  console.log(`Downloading standalone Python (${PYTHON_ASSET})...`);
  const base = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}`;
  const sumsFile = path.join(OUT, 'python-SHA256SUMS');
  const archive = path.join(OUT, PYTHON_ASSET);
  fs.mkdirSync(OUT, { recursive: true });
  await downloadToFile(`${base}/SHA256SUMS`, sumsFile);
  const line = fs.readFileSync(sumsFile, 'utf8').split('\n').find((l) => l.trim().endsWith(` ${PYTHON_ASSET}`));
  fs.rmSync(sumsFile, { force: true });
  const expected = line && line.trim().split(/\s+/)[0];
  if (!expected) throw new Error(`The ${PYTHON_RELEASE} checksums have no ${PYTHON_ASSET}.`);
  await downloadToFile(`${base}/${encodeURIComponent(PYTHON_ASSET)}`, archive);
  try {
    if (sha256(archive) !== expected) throw new Error(`${PYTHON_ASSET} failed its checksum.`);
    fs.rmSync(dir, { recursive: true, force: true });
    // the archive holds a single python folder.
    execFileSync('tar', ['-xzf', archive, '-C', OUT], { stdio: 'inherit' });
  } finally {
    fs.rmSync(archive, { force: true });
  }
  prune(dir);
  fs.writeFileSync(path.join(dir, '.pinned'), PYTHON_ASSET);
}

async function prepareYtDlp() {
  const dir = path.join(OUT, 'yt-dlp_macos');
  if (stamp(dir) === YT_DLP_VERSION) return;
  console.log(`Downloading yt-dlp's platform-independent build (${YT_DLP_VERSION})...`);
  await installRelease('yt-dlp/yt-dlp', YT_DLP_VERSION, dir, { legacy: true });
  fs.writeFileSync(path.join(dir, '.pinned'), YT_DLP_VERSION);
}

(async () => {
  await preparePython();
  await prepareYtDlp();
  // the two together, the way the app runs them.
  const version = execFileSync(path.join(OUT, 'yt-dlp_macos', EXE_NAME), ['--version'], {
    env: { ...process.env, DOWNSTREAM_PYTHON: path.join(OUT, 'python', 'bin', 'python3') },
    encoding: 'utf8',
  }).trim();
  console.log(`Legacy downloader ready (yt-dlp ${version}, ${execFileSync('du', ['-sh', path.join(OUT, 'python')], { encoding: 'utf8' }).split('\t')[0]} of python).`);
})().catch((err) => {
  console.error(`Couldn't prepare the legacy downloader: ${err.message}`);
  process.exit(1);
});
