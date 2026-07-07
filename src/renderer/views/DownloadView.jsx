import { useState } from 'react';
import useAppStore from '../stores/useAppStore';
import PrimaryWidget from '../components/PrimaryWidget';
import QueueWidget from '../components/QueueWidget';
import MusicLibrary from '../components/MusicLibrary';
import EQMixer from '../components/EQMixer';
import PlaylistModal from '../components/PlaylistModal';
import CancelModal from '../components/CancelModal';
import BehaviorModal from '../components/BehaviorModal';
import GuideModal from '../components/GuideModal';
import NormalizationInfoModal from '../components/NormalizationInfoModal';

export default function DownloadView() {
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const busy = isDownloading;
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="layout">
      <div className="btn-corner-zone">
        <button
          className={`btn-back${busy ? ' btn-back-disabled' : ''}`}
          onClick={() => !busy && setCurrentView('home')}
          title={busy ? 'Busy -- wait for downloads to finish' : 'Back to home'}
          disabled={busy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
        <button
          className="btn-guide-hint"
          onClick={() => setGuideOpen(true)}
          title="Getting started guide"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18c0 1.657 1.343 3 3 3s3-1.343 3-3" />
            <path d="M12 2C8.686 2 6 4.686 6 8c0 2.5 1.5 4.5 3 6h6c1.5-1.5 3-3.5 3-6 0-3.314-2.686-6-6-6z" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
      </div>
      <PrimaryWidget />
      <QueueWidget />
      <MusicLibrary />
      <EQMixer />
      <CancelModal />
      <PlaylistModal />
      <BehaviorModal />
      <NormalizationInfoModal />
      {guideOpen && <GuideModal type={currentView === 'player' ? 'player' : 'download'} onDismiss={() => setGuideOpen(false)} />}
    </div>
  );
}
