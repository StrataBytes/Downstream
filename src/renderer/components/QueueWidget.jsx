import { useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { downloadAll } from '../services/downloadService';
import QueueRow from './QueueRow';

export default function QueueWidget() {
  const queue = useAppStore((s) => s.queue);
  const queueHistory = useAppStore((s) => s.queueHistory);
  const showHistory = useAppStore((s) => s.showHistory);
  const setShowHistory = useAppStore((s) => s.setShowHistory);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const isQueueing = useAppStore((s) => s.isQueueing);
  const setQueueingCancelled = useAppStore((s) => s.setQueueingCancelled);
  const clearAndCloseQueue = useAppStore((s) => s.clearAndCloseQueue);
  const setDownloadCancelled = useAppStore((s) => s.setDownloadCancelled);
  const openCancelModal = useAppStore((s) => s.openCancelModal);
  const totalProgress = useAppStore((s) => s.totalProgress);

  const [closing, setClosing] = useState(false);

  if (!queueOpen && queue.length === 0 && queueHistory.length === 0) return null;

  const busy = isDownloading || isQueueing;

  const handleClearAndClose = () => {
    setClosing(true);
    setTimeout(() => {
      clearAndCloseQueue();
      setClosing(false);
    }, 350); // matches CSS slide-out duration
  };

  const handleCancel = () => {
    if (!isDownloading) return;
    const remaining = queue.filter(
      (item) => !item.status?.includes('Completed') && !item.status?.includes('Complete')
    ).length;
    if (remaining <= 5) {
      setDownloadCancelled(true);
    } else {
      openCancelModal(remaining);
    }
  };

  const displayItems = showHistory ? queueHistory : queue;
  const hasHistory = queueHistory.length > 0;

  return (
    <div className={`queue-widget ${closing ? 'queue-widget-closing' : ''}`}>
      <div className="queue-header">
        <h2>{showHistory ? 'Completed' : 'Queue'}</h2>
        <div className="queue-header-right">
          {hasHistory && (
            <button
              className="btn-history-toggle"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? 'Back to Queue' : `Completed (${queueHistory.length})`}
            </button>
          )}
          <span className="queue-count">
            {showHistory
              ? `${queueHistory.length} completed`
              : `${queue.length} video${queue.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      <div className="queue-list">
        {displayItems.length === 0 && (
          <div className="queue-empty">
            {showHistory ? 'No completed items yet.' : 'Queue is empty.'}
          </div>
        )}
        {displayItems.map((item) => (
          <QueueRow key={item.url} item={item} showRemove={!showHistory} />
        ))}
      </div>

      {!showHistory && totalProgress.visible && (
        <div className="queue-total-progress">
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: `${totalProgress.total > 0 ? Math.floor((totalProgress.completed / totalProgress.total) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="progress-label">
            {totalProgress.text} &middot; {totalProgress.completed}/{totalProgress.total}
          </span>
        </div>
      )}

      {!showHistory && (
        <div className="queue-actions">
          <button
            className={`btn-primary ${busy ? 'btn-disabled' : ''}`}
            onClick={() => downloadAll()}
            disabled={busy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download All
          </button>
          {isDownloading && (
            <button className="btn-danger" onClick={handleCancel}>Cancel</button>
          )}
          {isQueueing && (
            <button className="btn-danger" onClick={() => setQueueingCancelled(true)}>Cancel</button>
          )}
          <button className={`btn-ghost ${busy ? 'btn-disabled' : ''}`} onClick={() => window.electronAPI.openDownloadsFolder()} disabled={busy}>
            Open Folder
          </button>
        </div>
      )}

      {!busy && (
        <button className="btn-clear-close" onClick={handleClearAndClose}>
          Clear &amp; Close
        </button>
      )}
    </div>
  );
}
