import useAppStore from '../stores/useAppStore';
import { addVideoToQueue } from '../services/downloadService';

function formatDate(raw) {
  if (!raw) return '';
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${m}/${d}/${y}`;
  }
  return raw;
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SearchResults({ results, quality, format, onClear }) {
  const isDownloading = useAppStore((s) => s.isDownloading);
  const isQueueing = useAppStore((s) => s.isQueueing);
  const locked = isDownloading || isQueueing;

  if (!results || results.length === 0) return null;

  const handleSelect = async (result) => {
    if (locked) return;
    await addVideoToQueue(result.url, quality, format);
  };

  return (
    <div className="search-results">
      <div className="search-results-header">
        <span className="search-results-label">Search Results</span>
        <button className="search-results-close" onClick={onClear} title="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="search-results-list">
        {results.map((r, i) => (
          <div
            key={r.url + i}
            className={`search-result-item${locked ? ' search-result-locked' : ''}`}
            onClick={() => handleSelect(r)}
            title={locked ? 'Wait for current downloads to finish' : `Add "${r.title}" to queue`}
          >
            <div className="search-result-thumb">
              {r.thumbnail ? (
                <img src={r.thumbnail} alt="" draggable={false} />
              ) : (
                <div className="search-result-thumb-placeholder" />
              )}
              {r.duration && <span className="search-result-duration">{formatDuration(r.duration)}</span>}
            </div>
            <div className="search-result-info">
              <span className="search-result-title">{r.title}</span>
              <span className="search-result-meta">
                {r.channel}
                {r.uploadDate ? ` · ${formatDate(r.uploadDate)}` : ''}
              </span>
            </div>
            <div className="search-result-add">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
