const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    downloadVideo: (data) => ipcRenderer.invoke('download-video', data),
    cancelDownload: () => ipcRenderer.invoke('cancel-download'),
    getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
    playlistStart: (job) => ipcRenderer.invoke('playlist-start', job),
    playlistCancel: (id) => ipcRenderer.invoke('playlist-cancel', id),
    onPlaylistProgress: (func) => ipcRenderer.on('playlist-progress', (event, progress) => func(progress)),
    openDownloadsFolder: (folderPath) => ipcRenderer.invoke('open-downloads-folder', folderPath),
    selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
    searchStart: (search) => ipcRenderer.invoke('search-start', search),
    searchCancel: (id) => ipcRenderer.invoke('search-cancel', id),
    onSearchResults: (func) => ipcRenderer.on('search-results', (event, batch) => func(batch)),
    selectMusicFolders: () => ipcRenderer.invoke('select-music-folders'),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    renameFolder: (folderPath, newName) => ipcRenderer.invoke('rename-folder', folderPath, newName),
    readMusicFolder: (folderPath, extensions) => ipcRenderer.invoke('read-music-folder', folderPath, extensions),
    scanMusicFolders: (folderPaths, extensions) => ipcRenderer.invoke('scan-music-folders', folderPaths, extensions),
    getFolderCover: (folderPath, extensions, refresh) => ipcRenderer.invoke('get-folder-cover', folderPath, extensions, refresh),
    getAlbumArt: (filePath) => ipcRenderer.invoke('get-album-art', filePath),
    measureLoudness: (filePath) => ipcRenderer.invoke('measure-loudness', filePath),
    checkVersion: () => ipcRenderer.invoke('check-version'),
    checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
    checkYtDlp: () => ipcRenderer.invoke('check-ytdlp'),
    getYtDlpInfo: () => ipcRenderer.invoke('get-ytdlp-info'),
    getYtDlpVersions: () => ipcRenderer.invoke('get-ytdlp-versions'),
    setYtDlpVersion: (target) => ipcRenderer.invoke('set-ytdlp-version', target),
    checkYtDlpUpdate: () => ipcRenderer.invoke('check-ytdlp-update'),
    repairYtDlp: () => ipcRenderer.invoke('repair-ytdlp'),
    getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
    setHardwareAcceleration: (on) => ipcRenderer.invoke('set-hardware-acceleration', on),
    setDedicatedGpu: (on) => ipcRenderer.invoke('set-dedicated-gpu', on),
    resetAppSettings: () => ipcRenderer.invoke('reset-app-settings'),
    restartApp: () => ipcRenderer.invoke('restart-app'),
    openAppData: () => ipcRenderer.invoke('open-app-data'),
    cleanTempFiles: () => ipcRenderer.invoke('clean-temp-files'),
    checkNetwork: () => ipcRenderer.invoke('check-network'),
    verifyFfmpeg: () => ipcRenderer.invoke('verify-ffmpeg'),
    verifyYtDlp: () => ipcRenderer.invoke('verify-ytdlp'),
    detectRenderTier: () => ipcRenderer.invoke('detect-render-tier'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    onDebugLog: (func) => ipcRenderer.on('debug-log', (event, entry) => func(entry)),
    setDebugCapture: (on) => ipcRenderer.send('set-debug-capture', on),
    setTouchBarState: (state) => ipcRenderer.send('touchbar-state', state),
    setTouchBarTitle: (title) => ipcRenderer.send('touchbar-title', title),
    setTouchBarIcons: (icons) => ipcRenderer.send('touchbar-icons', icons),
    onTouchBarAction: (func) => ipcRenderer.on('touchbar-action', (event, action, value) => func(action, value)),
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
