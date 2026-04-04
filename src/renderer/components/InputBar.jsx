import { useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { addVideoToQueue } from '../services/downloadService';
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
  const openPlaylistModal = useAppStore((s) => s.openPlaylistModal);
  const setLoading = useAppStore((s) => s.setLoading);
  const isQueueing = useAppStore((s) => s.isQueueing);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const locked = isQueueing || isDownloading;

  const handleAdd = async () => {
    if (locked) return;
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isUrl(trimmed)) {
      setSearching(true);
      setSearchResults(null);
      try {
        const results = await window.electronAPI.searchVideos(trimmed);
        setSearchResults(results);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      }
      setSearching(false);
      return;
    }

    setSearchResults(null);
    setLoading(true, 'Loading playlist...');
    try {
      const playlistInfo = await window.electronAPI.getPlaylistInfo(trimmed);
      setLoading(false);

      if (playlistInfo?.videos?.length > 1) {
        openPlaylistModal(playlistInfo, quality, format);
      } else {
        await addVideoToQueue(trimmed, quality, format);
      }
    } catch (err) {
      setLoading(false);
      console.error('Error checking playlist:', err);
      await addVideoToQueue(trimmed, quality, format);
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
          placeholder="Paste a link or search..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={locked}
        />
        <div className="input-controls">
          <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={locked}>
            <option value="highest">Highest</option>
            <option value="high">1080p</option>
            <option value="medium">720p</option>
            <option value="low">480p</option>
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={locked}>
            <option value="mp4">MP4</option>
            <option value="mp3">MP3</option>
          </select>
          <button className={`btn-add ${locked ? 'btn-disabled' : ''}`} onClick={handleAdd} disabled={locked || searching}>
            {searching ? (
              <span className="btn-add-searching">Searching...</span>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
              </>
            )}
          </button>
        </div>
      </div>
      <SearchResults
        results={searchResults}
        quality={quality}
        format={format}
        onClear={() => setSearchResults(null)}
      />
    </>
  );
}
