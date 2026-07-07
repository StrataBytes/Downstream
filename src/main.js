const { app, BrowserWindow, Menu, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { redownloadYtDlp, redownloadFfmpeg, unblockFile, describeBinaryFailure } = require('./binaryRecovery');

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
        if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp');
        return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
    },
    getIconPath() {
        return path.join(__dirname, '..', '..', 'assets', 'icons', 'mac', 'icon.icns');
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
const ytDlpPath = platform.getYtDlpPath();

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
    try { fs.chmodSync(ytDlpPath, 0o755); } catch {}
}

// strips any leftover mark-of-the-web from an existing install (e.g. upgrading from an older build) so smartscreen has one less reason to treat these as untrusted.
unblockFile(ffmpegPath);
unblockFile(ffprobeTarget);
unblockFile(ytDlpPath);

const ytDlpExec = require('yt-dlp-exec').create(ytDlpPath);

console.log('FFmpeg path:', ffmpegPath);
console.log('yt-dlp path:', ytDlpPath);

// binary health and recovery.
// windows defender/smartscreen can flag yt-dlp.exe (an unsigned pyinstaller build) as unrecognized and quarantine or delete it mid-session.
// every code path that shells out to yt-dlp/ffmpeg checks the binary is on disk first, and if not, tries once to restore it automatically before giving up with a message the renderer can show the user.
let ytDlpRecovery = null;
function ensureYtDlpBinary() {
    if (fs.existsSync(ytDlpPath)) return Promise.resolve(true);
    if (ytDlpRecovery) return ytDlpRecovery;
    console.warn('[recovery] yt-dlp is missing (likely removed by Windows Defender/SmartScreen) — attempting automatic restore...');
    ytDlpRecovery = redownloadYtDlp(ytDlpPath)
        .then(() => { console.log('[recovery] yt-dlp restored successfully.'); return true; })
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
            const mimeMap = { '.flac': 'audio/flac', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
            const mime = mimeMap[ext] || 'audio/mpeg';

            if (!seenMediaPaths.has(filePath)) {
                seenMediaPaths.add(filePath);
                console.log(`[media] serving ${path.basename(filePath)} (${mime}, ${(fileSize / 1048576).toFixed(1)}MB)`);
            }

            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                if (match) {
                    const start = parseInt(match[1], 10);
                    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
                    const length = end - start + 1;
                    const buf = Buffer.alloc(length);
                    const fd = fs.openSync(filePath, 'r');
                    fs.readSync(fd, buf, 0, length, start);
                    fs.closeSync(fd);
                    return new Response(buf, {
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

            return new Response(fs.readFileSync(filePath), {
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

async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }
}

ipcMain.handle('download-video', async (event, { url, quality, format, outputDir: customOutputDir }) => {
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

    console.log(`[download] start ${cleanUrl} (${format}/${quality}) → ${outputDir}`);
    event.sender.send('download-progress', { url, progress: 1 });

    // highest percentage seen, prevents the bar going backwards on multi-stream downloads (yt-dlp downloads video 0-100% then audio 0-100%).
    let maxProgress = 1;
    let finalizingSent = false;

    const parseProgress = (chunk) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
            const m = line.match(/\[download\]\s+([\d.]+)%/);
            if (!m) continue;
            const rawPct = Math.round(parseFloat(m[1]));
            if (rawPct >= 100) {
                // stream finished, ffmpeg merge/convert is next with no progress output.
                if (!finalizingSent) {
                    finalizingSent = true;
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
            finalizingSent = false;
            return new Promise((resolve, reject) => {
                const proc = spawn(ytDlpPath, args);
                let stderrTail = '';
                proc.stdout.on('data', parseProgress);
                proc.stderr.on('data', (chunk) => {
                    parseProgress(chunk);
                    // keeps the tail of stderr so a silent failure has a real cause.
                    stderrTail = (stderrTail + chunk.toString()).slice(-1500);
                });
                proc.on('error', (e) => {
                    console.error('[download] spawn error:', e.message);
                    reject(e);
                });
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else {
                        const tail = stderrTail.trim();
                        console.error(`[download] yt-dlp exited ${code}${tail ? ' — ' + tail.split('\n').slice(-3).join(' | ') : ''}`);
                        reject(new Error(`yt-dlp exited with code ${code}`));
                    }
                });
            });
        }, 3, 3000);

        event.sender.send('download-progress', { url, progress: 100 });
        event.sender.send('download-complete', { url, success: true });
        event.sender.send('conversion-complete', { url, success: true });
        console.log(`[download] complete ${cleanUrl}`);
        return { success: true };
    } catch (dlError) {
        const message = describeBinaryFailure('yt-dlp', dlError);
        console.error(`[download] failed ${url}: ${message}`);
        event.sender.send('download-error', { url, error: message });
        return { success: false, error: message };
    }
});

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

ipcMain.handle('get-playlist-info', async (event, url) => {
    try {
        const urlObj = new URL(url);
        const hasList = urlObj.searchParams.has('list');
        const hasRadio = urlObj.searchParams.has('start_radio');
        if (!hasList && !hasRadio) {
            return null;
        }
        // distinct from `null` below: null means "not a playlist", which the renderer treats as fine and queues the link as a single video.
        // { error } means the enumeration itself couldn't run, so the renderer needs to tell the user instead of queuing garbage.
        if (!(await ensureYtDlpBinary())) {
            return { error: true, message: BINARY_UNAVAILABLE_YTDLP };
        }
        const maxVideos = hasRadio ? 25 : 100;
        const info = await withRetry(async () => {
            return await ytDlpExec(url, {
                dumpSingleJson: true,
                flatPlaylist: true,
                noWarnings: true,
                noCheckCertificate: true,
                skipDownload: true,
                playlistEnd: maxVideos,
            });
        }, 2, 3000);
        if (info.entries && info.entries.length > 0) {
            return {
                title: info.title || (hasRadio ? 'Radio' : 'Playlist'),
                // flat-playlist entries already carry display metadata, passed through so queueing never needs a per-video re-fetch.
                videos: info.entries.map(entry => ({
                    url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
                    title: entry.title || 'Unknown Title',
                    id: entry.id,
                    uploader: entry.uploader || entry.channel || null,
                    duration: entry.duration || null,
                })),
                isRadio: hasRadio,
                truncated: info.entries.length >= maxVideos
            };
        }
        return null;
    } catch (error) {
        const message = describeBinaryFailure('yt-dlp', error);
        console.error(`Error fetching playlist info for ${url}: ${message}`);
        return { error: true, message };
    }
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

ipcMain.handle('search-videos', async (event, query) => {
    console.log(`[search] query "${query}" via ${ytDlpPath}`);
    if (!(await ensureYtDlpBinary())) {
        console.error('[search] yt-dlp unavailable — ' + BINARY_UNAVAILABLE_YTDLP);
        return [];
    }
    try {
        const info = await withRetry(async () => {
            return await ytDlpExec(`ytsearch8:${query}`, {
                dumpSingleJson: true,
                flatPlaylist: true,
                noWarnings: true,
                skipDownload: true,
                noCheckCertificate: true,
            });
        }, 2, 2000);

        if (!info.entries) {
            console.warn('[search] no entries in response');
            return [];
        }
        const mapped = info.entries
            .filter((e) => e.id)
            .map((e) => ({
                url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
                title: e.title || 'Unknown Title',
                channel: e.uploader || e.channel || 'Unknown',
                uploadDate: e.upload_date || null,
                thumbnail: e.thumbnails?.length
                    ? e.thumbnails[e.thumbnails.length - 1].url
                    : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
                duration: e.duration || null,
            }));
        console.log(`[search] returned ${mapped.length} result(s)`);
        return mapped;
    } catch (error) {
        console.error('[search] failed:', describeBinaryFailure('yt-dlp', error));
        return [];
    }
});

ipcMain.handle('select-music-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Music Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('read-music-folder', async (_event, folderPath, extensions) => {
    try {
        const exts = (extensions && extensions.length > 0) ? extensions : ['mp3', 'flac', 'wav'];
        const pattern = new RegExp(`\\.(${exts.join('|')})$`, 'i');
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

ipcMain.handle('check-network', async () => {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (!iface.internal && iface.family === 'IPv4') return true;
        }
    }
    return false;
});

ipcMain.handle('detect-render-tier', async () => {
    try {
        return await platform.detectRenderTier();
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
    debugForwardEnabled = !!on;
});

process.on('uncaughtException', (error) => {
    if (error.message.includes('spawn UNKNOWN') || error.message.includes('spawn EACCES')) {
        console.warn('Suppressed spawn error:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});
