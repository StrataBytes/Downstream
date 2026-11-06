const { app, BrowserWindow, Menu, ipcMain, shell, dialog, protocol, net, powerMonitor, screen } = require('electron');
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
        if (__DOWNSTREAM_LEGACY__) return path.join(__dirname, '..', '..', 'build', 'legacy', 'yt-dlp_macos', 'yt-dlp_macos');
        return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp_macos', 'yt-dlp_macos');
    },
    // the legacy build's own python, which runs yt-dlp there (see ytDlpMacos.js).
    getPythonPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'python', 'bin', 'python3');
        return path.join(__dirname, '..', '..', 'build', 'legacy', 'python', 'bin', 'python3');
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

const linux = {
    handleSquirrelStartup() { return false; },
    getFFmpegPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg');
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
    },
    getFFmpegDir() {
        if (app.isPackaged) return process.resourcesPath;
        return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static');
    },
    // the official self-contained build, with its own python, so it doesn't depend on the system's.
    getYtDlpPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp_linux');
        return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp_linux');
    },
    getIconPath() {
        if (app.isPackaged) return path.join(process.resourcesPath, '512.png');
        return path.join(__dirname, '..', '..', 'assets', 'icons', 'png', '512.png');
    },
    // the same hardware cascade as windows, since a linux pc can be anything.
    detectRenderTier() {
        return win32.detectRenderTier();
    },
    attachTouchBar() {},
};

const platform = { darwin, linux }[process.platform] || win32;

if (platform.handleSquirrelStartup()) {
    // squirrel handled the event, app is quitting.
}

const fs = require('fs');
const ytdl = require('ytdl-core');

const ffmpegPath = platform.getFFmpegPath();
const ffmpegDir = platform.getFFmpegDir();
const bundledYtDlpPath = platform.getYtDlpPath();
// every yt-dlp the legacy build runs, bundled or updated, finds its python here.
if (__DOWNSTREAM_LEGACY__) process.env.DOWNSTREAM_PYTHON = platform.getPythonPath();
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

