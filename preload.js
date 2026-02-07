const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    downloadVideo: (data) => ipcRenderer.invoke('download-video', data),
    getVideoTitle: (url) => ipcRenderer.invoke('get-video-title', url),
    getVideoThumbnail: (url) => ipcRenderer.invoke('get-video-thumbnail', url),
    getPlaylistInfo: (url) => ipcRenderer.invoke('get-playlist-info', url),
    openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
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