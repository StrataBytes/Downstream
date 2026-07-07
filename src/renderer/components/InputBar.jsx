import { useState, useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { addLinkToQueue } from '../services/downloadService';
import { validateMediaLink } from '../utils/linkCheck';
import { dbg } from '../services/debugLog';
import SearchResults from './SearchResults';

function isUrl(str) {
  return /^https?:\/\//i.test(str) || /^(www\.)/i.test(str);
}

export default function InputBar() {
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('high');
  const [format, setFormat] = useState('mp4');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [inputError, setInputError] = useState(null);
  const errorTimerRef = useRef(null);
  const openPlaylistModal = useAppStore((s) => s.openPlaylistModal);
  const setLoading = useAppStore((s) => s.setLoading);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showError = (reason) => {
    setInputError(reason);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setInputError(null), 5000);
  };

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isUrl(trimmed)) {
      setSearching(true);
      setSearchResults(null);
      dbg('search', `submit "${trimmed}"`);
      try {
        const results = await window.electronAPI.searchVideos(trimmed);
        dbg('search', `got ${Array.isArray(results) ? results.length : 'non-array'} result(s)`);
        setSearchResults(results);
      } catch (err) {
        dbg('search', '!', `error: ${err.message}`);
        setSearchResults([]);
      }
      setSearching(false);
      return;
    }

    // links: validates before anything touches the network, so a rejected typo costs zero requests.
    const check = validateMediaLink(trimmed);
    if (!check.ok) {
      dbg('link', '!', `rejected "${trimmed}": ${check.reason}`);
      showError(check.reason);
      return;
    }

    setSearchResults(null);

    // playlist detection is a local url-param check, only actual playlists need the enumeration call (which the modal requires anyway).
    // plain video links queue instantly with zero upfront fetches.
    let isPlaylistLink = false;
    try {
      const parsed = new URL(check.url);
      isPlaylistLink = parsed.searchParams.has('list') || parsed.searchParams.has('start_radio');
    } catch { /* validator already vetted it */ }

    if (isPlaylistLink) {
      setLoading(true, 'Loading playlist...');
      dbg('link', `enumerating playlist ${check.url}`);
      try {
        const playlistInfo = await window.electronAPI.getPlaylistInfo(check.url);
        setLoading(false);
        if (playlistInfo?.error) {
          // yt-dlp itself failed (e.g. missing/blocked binary), don't queue the playlist link as a fake "single video", tell the user instead.
          dbg('link', '!', `playlist enumeration failed: ${playlistInfo.message}`);
          showError(playlistInfo.message);
        } else if (playlistInfo?.videos?.length > 1) {
          dbg('link', `playlist with ${playlistInfo.videos.length} videos`);
          openPlaylistModal(playlistInfo, quality, format);
        } else {
          dbg('link', 'single video → queue');
          addLinkToQueue(check.url, quality, format);
        }
      } catch (err) {
        setLoading(false);
        dbg('link', '!', `playlist check failed: ${err.message} -- adding as single`);
        addLinkToQueue(check.url, quality, format);
      }
    } else {
      dbg('link', `add ${check.url}`);
      addLinkToQueue(check.url, quality, format);
    }

    setUrl('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <>
      <div className="input-bar">
        <input
          type="text"
          className="url-input"
          placeholder="Search for something or paste a link..."
          value={url}
          onChange={(e) => { setUrl(e.target.value); setInputError(null); }}
          onKeyDown={handleKeyDown}
        />
        <div className="input-controls">
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="highest">Highest</option>
            <option value="high">1080p</option>
            <option value="medium">720p</option>
            <option value="low">480p</option>
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="mp4">MP4</option>
            <option value="mp3">MP3</option>
          </select>
          <button className="btn-add" onClick={handleAdd} disabled={searching}>
            {searching ? (
              <span className="btn-add-searching">Searching...</span>
            ) : isUrl(url.trim()) ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Link
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.5" y1="16.5" x2="22" y2="22" />
                </svg>
                Search
              </>
            )}
          </button>
        </div>
      </div>
      {inputError && (
        <div className="input-bar-error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="13" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{inputError}</span>
        </div>
      )}
      <SearchResults
        results={searchResults}
        quality={quality}
        format={format}
        onClear={() => setSearchResults(null)}
      />
    </>
  );
}
