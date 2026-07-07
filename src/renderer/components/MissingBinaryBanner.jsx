import { useState } from 'react';
import useAppStore from '../stores/useAppStore';

// shown when yt-dlp and/or ffmpeg aren't on disk and downstream's own automatic recovery failed too, most commonly because windows defender/smartscreen removed or blocked one of them and the retry's network access failed as well.
// lets the user retry the same recovery on demand instead of silently having a broken downloader.
export default function MissingBinaryBanner() {
  const ffmpegReady = useAppStore((s) => s.ffmpegReady);
  const ytDlpReady = useAppStore((s) => s.ytDlpReady);
  const setFfmpegReady = useAppStore((s) => s.setFfmpegReady);
  const setYtDlpReady = useAppStore((s) => s.setYtDlpReady);
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const ffmpegMissing = ffmpegReady === false;
  const ytDlpMissing = ytDlpReady === false;

  if ((!ffmpegMissing && !ytDlpMissing) || dismissed) return null;

  const missingName = ffmpegMissing && ytDlpMissing
    ? 'yt-dlp and ffmpeg'
    : ytDlpMissing ? 'yt-dlp' : 'ffmpeg';

  const handleRetry = async () => {
    setRetrying(true);
    const [ffmpegOk, ytDlpOk] = await Promise.all([
      window.electronAPI.checkFfmpeg().catch(() => false),
      window.electronAPI.checkYtDlp().catch(() => false),
    ]);
    setFfmpegReady(ffmpegOk);
    setYtDlpReady(ytDlpOk);
    setRetrying(false);
  };

  return (
    <div className="binary-banner">
      <div className="update-banner-content">
        <svg className="update-banner-icon binary-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="update-banner-text">
          Windows blocked or removed <strong>{missingName}</strong>, and Downstream couldn't restore {ffmpegMissing && ytDlpMissing ? 'them' : 'it'} automatically.
          Downloads won't work until this is fixed -- check Windows Security &gt; Protection history to restore the file, then retry below.
        </span>
      </div>
      <div className="update-banner-actions">
        <button className="update-banner-btn update-banner-btn-update" onClick={handleRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <button className="update-banner-btn update-banner-btn-dismiss" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
