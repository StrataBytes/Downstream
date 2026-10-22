const { app, BrowserWindow, Menu, ipcMain, shell, dialog, protocol, net, powerMonitor } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { redownloadYtDlp, redownloadFfmpeg, unblockFile, describeBinaryFailure } = require('./binaryRecovery');
const { attachTouchBar } = require('./touchBar');
const { createVersionStore, run: runFile } = require('./ytDlpMacos');

// in-app debug log forwarding.
// tees main-process console output to the renderer's debugging outlog pane while preserving normal stdout.
// off by default, with no formatting or ipc work done until the renderer enables it via 'set-debug-capture'.
let debugForwardEnabled = false;
let debugSender = null;
function forwardDebug(level, args) {
    if (!debugForwardEnabled || !debugSender || debugSender.isDestroyed()) return;
    let text;
    try {
        text = args.map((a) =>
            typeof a === 'string' ? a
            : a instanceof Error ? (a.stack || a.message)
            : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
        ).join(' ');
    } catch { text = String(args); }
    try { debugSender.send('debug-log', { ts: Date.now(), level, text }); } catch { /* ignore */ }
}
['log', 'warn', 'error'].forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); forwardDebug(level, args); };
});

// cpu branding patterns treated as modern enough for standard rendering.
// matches model numbers directly (e.g. "i7-12700H") instead of requiring "core i7" as a contiguous phrase, since os.cpus() strings often insert trademark glyphs between the brand word and the model number.
// anything that doesn't match is treated conservatively as lite.
const MODERN_CPU_PATTERN = /\bi[3579]-\d{3,5}|ultra\D{0,5}[3579]\b|ryzen\D{0,5}[3579]\b|threadripper|xeon|epyc/i;

// platform-specific helpers, each exporting the same interface.
// the active one is chosen at the bottom of this block based on process.platform.
// to add a new os, add another object and extend the selector.

const win32 = {
    handleSquirrelStartup() {
        const cmd = process.argv[1];
        if (!cmd) return false;
        const appFolder = path.resolve(process.execPath, '..');
        const updateExe = path.resolve(appFolder, '..', 'Update.exe');
        const exeName = path.basename(process.execPath);
        if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
            spawn(updateExe, ['--createShortcut', exeName], { detached: true });
            app.quit(); return true;
        }
        if (cmd === '--squirrel-uninstall') {
            spawn(updateExe, ['--removeShortcut', exeName], { detached: true });
            app.quit(); return true;
        }
        if (cmd === '--squirrel-obsolete') { app.quit(); return true; }
        return false;
    },
    getFFmpegPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg.exe');
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    },
    getFFmpegDir() {
        if (app.isPackaged) return process.resourcesPath;
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static');
    },
    getYtDlpPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp.exe');
        return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
    },
    getIconPath() {
        return path.join(__dirname, '..', '..', 'assets', 'icons', 'win', 'icon.ico');
    },
    detectRenderTier() {
        // strict cascade.
        // ram and core count alone are misleading, since an old cpu can have upgraded ram and an ancient xeon can have many cores.
        // an unrecognized or legacy cpu name vetoes standard regardless of the rest.
        const totalRamGB = os.totalmem() / (1024 ** 3);
        if (totalRamGB < 8) {
            return { profile: 'lite', reason: 'low-ram' };
        }

        const cpuModel = os.cpus()[0]?.model || '';
        if (!MODERN_CPU_PATTERN.test(cpuModel)) {
            return { profile: 'lite', reason: 'legacy-cpu' };
        }

        const coreCount = os.cpus().length;
        if (coreCount < 6) {
            return { profile: 'lite', reason: 'low-cores' };
        }

        return { profile: 'standard', reason: 'modern-hardware' };
    },
    attachTouchBar() {},
};

const darwin = {
    handleSquirrelStartup() { return false; },
    getFFmpegPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg');
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
    },
    getFFmpegDir() {
        if (app.isPackaged) return process.resourcesPath;
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static');
    },
    getYtDlpPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp_macos', 'yt-dlp_macos');
        return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp_macos', 'yt-dlp_macos');
    },
    getIconPath() {
        return path.join(__dirname, '..', '..', 'assets', 'icons', 'mac', 'icon.icns');
    },
    attachTouchBar(win) {
        attachTouchBar(win);
    },
    detectRenderTier() {
        if (process.arch === 'arm64') {
            return Promise.resolve({ profile: 'standard', reason: 'apple-silicon' });
        }
        // x64 binary here could be a real intel mac, or apple silicon running this build under rosetta.
        // only rosetta tells the truth here.
        // uses execFile (async), never execSync, since a blocking spawn on electron's main process event loop can stall the renderer's first audiocontext handshake and leave audio dead for that renderer's lifetime.
        // this path only runs once per install, gated by renderProfile in localStorage.
        return new Promise((resolve) => {
            execFile('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }, (err, stdout) => {
                if (!err && stdout.trim() === '1') {
                    resolve({ profile: 'standard', reason: 'apple-silicon-rosetta' });
                } else {
                    // sysctl key missing (e.g. very old macos) or genuine x64.
                    // either way, the safe assumption is real intel hardware.
                    resolve({ profile: 'lite', reason: 'intel-mac' });
                }
            });
        });
    },
};

const platform = process.platform === 'darwin' ? darwin : win32;

if (platform.handleSquirrelStartup()) {
    // squirrel handled the event, app is quitting.
}

const fs = require('fs');
const ytdl = require('ytdl-core');

const ffmpegPath = platform.getFFmpegPath();
const ffmpegDir = platform.getFFmpegDir();
const bundledYtDlpPath = platform.getYtDlpPath();
// The copy inside the application bundle is immutable on macOS and can be replaced by
// an installer update on Windows. Keep the auto-updating copy in userData instead.
// That lets yt-dlp repair YouTube extractor changes without modifying or invalidating
// the packaged application, while retaining the bundled executable as a fallback.
let ytDlpPath = bundledYtDlpPath;
let ytDlpManagedPath = null;
let ytDlpUpdatePromise = null;
let ytDlpExec = require('yt-dlp-exec').create(ytDlpPath);
const YT_DLP_DEFAULT_TARGET = 'nightly';
const YT_DLP_CHANNEL_REPOS = {
    stable: 'yt-dlp/yt-dlp',
    nightly: 'yt-dlp/yt-dlp-nightly-builds',
    master: 'yt-dlp/yt-dlp-master-builds',
};
let ytDlpUpdateTarget = YT_DLP_DEFAULT_TARGET;

function useYtDlp(binaryPath) {
    ytDlpPath = binaryPath;
    ytDlpExec = require('yt-dlp-exec').create(binaryPath);
    console.log('yt-dlp path:', binaryPath);
}

function ytDlpSettingsPath() {
    return path.join(app.getPath('userData'), 'yt-dlp-settings.json');
}

