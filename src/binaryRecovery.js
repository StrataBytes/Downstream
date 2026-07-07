'use strict';

// recovery helpers for the external binaries (yt-dlp, ffmpeg) downstream shells out to.
// on windows these are unsigned executables, and windows smart app control blocks them outright unless the exact file hash already has cloud reputation, sometimes quarantining or deleting them mid-session.
// when that happens, this redownloads the exact same pinned binary `npm run setup` would have fetched.
// used by both scripts/postinstall.js (plain node, at install time) and src/main.js (inside electron, at runtime), kept dependency-free (only node built-ins) so it works unmodified in both contexts.

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

// pinned yt-dlp release for windows, deliberately not "latest".
// yt-dlp-exec's own installer always grabs whatever the newest github release is at install time, so every user who runs `npm run setup` on a different day gets a different yt-dlp.exe with a different sha256 hash.
// windows smart app control blocks unsigned executables unless microsoft's cloud reputation graph already recognizes that exact hash, and a hash freshly minted on every install never accumulates enough shared exposure to earn that.
// ffmpeg-static already avoids this by pinning a fixed release tag (see FFMPEG_RELEASE_TAG below), and this does the same for yt-dlp, so every downstream install on a given release shares one hash instead of each rolling the dice for each.
// bump deliberately, not automatically, when yt-dlp needs to catch up with youtube, and re-verify the new pin isn't immediately blocked before shipping it, since a fresh pin starts back at zero reputation too.
const YT_DLP_WIN_VERSION = '2026.02.04';
const YT_DLP_WIN_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_WIN_VERSION}/yt-dlp.exe`;

// kept in sync with ffmpeg-static's package.json ("binary-release-tag").
// bump alongside any ffmpeg-static version bump.
const FFMPEG_RELEASE_TAG = 'b6.0';

function downloadToFile(url, destPath, { gunzip = false, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Downstream (yt-dlp/ffmpeg recovery)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) { reject(new Error('Too many redirects')); return; }
        downloadToFile(res.headers.location, destPath, { gunzip, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
        return;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const tmpPath = `${destPath}.download`;
      const out = fs.createWriteStream(tmpPath);
      const source = gunzip ? res.pipe(zlib.createGunzip()) : res;

      source.on('error', (err) => { out.destroy(); reject(err); });
      out.on('error', reject);
      source.pipe(out);
      out.on('finish', () => {
        fs.renameSync(tmpPath, destPath);
        resolve();
      });
    }).on('error', reject);
  });
}

// removes the ntfs "zone.identifier" alternate data stream windows attaches to files that came from the internet (mark-of-the-web).
// harmless no-op if the stream isn't present.
function unblockFile(filePath) {
  if (process.platform !== 'win32') return;
  try {
    fs.unlinkSync(`${filePath}:Zone.Identifier`);
  } catch { /* no motw stream present, nothing to unblock */ }
}

async function redownloadYtDlp(destPath) {
  if (process.platform !== 'win32') {
    throw new Error('Automatic yt-dlp recovery is only implemented for Windows.');
  }
  await downloadToFile(YT_DLP_WIN_URL, destPath);
  fs.chmodSync(destPath, 0o755);
  unblockFile(destPath);
}

async function redownloadFfmpeg(destPath) {
  if (process.platform !== 'win32') {
    throw new Error('Automatic ffmpeg recovery is only implemented for Windows.');
  }
  // ffmpeg-static only ships win32 x64/ia32 builds, no win32/arm64.
  const arch = process.arch === 'ia32' ? 'ia32' : 'x64';
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE_TAG}/ffmpeg-win32-${arch}.gz`;
  await downloadToFile(url, destPath, { gunzip: true });
  fs.chmodSync(destPath, 0o755);
  unblockFile(destPath);
}

// two distinct failure modes that both surface as a spawn/exec error, and need different messaging since only one is fixable here.
// 'missing': the file isn't on disk (deleted or quarantined). redownloading helps here, which is what ensureYtDlpBinary/ensureFfmpegBinary in main.js already do before this is reached.
// 'blocked': the file is present and untouched, but windows refuses to execute it since smart app control/smartscreen couldn't verify the unsigned publisher. redownloading identical unsigned bytes just gets blocked again, so the user is told the truth instead of retrying.
function classifySpawnFailure(err) {
  if (!err) return 'other';
  if (err.code === 'ENOENT') return 'missing';
  if (process.platform === 'win32') {
    const msg = err.message || '';
    if (err.code === 'UNKNOWN' || err.code === 'EACCES' || err.code === 'EPERM' || /spawn.*UNKNOWN/i.test(msg)) {
      return 'blocked';
    }
  }
  return 'other';
}

function describeBinaryFailure(binaryLabel, err) {
  switch (classifySpawnFailure(err)) {
    case 'missing':
      return `${binaryLabel} is missing. Downstream tried to restore it automatically — if this keeps happening, check Windows Security > Protection history.`;
    case 'blocked':
      return `Windows blocked ${binaryLabel} from running because it couldn't verify who published it (Smart App Control/SmartScreen). The file itself is fine — reinstalling or redownloading won't change this. Check Windows Security > App & browser control > Smart App Control, or Protection history, for an option to allow it.`;
    default:
      return `${binaryLabel} failed to run: ${err?.message || 'unknown error'}`;
  }
}

module.exports = {
  unblockFile,
  redownloadYtDlp,
  redownloadFfmpeg,
  classifySpawnFailure,
  describeBinaryFailure,
  YT_DLP_WIN_VERSION,
};
