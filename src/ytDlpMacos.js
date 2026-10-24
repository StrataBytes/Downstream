'use strict';

// macos yt-dlp, using the official unpacked build.
// the single-file build unpacks itself on every run, and macos rescans those files each time.
// shared by scripts/postinstall.js and src/main.js, so it only uses node built-ins.

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { downloadToFile } = require('./binaryRecovery');

const ZIP_ASSET = 'yt-dlp_macos.zip';
const SUMS_ASSET = 'SHA2-256SUMS';
const EXE_NAME = 'yt-dlp_macos';
// the official macos build needs 10.15, so the legacy build installs the platform-independent one instead.
// a small launcher under the usual name runs it with downstream's bundled python, whose path main puts in DOWNSTREAM_PYTHON.
const ZIPAPP_ASSET = 'yt-dlp';
const ZIPAPP_NAME = 'yt-dlp.pyz';
const LAUNCHER = '#!/bin/sh\nexec "${DOWNSTREAM_PYTHON:-python3}" "$(dirname "$0")/yt-dlp.pyz" "$@"\n';
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Downstream (yt-dlp updater)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        fetchText(res.headers.location, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error(`timed out fetching ${url}`)));
    req.on('error', reject);
  });
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// downloads one release's build, checks it against the release checksums, and unpacks it into dir.
async function installRelease(repo, tag, dir, { legacy = false } = {}) {
  const asset = legacy ? ZIPAPP_ASSET : ZIP_ASSET;
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const sums = await fetchText(`${base}/${SUMS_ASSET}`);
  const line = sums.split('\n').find((l) => l.trim().endsWith(` ${asset}`));
  const expected = line && line.trim().split(/\s+/)[0];
  if (!expected) throw new Error(`${SUMS_ASSET} for ${tag} has no ${asset}.`);

  const download = `${dir}.download`;
  await downloadToFile(`${base}/${asset}`, download);
  try {
    if (await sha256(download) !== expected) throw new Error(`${asset} for ${tag} failed its checksum.`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    if (legacy) {
      fs.renameSync(download, path.join(dir, ZIPAPP_NAME));
      fs.writeFileSync(path.join(dir, EXE_NAME), LAUNCHER);
    } else {
      await run('ditto', ['-x', '-k', download, dir], 120000);
    }
  } finally {
    fs.rmSync(download, { force: true });
  }

  const exe = path.join(dir, EXE_NAME);
  fs.chmodSync(exe, 0o755);
  return exe;
}

// installed versions live in their own folders under root, with root/current naming the active one.
// updating never touches the files of a version that may still be running.
function createVersionStore({ root, bundledExe, repos, defaultTarget, legacy = false }) {
  const currentFile = path.join(root, 'current');
  const exeFor = (tag) => path.join(root, tag, EXE_NAME);
  let queue = Promise.resolve();

  function current() {
    try {
      const tag = fs.readFileSync(currentFile, 'utf8').trim();
      return TAG_PATTERN.test(tag) ? tag : null;
    } catch {
      return null;
    }
  }

  function activeExe() {
    const tag = current();
    return tag && fs.existsSync(exeFor(tag)) ? exeFor(tag) : bundledExe;
  }

  // only safe at launch, before any version is running.
  function prune() {
    if (!fs.existsSync(root)) return;
    const keep = current();
    for (const name of fs.readdirSync(root)) {
      if (name === 'current' || name === keep) continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }

  async function resolveTarget(target) {
    if (target === defaultTarget) {
      const latest = JSON.parse(await fetchText(`https://api.github.com/repos/${repos[defaultTarget]}/releases/latest`));
      return { repo: repos[defaultTarget], tag: latest.tag_name };
    }
    const [channel, tag] = target.split('@');
    return { repo: repos[channel], tag };
  }

  async function installTarget(target) {
    const { repo, tag } = await resolveTarget(target);
    if (!repo || !TAG_PATTERN.test(tag || '')) throw new Error(`Unknown yt-dlp release: ${target}`);
    if (tag === current() && fs.existsSync(exeFor(tag))) return exeFor(tag);

    fs.mkdirSync(root, { recursive: true });
    const exe = await installRelease(repo, tag, path.join(root, tag), { legacy });
    // macos scans new files on their first run, so that happens here instead of during a download.
    await run(exe, ['--version'], 180000);
    fs.writeFileSync(currentFile, tag);
    return exe;
  }

  // jobs run one at a time, so two updates never write the same folder.
  function enqueue(work) {
    const job = queue.then(work);
    queue = job.catch(() => {});
    return job;
  }

  function install(target) {
    return enqueue(() => installTarget(target));
  }

  // drops the active version and installs it again, for a damaged install.
  // only safe while that version isn't running.
  function reinstall(target) {
    return enqueue(() => {
      const tag = current();
      fs.rmSync(currentFile, { force: true });
      if (tag) fs.rmSync(path.join(root, tag), { recursive: true, force: true });
      return installTarget(target);
    });
  }

  return { activeExe, prune, install, reinstall };
}

module.exports = { installRelease, createVersionStore, run, EXE_NAME };
