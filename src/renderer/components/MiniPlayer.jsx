import { useLayoutEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import ScrollingText from './ScrollingText';
import { DownloadIcon } from './InputBar';

const count = new Intl.NumberFormat();

// the running download, shown everywhere but the downloader, and for a moment after it finishes.
function DownloadPart({ leaving }) {
  const goToView = useAppStore((s) => s.goToView);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const { completed, total, text } = useAppStore((s) => s.totalProgress);
  const title = useAppStore((s) => s.nowPlaying?.title);
  const itemProgress = useAppStore((s) => s.queue.find((q) => q.url === s.nowPlaying?.url)?.progress ?? 0);

  // the current item's own progress fills in between finished ones.
  const fraction = total > 0 ? Math.min(1, (completed + (isDownloading ? itemProgress / 100 : 0)) / total) : 0;
  const label = isDownloading
    ? `${count.format(Math.min(completed + 1, total))} of ${count.format(total)}`
    : text === 'Complete!' ? 'Done' : text;

  return (
    <button
      className={`mini-player-download${isDownloading ? '' : ' mini-player-download-finished'}${leaving ? ' mini-player-part-leaving' : ''}`}
      onClick={() => goToView('download')}
      title={isDownloading && title ? `Downloading ${title}` : 'Open the downloader'}
    >
      <DownloadIcon size={14} busy={isDownloading} done={!isDownloading && text === 'Complete!'} />
      <span>{label}</span>
      <span className="mini-player-download-track">
        <span className="mini-player-download-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
    </button>
  );
}

// heading is the screen the app is fading over to, so the part that screen already shows fades out first.
export default function MiniPlayer({ heading }) {
  const currentView = useAppStore((s) => s.currentView);
  const homeIdleMode = useAppStore((s) => s.homeIdleMode);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const goToView = useAppStore((s) => s.goToView);
  const playNextTrack = useAppStore((s) => s.playNextTrack);
  const playPrevTrack = useAppStore((s) => s.playPrevTrack);
  const downloadShowing = useAppStore((s) => s.isDownloading || s.totalProgress.visible);
  const summaryLeaving = useAppStore((s) => !s.isDownloading && s.totalProgress.leaving);
  const pillRef = useRef(null);
  const lastWidth = useRef(null);

  const showMusic = currentView !== 'player' && !!musicCurrent;
  const showDownload = currentView !== 'download' && downloadShowing;
  const musicLeaving = showMusic && heading === 'player';
  const downloadLeaving = showDownload && (heading === 'download' || summaryLeaving);

  // the pill grows or shrinks as a part joins or leaves, instead of snapping to its new width.
  useLayoutEffect(() => {
    const el = pillRef.current;
    const from = lastWidth.current;
    lastWidth.current = el?.offsetWidth ?? null;
    if (!el || !from || from === el.offsetWidth || document.body.classList.contains('lite-no-anim')) return;
    el.animate([{ width: `${from}px` }, { width: `${el.offsetWidth}px` }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }, [showMusic, showDownload]);

  if (!showMusic && !showDownload) return null;
  const leaving = (!showMusic || musicLeaving) && (!showDownload || downloadLeaving);

  return (
    <div ref={pillRef} className={`mini-player${currentView === 'home' && homeIdleMode ? ' mini-player-idle' : ''}${leaving ? ' mini-player-leaving' : ''}`}>
      {showMusic && (
        <div className={`mini-player-music${musicLeaving ? ' mini-player-part-leaving' : ''}`}>
          <button className="mini-player-btn" onClick={playPrevTrack} title="Previous">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="5" width="3" height="14" rx="1" />
              <polygon points="21 5 10 12 21 19 21 5" />
            </svg>
          </button>

          <button
            className="mini-player-btn mini-player-play"
            onClick={() => setMusicPlaying(!musicPlaying)}
            title={musicPlaying ? 'Pause' : 'Play'}
          >
            {musicPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>
            )}
          </button>

          <button className="mini-player-btn" onClick={playNextTrack} title="Next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="3 5 14 12 3 19 3 5" />
              <rect x="18" y="5" width="3" height="14" rx="1" />
            </svg>
          </button>

          <ScrollingText text={musicCurrent.name} className="mini-player-track" />

          <button className="mini-player-return" onClick={() => goToView('player')} title="Return to player">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span>Player</span>
          </button>
        </div>
      )}
      {showMusic && showDownload && <span className="mini-player-divider" />}
      {showDownload && <DownloadPart leaving={downloadLeaving} />}
    </div>
  );
}
