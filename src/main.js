const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const squirrelCommand = process.argv[1];
if (squirrelCommand) {
    const appFolder = path.resolve(process.execPath, '..');
    const updateExe = path.resolve(appFolder, '..', 'Update.exe');
    const exeName = path.basename(process.execPath);
    if (squirrelCommand === '--squirrel-install' || squirrelCommand === '--squirrel-updated') {
        spawn(updateExe, ['--createShortcut', exeName], { detached: true });
        app.quit();
    } else if (squirrelCommand === '--squirrel-uninstall') {
        spawn(updateExe, ['--removeShortcut', exeName], { detached: true });
        app.quit();
    } else if (squirrelCommand === '--squirrel-obsolete') {
        app.quit();
    }
}

const fs = require('fs');
const ytdl = require('ytdl-core');

function getFFmpegPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'ffmpeg.exe');
    }
    return path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
}

function getYtDlpPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'yt-dlp.exe');
    }
    return path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
}

const ffmpegPath = getFFmpegPath();
const ytDlpPath = getYtDlpPath();

const ytDlpExec = require('yt-dlp-exec').create(ytDlpPath);

console.log('FFmpeg path:', ffmpegPath);
console.log('yt-dlp path:', ytDlpPath);

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 750,
        minWidth: 900,
        minHeight: 500,
        icon: path.join(__dirname, '..', '..', 'epic.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }

    mainWindow.setMenuBarVisibility(false);
}

protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.whenReady().then(() => {
    protocol.handle('media', (request) => {
        const filePath = decodeURIComponent(request.url.slice('media:///'.length));
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const rangeHeader = request.headers.get('range');

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
                        'Content-Type': 'audio/mpeg',
                    },
                });
            }
        }

        return new Response(fs.readFileSync(filePath), {
            status: 200,
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(fileSize),
                'Content-Type': 'audio/mpeg',
            },
        });
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

    switch (quality) {
        case 'high':
            return 'bestvideo[vcodec^=avc]+bestaudio/best[vcodec^=avc]/bestvideo+bestaudio/best';
        case 'medium':
            return 'bestvideo[height<=720][vcodec^=avc]+bestaudio/bestvideo[height<=720]+bestaudio/best';
        case 'low':
            return 'bestvideo[height<=480][vcodec^=avc]+bestaudio/bestvideo[height<=480]+bestaudio/best';
        default:
            return 'bestvideo[vcodec^=avc]+bestaudio/best[vcodec^=avc]/bestvideo+bestaudio/best';
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

ipcMain.handle('download-video', async (event, { url, quality, format }) => {
    const outputDir = app.getPath('downloads');
    const cleanUrl = cleanYouTubeUrl(url);
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    try {
        const ytDlpOptions = {
            output: outputTemplate,
            format: getFormatString(quality, format),
            noPlaylist: true,
            ffmpegLocation: ffmpegPath,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            concurrentFragments: 4,
            retries: 10,
            fragmentRetries: 10,
            newline: true,
            noColors: true,
        };

        if (format === 'mp3') {
            ytDlpOptions.extractAudio = true;
            ytDlpOptions.audioFormat = 'mp3';
            ytDlpOptions.audioQuality = 0;
        }

        console.log(`Starting download for: ${cleanUrl}`);

        let progressValue = 10;
        const progressInterval = setInterval(() => {
            if (progressValue < 90) {
                progressValue += 10;
                event.sender.send('download-progress', { url, progress: progressValue });
            }
        }, 1000);

        try {
            const result = await withRetry(async () => {
                return await ytDlpExec(cleanUrl, ytDlpOptions);
            }, 3, 3000);

            clearInterval(progressInterval);

            event.sender.send('download-progress', { url, progress: 100 });
            event.sender.send('download-complete', { url, success: true });
            event.sender.send('conversion-complete', { url, success: true });
            console.log(`Download completed for ${cleanUrl}`);
            return { success: true };
        } catch (dlError) {
            clearInterval(progressInterval);
            console.error(`Error downloading ${url}: ${dlError.message}`);
            event.sender.send('download-error', { url, error: dlError.message });
            return { success: false, error: dlError.message };
        }

    } catch (error) {
        console.error(`Error downloading ${url}: ${error.message}`);
        console.error('Full error:', error);
        event.sender.send('download-error', { url, error: error.message });
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-video-info', async (event, url) => {
    try {
        const cleanUrl = cleanYouTubeUrl(url);
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
        console.error(`Error fetching video info for ${url}: ${error.message}`);
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
        const maxVideos = hasRadio ? 25 : 100;
        const info = await withRetry(async () => {
            return await ytDlpExec(url, {
                dumpSingleJson: true,
                flatPlaylist: true,
                noWarnings: true,
                skipDownload: true,
                playlistEnd: maxVideos,
            });
        }, 2, 3000);
        if (info.entries && info.entries.length > 0) {
            return {
                title: info.title || (hasRadio ? 'Radio' : 'Playlist'),
                videos: info.entries.map(entry => ({
                    url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
                    title: entry.title || 'Unknown Title',
                    id: entry.id
                })),
                isRadio: hasRadio,
                truncated: info.entries.length >= maxVideos
            };
        }
        return null;
    } catch (error) {
        console.error(`Error fetching playlist info for ${url}: ${error.message}`);
        return null;
    }
});

ipcMain.handle('open-downloads-folder', async () => {
    const downloadsPath = app.getPath('downloads');
    shell.openPath(downloadsPath);
});

ipcMain.handle('search-videos', async (event, query) => {
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

        if (!info.entries) return [];
        return info.entries
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
    } catch (error) {
        console.error('Search failed:', error.message);
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

ipcMain.handle('read-music-folder', async (_event, folderPath) => {
    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const mp3Files = entries
            .filter((e) => e.isFile() && /\.mp3$/i.test(e.name))
            .map((e) => ({
                name: e.name.replace(/\.mp3$/i, ''),
                path: path.join(folderPath, e.name),
            }));
        return mp3Files;
    } catch (err) {
        console.error('Error reading music folder:', err.message);
        return [];
    }
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

ipcMain.handle('open-external-url', async (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
    }
});

process.on('uncaughtException', (error) => {
    if (error.message.includes('spawn UNKNOWN')) {
        console.warn('Suppressed "spawn UNKNOWN" error:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});
