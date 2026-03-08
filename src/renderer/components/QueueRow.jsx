import { useRef, useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';

export default function QueueRow({ item, showRemove }) {
  const { url, title, quality, format, status, progress, titleLoaded, failed, completed, fadingOut } = item;
  const removeFromQueue = useAppStore((s) => s.removeFromQueue);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const titleRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => {
      const isOverflowing = el.scrollWidth > el.clientWidth + 1;
      setOverflows(isOverflowing);
      if (isOverflowing) {
        const inner = el.firstElementChild;
        if (inner) {
          const dist = el.scrollWidth - el.clientWidth;
          inner.style.setProperty('--scroll-dist', `${-dist}px`);
          inner.style.setProperty('--scroll-dur', `${(dist / 20) + 4}s`);
        }
      }
    };
    check();
    const obs = new ResizeObserver(check);
    obs.observe(el);
    return () => obs.disconnect();
  }, [title]);

  const statusClass = failed ? 'status-error' : completed ? 'status-done' : '';

  return (
    <div className={`queue-row ${fadingOut ? 'queue-row-fade-out' : ''}`}>
      <div className="queue-row-info">
        <div
          ref={titleRef}
          className={`queue-row-title ${overflows ? 'queue-row-title-active' : ''} ${titleLoaded ? '' : 'skeleton-loader'}`}
        >
          <span className={overflows ? 'queue-row-title-scroll' : ''}>
            {title}
          </span>
        </div>
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
            className={`mini-progress-fill ${completed ? 'fill-done' : ''} ${failed ? 'fill-error' : ''}`}
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
        <span className={`queue-row-label ${statusClass}`}>{status}</span>
      </div>
    </div>
  );
}
