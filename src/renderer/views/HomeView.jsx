import useAppStore from '../stores/useAppStore';
import UpdateBanner from '../components/UpdateBanner';

export default function HomeView() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <div className="layout">
      <UpdateBanner />
      <div className="home-widget">
        <h1 className="home-title">DownStream</h1>
        <p className="home-subtitle">What would you like to do?</p>

        <div className="home-options">
          <button className="home-option" onClick={() => setCurrentView('download')}>
            <div className="home-option-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <span className="home-option-label">Downloader</span>
            <span className="home-option-desc">Download internet videos & audio</span>
          </button>

          <button className="home-option" onClick={() => setCurrentView('player')}>
            <div className="home-option-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <span className="home-option-label">Music Player</span>
            <span className="home-option-desc">Play your local music library</span>
          </button>
        </div>
      </div>
      <span className="home-version">v2.1.1</span>
    </div>
  );
}
