import { useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { addPlaylistToQueue, LARGE_BATCH } from '../services/downloadService';

const count = new Intl.NumberFormat();

export default function PlaylistModal() {
  const { open, info, quality, format } = useAppStore((s) => s.playlistModal);
  const closePlaylistModal = useAppStore((s) => s.closePlaylistModal);
  const [checked, setChecked] = useState({});
  const [closing, setClosing] = useState(false);

  if (!open || !info) return null;

  const videos = info.videos || [];

  const isChecked = (index) => checked[index] ?? true;

  const toggle = (index) =>
    setChecked((prev) => ({ ...prev, [index]: !isChecked(index) }));

  const selectAll = () => {
    const next = {};
    videos.forEach((_, i) => (next[i] = true));
    setChecked(next);
  };

  const deselectAll = () => {
    const next = {};
    videos.forEach((_, i) => (next[i] = false));
    setChecked(next);
  };

  const slideOut = (cb) => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      cb();
    }, 350);
  };

  const handleAdd = () => {
    const selected = videos.filter((_, i) => isChecked(i));
    slideOut(() => {
      closePlaylistModal();
      setChecked({});
    });
    // the flat-playlist data already includes every title, one batched store update, no per-video fetches, nothing to wait for or cancel.
    addPlaylistToQueue(selected, quality, format);
  };

  const handleCancel = () => {
    slideOut(() => {
      closePlaylistModal();
      setChecked({});
    });
  };

  const selectedCount = videos.filter((_, i) => isChecked(i)).length;

  return (
    <div className={`playlist-panel ${closing ? 'playlist-panel-closing' : ''}`}>
      <div className="playlist-panel-header">
        <h2>Playlist</h2>
        <span className="queue-count">{count.format(videos.length)} videos</span>
      </div>

      <div className="modal-actions">
        <button onClick={selectAll}>Select All</button>
        <button onClick={deselectAll}>Deselect All</button>
      </div>

      <div className="playlist-items">
        {info.truncated && (
          <div className="playlist-truncated-warning">
            {info.isRadio
              ? `⚠️ Mixes never end, so only the first ${videos.length} videos are listed`
              : `⚠️ YouTube stopped answering, so only ${count.format(videos.length)}${info.total ? ` of ${count.format(info.total)}` : ''} videos loaded`}
          </div>
        )}

        {videos.map((video, index) => (
          <div className="playlist-item" key={video.url}>
            <input
              type="checkbox"
              id={`playlist-video-${index}`}
              checked={isChecked(index)}
              onChange={() => toggle(index)}
            />
            <label htmlFor={`playlist-video-${index}`}>{video.title}</label>
          </div>
        ))}
      </div>

      {selectedCount >= LARGE_BATCH && (
        <div className="playlist-pacing-note">
          Big batches take longer pauses between downloads, so YouTube doesn't block them.
        </div>
      )}

      <div className="modal-buttons">
        <button onClick={handleAdd}>Add {selectedCount} Selected</button>
        <button id="cancel-modal-btn" onClick={handleCancel}>Cancel</button>
      </div>
    </div>
  );
}
