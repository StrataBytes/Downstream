import useAppStore from '../stores/useAppStore';
import { cancelPlaylistLoad, LARGE_BATCH } from '../services/downloadService';

const count = new Intl.NumberFormat();

// a playlist gets its own loading screen, since a long one takes a while.
function PlaylistLoading({ title, found, total, endless }) {
  const known = total > 0;
  const status = found === 0
    ? 'Finding videos...'
    : known
      ? `${count.format(found)} of ${count.format(total)} videos`
      : `${count.format(found)} videos found`;

  return (
    <div className="loading-overlay">
      <div className="playlist-loading">
        <span className="playlist-loading-label">{endless ? 'Loading mix' : 'Loading playlist'}</span>
        <span className="playlist-loading-title">{title}</span>
        <div className="shimmer-bar">
          <div
            className={`shimmer-bar-fill${known ? '' : ' shimmer-bar-fill-unknown'}`}
            style={{ width: known ? `${Math.min(100, (found / total) * 100)}%` : '100%' }}
          />
        </div>
        <span className="playlist-loading-status">{status}</span>
        {endless ? (
          <span className="playlist-loading-note">Mixes never end, so only the first {total} are listed.</span>
        ) : total > LARGE_BATCH ? (
          <span className="playlist-loading-note">Long playlists load a page at a time to stay under YouTube's limits.</span>
        ) : null}
        <button className="playlist-loading-cancel" onClick={cancelPlaylistLoad}>Cancel</button>
      </div>
    </div>
  );
}

export default function LoadingOverlay() {
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingText = useAppStore((s) => s.loadingText);
  const playlist = useAppStore((s) => s.playlistLoading);

  if (playlist) return <PlaylistLoading {...playlist} />;
  if (!isLoading) return null;

  return (
    <div className="loading-overlay" style={{ display: 'flex' }}>
      <div className="loading-spinner" />
      <div className="loading-text">{loadingText}</div>
    </div>
  );
}
