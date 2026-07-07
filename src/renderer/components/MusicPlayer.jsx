import { useState, useEffect } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import { dbg } from '../services/debugLog';
import ScrollingText from './ScrollingText';

export default function MusicPlayer() {
  const musicFolder = useAppStore((s) => s.musicFolder);
  const musicFiles = useAppStore((s) => s.musicFiles);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const musicLibraryOpen = useAppStore((s) => s.musicLibraryOpen);
  const musicShuffle = useAppStore((s) => s.musicShuffle);
  const musicRepeat = useAppStore((s) => s.musicRepeat);
  const musicNormalize = useAppStore((s) => s.musicNormalize);
  const setMusicFolder = useAppStore((s) => s.setMusicFolder);
  const setMusicFiles = useAppStore((s) => s.setMusicFiles);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const setMusicLibraryOpen = useAppStore((s) => s.setMusicLibraryOpen);
  const toggleMusicRepeat = useAppStore((s) => s.toggleMusicRepeat);
  const toggleMusicShuffle = useAppStore((s) => s.toggleMusicShuffle);
  const toggleMusicNormalize = useAppStore((s) => s.toggleMusicNormalize);
  const playNextTrack = useAppStore((s) => s.playNextTrack);
  const playPrevTrack = useAppStore((s) => s.playPrevTrack);
  const musicVolume = useAppStore((s) => s.musicVolume);
  const setMusicVolume = useAppStore((s) => s.setMusicVolume);
  const eqOpen = useAppStore((s) => s.eqOpen);
  const setEqOpen = useAppStore((s) => s.setEqOpen);
  const behaviorOpen = useAppStore((s) => s.behaviorOpen);
  const setBehaviorOpen = useAppStore((s) => s.setBehaviorOpen);
  const playerViewMode = useAppStore((s) => s.playerViewMode);
  const musicFolderView = useAppStore((s) => s.musicFolderView);
  const setMusicFolderView = useAppStore((s) => s.setMusicFolderView);
  const savedFolders = useAppStore((s) => s.savedFolders);
  const addSavedFolder = useAppStore((s) => s.addSavedFolder);
  const removeSavedFolder = useAppStore((s) => s.removeSavedFolder);
  const loudnessScanningTrack = useAppStore((s) => s.loudnessScanningTrack);
  const setNormInfoOpen = useAppStore((s) => s.setNormInfoOpen);

  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadFolder = async (folder) => {
    setMusicFolder(folder);
    const state = useAppStore.getState();
    const exts = getAcceptedExtensions(state);
    dbg('library', `loading "${folder}" (accepts ${exts.join(', ')})`);
    const files = await window.electronAPI.readMusicFolder(folder, exts);

    if (files.length === 0) {
      dbg('library', '!', 'no supported files found');
      setToast(`No supported files found. Add ${exts.map(e => '.' + e).join(', ')} files to this folder.`);
      setMusicFolder(null);
      return;
    }

    // when shuffle will be active (already on, or about to be enabled by shuffle on start below), the first track must be random too.
    // toggleMusicShuffle anchors its queue on the current track, so seeding with files[0] made the same alphabetically-first song open every session even though the rest of the queue was shuffled.
    const willShuffle = state.musicShuffle || state.behaviorShuffleOnStart;
    const first = willShuffle ? files[Math.floor(Math.random() * files.length)] : files[0];
    dbg('library', `loaded ${files.length} track(s), auto-selecting "${first.name}"${willShuffle ? ' (random start)' : ''}`);
    setMusicFiles(files);
    setMusicCurrent(first);
    setMusicFolderView(false);
    setToast(null);

    if (state.behaviorNormalizeOnStart && !state.musicNormalize) {
      state.toggleMusicNormalize();
    }
    if (state.behaviorShuffleOnStart && !state.musicShuffle) {
      state.toggleMusicShuffle();
    }
  };

  const handleAddFolder = async () => {
    const folder = await window.electronAPI.selectMusicFolder();
    if (!folder) return;
    addSavedFolder(folder);
    await loadFolder(folder);
  };

  const handleRemoveFolder = (e, folder) => {
    e.stopPropagation();
    removeSavedFolder(folder);
  };

  const handlePlayPause = () => {
    if (!musicCurrent) return;
    setMusicPlaying(!musicPlaying);
  };

  const showFolderSelect = !musicFolder || musicFolderView || (!musicPlaying && !musicCurrent);
  if (showFolderSelect) {
    return (
      <div className="music-folder-select">
        <h2 className="folder-select-title">Select a Folder</h2>
        <div className="folder-grid">
          {savedFolders.map((f) => (
            <div
              key={f}
              className={`folder-card${f === musicFolder ? ' folder-card-active' : ''}`}
              onClick={() => loadFolder(f)}
              title={f}
            >
              <button
                className="folder-card-remove"
                onClick={(e) => handleRemoveFolder(e, f)}
                title="Remove"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <svg className="folder-card-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="folder-card-name">{f.split(/[/\\]/).pop()}</span>
            </div>
          ))}
          <div className="folder-card folder-card-add" onClick={handleAddFolder} title="Add new folder">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="folder-card-name">Add Folder</span>
          </div>
        </div>
        {toast && (
          <div className="folder-toast">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{toast}</span>
          </div>
        )}
      </div>
    );
  }

  const isCommander = playerViewMode === 'commander';

  return (
    <div className={`music-player${isCommander ? ' music-player-commander' : ''}`}>
      <ScrollingText
        text={musicCurrent ? musicCurrent.name : 'No track selected'}
        variant="ambient"
        className="music-track-name"
      />

      <div className="music-controls">
        <button
          className={`btn-music-toggle${musicShuffle ? ' btn-music-toggle-active' : ''}`}
          onClick={toggleMusicShuffle}
          title="Randomize Playlist"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
        </button>

        <button className="btn-music-control" onClick={playPrevTrack} title="Previous">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="5" width="3" height="14" rx="1" />
            <polygon points="21 5 10 12 21 19 21 5" />
          </svg>
        </button>

        <button className="btn-music-play" onClick={handlePlayPause} title={musicPlaying ? 'Pause' : 'Play'}>
          {musicPlaying ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          )}
        </button>

        <button className="btn-music-control" onClick={playNextTrack} title="Next">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="3 5 14 12 3 19 3 5" />
            <rect x="18" y="5" width="3" height="14" rx="1" />
          </svg>
        </button>

        <button
          className={`btn-music-toggle${musicRepeat ? ' btn-music-toggle-active' : ''}`}
          onClick={toggleMusicRepeat}
          title="Repeat Current Track Infinitely"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
      </div>

      <div className="music-player-extras">

      <div className="music-volume">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {musicVolume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
          {musicVolume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
        </svg>
        <input
          type="range"
          className="music-volume-slider"
          min="0"
          max="1"
          step="0.01"
          value={musicVolume}
          onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
          title={`Volume: ${Math.round(musicVolume * 100)}%`}
        />
      </div>

      <div className="music-actions">
        <div className="music-folder-name" onClick={() => setMusicFolderView(true)} title="Change folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>{musicFolder.split(/[/\\]/).pop()}</span>
        </div>
        <div
          className="music-folder-name"
          onClick={() => setMusicLibraryOpen(!musicLibraryOpen)}
          title="Toggle library"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span>Library</span>
        </div>
        <div
          className="music-folder-name"
          onClick={() => setEqOpen(!eqOpen)}
          title="Toggle equalizer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span>EQ</span>
        </div>
        <div
          className={`music-folder-name${musicNormalize ? ' music-folder-name-active' : ''}`}
          onClick={toggleMusicNormalize}
          title="Volume normalization"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="7" x2="5" y2="17" />
            <line x1="10" y1="7" x2="10" y2="17" />
            <line x1="15" y1="7" x2="15" y2="17" />
            <line x1="20" y1="7" x2="20" y2="17" />
          </svg>
          <span>Norm</span>
        </div>
        <div
          className={`music-folder-name${behaviorOpen ? ' music-folder-name-active' : ''}`}
          onClick={() => setBehaviorOpen(!behaviorOpen)}
          title="Playback behavior"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
          </svg>
          <span>Behavior</span>
        </div>
      </div>

      </div>

      {loudnessScanningTrack && (
        <div
          className="norm-scan-toast"
          onClick={() => setNormInfoOpen(true)}
          title="Click to learn how Contextual Normalization works"
        >
          <div className="norm-scan-title-row">
            <ScrollingText text="Normalizing your Library..." className="norm-scan-title" />
            <svg className="norm-scan-info-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <ScrollingText text={loudnessScanningTrack} className="norm-scan-track" />
        </div>
      )}
    </div>
  );
}
