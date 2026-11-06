import { useLayoutEffect, useRef } from 'react';
import useAppStore, { queueItemEditable } from '../stores/useAppStore';
import { QUALITIES, FORMATS } from '../utils/qualities';
import ScrollingText from './ScrollingText';
import TagSelect from './TagSelect';

export default function QueueRow({ item, inHistory }) {
  const { url, title, quality, format, status, progress, titleLoaded, failed, completed, fadingOut } = item;
  const editable = useAppStore((s) => !inHistory && queueItemEditable(item, s));
  const setQueueOptions = useAppStore((s) => s.setQueueOptions);
  const removeFromQueue = useAppStore((s) => s.removeFromQueue);
  const rowRef = useRef(null);

  // a finished row folds away, so the rows below slide up instead of jumping.
  // the list's gap folds with it.
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!fadingOut || !el) return;
    const instant = document.body.classList.contains('lite-no-anim');
    el.animate([
      { height: `${el.offsetHeight}px`, opacity: 1, marginBottom: '0px' },
      { height: '0px', opacity: 0, marginBottom: '-8px', paddingTop: '0px', paddingBottom: '0px', borderWidth: '0px' },
    ], { duration: instant ? 0 : 420, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
  }, [fadingOut]);

  const statusClass = failed ? ' status-error' : completed ? ' status-done' : '';
  const fill = completed ? ' fill-done' : failed ? ' fill-error' : status === 'Finalizing...' ? ' fill-finalizing' : '';

  return (
    <div ref={rowRef} className="queue-row">
      <div className="queue-row-top">
        <ScrollingText
          text={title}
          className={`queue-row-title${titleLoaded ? '' : ' skeleton-loader'}`}
        />
        {!inHistory && (
          <button
            className="btn-row-remove"
            onClick={() => removeFromQueue(url)}
            disabled={!editable}
            title="Remove from queue"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className="mini-progress-track">
        <div className={`mini-progress-fill${fill}`} style={{ width: `${progress ?? 0}%` }} />
      </div>
      <div className="queue-row-bottom">
        <span className={`queue-row-label${statusClass}`} title={status}>{status}</span>
        <span className="queue-row-tags">
          {format !== 'mp3' && (
            <TagSelect
              value={quality}
              options={QUALITIES}
              onChange={(value) => setQueueOptions({ quality: value }, url)}
              disabled={!editable}
              title="Quality"
            />
          )}
          <TagSelect
            value={format}
            options={FORMATS}
            onChange={(value) => setQueueOptions({ format: value }, url)}
            disabled={!editable}
            title="Format"
          />
        </span>
      </div>
    </div>
  );
}
