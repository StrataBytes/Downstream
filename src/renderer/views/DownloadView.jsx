import { useState } from 'react';
import { createPortal } from 'react-dom';
import useAppStore from '../stores/useAppStore';
import PrimaryWidget from '../components/PrimaryWidget';
import QueueWidget from '../components/QueueWidget';
import MusicLibrary from '../components/MusicLibrary';
import EQMixer from '../components/EQMixer';
import PlaylistModal from '../components/PlaylistModal';
import CancelModal from '../components/CancelModal';
import Guide from '../components/GuideModal';
import NormalizationInfoModal from '../components/NormalizationInfoModal';

export default function DownloadView() {
  const currentView = useAppStore((s) => s.currentView);
  const goToView = useAppStore((s) => s.goToView);
  const picking = useAppStore((s) => s.playlistModal.open);
  const idle = useAppStore((s) => s.playerIdle && s.currentView === 'player');
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="layout">
      {/* the playlist picker covers this corner, and is finished or skipped before leaving. */}
      <div className={`btn-corner-zone${picking ? ' btn-corner-zone-hidden' : ''}${idle ? ' btn-corner-zone-idle' : ''}`} inert={picking}>
        <button className="btn-back" onClick={() => goToView('home')} title="Back to home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
        {/* opens out to show its name while the pointer is on it. */}
        <button className="btn-guide-hint" onClick={() => setGuideOpen(true)} aria-label="Guide">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18c0 1.657 1.343 3 3 3s3-1.343 3-3" />
            <path d="M12 2C8.686 2 6 4.686 6 8c0 2.5 1.5 4.5 3 6h6c1.5-1.5 3-3.5 3-6 0-3.314-2.686-6-6-6z" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
          <span className="btn-guide-label">Guide</span>
        </button>
      </div>
      <PrimaryWidget />
      <QueueWidget />
      <MusicLibrary />
      <PlaylistModal />
      {/* these cover the whole window, so they sit outside the view, which the visualizer is drawn over. */}
      {createPortal(
        <>
          <CancelModal />
          <EQMixer />
          <NormalizationInfoModal />
          {guideOpen && <Guide view={currentView === 'player' ? 'player' : 'download'} onClose={() => setGuideOpen(false)} />}
        </>,
        document.body,
      )}
    </div>
  );
}
