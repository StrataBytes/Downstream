import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import ScrollingText from './ScrollingText';

export default function QueueRow({ item, showRemove }) {
  const { url, title, quality, format, status, progress, titleLoaded, failed, completed, fadingOut } = item;
  const removeFromQueue = useAppStore((s) => s.removeFromQueue);
  const setQueueItemFormat = useAppStore((s) => s.setQueueItemFormat);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const [ctxMenu, setCtxMenu] = useState(null);

  const statusClass = failed ? 'status-error' : completed ? 'status-done' : '';

  const handleContextMenu = (e) => {
    if (isDownloading) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  const swapFormat = format === 'mp3' ? 'mp4' : 'mp3';

  return (
    <>
    <div className={`queue-row ${fadingOut ? 'queue-row-fade-out' : ''}`} onContextMenu={handleContextMenu}>
      <div className="queue-row-info">
        <ScrollingText
          text={title}
          className={`queue-row-title${titleLoaded ? '' : ' skeleton-loader'}`}
        />
        <span className="queue-row-tags">
          <span className="tag">{quality}</span>
          <span className="tag">{format?.toUpperCase()}</span>
        </span>
        {showRemove && !isDownloading && (
          <button
            className="btn-row-remove"
            onClick={() => removeFromQueue(url)}
            title="Remove from queue"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className="queue-row-status">
        <div className="mini-progress-track">
          <div
            className={`mini-progress-fill ${completed ? 'fill-done' : ''} ${failed ? 'fill-error' : ''} ${status === 'Finalizing...' ? 'fill-finalizing' : ''}`}
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
        <span className={`queue-row-label ${statusClass}`}>{status}</span>
      </div>
    </div>
    {ctxMenu && (
      <div
        className="queue-ctx-menu"
        style={{ top: ctxMenu.y, left: ctxMenu.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="queue-ctx-item"
          onClick={() => { setQueueItemFormat(url, swapFormat); setCtxMenu(null); }}
        >
          Switch to {swapFormat.toUpperCase()}
        </button>
      </div>
    )}
    </>
  );
}
