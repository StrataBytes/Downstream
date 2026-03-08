import { useEffect } from 'react';
import useAppStore from '../stores/useAppStore';

let listenersRegistered = false;

export function useIPCListeners() {
  useEffect(() => {
    if (listenersRegistered) return;
    listenersRegistered = true;

    window.electronAPI.on('download-progress', (_event, { url, progress }) => {
      useAppStore.getState().updateQueueItem(url, {
        progress,
        status: `Downloading (${progress}%)`,
      });
    });

    window.electronAPI.on('download-complete', (_event, { url, success }) => {
      useAppStore.getState().updateQueueItem(url, {
        status: success ? 'Converting...' : 'Download Failed',
        failed: !success,
      });
    });

    window.electronAPI.on('conversion-complete', (_event, { url, success }) => {
      useAppStore.getState().updateQueueItem(url, {
        status: success ? 'Completed' : 'Conversion Failed',
        progress: success ? 100 : undefined,
        failed: !success,
        completed: success,
      });

      if (success) {
        setTimeout(() => {
          useAppStore.getState().fadeOutToHistory(url);
          setTimeout(() => {
            useAppStore.getState().moveToHistory(url);
          }, 500); // matches CSS fade-out duration
        }, 1200); // brief pause so user sees "Completed"
      }
    });

    window.electronAPI.on('download-error', (_event, { url, error }) => {
      useAppStore.getState().updateQueueItem(url, {
        status: `Error: ${error}`,
        failed: true,
      });
    });
  }, []);
}
