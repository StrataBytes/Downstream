import { useState, useRef, useEffect, useMemo } from 'react';
import useAppStore from '../stores/useAppStore';

const SORTS = {
  'name-asc': { label: 'Name (A–Z)', compare: (a, b) => a.name.localeCompare(b.name) },
  'date-desc': { label: 'Date Modified (Newest First)', compare: (a, b) => (b.mtime || 0) - (a.mtime || 0) },
  'date-asc': { label: 'Date Modified (Oldest First)', compare: (a, b) => (a.mtime || 0) - (b.mtime || 0) },
};

function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function MusicLibrary() {
  const musicFiles = useAppStore((s) => s.musicFiles);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicLibraryOpen = useAppStore((s) => s.musicLibraryOpen);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicLibraryOpen = useAppStore((s) => s.setMusicLibraryOpen);
  const sortBy = useAppStore((s) => s.musicLibrarySort);
  const setSortBy = useAppStore((s) => s.setMusicLibrarySort);

  const [closing, setClosing] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const sortMenuRef = useRef(null);
  const searchInputRef = useRef(null);

  // closes the sort menu on any click outside it.
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onClick = (e) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const visibleTracks = useMemo(() => {
    const filtered = searchQuery.trim()
      ? musicFiles.filter((t) => fuzzyMatch(searchQuery, t.name))
      : musicFiles;
    const compare = (SORTS[sortBy] || SORTS['name-asc']).compare;
    return [...filtered].sort(compare);
  }, [musicFiles, searchQuery, sortBy]);

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

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery('');
    } else {
      setSearchOpen(true);
    }
  };

  return (
    <div className={`music-library ${closing ? 'music-library-closing' : ''}`}>
      <div className="music-library-header">
        <h2>Library</h2>
        <div className="queue-header-right">
          <span className="queue-count">{visibleTracks.length} tracks</span>
          <button className="btn-row-remove" onClick={handleClose} title="Close library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="music-library-toolbar">
        <div className="music-library-sort" ref={sortMenuRef}>
          <button
            className={`music-library-tool-btn${sortMenuOpen ? ' music-library-tool-btn-active' : ''}`}
            onClick={() => setSortMenuOpen((v) => !v)}
            title="Sort tracks"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Sort</span>
          </button>
          {sortMenuOpen && (
            <div className="music-library-sort-menu">
              {Object.entries(SORTS).map(([id, { label }]) => (
                <button
                  key={id}
                  className={`music-library-sort-option${sortBy === id ? ' music-library-sort-option-active' : ''}`}
                  onClick={() => { setSortBy(id); setSortMenuOpen(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className={`music-library-tool-btn${searchOpen ? ' music-library-tool-btn-active' : ''}`}
          onClick={toggleSearch}
          title="Search tracks"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="22" y2="22" />
          </svg>
        </button>
      </div>

      {searchOpen && (
        <div className="music-library-search-row">
          <svg className="music-library-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="22" y2="22" />
          </svg>
          <input
            ref={searchInputRef}
            className="music-library-search-input"
            type="text"
            placeholder="Filter tracks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') toggleSearch(); }}
          />
          {searchQuery && (
            <button className="music-library-search-clear" onClick={() => setSearchQuery('')} title="Clear">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="music-library-list">
        {musicFiles.length === 0 && (
          <div className="queue-empty">No mp3 files found.</div>
        )}
        {musicFiles.length > 0 && visibleTracks.length === 0 && (
          <div className="queue-empty">No tracks match your search.</div>
        )}
        {visibleTracks.map((track) => (
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
