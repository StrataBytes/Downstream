import useAppStore from '../stores/useAppStore';

export default function MiniPlayer() {
  const currentView = useAppStore((s) => s.currentView);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const playNextTrack = useAppStore((s) => s.playNextTrack);
  const playPrevTrack = useAppStore((s) => s.playPrevTrack);

  if (currentView === 'player' || !musicCurrent) return null;

  return (
    <div className="mini-player">
      <button className="mini-player-btn" onClick={playPrevTrack} title="Previous">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="5" width="3" height="14" rx="1" />
          <polygon points="21 5 10 12 21 19 21 5" />
        </svg>
      </button>

      <button
        className="mini-player-btn mini-player-play"
        onClick={() => setMusicPlaying(!musicPlaying)}
        title={musicPlaying ? 'Pause' : 'Play'}
      >
        {musicPlaying ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        )}
      </button>

      <button className="mini-player-btn" onClick={playNextTrack} title="Next">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="3 5 14 12 3 19 3 5" />
          <rect x="18" y="5" width="3" height="14" rx="1" />
        </svg>
      </button>

      <span className="mini-player-track">{musicCurrent.name}</span>

      <button
        className="mini-player-return"
        onClick={() => setCurrentView('player')}
        title="Return to player"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <span>Player</span>
      </button>
    </div>
  );
}
