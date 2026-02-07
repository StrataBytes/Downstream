if (require('electron-squirrel-startup')) process.exit(0);

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const ytdl = require('ytdl-core');

function getFFmpegPath() {
    let ffmpegPath = require('ffmpeg-static');
    if (app.isPackaged) {
        ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegPath;
}

function getYtDlpPath() {
    let ytDlpPath = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
    if (app.isPackaged) {
        ytDlpPath = ytDlpPath.replace('app.asar', 'app.asar.unpacked');
    }
    return ytDlpPath;
}

const ffmpegPath = getFFmpegPath();
const ytDlpPath = getYtDlpPath();

const ytDlpExec = require('yt-dlp-exec').create(ytDlpPath);

console.log('FFmpeg path:', ffmpegPath);
console.log('yt-dlp path:', ytDlpPath);

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 600,
        minHeight: 400,
        icon: path.join(__dirname, 'epic.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
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
        
        const result = await withRetry(async () => {
            return await ytDlpExec(cleanUrl, ytDlpOptions);
        }, 3, 3000);
        
        clearInterval(progressInterval);
        
        event.sender.send('download-progress', { url, progress: 100 });
        event.sender.send('download-complete', { url, success: true });
        event.sender.send('conversion-complete', { url, success: true });
        console.log(`Download completed for ${cleanUrl}`);

    } catch (error) {
        console.error(`Error downloading ${url}: ${error.message}`);
        console.error('Full error:', error);
        event.sender.send('download-error', { url, error: error.message });
    }
});

ipcMain.handle('get-video-title', async (event, url) => {
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
        return info.title || 'Unknown Title';
    } catch (error) {
        console.error(`Error fetching video title for ${url}: ${error.message}`);
        try {
            const info = await ytdl.getBasicInfo(cleanYouTubeUrl(url));
            return info.videoDetails.title;
        } catch (fallbackError) {
            console.error(`Fallback also failed: ${fallbackError.message}`);
            return 'Unknown Title - Check URL';
        }
    }
});

ipcMain.handle('get-video-thumbnail', async (event, url) => {
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
        if (info.thumbnail) {
            return info.thumbnail;
        } else if (info.thumbnails && info.thumbnails.length > 0) {
            return info.thumbnails[info.thumbnails.length - 1].url;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching video thumbnail for ${url}: ${error.message}`);
        return null;
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

process.on('uncaughtException', (error) => {
    if (error.message.includes('spawn UNKNOWN')) {
        console.warn('Suppressed "spawn UNKNOWN" error:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});
