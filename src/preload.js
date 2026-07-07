const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    downloadVideo: (data) => ipcRenderer.invoke('download-video', data),
    getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
    getPlaylistInfo: (url) => ipcRenderer.invoke('get-playlist-info', url),
    openDownloadsFolder: (folderPath) => ipcRenderer.invoke('open-downloads-folder', folderPath),
    selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
    searchVideos: (query) => ipcRenderer.invoke('search-videos', query),
    selectMusicFolder: () => ipcRenderer.invoke('select-music-folder'),
    readMusicFolder: (folderPath, extensions) => ipcRenderer.invoke('read-music-folder', folderPath, extensions),
    getAlbumArt: (filePath) => ipcRenderer.invoke('get-album-art', filePath),
    measureLoudness: (filePath) => ipcRenderer.invoke('measure-loudness', filePath),
    checkVersion: () => ipcRenderer.invoke('check-version'),
    checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
    checkYtDlp: () => ipcRenderer.invoke('check-ytdlp'),
    checkNetwork: () => ipcRenderer.invoke('check-network'),
    detectRenderTier: () => ipcRenderer.invoke('detect-render-tier'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    onDebugLog: (func) => ipcRenderer.on('debug-log', (event, entry) => func(entry)),
    setDebugCapture: (on) => ipcRenderer.send('set-debug-capture', on),
    on: (channel, func) => {
        const validChannels = [
            'download-progress',
            'download-complete',
            'conversion-complete',
            'download-error'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
        }
    }
});
