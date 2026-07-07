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
  const clearAndCloseQueue = useAppStore((s) => s.clearAndCloseQueue);
  const setDownloadCancelled = useAppStore((s) => s.setDownloadCancelled);
  const openCancelModal = useAppStore((s) => s.openCancelModal);
  const setAllQueueFormat = useAppStore((s) => s.setAllQueueFormat);
  const totalProgress = useAppStore((s) => s.totalProgress);
  const downloadFolder = useAppStore((s) => s.downloadFolder);
  const setDownloadFolder = useAppStore((s) => s.setDownloadFolder);

  const currentView = useAppStore((s) => s.currentView);
  const [closing, setClosing] = useState(false);

  if (currentView !== 'download') return null;
  if (!queueOpen && queue.length === 0 && queueHistory.length === 0) return null;

  const busy = isDownloading;
  const fetchingTitles = queue.some((item) => !item.titleLoaded);

  const handleClearAndClose = () => {
    setClosing(true);
    setTimeout(() => {
      clearAndCloseQueue();
      setClosing(false);
    }, 350); // matches CSS slide-out duration
  };

  const handleChangeFolder = async () => {
    const selected = await window.electronAPI.selectDownloadFolder();
    if (selected) setDownloadFolder(selected);
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
          {!showHistory && !busy && queue.length > 0 && (
            <div className="queue-format-toggle">
              <button
                className="queue-format-btn"
                onClick={() => setAllQueueFormat('mp4')}
                title="Set all to MP4"
              >All MP4</button>
              <button
                className="queue-format-btn"
                onClick={() => setAllQueueFormat('mp3')}
                title="Set all to MP3"
              >All MP3</button>
            </div>
          )}
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

      {!showHistory && fetchingTitles && (
        <div className="queue-fetch-hint">
          Fetching titles in the background -- downloads don&apos;t need to wait.
        </div>
      )}

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
            className={`btn-primary ${(busy || queue.length === 0) ? 'btn-disabled' : ''}`}
            onClick={() => downloadAll()}
            disabled={busy || queue.length === 0}
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
          <div className={`btn-folder-split${busy ? ' btn-disabled' : ''}`}>
            <button
              className="btn-folder-main"
              onClick={() => window.electronAPI.openDownloadsFolder(downloadFolder)}
              disabled={busy}
              title={downloadFolder ? `Open: ${downloadFolder}` : 'Open Downloads folder'}
            >
              {downloadFolder
                ? `📁 ${downloadFolder.split(/[\\/]/).pop()}`
                : 'Open Folder'}
            </button>
            <button
              className="btn-folder-wedge"
              onClick={handleChangeFolder}
              disabled={busy}
              title="Change download location (this session only)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2,3 5,7 8,3" />
              </svg>
            </button>
          </div>
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