function isValidYtDlpTarget(target) {
    if (target === YT_DLP_DEFAULT_TARGET) return true;
    const match = typeof target === 'string' && target.match(/^(stable|nightly|master)@([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/);
    return !!match && Object.hasOwn(YT_DLP_CHANNEL_REPOS, match[1]);
}

function loadYtDlpUpdateTarget() {
    try {
        const saved = JSON.parse(fs.readFileSync(ytDlpSettingsPath(), 'utf8'));
        if (isValidYtDlpTarget(saved?.target)) ytDlpUpdateTarget = saved.target;
    } catch { /* first launch or an unreadable settings file: use the safe default */ }
}

function saveYtDlpUpdateTarget() {
    const settingsPath = ytDlpSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tempPath = `${settingsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ target: ytDlpUpdateTarget }, null, 2));
    fs.renameSync(tempPath, settingsPath);
}

// ensures ffprobe sits next to ffmpeg so yt-dlp can find both via --ffmpeg-location.
const ffprobeTarget = path.join(ffmpegDir,
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
if (!fs.existsSync(ffprobeTarget)) {
    try {
        const ffprobeSrc = app.isPackaged
            ? null
            : require('ffprobe-static').path;
        if (ffprobeSrc) fs.copyFileSync(ffprobeSrc, ffprobeTarget);
    } catch {}
}

if (process.platform === 'darwin') {
    try { fs.chmodSync(ffmpegPath, 0o755); } catch {}
    try { fs.chmodSync(ffprobeTarget, 0o755); } catch {}
    try { fs.chmodSync(bundledYtDlpPath, 0o755); } catch {}
}

// strips any leftover mark-of-the-web from an existing install (e.g. upgrading from an older build) so smartscreen has one less reason to treat these as untrusted.
unblockFile(ffmpegPath);
unblockFile(ffprobeTarget);
unblockFile(bundledYtDlpPath);

console.log('FFmpeg path:', ffmpegPath);
console.log('yt-dlp bundled path:', bundledYtDlpPath);

// yt-dlp's official guidance is to use the nightly channel when a site changes and
// the stable build breaks. Keep that auto-updating copy in userData so packaged app
// resources remain untouched, and retain the bundled executable as a fallback.
function copyBundledYtDlpToManagedPath() {
    if (!ytDlpManagedPath || !fs.existsSync(bundledYtDlpPath)) {
        throw new Error('Bundled yt-dlp is unavailable.');
    }
    fs.mkdirSync(path.dirname(ytDlpManagedPath), { recursive: true });
    fs.copyFileSync(bundledYtDlpPath, ytDlpManagedPath);
    try { fs.chmodSync(ytDlpManagedPath, 0o755); } catch {}
    unblockFile(ytDlpManagedPath);
}

// the latest update attempt, shown in advanced options.
let ytDlpUpdateStatus = { state: 'idle', checkedAt: null, error: null };

function trackYtDlpUpdate(job) {
    ytDlpUpdateStatus = { ...ytDlpUpdateStatus, state: 'updating', error: null };
    return job.then(
        (result) => {
            ytDlpUpdateStatus = { state: 'idle', checkedAt: Date.now(), error: null };
            return result;
        },
        (err) => {
            ytDlpUpdateStatus = { state: 'error', checkedAt: Date.now(), error: err.message };
            throw err;
        },
    );
}

function updateManagedYtDlp(target = ytDlpUpdateTarget) {
    return trackYtDlpUpdate(installYtDlp(target));
}

function installYtDlp(target) {
    if (macYtDlp) return macYtDlp.install(target).then(useYtDlp);
    return new Promise((resolve, reject) => {
        const child = execFile(
            ytDlpManagedPath,
            ['--update-to', target],
            { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    reject(new Error((stderr || stdout || err.message).trim()));
                    return;
                }
                const result = (stdout || stderr || '').trim().replace(/\s+/g, ' ');
                console.log(`[yt-dlp] ${result || `${target} update check complete.`}`);
                try { fs.chmodSync(ytDlpManagedPath, 0o755); } catch {}
                unblockFile(ytDlpManagedPath);
                resolve();
            },
        );
        child.on('error', reject);
    });
}

// macos keeps each installed yt-dlp version in its own folder (see ytDlpMacos.js).
let macYtDlp = null;

function initializeMacYtDlp() {
    const binaries = path.join(app.getPath('userData'), 'binaries');
    // the single-file copy from older versions is no longer used.
    fs.rmSync(path.join(binaries, 'yt-dlp'), { force: true });
    macYtDlp = createVersionStore({
        root: path.join(binaries, 'yt-dlp_macos'),
        bundledExe: bundledYtDlpPath,
        repos: YT_DLP_CHANNEL_REPOS,
        defaultTarget: YT_DLP_DEFAULT_TARGET,
    });
    macYtDlp.prune();
    useYtDlp(macYtDlp.activeExe());
    // a first run is when macos scans a fresh install, so it happens now instead of during a download.
    runFile(ytDlpPath, ['--version'], 180000).catch(() => {});
    // newer builds install in the background, so nothing waits on the download.
    updateManagedYtDlp().catch((err) => {
        console.warn(`[yt-dlp] ${ytDlpUpdateTarget} update unavailable; using the installed copy:`, err.message);
    });
}

async function initializeYtDlpUpdater() {
    loadYtDlpUpdateTarget();
    if (process.platform === 'darwin') {
        initializeMacYtDlp();
        return;
    }
    const extension = process.platform === 'win32' ? '.exe' : '';
    ytDlpManagedPath = path.join(app.getPath('userData'), 'binaries', `yt-dlp${extension}`);
    if (!fs.existsSync(ytDlpManagedPath)) {
        console.log('[yt-dlp] installing managed copy...');
        copyBundledYtDlpToManagedPath();
    }
    useYtDlp(ytDlpManagedPath);
    console.log(`[yt-dlp] checking official ${ytDlpUpdateTarget} release...`);
    await updateManagedYtDlp();
}

function getManagedYtDlpVersion() {
    return new Promise((resolve, reject) => {
        execFile(ytDlpPath, ['--version'], { timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error((stderr || stdout || err.message).trim()));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

async function getYtDlpInfo() {
    if (ytDlpUpdatePromise) await ytDlpUpdatePromise;
    if (!(await ensureYtDlpBinary())) throw new Error('yt-dlp is unavailable.');
    return {
        version: await getManagedYtDlpVersion(),
        target: ytDlpUpdateTarget,
        automatic: ytDlpUpdateTarget === YT_DLP_DEFAULT_TARGET,
        updating: ytDlpUpdateStatus.state === 'updating',
        updateError: ytDlpUpdateStatus.error,
        checkedAt: ytDlpUpdateStatus.checkedAt,
        bundled: ytDlpPath === bundledYtDlpPath,
    };
}

function ytDlpBusy() {
    return !!activeDownload || activeSearches.size > 0 || activePlaylists.size > 0;
}

// reinstalls the current target from scratch, for a damaged or missing install.
async function repairYtDlp() {
    if (ytDlpBusy()) throw new Error('Wait for downloads and searches to finish first.');
    if (macYtDlp) {
        // new calls use the bundled copy while the installed one is replaced.
        useYtDlp(bundledYtDlpPath);
        await trackYtDlpUpdate(macYtDlp.reinstall(ytDlpUpdateTarget).then(useYtDlp));
    } else {
        copyBundledYtDlpToManagedPath();
        useYtDlp(ytDlpManagedPath);
        await updateManagedYtDlp();
    }
    return getYtDlpInfo();
}

async function getYtDlpAvailableVersions() {
    const entries = await Promise.all(Object.entries(YT_DLP_CHANNEL_REPOS).map(async ([channel, repo]) => {
        const response = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=12`, {
            headers: { 'User-Agent': 'Downstream yt-dlp version picker' },
        });
        if (!response.ok) throw new Error(`${channel} releases returned HTTP ${response.status}`);
        const releases = await response.json();
        return releases
            .filter((release) => !release.draft && typeof release.tag_name === 'string')
            .filter((release) => isValidYtDlpTarget(`${channel}@${release.tag_name}`))
            .map((release) => ({
                id: `${channel}@${release.tag_name}`,
                channel,
                version: release.tag_name,
                publishedAt: release.published_at,
            }));
    }));
    return entries.flat();
}

async function setYtDlpVersionOverride(target) {
    if (!isValidYtDlpTarget(target)) throw new Error('That yt-dlp release is not an official supported option.');
    if (ytDlpUpdatePromise) await ytDlpUpdatePromise;
    if (!(await ensureYtDlpBinary())) throw new Error('yt-dlp is unavailable.');
    await updateManagedYtDlp(target);
    ytDlpUpdateTarget = target;
    saveYtDlpUpdateTarget();
    return getYtDlpInfo();
}

// binary health and recovery.
// windows defender/smartscreen can flag yt-dlp.exe (an unsigned pyinstaller build) as unrecognized and quarantine or delete it mid-session.
// every code path that shells out to yt-dlp/ffmpeg checks the binary is on disk first, and if not, tries once to restore it automatically before giving up with a message the renderer can show the user.
let ytDlpRecovery = null;
async function ensureYtDlpBinary() {
    // A click immediately after launch uses the newest binary, not the stale bundled
    // fallback, while an offline/failed update still leaves the last working copy.
    if (ytDlpUpdatePromise) await ytDlpUpdatePromise;
    if (fs.existsSync(ytDlpPath)) return true;
    if (ytDlpRecovery) return ytDlpRecovery;
    console.warn('[recovery] yt-dlp is missing (likely removed by Windows Defender/SmartScreen) — attempting automatic restore...');
    ytDlpRecovery = (async () => {
        if (macYtDlp && fs.existsSync(bundledYtDlpPath)) {
            useYtDlp(bundledYtDlpPath);
            console.log('[recovery] yt-dlp restored from the bundled fallback.');
            return true;
        }
        // Re-seed the managed copy from the package-managed fallback on every
        // platform. Windows can still use the pinned recovery download if the bundle
        // was also removed by antivirus.
        if (ytDlpManagedPath && fs.existsSync(bundledYtDlpPath)) {
            copyBundledYtDlpToManagedPath();
            useYtDlp(ytDlpManagedPath);
            console.log('[recovery] yt-dlp restored from the bundled fallback.');
            return true;
        }
        if (process.platform === 'win32') {
            await redownloadYtDlp(ytDlpPath);
            console.log('[recovery] yt-dlp restored successfully.');
            return true;
        }
        return false;
    })()
        .catch((err) => { console.error('[recovery] failed to restore yt-dlp:', err.message); return false; })
        .finally(() => { ytDlpRecovery = null; });
    return ytDlpRecovery;
}

