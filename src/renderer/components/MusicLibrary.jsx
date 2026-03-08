import { useState } from 'react';
import useAppStore from '../stores/useAppStore';

export default function MusicLibrary() {
  const musicFiles = useAppStore((s) => s.musicFiles);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicLibraryOpen = useAppStore((s) => s.musicLibraryOpen);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicLibraryOpen = useAppStore((s) => s.setMusicLibraryOpen);

  const [closing, setClosing] = useState(false);

  if (!musicLibraryOpen) return null;

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setMusicLibraryOpen(false);
    }, 350);
  };

  const handleSelect = (track) => {
    setMusicCurrent(track);
  };

  return (
    <div className={`music-library ${closing ? 'music-library-closing' : ''}`}>
      <div className="music-library-header">
        <h2>Library</h2>
        <div className="queue-header-right">
          <span className="queue-count">{musicFiles.length} tracks</span>
          <button className="btn-row-remove" onClick={handleClose} title="Close library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="music-library-list">
        {musicFiles.length === 0 && (
          <div className="queue-empty">No mp3 files found.</div>
        )}
        {musicFiles.map((track) => (
          <button
            key={track.path}
            className={`music-library-item ${musicCurrent?.path === track.path ? 'music-library-item-active' : ''}`}
            onClick={() => handleSelect(track)}
          >
            <svg className="music-library-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {musicCurrent?.path === track.path ? (
                <>
                  <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
                  <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
                </>
              ) : (
                <polygon points="5 3 19 12 5 21 5 3" fill="none" />
              )}
            </svg>
            <span className="music-library-name">{track.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