if (process.platform !== 'win32') {
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
        legacy: __DOWNSTREAM_LEGACY__,
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

// the smallest window the layout is built for, at 100%.
// a bigger interface size raises the window's smallest size to match, so the layout always has at least this much room and nothing squeezes.
const MIN_WIDTH = 900;
const MIN_HEIGHT = 500;
const INTERFACE_SIZES = [0.9, 1, 1.1, 1.25];

function savedInterfaceSize() {
    const size = Number(readAppSettings().interfaceSize);
    return INTERFACE_SIZES.includes(size) ? size : 1;
}

// the sizes the window's screen has room for at their smallest window.
function fittingInterfaceSizes(win) {
    const { width, height } = screen.getDisplayMatching(win.getBounds()).workAreaSize;
    return INTERFACE_SIZES.filter((size) => MIN_WIDTH * size <= width && MIN_HEIGHT * size <= height);
}

function applyInterfaceSize(win, size) {
    win.webContents.setZoomFactor(size);
    const minWidth = Math.round(MIN_WIDTH * size);
    const minHeight = Math.round(MIN_HEIGHT * size);
    win.setMinimumSize(minWidth, minHeight);
    const [width, height] = win.getSize();
    if (width < minWidth || height < minHeight) win.setSize(Math.max(width, minWidth), Math.max(height, minHeight));
}

ipcMain.handle('get-interface-size', () => ({
    size: savedInterfaceSize(),
    sizes: INTERFACE_SIZES,
    fitting: mainWindow ? fittingInterfaceSizes(mainWindow) : INTERFACE_SIZES,
}));

ipcMain.handle('set-interface-size', (_event, size) => {
    if (!INTERFACE_SIZES.includes(size) || !mainWindow) return { error: 'That size isn\'t available.' };
    if (!fittingInterfaceSizes(mainWindow).includes(size)) return { error: 'This screen is too small for that size.' };
    writeAppSettings({ ...readAppSettings(), interfaceSize: size });
    applyInterfaceSize(mainWindow, size);
    console.log(`[app] interface size ${Math.round(size * 100)}%`);
    return { size };
});

function createWindow() {
    const size = savedInterfaceSize();
    const { workAreaSize } = screen.getPrimaryDisplay();
    mainWindow = new BrowserWindow({
        width: Math.min(Math.round(1200 * size), workAreaSize.width),
        height: Math.min(Math.round(750 * size), workAreaSize.height),
        minWidth: Math.round(MIN_WIDTH * size),
        minHeight: Math.round(MIN_HEIGHT * size),
        icon: platform.getIconPath(),
        backgroundColor: '#0f1923',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            zoomFactor: size,
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
        // downstream for legacy macos says so in its about panel too.
        if (__DOWNSTREAM_LEGACY__) {
            app.setAboutPanelOptions({
                applicationVersion: `${app.getVersion()} for legacy macOS`,
                version: '',
                credits: 'Built for macOS 10.13 and 10.14. Downstream for newer macOS can be a version ahead.',
            });
        }
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

// linux-only: the same idea for the desktop's keyring, which can otherwise ask to be unlocked or set up on launch.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('password-store', 'basic');
}

// chromium only applies this before the window exists, so changes take effect after a restart.
const hardwareAccelerationDisabled = !!readAppSettings().disableHardwareAcceleration;
if (hardwareAccelerationDisabled) app.disableHardwareAcceleration();

// macos-only: on macs with both an integrated and a dedicated gpu, chromium draws on the integrated one, which the blur effects overwhelm.
// asking for the high performance gpu moves macos onto the dedicated one while downstream runs, and back once it quits.
// macs with one gpu are unaffected, and like hardware acceleration this only applies at startup.
const dedicatedGpuRequested = process.platform === 'darwin' && !readAppSettings().preferIntegratedGpu;
if (dedicatedGpuRequested) app.commandLine.appendSwitch('force_high_performance_gpu');

// macos and linux: web audio's spec-mandated behavior for a cors-cross-origin media source is to silently output zeros from createMediaElementSource, with no thrown error.
// a response header alone (access-control-allow-origin) isn't sufficient if the scheme itself isn't registered as standard, secure, and corsEnabled before app.whenReady(), since that registration determines how chromium classifies the scheme's origin.
// windows doesn't need this, so its privileges and media:///<path> url format are left untouched here.
protocol.registerSchemesAsPrivileged([
    process.platform !== 'win32'
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

    removeLeftoverWorkDirs();
    purgeExpiredDeleted();

    // sleep can cut a download off mid-transfer.
    powerMonitor.on('suspend', () => console.log(`[app] system going to sleep${activeDownload ? ' during a download' : ''}`));
    powerMonitor.on('resume', () => console.log('[app] system woke up'));

    // tracks which media paths have already been logged so streaming (many range requests per file) doesn't flood the outlog.
    const seenMediaPaths = new Set();

    protocol.handle('media', (request) => {
        // "standard" schemes (macos and linux) parse with a real authority component, so the renderer sends media://local/<encoded-path> and the actual path lives in the url's pathname.
        // windows keeps the original media:///<encoded-path> (empty-host) format and parsing untouched.
        let filePath = process.platform !== 'win32'
            ? decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
            : decodeURIComponent(request.url.slice('media:///'.length));
        // a song whose folder moved while it played is found at the folder's new place.
        if (!fs.existsSync(filePath)) filePath = movedFile(filePath) || filePath;
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

// the tallest video each quality allows, with highest left uncapped.
const QUALITY_HEIGHT = { uhd: 2160, qhd: 1440, high: 1080, medium: 720, low: 480 };

function getFormatString(quality, format) {
    if (format === 'mp3') {
        return 'bestaudio/best';
    }

    const height = QUALITY_HEIGHT[quality];
    const cap = height ? `[height<=${height}]` : '';

    // the legacy build favors h.264 with aac, which older macs play smoothly and quicktime opens.
    // youtube's best 1080p is often av1, which keeps a core 2 duo busy on both cores and still drops frames.
    // youtube has no h.264 above 1080p, so 2k, 4k and highest skip the preference rather than quietly coming back as 1080p.
    if (__DOWNSTREAM_LEGACY__ && height && height <= 1080) {
        return `bestvideo[vcodec^=avc]${cap}+bestaudio[ext=m4a]/bestvideo${cap}+bestaudio/best${cap}/best`;
    }

    // no codec constraint, letting yt-dlp pick vp9/av1/h.264 freely and relying on ffmpeg (via mergeOutputFormat) to produce the mp4 container.
    // locking to [vcodec^=avc] caused sub-hd output, since youtube serves 1080p+ primarily in vp9/av1 and the best h.264 stream is often only 720p.
    return cap ? `bestvideo${cap}+bestaudio/best${cap}/best` : 'bestvideo+bestaudio/best';
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

// each download's own working folder, under the system's temp folder.
const WORK_DIR_PREFIX = 'downstream-download-';

// working folders left by a download that was running when downstream quit or crashed.
function removeLeftoverWorkDirs() {
    const tmp = os.tmpdir();
    let removed = 0;
    try {
        for (const name of fs.readdirSync(tmp)) {
            if (!name.startsWith(WORK_DIR_PREFIX)) continue;
            fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
            removed++;
        }
    } catch { /* the temp folder couldn't be read */ }
    if (removed) console.log(`[download] removed ${removed} unfinished download folder(s)`);
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
    // yt-dlp works in a folder of its own and only moves the finished file into place.
    // the pieces it makes along the way, like .part, .f248.webm or a half converted mp3, never land where music is played from, even when a download is stopped.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), WORK_DIR_PREFIX));

    // builds cli args directly so spawn() gives real-time stdout/stderr streams.
    // yt-dlp-exec (execa) buffers output internally and doesn't emit data events until the process exits, which makes progress tracking impossible through it.
    const args = [
        cleanUrl,
        '-P', `home:${outputDir}`,
        '-P', `temp:${workDir}`,
        '-o', '%(title)s.%(ext)s',
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
    // a live stream would record until stopped, so yt-dlp skips it, even when its title hadn't loaded yet to warn about it.
    args.push('--match-filters', '!is_live');

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
        const outcome = await withRetry(async () => {
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
                let skippedLive = false;
                proc.stdout.on('data', (chunk) => {
                    parseProgress(chunk);
                    forwardYtDlpOutput(chunk);
                    if (chunk.toString().includes('does not pass filter')) skippedLive = true;
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
                    if (code === 0) resolve(skippedLive ? 'live' : 'done');
                    else {
                        const tail = stderrTail.trim();
                        console.error(`[download] yt-dlp exited ${code}${tail ? ': ' + tail.split('\n').slice(-3).join(' | ') : ''}`);
                        reject(RATE_LIMIT_PATTERN.test(tail) ? rateLimitedError() : new Error(`yt-dlp exited with code ${code}`));
                    }
                });
            });
        }, 3, 3000);

        if (outcome === 'live') {
            console.log(`[download] skipped ${cleanUrl}, it's a live stream`);
            return { success: false, live: true };
        }
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
    } finally {
        // a stopped ffmpeg can hold its file for a moment, so removing it tries again.
        fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }).catch(() => {});
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
            live: info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming',
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

// yt-dlp leaves out song durations and artists and playlist sizes, though youtube sends them with the results.
// music and playlist searches keep the pages yt-dlp downloads anyway, and these are read from them with no extra requests.
// a page youtube has reshaped only leaves them out again.
const CLOCK_TIME = /^\d{1,2}(:\d{2}){1,2}$/;
const ITEM_COUNT = /^([\d,]+) (videos?|episodes?|songs?|tracks?)$/;

function clockSeconds(text) {
    return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function findText(node, test) {
    if (typeof node === 'string') return test.test(node) ? node : null;
    if (!node || typeof node !== 'object') return null;
    for (const value of Object.values(node)) {
        const found = findText(value, test);
        if (found) return found;
    }
    return null;
}

function collectSearchExtras(node, extras) {
    if (!node || typeof node !== 'object') return;
    const song = node.musicResponsiveListItemRenderer;
    const id = song?.playlistItemData?.videoId;
    if (id) {
        // the second line reads artist, album and duration, split by bullets.
        const line = (song.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map((r) => r.text).join('').split(' • ');
        const time = line.findLast((part) => CLOCK_TIME.test(part));
        const plays = song.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
        extras.set(id, { channel: line[0] || null, duration: time ? clockSeconds(time) : null, plays: plays || null });
    }
    const lockup = node.lockupViewModel;
    if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' && lockup.contentId) {
        const count = findText(lockup.contentImage, ITEM_COUNT)?.match(ITEM_COUNT)[1];
        const owner = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0];
        const isChannel = owner?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.webPageType === 'WEB_PAGE_TYPE_CHANNEL';
        extras.set(lockup.contentId, { count: count ? Number(count.replace(/,/g, '')) : null, channel: isChannel ? owner.text.content : null });
    }
    for (const value of Object.values(node)) collectSearchExtras(value, extras);
}

// api pages are plain json, and a full web page carries its results as ytInitialData.
function readSavedPage(file) {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trimStart().startsWith('{')) return JSON.parse(raw);
    const start = raw.indexOf('var ytInitialData = ');
    const end = raw.indexOf(';</script>', start);
    return start === -1 || end === -1 ? null : JSON.parse(raw.slice(start + 20, end));
}

// pages are read once each, as the results that need them arrive.
// one that's still being written fails to parse, so it's tried again later.
function savedPageReader(dir) {
    const read = new Set();
    const extras = new Map();
    return (id) => {
        if (!extras.has(id)) {
            for (const name of fs.readdirSync(dir)) {
                if (read.has(name)) continue;
                try {
                    collectSearchExtras(readSavedPage(path.join(dir, name)), extras);
                    read.add(name);
                } catch { /* tried again with the next result */ }
            }
        }
        return extras.get(id);
    };
}

// pages from searches still running, removed if downstream quits first.
const searchPageDirs = new Set();

function withExtras(result, extras) {
    if (!extras) return result;
    if (result.kind === 'playlist') return { ...result, count: extras.count, channel: result.channel || extras.channel };
    return { ...result, channel: result.channel || extras.channel, duration: result.duration || extras.duration, plays: extras.plays };
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
    // general results already come with everything shown.
    let pagesDir = null;
    if (tab !== 'general') {
        try {
            pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'downstream-search-'));
            searchPageDirs.add(pagesDir);
            args.push('--write-pages');
        } catch { /* results show without the extras */ }
    }
    const extrasFor = pagesDir ? savedPageReader(pagesDir) : () => null;
    const cleanUp = () => {
        if (!pagesDir) return;
        searchPageDirs.delete(pagesDir);
        fs.rm(pagesDir, { recursive: true, force: true }, () => {});
    };
    console.log(`[search] ${tab} "${text}" ${start + 1}-${end}`);

    return new Promise((resolve) => {
        const proc = spawn(ytDlpPath, args, { cwd: pagesDir || undefined, detached: process.platform !== 'win32', windowsHide: true });
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
                    const entry = JSON.parse(line);
                    const result = mapSearchEntry(tab, entry);
                    if (result) results.push(withExtras(result, extrasFor(entry.id)));
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
            cleanUp();
            resolve({ error: describeBinaryFailure('yt-dlp', err) });
        });
        proc.on('close', (code, signal) => {
            const cancelled = !activeSearches.has(id);
            activeSearches.delete(id);
            if (cancelled || signal) {
                cleanUp();
                resolve({ cancelled: true });
                return;
            }
            emit([buffer]);
            cleanUp();
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
        title: 'Add Media Folders',
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('open-folder', (_event, folderPath) => shell.openPath(folderPath));

// characters no folder name can hold on windows, which is the strictest of the three.
const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/;

// why a name can't be a folder's, or null when it can.
function folderNameProblem(name) {
    if (!name || name === '.' || name === '..' || INVALID_NAME.test(name) || /[. ]$/.test(name)) {
        return 'Folder names can\'t be empty, end in a dot or space, or use < > : " / \\ | ? *';
    }
    return null;
}

// downstream's own folder, where every folder directly inside is native.
// music needs no permission on macos, unlike documents, and onedrive leaves it alone unless asked.
function nativeRoot() {
    return path.join(app.getPath('music'), 'Downstream');
}

const isNativeFolder = (folderPath) => path.dirname(folderPath) === nativeRoot();

// a folder keeps its id through a rename, so one renamed outside downstream is still recognized.
async function folderId(folderPath) {
    const stat = await fs.promises.stat(folderPath, { bigint: true });
    return `${stat.dev}:${stat.ino}`;
}

// the folders inside downstream's own folder, and the ids of the saved folders that are still there.
// a root that can't be read reports an error, so nothing is taken for gone.
ipcMain.handle('list-native-folders', async (_event, savedPaths = []) => {
    const root = nativeRoot();
    const ids = {};
    for (const savedPath of savedPaths) {
        try { ids[savedPath] = await folderId(savedPath); } catch { /* missing */ }
    }
    let entries;
    try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return { root, folders: [], ids };
        console.error(`[library] couldn't read ${root}: ${err.message}`);
        return { root, error: err.message, ids };
    }
    const folders = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const full = path.join(root, entry.name);
        try { folders.push({ path: full, id: await folderId(full) }); } catch { /* gone since the listing */ }
    }
    return { root, folders, ids };
});

// saved folders gone from their path, looked for by id next to where they were, as after a rename in finder or file explorer.
ipcMain.handle('find-moved-folders', async (_event, lost) => {
    const found = {};
    for (const { path: lostPath, id } of lost) {
        const parent = path.dirname(lostPath);
        // a missing drive is left alone, rather than looking through every other drive.
        if (parent === '/Volumes' || path.dirname(parent) === parent) continue;
        let entries;
        try {
            entries = await fs.promises.readdir(parent, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const candidate = path.join(parent, entry.name);
            try {
                if (await folderId(candidate) === id) {
                    found[lostPath] = candidate;
                    break;
                }
            } catch { /* gone since the listing */ }
        }
    }
    return found;
});

// a taken name gets a number, like a new folder in finder.
ipcMain.handle('create-native-folder', async (_event, newName) => {
    const name = typeof newName === 'string' ? newName.trim() : '';
    const problem = folderNameProblem(name);
    if (problem) return { error: problem };
    const root = nativeRoot();
    try {
        await fs.promises.mkdir(root, { recursive: true });
        for (let n = 1; ; n++) {
            const target = path.join(root, n === 1 ? name : `${name} ${n}`);
            try {
                await fs.promises.mkdir(target);
            } catch (err) {
                if (err.code === 'EEXIST') continue;
                throw err;
            }
            console.log(`[library] created ${path.basename(target)}`);
            return { path: target, id: await folderId(target) };
        }
    } catch (err) {
        console.error(`[library] couldn't create ${name}: ${err.message}`);
        if (err.code === 'EACCES' || err.code === 'EPERM') return { error: `You don't have permission to make folders in ${root}.` };
        return { error: `Couldn't create the folder: ${err.message}` };
    }
});

// deleted folders wait in a hidden folder inside downstream's own, on the same drive, so deleting and restoring are instant.
// each one sits in a folder of its own with a note of where it came from and what the library knew about it.
const DELETED_DAYS = 30;
const deletedRoot = () => path.join(nativeRoot(), '.Recently Deleted');
const DELETED_NOTE = 'deleted.json';

async function folderBytes(dir) {
    let total = 0;
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += await folderBytes(full);
        else if (entry.isFile()) total += (await fs.promises.stat(full)).size;
    }
    return total;
}

async function listDeleted() {
    const items = [];
    let ids;
    try {
        ids = await fs.promises.readdir(deletedRoot());
    } catch {
        return items;
    }
    for (const id of ids) {
        try {
            const note = JSON.parse(await fs.promises.readFile(path.join(deletedRoot(), id, DELETED_NOTE), 'utf8'));
            items.push({ id, ...note, path: path.join(deletedRoot(), id, note.name) });
        } catch { /* not one of ours, or half removed */ }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

ipcMain.handle('list-deleted', () => listDeleted());

const deletedId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// a holder for one deleted thing, with recently deleted made around it the first time.
async function makeDeletedHolder(id) {
    const fresh = !fs.existsSync(deletedRoot());
    const holder = path.join(deletedRoot(), id);
    await fs.promises.mkdir(holder, { recursive: true });
    // a dot hides it on macos and linux, and windows needs it marked hidden.
    if (fresh && process.platform === 'win32') execFile('attrib', ['+h', deletedRoot()], { windowsHide: true }, () => {});
    return holder;
}

// moves a native folder into recently deleted, with what the library knew about it so a restore brings that back too.
ipcMain.handle('delete-native-folder', async (_event, folderPath, known) => {
    if (!isNativeFolder(folderPath)) return { error: 'Only folders in the Downstream folder can be deleted from here.' };
    const id = deletedId();
    const holder = path.join(deletedRoot(), id);
    const name = path.basename(folderPath);
    try {
        const size = await folderBytes(folderPath);
        await makeDeletedHolder(id);
        await fs.promises.rename(folderPath, path.join(holder, name));
        const note = { name, from: folderPath, deletedAt: Date.now(), size, ...known };
        await fs.promises.writeFile(path.join(holder, DELETED_NOTE), JSON.stringify(note));
        console.log(`[library] deleted ${name}, kept for ${DELETED_DAYS} days`);
        return { id };
    } catch (err) {
        console.error(`[library] couldn't delete ${folderPath}: ${err.message}`);
        await fs.promises.rm(holder, { recursive: true, force: true }).catch(() => {});
        if (err.code === 'ENOENT') return { error: "Downstream can't find this folder anymore." };
        if (err.code === 'EBUSY' || (process.platform === 'win32' && err.code === 'EPERM')) {
            return { error: 'Something is using a file in this folder, so it can\'t be deleted right now. If it\'s playing, switch to another folder and try again.' };
        }
        return { error: `Couldn't delete the folder: ${err.message}` };
    }
});

// a deleted song goes back in the folder it came from, which comes back too if it was one of downstream's own.
async function restoreMedia(item) {
    const dir = path.dirname(item.from);
    try {
        if (!fs.existsSync(dir)) {
            if (!isNativeFolder(dir)) return { error: 'The folder it came from isn\'t there anymore.' };
            await fs.promises.mkdir(dir, { recursive: true });
        }
        const target = freeFilePath(dir, item.name);
        await moveFile(item.path, target);
        await fs.promises.rm(path.join(deletedRoot(), item.id), { recursive: true, force: true });
        followMedia(item.from, target, false);
        console.log(`[library] restored ${path.basename(target)}`);
        return { path: target, note: item };
    } catch (err) {
        console.error(`[library] couldn't restore ${item.name}: ${err.message}`);
        return { error: `Couldn't restore it: ${mediaProblem(err)}` };
    }
}

// puts a deleted folder back in the downstream folder, numbered if its name was taken since.
ipcMain.handle('restore-deleted', async (_event, id) => {
    const item = (await listDeleted()).find((d) => d.id === id);
    if (!item) return { error: 'That is no longer in Recently deleted.' };
    if (item.kind === 'media') return restoreMedia(item);
    const target = freeNativePath(item.name);
    try {
        await fs.promises.rename(item.path, target);
        await fs.promises.rm(path.join(deletedRoot(), id), { recursive: true, force: true });
        console.log(`[library] restored ${path.basename(target)}`);
        return { path: target, note: item };
    } catch (err) {
        console.error(`[library] couldn't restore ${item.name}: ${err.message}`);
        return { error: `Couldn't restore the folder: ${err.message}` };
    }
});

// gone for good, with nothing left to restore.
async function purgeDeleted(ids) {
    for (const id of ids) {
        const item = (await listDeleted()).find((d) => d.id === id);
        await fs.promises.rm(path.join(deletedRoot(), id), { recursive: true, force: true });
        if (item) for (const suffix of ['', '.none']) fs.rmSync(coverCachePath(item.from) + suffix, { force: true });
    }
    if (ids.length) console.log(`[library] deleted ${ids.length} folder(s) for good`);
}

ipcMain.handle('purge-deleted', async (_event, ids) => {
    try {
        await purgeDeleted(ids);
        return {};
    } catch (err) {
        console.error(`[library] couldn't empty recently deleted: ${err.message}`);
        return { error: `Couldn't delete everything: ${err.message}` };
    }
});

// folders deleted more than a month ago go for good when downstream starts.
async function purgeExpiredDeleted() {
    const cutoff = Date.now() - DELETED_DAYS * 24 * 60 * 60 * 1000;
    const expired = (await listDeleted()).filter((d) => d.deletedAt < cutoff).map((d) => d.id);
    await purgeDeleted(expired).catch(() => {});
}

// folders that moved while downstream ran, so a song the player opened before the move is still found.
const movedFolders = new Map();
// songs moved on their own by downstream, found the same way.
const movedMedia = new Map();

function movedFile(filePath) {
    if (movedMedia.has(filePath)) return movedMedia.get(filePath);
    for (const [from, to] of movedFolders) {
        if (filePath.startsWith(from + path.sep)) return to + filePath.slice(from.length);
    }
    return null;
}

ipcMain.on('folder-moved', (_event, from, to) => {
    for (const [old, target] of movedFolders) if (target === from) movedFolders.set(old, to);
    movedFolders.set(from, to);
    // song lengths follow too, so a moved folder isn't read again.
    const lengths = knownDurations();
    let moved = 0;
    for (const file of Object.keys(lengths)) {
        if (!file.startsWith(from + path.sep)) continue;
        lengths[to + file.slice(from.length)] = lengths[file];
        delete lengths[file];
        moved++;
    }
    if (moved) saveDurationsSoon();
});

function moveCover(from, to) {
    for (const suffix of ['', '.none']) {
        try { fs.renameSync(coverCachePath(from) + suffix, coverCachePath(to) + suffix); } catch { /* no cover cached */ }
    }
}

// a free spot in the downstream folder, numbered when the name is taken.
function freeNativePath(name) {
    for (let n = 1; ; n++) {
        const target = path.join(nativeRoot(), n === 1 ? name : `${name} ${n}`);
        if (!fs.existsSync(target)) return target;
    }
}

// every file under a folder, with its size.
async function listFiles(dir, base = dir) {
    const files = [];
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(full, base));
        else if (entry.isFile()) files.push({ rel: path.relative(base, full), size: (await fs.promises.stat(full)).size });
    }
    return files;
}

function importProblem(err) {
    if (err.code === 'ENOSPC') return 'There isn\'t enough space for the folder.';
    if (err.code === 'EBUSY' || (process.platform === 'win32' && err.code === 'EPERM')) {
        return 'Something is using a file in this folder. If it\'s playing, switch to another folder and try again.';
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') return 'Downstream doesn\'t have permission to do that.';
    return `Couldn't import the folder: ${err.message}`;
}

// one import runs at a time, and can be stopped between files.
let activeImport = null;

ipcMain.handle('cancel-import', () => {
    if (activeImport) activeImport.cancelled = true;
});

// brings an external folder into the downstream folder.
// a move on the same drive is a rename.
// anything else is copied into a hidden folder file by file, checked, and only then named, with a move removing the original last.
ipcMain.handle('import-folder', async (event, { folderPath, move }) => {
    const root = nativeRoot();
    if (activeImport) return { error: 'Another folder is still being imported.' };
    if (isNativeFolder(folderPath)) return { error: 'This folder is already in the Downstream folder.' };
    if (folderPath === root || root.startsWith(folderPath + path.sep)) return { error: 'This folder holds the Downstream folder, so it can\'t go inside it.' };
    // claimed before anything is awaited, so a second import can't slip in.
    const job = { cancelled: false };
    activeImport = job;
    const name = path.basename(folderPath);
    let staging = null;
    try {
        try {
            if (!(await fs.promises.stat(folderPath)).isDirectory()) throw new Error('not a folder');
        } catch {
            return { error: "Downstream can't find this folder anymore." };
        }
        await fs.promises.mkdir(root, { recursive: true });
        if (move) {
            const target = freeNativePath(name);
            try {
                await fs.promises.rename(folderPath, target);
                moveCover(folderPath, target);
                console.log(`[library] moved ${name} into the Downstream folder`);
                return { path: target, id: await folderId(target) };
            } catch (err) {
                if (err.code !== 'EXDEV') throw err;
            }
        }
        const files = await listFiles(folderPath);
        const total = files.reduce((sum, f) => sum + f.size, 0);
        staging = path.join(root, `.importing-${process.pid}-${Date.now()}`);
        await fs.promises.mkdir(staging);
        let done = 0;
        for (const file of files) {
            if (job.cancelled) {
                await fs.promises.rm(staging, { recursive: true, force: true });
                console.log(`[library] import of ${name} cancelled`);
                return { cancelled: true };
            }
            const to = path.join(staging, file.rel);
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            await fs.promises.copyFile(path.join(folderPath, file.rel), to, fs.constants.COPYFILE_FICLONE);
            if ((await fs.promises.stat(to)).size !== file.size) throw new Error(`${file.rel} didn't copy completely.`);
            done += file.size;
            event.sender.send('import-progress', { folderPath, done, total });
        }
        const target = freeNativePath(name);
        await fs.promises.rename(staging, target);
        staging = null;
        moveCover(folderPath, target);
        console.log(`[library] ${move ? 'moved' : 'copied'} ${name} into the Downstream folder (${files.length} file(s), ${Math.round(total / 1048576)} MB)`);
        let leftover = false;
        if (move) {
            try {
                await fs.promises.rm(folderPath, { recursive: true });
            } catch (err) {
                console.error(`[library] couldn't remove the original ${folderPath}: ${err.message}`);
                leftover = true;
            }
        }
        return { path: target, id: await folderId(target), leftover };
    } catch (err) {
        console.error(`[library] import of ${folderPath} failed: ${err.message}`);
        if (staging) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
        return { error: importProblem(err) };
    } finally {
        activeImport = null;
    }
});

// renames a music folder on disk, and moves its cached cover along with it.
ipcMain.handle('rename-folder', async (_event, folderPath, newName) => {
    const name = typeof newName === 'string' ? newName.trim() : '';
    const problem = folderNameProblem(name);
    if (problem) return { error: problem };
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
    moveCover(folderPath, target);
    console.log(`[library] renamed ${path.basename(folderPath)} to ${name}`);
    return { path: target };
});

// pieces yt-dlp makes while it works, which a download stopped by an older version could leave next to the music.
// they look like music files but are unfinished, so the library leaves them out.
const DOWNLOAD_LEFTOVER = /\.(temp|f\d+(-\w+)?)\.[a-z0-9]+$/i;

const playable = (name, pattern) => pattern.test(name) && !DOWNLOAD_LEFTOVER.test(name);

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
            counts[folderPath] = entries.filter((e) => e.isFile() && playable(e.name, pattern)).length;
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
        names = (await fs.promises.readdir(folderPath)).filter((n) => playable(n, pattern)).sort().slice(0, COVER_TRIES);
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

// how long each song is, read once and remembered by path with its size and modified time, so a replaced file is read again.
const durationsPath = () => path.join(app.getPath('userData'), 'durations.json');
let durations = null;
let durationsSave = null;

function knownDurations() {
    if (!durations) {
        try {
            durations = JSON.parse(fs.readFileSync(durationsPath(), 'utf8'));
        } catch {
            durations = {};
        }
    }
    return durations;
}

function saveDurationsSoon() {
    clearTimeout(durationsSave);
    durationsSave = setTimeout(() => {
        try {
            fs.writeFileSync(durationsPath(), JSON.stringify(durations));
        } catch (err) {
            console.error(`[library] couldn't save song lengths: ${err.message}`);
        }
    }, 2000);
}

// ffmpeg prints a file's length as it opens it, and nothing more is read.
function readDuration(file) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true });
        let output = '';
        proc.stderr.on('data', (chunk) => { output += chunk; });
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 10000);
        proc.on('error', () => { clearTimeout(timer); resolve(null); });
        proc.on('close', () => {
            clearTimeout(timer);
            const m = output.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
            resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]) : null);
        });
    });
}

