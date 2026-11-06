import { useState } from 'react';
import useAppStore, { queueItemEditable, queueItemWaiting } from '../stores/useAppStore';
import { requestDownloadAll, requestCancelDownloads } from '../services/downloadService';
import { baseName } from '../services/musicLibrary';
import { QUALITIES, FORMATS } from '../utils/qualities';
import QueueRow from './QueueRow';
import TagSelect from './TagSelect';

const count = new Intl.NumberFormat();

// the one value every item shares, or null when they differ.
function shared(items, key) {
  const values = new Set(items.map((item) => item[key]));
  return values.size === 1 ? [...values][0] : null;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

// where a batch is going, opened from here once it's under way.
function DownloadFolder() {
  const downloadFolder = useAppStore((s) => s.downloadFolder);
  return (
    <button
      className="btn-folder-main"
      onClick={() => window.electronAPI.openDownloadsFolder(downloadFolder)}
      title={downloadFolder ? `Open ${downloadFolder}` : 'Open the Downloads folder'}
    >
      <FolderIcon />
      <span>{downloadFolder ? baseName(downloadFolder) : 'Downloads'}</span>
    </button>
  );
}

// download all, which becomes the batch's progress and cancel while it runs, in the same space.
function QueueMainAction({ waiting, batch }) {
  const isDownloading = useAppStore((s) => s.isDownloading);
  const totalProgress = useAppStore((s) => s.totalProgress);

  if (batch) {
    const percent = totalProgress.total > 0 ? Math.floor((totalProgress.completed / totalProgress.total) * 100) : 0;
    return (
      <div className="queue-batch">
        <div className="queue-batch-info">
          <div className="queue-batch-text">
            <span>{totalProgress.text}</span>
            <span>{count.format(totalProgress.completed)} of {count.format(totalProgress.total)}</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <button className="queue-batch-cancel" onClick={requestCancelDownloads} disabled={!isDownloading}>Cancel</button>
      </div>
    );
  }

  return (
    <button className={`btn-primary queue-download${waiting === 0 ? ' btn-disabled' : ''}`} onClick={requestDownloadAll} disabled={waiting === 0}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Download All
    </button>
  );
}

export default function QueueWidget() {
  const queue = useAppStore((s) => s.queue);
  const queueHistory = useAppStore((s) => s.queueHistory);
  const showHistory = useAppStore((s) => s.showHistory);
  const setShowHistory = useAppStore((s) => s.setShowHistory);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const clearAndCloseQueue = useAppStore((s) => s.clearAndCloseQueue);
  const setQueueOptions = useAppStore((s) => s.setQueueOptions);
  const totalProgress = useAppStore((s) => s.totalProgress);
  // while save to is open, the queue waits under frost so nothing in it can be changed or started.
  const saving = useAppStore((s) => s.savePickerOpen);

  const currentView = useAppStore((s) => s.currentView);
  const [closing, setClosing] = useState(false);

  if (currentView !== 'download') return null;
  if (!queueOpen && queue.length === 0 && queueHistory.length === 0) return null;

  const busy = isDownloading;
  const fetchingTitles = queue.some((item) => !item.titleLoaded);
  // items that haven't started, which set all and download all work on.
  const waiting = queue.filter((item) => queueItemWaiting(item) && queueItemEditable(item, { isDownloading, nowPlaying }));
  const videos = waiting.filter((item) => item.format !== 'mp3');
  const historyView = showHistory && queueHistory.length > 0;
  // a batch shows while it runs, and its summary stays a moment after unless more is already waiting.
  const batch = isDownloading || (totalProgress.visible && waiting.length === 0);

  const handleClearAndClose = () => {
    setClosing(true);
    setTimeout(() => {
      clearAndCloseQueue();
      setClosing(false);
    }, 350); // matches CSS slide-out duration
  };

  const displayItems = historyView ? queueHistory : queue;

  return (
    <div className={`queue-widget${closing ? ' queue-widget-closing' : ''}${saving ? ' queue-widget-frosted' : ''}`} inert={saving}>
      <div className="queue-tabs" role="tablist">
        <button role="tab" aria-selected={!historyView} className={`queue-tab${historyView ? '' : ' queue-tab-active'}`} onClick={() => setShowHistory(false)}>
          Queue <span className="queue-tab-count">{count.format(queue.length)}</span>
        </button>
        <button role="tab" aria-selected={historyView} className={`queue-tab queue-tab-history${historyView ? ' queue-tab-active' : ''}`} onClick={() => setShowHistory(true)} disabled={queueHistory.length === 0}>
          Completed <span className="queue-tab-count">{count.format(queueHistory.length)}</span>
        </button>
      </div>

      {/* the row keeps its space while nothing is waiting, so the list doesn't shift. */}
      {!historyView && (
        <div className="queue-set-all">
          {waiting.length > 0 && <span className="queue-set-all-label">Set all</span>}
          {videos.length > 0 && (
            <TagSelect
              value={shared(videos, 'quality')}
              options={QUALITIES}
              onChange={(value) => setQueueOptions({ quality: value })}
              placeholder="Mixed"
              title="Quality for every video still waiting"
            />
          )}
          {waiting.length > 0 && (
            <TagSelect
              value={shared(waiting, 'format')}
              options={FORMATS}
              onChange={(value) => setQueueOptions({ format: value })}
              placeholder="Mixed"
              title="Format for everything still waiting"
            />
          )}
          {fetchingTitles && (
            <span className="queue-fetching" title="Titles load in the background, and downloads don't need to wait for them.">
              Fetching titles
            </span>
          )}
        </div>
      )}

      <div className="queue-list">
        {displayItems.length === 0 && <div className="queue-empty">Queue is empty.</div>}
        {displayItems.map((item) => (
          <QueueRow key={item.url} item={item} inHistory={historyView} />
        ))}
      </div>

      <div className="queue-footer">
        <QueueMainAction waiting={waiting.length} batch={batch} />
        <div className="queue-footer-row">
          {batch && <DownloadFolder />}
          <button className="queue-clear" onClick={handleClearAndClose} disabled={busy} title="Clear the queue and close it">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