let ffmpegRecovery = null;
function ensureFfmpegBinary() {
    if (fs.existsSync(ffmpegPath)) return Promise.resolve(true);
    if (ffmpegRecovery) return ffmpegRecovery;
    console.warn('[recovery] ffmpeg is missing (likely removed by Windows Defender/SmartScreen) — attempting automatic restore...');
    ffmpegRecovery = redownloadFfmpeg(ffmpegPath)
        .then(() => { console.log('[recovery] ffmpeg restored successfully.'); return true; })
        .catch((err) => { console.error('[recovery] failed to restore ffmpeg:', err.message); return false; })
        .finally(() => { ffmpegRecovery = null; });
    return ffmpegRecovery;
}

const BINARY_UNAVAILABLE_YTDLP = 'Windows blocked or removed yt-dlp (the component Downstream uses to fetch videos) and it could not be restored automatically. Try restoring it from Windows Security > Protection history, then restart Downstream.';
const BINARY_UNAVAILABLE_FFMPEG = 'Windows blocked or removed ffmpeg (the component Downstream uses to process audio/video) and it could not be restored automatically. Try restoring it from Windows Security > Protection history, then restart Downstream.';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 750,
        minWidth: 900,
        minHeight: 500,
        icon: platform.getIconPath(),
        backgroundColor: '#0f1923',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (process.argv.includes('--fresh')) {
            mainWindow.webContents.session.clearStorageData({ storages: ['localstorage'] }).then(() => {
                mainWindow.reload();
                mainWindow.show();
            });
        } else {
            mainWindow.show();
        }
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }

    // points the log forwarder at the loaded renderer.
    // actual forwarding only happens once the outlog is opened.
    mainWindow.webContents.on('did-finish-load', () => {
        debugSender = mainWindow.webContents;
    });

    platform.attachTouchBar(mainWindow);

    mainWindow.on('unresponsive', () => console.warn('[app] window stopped responding'));
    mainWindow.on('responsive', () => console.log('[app] window is responding again'));
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[app] renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
    });

    if (process.platform === 'darwin') {
        const template = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'Window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ],
            },
        ];
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        mainWindow.setMenuBarVisibility(false);
    }
}

// macos-only: skips the real keychain for chromium's cookie-encryption key.
// the app is ad-hoc signed, so each build's identity is unique, and to keychain every update looks like a different app trying to read the previous build's item, which triggers a password prompt on every update.
// the mock keychain uses a fixed key instead, so there are no prompts.
// downstream has no logins, sessions, or cookies worth protecting, since all app settings live in localStorage.
if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('use-mock-keychain');
}

// chromium only applies this before the window exists, so changes take effect after a restart.
const hardwareAccelerationDisabled = !!readAppSettings().disableHardwareAcceleration;
if (hardwareAccelerationDisabled) app.disableHardwareAcceleration();

// macos-only: on macs with both an integrated and a dedicated gpu, chromium draws on the integrated one, which the blur effects overwhelm.
// asking for the high performance gpu moves macos onto the dedicated one while downstream runs, and back once it quits.
// macs with one gpu are unaffected, and like hardware acceleration this only applies at startup.
const dedicatedGpuRequested = process.platform === 'darwin' && !readAppSettings().preferIntegratedGpu;
if (dedicatedGpuRequested) app.commandLine.appendSwitch('force_high_performance_gpu');

