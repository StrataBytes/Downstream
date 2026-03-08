import { useRef, useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';

export default function NowPlaying() {
  const nowPlaying = useAppStore((s) => s.nowPlaying);
  const totalProgress = useAppStore((s) => s.totalProgress);
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
  }, [nowPlaying?.title]);

  if (!nowPlaying) return null;

  const percent =
    totalProgress.total > 0
      ? Math.floor((totalProgress.completed / totalProgress.total) * 100)
      : 0;

  return (
    <div className="now-playing">
      {nowPlaying.thumbnail && (
        <img
          className="now-playing-thumb"
          src={nowPlaying.thumbnail}
          alt=""
          draggable={false}
        />
      )}
      <div className="now-playing-info">
        <div
          ref={titleRef}
          className={`now-playing-title ${overflows ? 'now-playing-title-active' : ''}`}
        >
          <span className={overflows ? 'now-playing-title-scroll' : ''}>
            {nowPlaying.title}
          </span>
        </div>
        <div className="now-playing-meta">
          {nowPlaying.uploader && (
            <span className="meta-item">{nowPlaying.uploader}</span>
          )}
          {nowPlaying.uploadDate && (
            <span className="meta-item">{nowPlaying.uploadDate}</span>
          )}
        </div>
        <div className="now-playing-progress">
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="progress-label">
            {totalProgress.text} &middot; {totalProgress.completed}/{totalProgress.total}
          </span>
        </div>
      </div>
    </div>
  );
}
