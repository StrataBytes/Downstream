import { useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { addVideoToQueue } from '../services/downloadService';

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

  const handleAdd = async () => {
    const selected = videos.filter((_, i) => isChecked(i));
    slideOut(() => {
      closePlaylistModal();
      setChecked({});
    });

    const { setIsQueueing, setQueueingCancelled } = useAppStore.getState();
    setIsQueueing(true);
    setQueueingCancelled(false);

    for (const video of selected) {
      if (useAppStore.getState().queueingCancelled) break;
      await addVideoToQueue(video.url, quality, format);
    }

    setIsQueueing(false);
    setQueueingCancelled(false);
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
        <span className="queue-count">{videos.length} videos</span>
      </div>

      <div className="modal-actions">
        <button onClick={selectAll}>Select All</button>
        <button onClick={deselectAll}>Deselect All</button>
      </div>

      <div className="playlist-items">
        {info.truncated && (
          <div className="playlist-truncated-warning">
            {info.isRadio
              ? `⚠️ Radio limited to first ${videos.length} videos to prevent rate limiting`
              : `⚠️ Playlist limited to first ${videos.length} videos`}
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

      <div className="modal-buttons">
        <button onClick={handleAdd}>Add {selectedCount} Selected</button>
        <button id="cancel-modal-btn" onClick={handleCancel}>Cancel</button>
      </div>
    </div>
  );
}