// macos-only: web audio's spec-mandated behavior for a cors-cross-origin media source is to silently output zeros from createMediaElementSource, with no thrown error.
// a response header alone (access-control-allow-origin) isn't sufficient if the scheme itself isn't registered as standard, secure, and corsEnabled before app.whenReady(), since that registration determines how chromium classifies the scheme's origin.
// windows doesn't need this, so its privileges and media:///<path> url format are left untouched here.
protocol.registerSchemesAsPrivileged([
    process.platform === 'darwin'
        ? {
            scheme: 'media',
            privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
        }
        : { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.whenReady().then(() => {
    // Do this in the background: startup remains fast, while every yt-dlp IPC handler
    // waits for the one in-flight update before invoking the executable.
    ytDlpUpdatePromise = initializeYtDlpUpdater().catch((err) => {
        console.warn('[yt-dlp] nightly update unavailable; using the last installed copy:', err.message);
    });

    // sleep can cut a download off mid-transfer.
    powerMonitor.on('suspend', () => console.log(`[app] system going to sleep${activeDownload ? ' during a download' : ''}`));
    powerMonitor.on('resume', () => console.log('[app] system woke up'));

    // tracks which media paths have already been logged so streaming (many range requests per file) doesn't flood the outlog.
    const seenMediaPaths = new Set();

    protocol.handle('media', (request) => {
        // "standard" schemes (darwin) parse with a real authority component, so the renderer sends media://local/<encoded-path> and the actual path lives in the url's pathname.
        // windows keeps the original media:///<encoded-path> (empty-host) format and parsing untouched.
        const filePath = process.platform === 'darwin'
            ? decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
            : decodeURIComponent(request.url.slice('media:///'.length));
        try {
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const rangeHeader = request.headers.get('range');
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
            const mime = mimeMap[ext] || 'audio/mpeg';

            if (!seenMediaPaths.has(filePath)) {
                seenMediaPaths.add(filePath);
                console.log(`[media] serving ${path.basename(filePath)} (${mime}, ${(fileSize / 1048576).toFixed(1)}MB)`);
            }

            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                if (match) {
                    const start = parseInt(match[1], 10);
                    const end = Math.min(match[2] ? parseInt(match[2], 10) : fileSize - 1, fileSize - 1);
                    if (start >= fileSize || end < start) {
                        return new Response(null, {
                            status: 416,
                            headers: { 'Content-Range': `bytes */${fileSize}` },
                        });
                    }
                    const length = end - start + 1;
                    // Do not buffer a requested range: Chromium commonly asks for
                    // bytes=0- on an initial MP4 request, which is the whole file.
                    // Streaming keeps even multi-gigabyte media at constant memory.
                    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
                    return new Response(stream, {
                        status: 206,
                        headers: {
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': String(length),
                            'Content-Type': mime,
                            // marks cors-clean so the crossOrigin="anonymous" <audio> routed through web audio isn't tainted to silence.
                            'Access-Control-Allow-Origin': '*',
                        },
                    });
                }
            }

            // Some containers begin with a non-range request. This must be streamed
            // too; fs.readFileSync would allocate the entire media file in Electron's
            // main process before the renderer can begin playback.
            const stream = Readable.toWeb(fs.createReadStream(filePath));
            return new Response(stream, {
                status: 200,
                headers: {
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(fileSize),
                    'Content-Type': mime,
                    // marks cors-clean so the crossOrigin="anonymous" <audio> routed through web audio isn't tainted to silence.
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch (err) {
            console.error(`[media] FAILED ${path.basename(filePath)}: ${err.code || err.message}`);
            return new Response('Not found', { status: 404 });
        }
    });

    createWindow();
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// gpu and utility process crashes, which often explain rendering problems.
app.on('child-process-gone', (_event, details) => {
    console.error(`[app] ${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

function cleanYouTubeUrl(url) {
    try {
        const urlObj = new URL(url);
        const videoId = urlObj.searchParams.get('v');
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return url;
    } catch (error) {
        return url;
    }
}

function getFormatString(quality, format) {
    if (format === 'mp3') {
        return 'bestaudio/best';
    }

    // no codec constraint, letting yt-dlp pick vp9/av1/h.264 freely and relying on ffmpeg (via mergeOutputFormat) to produce the mp4 container.
    // locking to [vcodec^=avc] caused sub-hd output, since youtube serves 1080p+ primarily in vp9/av1 and the best h.264 stream is often only 720p.
    switch (quality) {
        case 'highest':
            return 'bestvideo+bestaudio/best';
        case 'high':
            return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
        case 'medium':
            return 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
        case 'low':
            return 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
        default:
            return 'bestvideo+bestaudio/best';
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// The queue is serial, so there can only ever be one yt-dlp process to stop. Keep a
// direct handle to it instead of relying on the renderer's between-item cancel flag.
let activeDownload = null;
let downloadCancelRequested = false;

function downloadCancelledError() {
    const error = new Error('Download cancelled');
    error.code = 'DOWNLOAD_CANCELLED';
    return error;
}

// what yt-dlp prints when youtube has seen too many requests.
const RATE_LIMIT_PATTERN = /HTTP Error 429|Too Many Requests|rate[- ]limit|confirm you.?re not a bot/i;

function rateLimitedError() {
    const error = new Error('YouTube is limiting downloads right now.');
    error.code = 'RATE_LIMITED';
    return error;
}

// yt-dlp's step lines, minus the constant percentage updates.
const YTDLP_STEP_LINE = /^\[[\w:]+\]/;
const YTDLP_PROGRESS_LINE = /^\[download\]\s+[\d.]+%/;

// passes yt-dlp's own output to the outlog while it's open.
function forwardYtDlpOutput(chunk) {
    if (!debugForwardEnabled) return;
    for (const line of chunk.toString().split('\n')) {
        const text = line.trim();
        if (text.startsWith('ERROR:')) console.error(`[yt-dlp] ${text}`);
        else if (text.startsWith('WARNING:')) console.warn(`[yt-dlp] ${text}`);
        else if (YTDLP_STEP_LINE.test(text) && !YTDLP_PROGRESS_LINE.test(text)) console.log(`[yt-dlp] ${text}`);
    }
}

function cancelActiveDownload() {
    const running = activeDownload;
    downloadCancelRequested = true;
    if (!running?.proc?.pid) return false;

    running.cancelled = true;
    const { proc } = running;
    console.log(`[download] cancelling yt-dlp process ${proc.pid}...`);

    if (process.platform === 'win32') {
        // yt-dlp may be waiting on ffmpeg during conversion. /T terminates that
        // child process too, which proc.kill() alone does not guarantee on Windows.
        execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
        // The process is spawned detached on Unix so its PID is also its process
        // group. This stops yt-dlp and any ffmpeg child it started.
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
        setTimeout(() => {
            if (activeDownload === running) {
                try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
            }
        }, 1500).unref();
    }
    return true;
}

async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            // retrying right away only makes a rate limit worse.
            if (error?.code === 'DOWNLOAD_CANCELLED' || error?.code === 'RATE_LIMITED') throw error;
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.warn(`[retry] attempt ${attempt} of ${maxRetries} failed (${error?.message || error}), retrying in ${delay}ms`);
            await sleep(delay);
        }
    }
}

ipcMain.handle('download-video', async (event, { url, quality, format, outputDir: customOutputDir, gentle }) => {
    downloadCancelRequested = false;
    if (!(await ensureYtDlpBinary())) {
        event.sender.send('download-error', { url, error: BINARY_UNAVAILABLE_YTDLP });
        return { success: false, error: BINARY_UNAVAILABLE_YTDLP };
    }
    if (!(await ensureFfmpegBinary())) {
        event.sender.send('download-error', { url, error: BINARY_UNAVAILABLE_FFMPEG });
        return { success: false, error: BINARY_UNAVAILABLE_FFMPEG };
    }

    const outputDir = customOutputDir || app.getPath('downloads');
    const cleanUrl = cleanYouTubeUrl(url);
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    // builds cli args directly so spawn() gives real-time stdout/stderr streams.
    // yt-dlp-exec (execa) buffers output internally and doesn't emit data events until the process exits, which makes progress tracking impossible through it.
    const args = [
        cleanUrl,
        '-o', outputTemplate,
        '-f', getFormatString(quality, format),
        '--no-playlist',
        '--ffmpeg-location', ffmpegDir,
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--concurrent-fragments', '4',
        '--retries', '10',
        '--fragment-retries', '10',
        '--newline',
        '--no-colors',
        '--no-check-certificates',
        '--embed-thumbnail',
        '--convert-thumbnails', 'jpg',
    ];

    if (format === 'mp3') {
        args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push('--merge-output-format', 'mp4');
    }
    // big batches also space out the requests inside each download.
    if (gentle) args.push('--sleep-requests', '0.75');

    const started = Date.now();
    console.log(`[download] start ${cleanUrl} (${format}/${quality}, -f ${getFormatString(quality, format)}${gentle ? ', paced' : ''}) → ${outputDir}`);
    event.sender.send('download-progress', { url, progress: 1 });

    // highest percentage seen, prevents the bar going backwards on multi-stream downloads (yt-dlp downloads video 0-100% then audio 0-100%).
    let maxProgress = 1;
    let finalizingSent = false;
    let attemptStarted = Date.now();
    let receiving = false;

    const parseProgress = (chunk) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
            const m = line.match(/\[download\]\s+([\d.]+)%/);
            if (!m) continue;
            // a long wait before this point is youtube or the network, not the download itself.
            if (!receiving) {
                receiving = true;
                console.log(`[download] data started ${((Date.now() - attemptStarted) / 1000).toFixed(1)}s after launch`);
            }
            const rawPct = Math.round(parseFloat(m[1]));
            if (rawPct >= 100) {
                // stream finished, ffmpeg merge/convert is next with no progress output.
                if (!finalizingSent) {
                    finalizingSent = true;
                    console.log('[download] a stream reached 100%');
                    event.sender.send('download-progress', { url, progress: 95, finalizing: true });
                }
            } else {
                const pct = Math.min(94, rawPct); // 95 reserved for finalizing
                if (pct > maxProgress) {
                    maxProgress = pct;
                    event.sender.send('download-progress', { url, progress: pct });
                }
            }
        }
    };

    try {
        await withRetry(async () => {
            if (downloadCancelRequested) throw downloadCancelledError();
            finalizingSent = false;
            attemptStarted = Date.now();
            receiving = false;
            return new Promise((resolve, reject) => {
                const proc = spawn(ytDlpPath, args, {
                    detached: process.platform !== 'win32',
                    windowsHide: true,
                });
                const running = { proc, cancelled: false };
                activeDownload = running;
                let stderrTail = '';
                proc.stdout.on('data', (chunk) => {
                    parseProgress(chunk);
                    forwardYtDlpOutput(chunk);
                });
                proc.stderr.on('data', (chunk) => {
                    parseProgress(chunk);
                    forwardYtDlpOutput(chunk);
                    // keeps the tail of stderr so a silent failure has a real cause.
                    stderrTail = (stderrTail + chunk.toString()).slice(-1500);
                });
                proc.on('error', (e) => {
                    if (activeDownload === running) activeDownload = null;
                    console.error('[download] spawn error:', e.message);
                    reject(running.cancelled ? downloadCancelledError() : e);
                });
                proc.on('close', (code) => {
                    if (activeDownload === running) activeDownload = null;
                    if (running.cancelled) {
                        console.log('[download] cancelled.');
                        reject(downloadCancelledError());
                        return;
                    }
                    if (code === 0) resolve();
                    else {
                        const tail = stderrTail.trim();
                        console.error(`[download] yt-dlp exited ${code}${tail ? ': ' + tail.split('\n').slice(-3).join(' | ') : ''}`);
                        reject(RATE_LIMIT_PATTERN.test(tail) ? rateLimitedError() : new Error(`yt-dlp exited with code ${code}`));
                    }
                });
            });
        }, 3, 3000);

        event.sender.send('download-progress', { url, progress: 100 });
        event.sender.send('download-complete', { url, success: true });
        event.sender.send('conversion-complete', { url, success: true });
        console.log(`[download] complete ${cleanUrl} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return { success: true };
    } catch (dlError) {
        if (dlError?.code === 'DOWNLOAD_CANCELLED') {
            return { success: false, cancelled: true };
        }
        // the queue waits and tries this one again, so it isn't shown as failed.
        if (dlError?.code === 'RATE_LIMITED') {
            console.warn(`[download] youtube is rate limiting, ${cleanUrl} will be retried after a pause`);
            return { success: false, rateLimited: true, error: dlError.message };
        }
        const message = describeBinaryFailure('yt-dlp', dlError);
        console.error(`[download] failed ${url}: ${message}`);
        event.sender.send('download-error', { url, error: message });
        return { success: false, error: message };
    }
});

ipcMain.handle('cancel-download', async () => ({ cancelled: cancelActiveDownload() }));

ipcMain.handle('get-video-info', async (event, url) => {
    const cleanUrl = cleanYouTubeUrl(url);
    if (!(await ensureYtDlpBinary())) {
        // skips straight to the ytdl-core fallback instead of burning retries against a binary that's already known to be missing.
        try {
            const info = await ytdl.getBasicInfo(cleanUrl);
            return {
                title: info.videoDetails.title || 'Unknown Title',
                thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || null,
                uploader: info.videoDetails.author?.name || 'Unknown',
                uploadDate: info.videoDetails.publishDate || null,
                duration: parseInt(info.videoDetails.lengthSeconds) || null,
            };
        } catch (fallbackError) {
            console.error(`yt-dlp unavailable and fallback failed for ${url}: ${fallbackError.message}`);
            return { title: 'Unknown Title - Check URL', thumbnail: null, uploader: 'Unknown', uploadDate: null, duration: null };
        }
    }
    try {
        const info = await withRetry(async () => {
            return await ytDlpExec(cleanUrl, {
                dumpSingleJson: true,
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true,
                skipDownload: true,
            });
        }, 2, 2000);

        let thumbnail = info.thumbnail || null;
        if (!thumbnail && info.thumbnails && info.thumbnails.length > 0) {
            thumbnail = info.thumbnails[info.thumbnails.length - 1].url;
        }

        return {
            title: info.title || 'Unknown Title',
            thumbnail,
            uploader: info.uploader || info.channel || 'Unknown',
            uploadDate: info.upload_date || null,
            duration: info.duration || null,
        };
    } catch (error) {
        console.error(`Error fetching video info for ${url}: ${describeBinaryFailure('yt-dlp', error)}`);
        try {
            const info = await ytdl.getBasicInfo(cleanYouTubeUrl(url));
            return {
                title: info.videoDetails.title || 'Unknown Title',
                thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || null,
                uploader: info.videoDetails.author?.name || 'Unknown',
                uploadDate: info.videoDetails.publishDate || null,
                duration: parseInt(info.videoDetails.lengthSeconds) || null,
            };
        } catch (fallbackError) {
            console.error(`Fallback also failed: ${fallbackError.message}`);
            return { title: 'Unknown Title - Check URL', thumbnail: null, uploader: 'Unknown', uploadDate: null, duration: null };
        }
    }
});

// mixes and radios never end, so only their start is listed.
const ENDLESS_PLAYLIST_LIMIT = 25;
// seconds between yt-dlp's page requests, so long playlists are read gently.
// the first page is never delayed, so short playlists don't wait at all.
const PLAYLIST_PAGE_SLEEP = '1';
const activePlaylists = new Map();

// youtube mixes and radios have list ids starting with RD.
// lists starting with RDCLAK are youtube music's own playlists, which do end.
function isEndlessPlaylist(urlObj) {
    const list = urlObj.searchParams.get('list') || '';
    return urlObj.searchParams.has('start_radio') || (list.startsWith('RD') && !list.startsWith('RDCLAK'));
}

// private, deleted and live entries can't be downloaded, so they aren't listed.
function mapPlaylistEntry(e) {
    if (!e?.id) return null;
    if (/^\[(private|deleted) video\]$/i.test(e.title || '')) return null;
    if (e.live_status === 'is_live' || e.live_status === 'is_upcoming') return null;
    return {
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title || 'Unknown Title',
        id: e.id,
        uploader: e.uploader || e.channel || null,
        duration: e.duration || null,
    };
}

// stops a spawned process and anything it started.
function killProcessTree(proc) {
    if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true }, () => {});
        return;
    }
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
}

// lists a playlist's videos, reporting progress as yt-dlp reads each page.
// null means the link isn't a playlist, so it gets queued as one video.
ipcMain.handle('playlist-start', async (event, { id, url }) => {
    let urlObj;
    try { urlObj = new URL(url); } catch { return null; }
    if (!urlObj.searchParams.has('list') && !urlObj.searchParams.has('start_radio')) return null;
    if (!(await ensureYtDlpBinary())) return { error: true, message: BINARY_UNAVAILABLE_YTDLP };

    let endless = isEndlessPlaylist(urlObj);
    const args = [
        url,
        '--flat-playlist',
        '--dump-json',
        '--lazy-playlist',
        '--sleep-requests', PLAYLIST_PAGE_SLEEP,
        '--no-warnings',
        '--ignore-config',
        '--no-check-certificates',
    ];
    if (endless) args.push('--playlist-end', String(ENDLESS_PLAYLIST_LIMIT));
    console.log(`[playlist] loading ${url}${endless ? ` (mix, first ${ENDLESS_PLAYLIST_LIMIT} only)` : ''}`);
    const started = Date.now();

    return new Promise((resolve) => {
        const proc = spawn(ytDlpPath, args, { detached: process.platform !== 'win32', windowsHide: true });
        const job = { proc, cancelled: false, capped: false };
        activePlaylists.set(id, job);
        const videos = [];
        let seen = 0;
        let title = null;
        let total = null;
        let buffer = '';
        let stderrTail = '';
        let lastReport = 0;

        // yt-dlp prints one entry per write, so updates are spaced out.
        const report = (force) => {
            const now = Date.now();
            if ((!force && now - lastReport < 150) || event.sender.isDestroyed()) return;
            lastReport = now;
            event.sender.send('playlist-progress', { id, title, found: seen, total: endless ? ENDLESS_PLAYLIST_LIMIT : total, endless });
        };
        // a mix is known from its link, so the loading screen can say so before the first page arrives.
        if (endless) report(true);

        const take = (line) => {
            if (!line.trim() || job.capped) return;
            let entry;
            try { entry = JSON.parse(line); } catch { return; }
            if (seen === 0) {
                title = entry.playlist_title || entry.playlist || null;
                total = entry.playlist_count ?? null;
                console.log(`[playlist] "${title}" lists ${total ?? 'an unknown number of'} item(s), first one after ${Date.now() - started}ms`);
                // a mix the link didn't give away still stops at the limit.
                if (!endless && total == null && /^Mix\b/.test(title || '')) {
                    endless = true;
                    console.log(`[playlist] looks like a mix, stopping at ${ENDLESS_PLAYLIST_LIMIT}`);
                }
            }
            seen++;
            const video = mapPlaylistEntry(entry);
            if (video) videos.push(video);
            if (endless && seen >= ENDLESS_PLAYLIST_LIMIT) {
                job.capped = true;
                killProcessTree(proc);
            }
        };

        proc.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(take);
            report();
        });
        proc.stderr.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-1500);
        });
        proc.on('error', (err) => {
            activePlaylists.delete(id);
            const message = describeBinaryFailure('yt-dlp', err);
            console.error(`[playlist] ${message}`);
            resolve({ error: true, message });
        });
        proc.on('close', (code) => {
            activePlaylists.delete(id);
            if (job.cancelled) {
                console.log(`[playlist] cancelled after ${seen} item(s)`);
                resolve({ cancelled: true });
                return;
            }
            take(buffer);
            const failed = code !== 0 && !job.capped;
            if (failed) {
                const reason = stderrTail.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
                console.error(`[playlist] stopped after ${seen} item(s): ${reason}`);
                if (videos.length === 0) {
                    const detail = reason.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]+:\s+)?/, '');
                    resolve({ error: true, message: `Couldn't load this playlist. ${detail}` });
                    return;
                }
            }
            if (seen === 0) {
                resolve(null);
                return;
            }
            const skipped = seen - videos.length;
            console.log(`[playlist] done: ${videos.length} video(s) in ${((Date.now() - started) / 1000).toFixed(1)}s${skipped ? `, ${skipped} private, deleted or live skipped` : ''}`);
            resolve({
                title: title || (endless ? 'Mix' : 'Playlist'),
                videos,
                total,
                isRadio: endless,
                truncated: job.capped || failed,
            });
        });
    });
});

