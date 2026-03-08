const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    downloadVideo: (data) => ipcRenderer.invoke('download-video', data),
    getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
    getPlaylistInfo: (url) => ipcRenderer.invoke('get-playlist-info', url),
    openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
    selectMusicFolder: () => ipcRenderer.invoke('select-music-folder'),
    readMusicFolder: (folderPath) => ipcRenderer.invoke('read-music-folder', folderPath),
    checkVersion: () => ipcRenderer.invoke('check-version'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
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