// at most a few lengths are read at once, however many folders ask.
const LENGTH_READERS = 4;
let lengthReaders = 0;
const lengthQueue = [];

async function withLengthReader(read) {
    while (lengthReaders >= LENGTH_READERS) await new Promise((resolve) => lengthQueue.push(resolve));
    lengthReaders++;
    try {
        return await read();
    } finally {
        lengthReaders--;
        lengthQueue.shift()?.();
    }
}

// what the info panel shows for folders: tracks, size, formats and total length.
// lengths not known yet are only read when asked to, and the result says how many are still unknown.
ipcMain.handle('folder-details', async (_event, folderPaths, extensions, measure) => {
    const pattern = musicPattern(extensions);
    const lengths = knownDurations();
    const details = { tracks: 0, size: 0, duration: 0, unknown: 0, formats: {}, missing: 0 };
    const unknown = [];
    for (const folderPath of folderPaths) {
        let entries;
        try {
            entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        } catch {
            details.missing++;
            continue;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !playable(entry.name, pattern)) continue;
            const file = path.join(folderPath, entry.name);
            let stat;
            try {
                stat = await fs.promises.stat(file);
            } catch {
                continue;
            }
            const mtime = Math.floor(stat.mtimeMs);
            const ext = path.extname(entry.name).slice(1).toLowerCase();
            details.tracks++;
            details.size += stat.size;
            details.formats[ext] = (details.formats[ext] || 0) + 1;
            const known = lengths[file];
            if (known && known.size === stat.size && known.mtime === mtime) details.duration += known.duration;
            else unknown.push({ file, size: stat.size, mtime });
        }
    }
    if (measure && unknown.length > 0 && await ensureFfmpegBinary()) {
        await Promise.all(unknown.map((item) => withLengthReader(async () => {
            // a file that can't be read counts as no time, so it isn't tried again until it changes.
            const duration = (await readDuration(item.file)) || 0;
            lengths[item.file] = { size: item.size, mtime: item.mtime, duration };
            details.duration += duration;
        })));
        saveDurationsSoon();
        console.log(`[library] read the length of ${unknown.length} song(s)`);
    } else {
        details.unknown = unknown.length;
    }
    return details;
});