ipcMain.handle('playlist-cancel', (_event, id) => {
    const job = activePlaylists.get(id);
    if (!job) return;
    job.cancelled = true;
    killProcessTree(job.proc);
});

ipcMain.handle('open-downloads-folder', async (_event, folderPath) => {
    shell.openPath(folderPath || app.getPath('downloads'));
});

ipcMain.handle('select-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Choose Download Location',
    });
    return result.canceled ? null : result.filePaths[0];
});

// search streams results to the renderer as yt-dlp prints them, one page per call.
const SEARCH_PAGE_SIZE = 20;
const activeSearches = new Map();

function searchTarget(tab, query, end) {
    const q = encodeURIComponent(query);
    if (tab === 'music') return `https://music.youtube.com/search?q=${q}#songs`;
    if (tab === 'playlists') return `https://www.youtube.com/results?search_query=${q}&sp=EgIQAw%3D%3D`;
    return `ytsearch${end}:${query}`;
}

// the small thumbnail, since results only show it small and yt-dlp lists the large one.
function smallThumbnail(videoId) {
    return videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
}

function mapSearchEntry(tab, e) {
    if (!e?.id || !e.url) return null;
    if (tab === 'playlists') {
        // the playlist filter still mixes in channels.
        if (!/[?&]list=/.test(e.url)) return null;
        const listed = e.thumbnails?.length ? e.thumbnails[e.thumbnails.length - 1].url : null;
        const thumbnail = smallThumbnail(listed?.match(/\/vi\/([\w-]{11})\//)?.[1]) || listed;
        return { kind: 'playlist', url: e.url, title: e.title || 'Untitled playlist', channel: e.channel || e.uploader || null, thumbnail };
    }
    // a live stream would record until stopped, so it isn't offered.
    if (e.live_status === 'is_live' || e.live_status === 'is_upcoming') return null;
    return {
        kind: 'video',
        url: e.url,
        title: e.title || 'Unknown Title',
        channel: e.channel || e.uploader || null,
        duration: e.duration || null,
        views: e.view_count ?? null,
        thumbnail: smallThumbnail(e.id),
    };
}

function stopSearch(id) {
    const proc = activeSearches.get(id);
    if (!proc) return;
    activeSearches.delete(id);
    killProcessTree(proc);
}

ipcMain.handle('search-start', async (event, { id, query, tab, start = 0 }) => {
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) return { error: 'Type something to search for.' };
    if (!(await ensureYtDlpBinary())) return { error: BINARY_UNAVAILABLE_YTDLP };

    const end = start + SEARCH_PAGE_SIZE;
    const args = [
        searchTarget(tab, text, end),
        '--flat-playlist',
        '--dump-json',
        '--lazy-playlist',
        '--playlist-start', String(start + 1),
        '--playlist-end', String(end),
        '--no-warnings',
        '--ignore-config',
        '--no-check-certificates',
    ];
    console.log(`[search] ${tab} "${text}" ${start + 1}-${end}`);

    return new Promise((resolve) => {
        const proc = spawn(ytDlpPath, args, { detached: process.platform !== 'win32', windowsHide: true });
        activeSearches.set(id, proc);
        let buffer = '';
        let raw = 0;
        let shown = 0;
        let stderrTail = '';

        const emit = (lines) => {
            const results = [];
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    raw++;
                    const result = mapSearchEntry(tab, JSON.parse(line));
                    if (result) results.push(result);
                } catch { /* a partial or non-json line */ }
            }
            shown += results.length;
            if (results.length && !event.sender.isDestroyed()) event.sender.send('search-results', { id, results });
        };

        proc.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            emit(lines);
        });
        proc.stderr.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-1500);
        });
        proc.on('error', (err) => {
            activeSearches.delete(id);
            resolve({ error: describeBinaryFailure('yt-dlp', err) });
        });
        proc.on('close', (code, signal) => {
            const cancelled = !activeSearches.has(id);
            activeSearches.delete(id);
            if (cancelled || signal) {
                resolve({ cancelled: true });
                return;
            }
            emit([buffer]);
            console.log(`[search] ${tab} "${text}" done: ${shown} shown of ${raw}`);
            if (code !== 0 && raw === 0) {
                const reason = stderrTail.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
                console.error(`[search] failed: ${reason}`);
                resolve({ error: 'Search failed. Check your connection and try again.' });
                return;
            }
            resolve({ raw, shown, more: raw >= SEARCH_PAGE_SIZE });
        });
    });
});

