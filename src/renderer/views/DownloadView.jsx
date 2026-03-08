import useAppStore from '../stores/useAppStore';
import PrimaryWidget from '../components/PrimaryWidget';
import QueueWidget from '../components/QueueWidget';
import MusicLibrary from '../components/MusicLibrary';
import EQMixer from '../components/EQMixer';
import PlaylistModal from '../components/PlaylistModal';
import CancelModal from '../components/CancelModal';

export default function DownloadView() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const isQueueing = useAppStore((s) => s.isQueueing);
  const busy = isDownloading || isQueueing;

  return (
    <div className="layout">
      <button
        className={`btn-back${busy ? ' btn-back-disabled' : ''}`}
        onClick={() => !busy && setCurrentView('home')}
        title={busy ? 'Busy — wait for downloads to finish' : 'Back to home'}
        disabled={busy}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>
      <PrimaryWidget />
      <QueueWidget />
      <MusicLibrary />
      <EQMixer />
      <CancelModal />
      <PlaylistModal />
    </div>
  );
}
