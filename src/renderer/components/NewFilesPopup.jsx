import { useEffect, useRef } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';

const POLL_INTERVAL = 15000;

export default function NewFilesPopup() {
  const currentView = useAppStore((s) => s.currentView);
  const musicFolder = useAppStore((s) => s.musicFolder);
  const musicFiles = useAppStore((s) => s.musicFiles);
  const watchEnabled = useAppStore((s) => s.behaviorWatchFolder);
  const newFilesDetected = useAppStore((s) => s.newFilesDetected);
  const setNewFilesDetected = useAppStore((s) => s.setNewFilesDetected);
  const setMusicFiles = useAppStore((s) => s.setMusicFiles);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const knownCountRef = useRef(musicFiles.length);

  useEffect(() => {
    knownCountRef.current = musicFiles.length;
    setNewFilesDetected(false);
  }, [musicFiles]);

  // visible from the player (where the folder is actually being browsed) and the downloader (where a user queuing a bulk batch is likely to be sitting while those files land in a watched folder).
  // home doesn't get it, since there's no player context to reload into from there.
  const isRelevantView = currentView === 'player' || currentView === 'download';

  useEffect(() => {
    if (!watchEnabled || !musicFolder || !isRelevantView) return;

    const interval = setInterval(async () => {
      const exts = getAcceptedExtensions(useAppStore.getState());
      const files = await window.electronAPI.readMusicFolder(musicFolder, exts);
      if (files.length > knownCountRef.current) {
        setNewFilesDetected(true);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [watchEnabled, musicFolder, isRelevantView]);

  const handleReload = async () => {
    setMusicPlaying(false);
    setMusicCurrent(null);
    useAppStore.getState().clearBackgroundThumbnail();

    const exts = getAcceptedExtensions(useAppStore.getState());
    const files = await window.electronAPI.readMusicFolder(musicFolder, exts);
    setMusicFiles(files);
    if (files.length > 0) {
      // same rule as folder load: with shuffle active, the restart track should be random, not the alphabetically-first file.
      const first = useAppStore.getState().musicShuffle
        ? files[Math.floor(Math.random() * files.length)]
        : files[0];
      setMusicCurrent(first);
    }
    setNewFilesDetected(false);
  };

  if (!newFilesDetected || !isRelevantView) return null;

  return (
    <div className="new-files-popup">
      <div className="new-files-popup-content">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="new-files-popup-text">
          <span className="new-files-popup-title">New files detected</span>
          <span className="new-files-popup-desc">Reload to add them -- this will restart playback from the beginning.</span>
        </div>
      </div>
      <div className="new-files-popup-actions">
        <button className="new-files-popup-btn new-files-dismiss" onClick={() => setNewFilesDetected(false)}>
          Dismiss
        </button>
        <button className="new-files-popup-btn new-files-reload" onClick={handleReload}>
          Reload
        </button>
      </div>
    </div>
  );
}