ipcMain.handle('search-cancel', (_event, id) => stopSearch(id));

// several folders can be picked at once.
ipcMain.handle('select-music-folders', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'multiSelections'],
        title: 'Add Music Folders',
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('open-folder', (_event, folderPath) => shell.openPath(folderPath));

// characters no folder name can hold on windows, which is the strictest of the three.
const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/;

// renames a music folder on disk, and moves its cached cover along with it.
ipcMain.handle('rename-folder', async (_event, folderPath, newName) => {
    const name = typeof newName === 'string' ? newName.trim() : '';
    if (!name || name === '.' || name === '..' || INVALID_NAME.test(name) || /[. ]$/.test(name)) {
        return { error: 'Folder names can\'t be empty, end in a dot or space, or use < > : " / \\ | ? *' };
    }
    const target = path.join(path.dirname(folderPath), name);
    if (target === folderPath) return { path: folderPath };
    // a change of capitals only is the same folder on macos and windows, so it goes through a temporary name.
    const caseOnly = target.toLowerCase() === folderPath.toLowerCase();
    try {
        if (!caseOnly && fs.existsSync(target)) return { error: `There's already a folder called "${name}" next to it.` };
        if (caseOnly) {
            const step = `${folderPath}.renaming-${process.pid}`;
            await fs.promises.rename(folderPath, step);
            await fs.promises.rename(step, target);
        } else {
            await fs.promises.rename(folderPath, target);
        }
    } catch (err) {
        console.error(`[library] couldn't rename ${folderPath}: ${err.message}`);
        if (err.code === 'ENOENT') return { error: "Downstream can't find this folder anymore." };
        if (err.code === 'EBUSY' || (process.platform === 'win32' && err.code === 'EPERM')) {
            return { error: 'Something is using a file in this folder, so it can\'t be renamed right now. If it\'s playing, switch to another folder and try again.' };
        }
        if (err.code === 'EACCES' || err.code === 'EPERM') return { error: "You don't have permission to rename this folder." };
        return { error: `Couldn't rename the folder: ${err.message}` };
    }
    for (const suffix of ['', '.none']) {
        try { fs.renameSync(coverCachePath(folderPath) + suffix, coverCachePath(target) + suffix); } catch { /* no cover cached */ }
    }
    console.log(`[library] renamed ${path.basename(folderPath)} to ${name}`);
    return { path: target };
});

function musicPattern(extensions) {
    const exts = (extensions && extensions.length > 0) ? extensions : ['mp3', 'flac', 'wav'];
    return new RegExp(`\\.(${exts.join('|')})$`, 'i');
}

// how many playable files each saved folder has, without reading each file's details.
// null marks a folder that's gone or unreadable.
ipcMain.handle('scan-music-folders', async (_event, folderPaths, extensions) => {
    const pattern = musicPattern(extensions);
    const counts = {};
    for (const folderPath of folderPaths) {
        try {
            const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
            counts[folderPath] = entries.filter((e) => e.isFile() && pattern.test(e.name)).length;
        } catch {
            counts[folderPath] = null;
        }
    }
    return counts;
});

// folder covers are small copies of a track's album art, kept on disk so the folder screen opens instantly.
const COVER_SIZE = 120;
// how many tracks are tried for art before a folder is treated as having none.
const COVER_TRIES = 6;

function coverCachePath(folderPath) {
    const id = require('crypto').createHash('sha1').update(folderPath).digest('hex');
    return path.join(app.getPath('userData'), 'covers', `${id}.jpg`);
}

function extractCover(source, target) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, [
            '-v', 'error', '-y',
            '-i', source,
            '-an', '-map', '0:v:0',
            '-vf', `scale=${COVER_SIZE}:${COVER_SIZE}:force_original_aspect_ratio=increase,crop=${COVER_SIZE}:${COVER_SIZE}`,
            '-frames:v', '1', '-q:v', '4',
            target,
        ], { windowsHide: true });
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 10000);
        proc.on('error', () => { clearTimeout(timer); resolve(false); });
        proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && fs.existsSync(target)); });
    });
}