// === managing media ===
// songs added, moved and deleted one by one from inside downstream, so finder or file explorer isn't needed.

// a free name for a file in a folder, numbered like "Golden Hour (2)" when it's taken.
function freeFilePath(dir, fileName) {
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    for (let n = 1; ; n++) {
        const target = path.join(dir, n === 1 ? fileName : `${stem} (${n})${ext}`);
        if (!fs.existsSync(target)) return target;
    }
}

function mediaProblem(err) {
    if (err.code === 'ENOENT') return 'Downstream can\'t find it anymore.';
    if (err.code === 'ENOSPC') return 'There isn\'t enough space for it.';
    if (err.code === 'EBUSY' || (process.platform === 'win32' && err.code === 'EPERM')) return 'Something else is using it right now.';
    if (err.code === 'EACCES' || err.code === 'EPERM') return 'Downstream doesn\'t have permission to do that.';
    return err.message;
}

// windows can keep hold of a file the player has only just let go of, so a busy one is tried a few more times.
async function whenFree(step) {
    for (let tries = 0; ; tries++) {
        try {
            return await step();
        } catch (err) {
            const busy = process.platform === 'win32' && (err.code === 'EBUSY' || err.code === 'EPERM');
            if (!busy || tries >= 3) throw err;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
}

// copies a file next to where it's going under a hidden name, checks it, and only then names it.
// it keeps the original's modified time, so the length and loudness known about it still match.
async function copyChecked(from, to) {
    const part = path.join(path.dirname(to), `.${path.basename(to)}.part-${process.pid}`);
    try {
        await fs.promises.copyFile(from, part, fs.constants.COPYFILE_FICLONE);
        const [original, copy] = await Promise.all([fs.promises.stat(from), fs.promises.stat(part)]);
        if (original.size !== copy.size) throw new Error(`${path.basename(from)} didn't copy completely.`);
        await fs.promises.utimes(part, original.atimeMs / 1000, original.mtimeMs / 1000);
        await fs.promises.rename(part, to);
    } catch (err) {
        await fs.promises.rm(part, { force: true }).catch(() => {});
        throw err;
    }
}

// a rename on the same drive, and a checked copy with the original removed after on another.
// a copy whose original can't be removed is taken back, so the song is never in two places.
async function moveFile(from, to) {
    try {
        await whenFree(() => fs.promises.rename(from, to));
        return;
    } catch (err) {
        if (err.code !== 'EXDEV') throw err;
    }
    await copyChecked(from, to);
    try {
        await whenFree(() => fs.promises.rm(from));
    } catch (err) {
        await fs.promises.rm(to, { force: true }).catch(() => {});
        throw err;
    }
}

// what main knows about a song by its path follows it to the new one.
// a move made while it plays also leaves a forwarding note, so the player still finds it.
function followMedia(from, to, playing = true) {
    if (playing) {
        for (const [old, target] of movedMedia) if (target === from) movedMedia.set(old, to);
        movedMedia.set(from, to);
    }
    const lengths = knownDurations();
    if (lengths[from] && from !== to) {
        lengths[to] = lengths[from];
        delete lengths[from];
        saveDurationsSoon();
    }
}

// copies downstream made this session, the only files undoing an add may remove.
const madeCopies = new Set();

// moves or copies songs into folders, each under a free name, and says how each one went, so one that can't go doesn't stop the rest.
// each item names the song, the folder it goes to, and optionally the name it should have there.
ipcMain.handle('place-media', async (_event, { items, copy }) => {
    const folders = new Map();
    const isFolder = async (dir) => {
        if (!folders.has(dir)) folders.set(dir, await fs.promises.stat(dir).then((s) => s.isDirectory(), () => false));
        return folders.get(dir);
    };
    const results = [];
    for (const { from, dir, name } of items) {
        const result = { from };
        try {
            if (!(await isFolder(dir))) {
                result.error = 'Downstream can\'t find that folder anymore.';
            } else if (!copy && path.dirname(from) === dir && (!name || name === path.basename(from))) {
                result.to = from;
                result.same = true;
            } else {
                const to = freeFilePath(dir, name || path.basename(from));
                if (copy) {
                    await copyChecked(from, to);
                    madeCopies.add(to);
                } else {
                    await moveFile(from, to);
                    followMedia(from, to);
                }
                result.to = to;
            }
        } catch (err) {
            console.error(`[library] couldn't ${copy ? 'copy' : 'move'} ${path.basename(from)}: ${err.message}`);
            result.error = mediaProblem(err);
        }
        results.push(result);
    }
    const done = results.filter((r) => r.to && !r.same).length;
    if (done) console.log(`[library] ${copy ? 'copied' : 'moved'} ${done} song(s)`);
    return results;
});

// undoing an add that copied takes the copies away again.
ipcMain.handle('discard-copies', async (_event, files) => {
    for (const file of files) {
        if (!madeCopies.has(file)) continue;
        try {
            await whenFree(() => fs.promises.rm(file));
            madeCopies.delete(file);
        } catch (err) {
            console.error(`[library] couldn't take back the copy ${path.basename(file)}: ${err.message}`);
        }
    }
});

// songs go into recently deleted like folders do, each in a holder of its own with a note of where it came from.
// the note is written before the song goes in, so a holder is never left with a song and no way back.
ipcMain.handle('delete-media', async (_event, files) => {
    const results = [];
    for (const file of files) {
        const id = deletedId();
        const name = path.basename(file);
        let holder = null;
        try {
            const { size } = await fs.promises.stat(file);
            holder = await makeDeletedHolder(id);
            const known = knownDurations()[file];
            const note = { kind: 'media', name, from: file, deletedAt: Date.now(), size, duration: known?.duration ?? null };
            await fs.promises.writeFile(path.join(holder, DELETED_NOTE), JSON.stringify(note));
            await moveFile(file, path.join(holder, name));
            results.push({ file, id });
        } catch (err) {
            console.error(`[library] couldn't delete ${name}: ${err.message}`);
            if (holder) await fs.promises.rm(holder, { recursive: true, force: true }).catch(() => {});
            results.push({ file, error: mediaProblem(err) });
        }
    }
    const done = results.filter((r) => r.id).length;
    if (done) console.log(`[library] deleted ${done} song(s), kept for ${DELETED_DAYS} days`);
    return results;
});

ipcMain.handle('pick-media-files', async (_event, extensions) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title: 'Add Media',
        buttonLabel: 'Add',
        filters: [{ name: 'Media', extensions: extensions?.length ? extensions : ['mp3', 'flac', 'wav'] }],
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('show-media', (_event, filePath) => shell.showItemInFolder(filePath));

// the most songs a search brings back, which is more than anyone reads.
const SEARCH_LIMIT = 200;

// songs whose names hold the search, across the library's folders, folder by folder.
ipcMain.handle('search-media', async (_event, folderPaths, query, extensions) => {
    const pattern = musicPattern(extensions);
    const q = String(query || '').trim().toLowerCase();
    const found = [];
    if (!q) return found;
    for (const folderPath of folderPaths) {
        let entries;
        try {
            entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !playable(entry.name, pattern)) continue;
            const name = entry.name.replace(pattern, '');
            if (!name.toLowerCase().includes(q)) continue;
            found.push({ name, path: path.join(folderPath, entry.name), folder: folderPath });
            if (found.length >= SEARCH_LIMIT) return found;
        }
    }
    return found;
});

// each song's size, format and length, for the info panel and the library's rows.
// lengths not known yet are only read when asked to.
ipcMain.handle('media-details', async (_event, files, measure) => {
    const lengths = knownDurations();
    const details = {};
    const unknown = [];
    for (const file of files) {
        let stat;
        try {
            stat = await fs.promises.stat(file);
        } catch {
            continue;
        }
        const mtime = Math.floor(stat.mtimeMs);
        const known = lengths[file];
        const item = {
            size: stat.size,
            mtime,
            ext: path.extname(file).slice(1).toLowerCase(),
            duration: known && known.size === stat.size && known.mtime === mtime ? known.duration : null,
        };
        details[file] = item;
        if (item.duration === null) unknown.push(file);
    }
    if (measure && unknown.length > 0 && await ensureFfmpegBinary()) {
        await Promise.all(unknown.map((file) => withLengthReader(async () => {
            const item = details[file];
            // a file that can't be read counts as no time, so it isn't tried again until it changes.
            item.duration = (await readDuration(file)) || 0;
            lengths[file] = { size: item.size, mtime: item.mtime, duration: item.duration };
        })));
        saveDurationsSoon();
    }
    return details;
});

// which drive each folder is on, so moving to another one can be marked as the slower copy it is.
ipcMain.handle('folder-drives', async (_event, folderPaths) => {
    const drives = {};
    for (const folderPath of folderPaths) {
        try {
            drives[folderPath] = (await fs.promises.stat(folderPath)).dev;
        } catch { /* gone, so it isn't offered */ }
    }
    return drives;
});

ipcMain.handle('read-music-folder', async (_event, folderPath, extensions) => {
    try {
        const pattern = musicPattern(extensions);
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const audioFiles = entries
            .filter((e) => e.isFile() && playable(e.name, pattern))
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
        // its progress is left on, so a slow scan can be told apart from a stuck one.
        const args = [
            '-hide_banner',
            '-i', filePath,
            '-vn', '-sn', '-dn',
            '-af', 'loudnorm=I=-14:TP=-1:print_format=json',
            '-f', 'null', '-',
        ];
        let stderrTail = '';
        let settled = false;
        let stall = null;
        let cap = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(stall);
            clearTimeout(cap);
            loudnessProc = null;
            resolve(result);
        };
        const proc = spawn(ffmpegPath, args);
        loudnessProc = proc;
        const giveUp = (why) => {
            console.warn(`[loudness] ${why} scanning ${path.basename(filePath)}, killing ffmpeg`);
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            finish(null);
        };
        // ffmpeg reports its progress twice a second, so a scan that goes quiet for a minute is stuck on a corrupt file, and its failure is cached.
        // a slow one keeps going however long the song is, since an older mac can take a third of a song's length or more.
        const watch = () => {
            clearTimeout(stall);
            stall = setTimeout(() => giveUp('no progress'), 60000);
        };
        watch();
        cap = setTimeout(() => giveUp('30 minutes'), 30 * 60000);
        proc.stderr.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-4000);
            watch();
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

// whether a song has a moment of true silence near each of the given times, read straight from the file.
// the player asks before taking a silent audio graph for a stuck one, since some songs really are silent for a while.
// null when the file can't be read, so the player leaves things alone.
function silentNear(filePath, at) {
    return new Promise((resolve) => {
        let stderr = '';
        const from = Math.max(0, at - 0.2);
        const proc = spawn(ffmpegPath, [
            '-hide_banner', '-nostats',
            '-ss', from.toFixed(3), '-t', '0.4',
            '-i', filePath,
            '-map', '0:a:0',
            '-af', 'silencedetect=noise=-90dB:d=0.02',
            '-f', 'null', '-',
        ], { windowsHide: true });
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            resolve(null);
        }, 10000);
        proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
        proc.on('error', () => {
            clearTimeout(timer);
            resolve(null);
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0 ? stderr.includes('silence_start') : null);
        });
    });
}

ipcMain.handle('media-silent-at', async (_event, filePath, times) => {
    if (typeof filePath !== 'string' || !Array.isArray(times) || !times.length) return null;
    if (!fs.existsSync(filePath) || !(await ensureFfmpegBinary())) return null;
    for (const at of times.slice(0, 4)) {
        if (!Number.isFinite(at)) return null;
        const silent = await silentNear(filePath, at);
        if (silent !== true) return silent;
    }
    return true;
});

app.on('will-quit', () => {
    try { loudnessProc?.kill('SIGKILL'); } catch { /* ignore */ }
    searchPageDirs.forEach((dir) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left for the system to clear */ }
    });
});

ipcMain.handle('check-version', async () => {
    try {
        const appVersion = app.getVersion();
        // the legacy build has its own list, since it's released on its own schedule.
        const list = __DOWNSTREAM_LEGACY__ ? 'legacy-versionctrl.json' : 'versionctrl.json';
        const res = await net.fetch(`https://raw.githubusercontent.com/StrataBytes/Downstream/refs/heads/main/${list}`);
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
    if (mainWindow) applyInterfaceSize(mainWindow, 1);
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