const coverDataUrl = (file) => `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;

// a folder with no art gets a marker file, so it isn't searched again on every visit.
ipcMain.handle('get-folder-cover', async (_event, folderPath, extensions, refresh) => {
    const file = coverCachePath(folderPath);
    const none = `${file}.none`;
    if (!refresh) {
        if (fs.existsSync(file)) return coverDataUrl(file);
        if (fs.existsSync(none)) return null;
    }
    if (!(await ensureFfmpegBinary())) return null;
    let names;
    try {
        const pattern = musicPattern(extensions);
        names = (await fs.promises.readdir(folderPath)).filter((n) => pattern.test(n)).sort().slice(0, COVER_TRIES);
    } catch {
        return null;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const name of names) {
        if (await extractCover(path.join(folderPath, name), file)) {
            fs.rmSync(none, { force: true });
            console.log(`[library] cover for ${path.basename(folderPath)} from ${name}`);
            return coverDataUrl(file);
        }
    }
    fs.rmSync(file, { force: true });
    // an empty folder is checked again next time, since music may be added to it.
    if (names.length > 0) {
        fs.writeFileSync(none, '');
        console.log(`[library] no album art in the first ${names.length} track(s) of ${path.basename(folderPath)}`);
    }
    return null;
});

ipcMain.handle('read-music-folder', async (_event, folderPath, extensions) => {
    try {
        const pattern = musicPattern(extensions);
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const audioFiles = entries
            .filter((e) => e.isFile() && pattern.test(e.name))
            .map((e) => {
                const fullPath = path.join(folderPath, e.name);
                // size and mtime identify the file for the renderer's loudness cache, so a replaced or re-downloaded file re-measures itself.
                let size = 0;
                let mtime = 0;
                try {
                    const st = fs.statSync(fullPath);
                    size = st.size;
                    mtime = Math.floor(st.mtimeMs);
                } catch { /* stat failure, cache simply won't validate */ }
                return {
                    name: e.name.replace(pattern, ''),
                    path: fullPath,
                    size,
                    mtime,
                };
            });
        console.log(`[library] read ${audioFiles.length} track(s) from ${folderPath}`);
        return audioFiles;
    } catch (err) {
        console.error(`[library] failed reading ${folderPath}: ${err.message}`);
        return [];
    }
});

ipcMain.handle('get-album-art', async (_event, filePath) => {
    if (!(await ensureFfmpegBinary())) return null;
    try {
        return await new Promise((resolve, reject) => {
            const proc = spawn(ffmpegPath, [
                '-i', filePath,
                '-an',
                '-vcodec', 'copy',
                '-f', 'image2pipe',
                'pipe:1',
            ]);
            const chunks = [];
            proc.stdout.on('data', (chunk) => chunks.push(chunk));
            proc.on('error', (e) => {
                console.error(`[albumart] ${describeBinaryFailure('ffmpeg', e)}`);
                reject(e);
            });
            proc.on('close', (code) => {
                if (code !== 0 || chunks.length === 0) {
                    resolve(null);
                    return;
                }
                const buf = Buffer.concat(chunks);
                const b64 = buf.toString('base64');
                const magic = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
                resolve(`data:${magic};base64,${b64}`);
            });
        });
    } catch {
        return null;
    }
});

// loudness measurement (contextual normalization).
// only one ffmpeg scan runs at a time, requests chain onto this promise so overlapping renderer calls can't double-spawn.
// ffmpeg is fragile under parallel spawns on weak machines, and the design is serial anyway.
let loudnessChain = Promise.resolve();
let loudnessProc = null;

function runLoudnessScan(filePath) {
    return new Promise((resolve) => {
        // -vn/-sn/-dn matter for .mp4, since without them ffmpeg decodes the video stream into the null sink too, wasting most of the cpu.
        const args = [
            '-hide_banner', '-nostats',
            '-i', filePath,
            '-vn', '-sn', '-dn',
            '-af', 'loudnorm=I=-14:TP=-1:print_format=json',
            '-f', 'null', '-',
        ];
        let stderrTail = '';
        let settled = false;
        let timer = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            loudnessProc = null;
            resolve(result);
        };
        const proc = spawn(ffmpegPath, args);
        loudnessProc = proc;
        // a healthy audio-only scan finishes in seconds.
        // past 3 minutes it's wedged on a corrupt file, so kill it and cache the failure.
        timer = setTimeout(() => {
            console.warn(`[loudness] timeout scanning ${path.basename(filePath)} — killing ffmpeg`);
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            finish(null);
        }, 180000);
        proc.stderr.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-4000);
        });
        proc.on('error', (e) => {
            console.error(`[loudness] ${describeBinaryFailure('ffmpeg', e)}`);
            finish(null);
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                console.warn(`[loudness] ffmpeg exited ${code} for ${path.basename(filePath)}`);
                finish(null);
                return;
            }
            // loudnorm prints its summary as the last {...} JSON block on stderr.
            const start = stderrTail.lastIndexOf('{');
            const end = stderrTail.lastIndexOf('}');
            if (start === -1 || end <= start) {
                finish(null);
                return;
            }
            try {
                const info = JSON.parse(stderrTail.slice(start, end + 1));
                const lufs = parseFloat(info.input_i);
                const truePeak = parseFloat(info.input_tp);
                const lra = parseFloat(info.input_lra);
                if (!Number.isFinite(lufs) || !Number.isFinite(truePeak)) {
                    // "-inf" (pure silence) and other unusables land here.
                    finish(null);
                    return;
                }
                console.log(`[loudness] ${path.basename(filePath)}: ${lufs} LUFS, TP ${truePeak} dBTP`);
                finish({ lufs, truePeak, lra: Number.isFinite(lra) ? lra : null });
            } catch {
                finish(null);
            }
        });
    });
}

ipcMain.handle('measure-loudness', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return null;
    const run = loudnessChain.then(async () => {
        if (!fs.existsSync(filePath)) return null;
        if (!(await ensureFfmpegBinary())) return null;
        return runLoudnessScan(filePath);
    });
    loudnessChain = run.catch(() => {}); // keep the chain alive across failures
    return run;
});

app.on('will-quit', () => {
    try { loudnessProc?.kill('SIGKILL'); } catch { /* ignore */ }
});

ipcMain.handle('check-version', async () => {
    try {
        const appVersion = app.getVersion();
        const res = await net.fetch('https://raw.githubusercontent.com/StrataBytes/Downstream/refs/heads/main/versionctrl.json');
        const data = await res.json();
        const entry = data.Versions?.[appVersion];
        console.log(`[update] ${appVersion} is ${!entry ? 'not in the version list' : entry.IsTargetOutdated ? 'outdated' : 'current'}`);
        if (!entry) return { appVersion, status: 'unknown' };
        return {
            appVersion,
            outdated: entry.IsTargetOutdated,
            message: entry.OutdatedMessage,
            knownIssues: (entry.KnownIssues || []).filter((s) => s),
            updateUrl: entry.updateButtonUrl,
        };
    } catch (err) {
        console.error('Version check failed:', err.message);
        return { appVersion: app.getVersion(), status: 'error' };
    }
});

ipcMain.handle('check-ffmpeg', async () => {
    return ensureFfmpegBinary();
});

ipcMain.handle('check-ytdlp', async () => {
    return ensureYtDlpBinary();
});

ipcMain.handle('get-ytdlp-info', async () => {
    try {
        return await getYtDlpInfo();
    } catch (err) {
        console.error('[yt-dlp] could not read active version:', err.message);
        return { error: err.message };
    }
});

ipcMain.handle('get-ytdlp-versions', async () => {
    try {
        return { versions: await getYtDlpAvailableVersions() };
    } catch (err) {
        console.error('[yt-dlp] could not fetch available versions:', err.message);
        return { error: err.message, versions: [] };
    }
});

ipcMain.handle('set-ytdlp-version', async (_event, target) => {
    try {
        return await setYtDlpVersionOverride(target);
    } catch (err) {
        console.error('[yt-dlp] version change failed:', err.message);
        return { error: err.message };
    }
});

ipcMain.handle('check-ytdlp-update', async () => {
    try {
        await updateManagedYtDlp();
        return await getYtDlpInfo();
    } catch (err) {
        console.error('[yt-dlp] update check failed:', err.message);
        return { error: err.message };
    }
});

ipcMain.handle('repair-ytdlp', async () => {
    try {
        const info = await repairYtDlp();
        console.log(`[yt-dlp] repaired, now ${info.version}`);
        return info;
    } catch (err) {
        console.error('[yt-dlp] repair failed:', err.message);
        return { error: err.message };
    }
});

// settings the main process needs before any window exists.
function appSettingsPath() {
    return path.join(app.getPath('userData'), 'app-settings.json');
}

function readAppSettings() {
    try {
        return JSON.parse(fs.readFileSync(appSettingsPath(), 'utf8')) || {};
    } catch {
        return {};
    }
}

function writeAppSettings(settings) {
    fs.mkdirSync(path.dirname(appSettingsPath()), { recursive: true });
    fs.writeFileSync(appSettingsPath(), JSON.stringify(settings, null, 2));
}

// each saved setting next to the one in effect, which differ until the next restart.
async function appSettingsInfo() {
    const saved = readAppSettings();
    const gpus = process.platform === 'darwin' ? (await app.getGPUInfo('basic').catch(() => ({}))).gpuDevice?.length || 0 : 0;
    return {
        hardwareAcceleration: !saved.disableHardwareAcceleration,
        hardwareAccelerationActive: !hardwareAccelerationDisabled,
        // only macs with two gpus have a choice to make.
        hasDedicatedGpu: gpus > 1,
        dedicatedGpu: !saved.preferIntegratedGpu,
        dedicatedGpuActive: dedicatedGpuRequested,
    };
}

ipcMain.handle('get-app-settings', () => appSettingsInfo());

ipcMain.handle('set-hardware-acceleration', (_event, on) => {
    writeAppSettings({ ...readAppSettings(), disableHardwareAcceleration: !on });
    console.log(`[settings] hardware acceleration ${on ? 'on' : 'off'} after the next restart`);
    return appSettingsInfo();
});

ipcMain.handle('set-dedicated-gpu', (_event, on) => {
    writeAppSettings({ ...readAppSettings(), preferIntegratedGpu: !on });
    console.log(`[settings] ${on ? 'dedicated' : 'integrated'} gpu after the next restart`);
    return appSettingsInfo();
});

ipcMain.handle('reset-app-settings', () => {
    fs.rmSync(appSettingsPath(), { force: true });
    console.log('[settings] app settings reset');
});

ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
});

ipcMain.handle('open-app-data', () => shell.openPath(app.getPath('userData')));

function folderSize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += folderSize(full);
        else total += fs.lstatSync(full).size;
    }
    return total;
}

// the single-file yt-dlp unpacks into a temp _MEI folder and leaves it behind when it's stopped mid-run.
// only folders with yt-dlp's own libraries, and too old to still be running, are removed.
function cleanYtDlpTempFolders() {
    if (ytDlpBusy()) throw new Error('Wait for downloads and searches to finish first.');
    const tmp = os.tmpdir();
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    let removed = 0;
    let freed = 0;
    for (const name of fs.readdirSync(tmp)) {
        if (!name.startsWith('_MEI')) continue;
        const dir = path.join(tmp, name);
        try {
            const stat = fs.statSync(dir);
            if (!stat.isDirectory() || stat.mtimeMs > cutoff) continue;
            const entries = new Set(fs.readdirSync(dir));
            const isYtDlp = entries.has('yt_dlp_ejs') || (entries.has('curl_cffi') && entries.has('Cryptodome'));
            if (!isYtDlp) continue;
            const size = folderSize(dir);
            fs.rmSync(dir, { recursive: true, force: true });
            removed++;
            freed += size;
        } catch { /* in use or already gone */ }
    }
    console.log(`[cleanup] removed ${removed} temp folder(s), ${Math.round(freed / 1048576)} MB`);
    return { removed, freed };
}

ipcMain.handle('clean-temp-files', () => {
    try {
        return cleanYtDlpTempFolders();
    } catch (err) {
        return { error: err.message };
    }
});

// reaches youtube itself, since a network adapter can be up with no internet behind it.
ipcMain.handle('check-network', async () => {
    try {
        const res = await net.fetch('https://www.youtube.com/generate_204', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        console.log(`[network] youtube answered ${res.status}`);
        return res.status < 500;
    } catch (err) {
        console.warn(`[network] youtube unreachable: ${err.message}`);
        return false;
    }
});

// runs a binary once, so startup knows it actually works.
// on macos the first run of a new install is also when it gets scanned, so that happens during startup.
// a run that outlasts the timeout is still counted as working, so a slow scan can't hold startup forever.
function verifyRuns(file, args) {
    return new Promise((resolve) => {
        const started = Date.now();
        const name = path.basename(file);
        execFile(file, args, { timeout: 20000, windowsHide: true }, (err, stdout) => {
            const took = `${Date.now() - started}ms`;
            if (!err) {
                console.log(`[startup] ${name} runs (${stdout.split('\n')[0].trim()}, ${took})`);
                resolve({ ok: true });
            } else if (err.killed) {
                console.warn(`[startup] ${name} still hadn't answered after ${took}, carrying on`);
                resolve({ ok: true, slow: true });
            } else {
                const error = describeBinaryFailure(name, err);
                console.error(`[startup] ${error}`);
                resolve({ ok: false, error });
            }
        });
    });
}

ipcMain.handle('verify-ffmpeg', async () => {
    if (!(await ensureFfmpegBinary())) return { ok: false };
    return verifyRuns(ffmpegPath, ['-version']);
});

ipcMain.handle('verify-ytdlp', async () => {
    if (!(await ensureYtDlpBinary())) return { ok: false };
    return verifyRuns(ytDlpPath, ['--version']);
});

ipcMain.handle('detect-render-tier', async () => {
    try {
        const tier = await platform.detectRenderTier();
        console.log(`[render] first launch tier: ${tier.profile} (${tier.reason})`);
        return tier;
    } catch (err) {
        console.error('Render tier detection failed:', err.message);
        return { profile: 'standard', reason: 'detection-error' };
    }
});

ipcMain.handle('open-external-url', async (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
    }
});

// toggled by the debugging outlog when it opens or closes.
// while off, main-process console output isn't forwarded to the renderer at all.
ipcMain.on('set-debug-capture', (_event, on) => {
    const starting = !!on && !debugForwardEnabled;
    debugForwardEnabled = !!on;
    if (starting) logEnvironment();
});

// the setup a bug report needs, printed whenever the outlog starts capturing.
async function logEnvironment() {
    const cpus = os.cpus();
    console.log(`[env] Downstream ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}, ${process.platform} ${process.getSystemVersion()} ${process.arch}`);
    console.log(`[env] electron ${process.versions.electron}, chrome ${process.versions.chrome}, node ${process.versions.node}`);
    console.log(`[env] ${cpus[0]?.model?.trim() || 'unknown cpu'}, ${cpus.length} cores, ${Math.round(os.totalmem() / 1073741824)}GB memory, hardware acceleration ${hardwareAccelerationDisabled ? 'off' : 'on'}`);
    const gpu = await app.getGPUInfo('complete').catch(() => null);
    const gpuCount = gpu?.gpuDevice?.length || 0;
    console.log(`[env] drawing with ${gpu?.auxAttributes?.glRenderer || 'an unknown gpu'}${gpuCount > 1 ? `, ${gpuCount} gpus, ${dedicatedGpuRequested ? 'dedicated' : 'integrated'} requested` : ''}`);
    console.log(`[env] ffmpeg at ${ffmpegPath}`);
    const { state, checkedAt, error } = ytDlpUpdateStatus;
    const update = state === 'updating' ? 'updating now' : checkedAt ? `update checked at ${new Date(checkedAt).toLocaleTimeString()}` : 'update not checked yet';
    console.log(`[env] yt-dlp at ${ytDlpPath}${ytDlpPath === bundledYtDlpPath ? ' (bundled copy)' : ''}, ${update}${error ? `, last update failed: ${error}` : ''}`);
    try {
        console.log(`[env] yt-dlp version ${await getManagedYtDlpVersion()} (${ytDlpUpdateTarget})`);
    } catch (err) {
        console.error(`[env] yt-dlp won't run: ${err.message}`);
    }
}

process.on('uncaughtException', (error) => {
    if (error.message.includes('spawn UNKNOWN') || error.message.includes('spawn EACCES')) {
        console.warn('Suppressed spawn error:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandled rejection:', reason);
});
