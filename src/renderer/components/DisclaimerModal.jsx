import useAppStore from '../stores/useAppStore';

const DOWNLOAD_DISCLAIMER = {
  title: 'Before You Download',
  body: 'Only download content you own or have permission to access. Downloading copyrighted material without authorization may violate applicable laws -- you are solely responsible for your use.',
  privacy: 'Downstream never tracks, logs, or reports your downloads. Everything stays on your device.',
  storageKey: 'disclaimerDownloadAccepted',
};

const PLAYER_DISCLAIMER = {
  title: 'Before You Play',
  body: 'Only play music you own or hold a valid license to use. Copyright compliance is your responsibility.',
  privacy: 'Downstream never monitors or logs your playback. Your library stays completely private.',
  storageKey: 'disclaimerPlayerAccepted',
};

export default function DisclaimerModal({ type, onAccept }) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const disclaimer = type === 'download' ? DOWNLOAD_DISCLAIMER : PLAYER_DISCLAIMER;

  const handleAccept = () => {
    localStorage.setItem(disclaimer.storageKey, 'true');
    onAccept();
  };

  const handleDecline = () => {
    setCurrentView('home');
  };

  return (
    <div className="disclaimer-backdrop">
      <div className="disclaimer-modal">
        <div className="disclaimer-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 className="disclaimer-title">{disclaimer.title}</h2>
        <p className="disclaimer-text">{disclaimer.body}</p>
        <div className="disclaimer-privacy">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{disclaimer.privacy}</span>
        </div>
        <div className="disclaimer-buttons">
          <button className="disclaimer-btn disclaimer-btn-decline" onClick={handleDecline}>
            Go Back
          </button>
          <button className="disclaimer-btn disclaimer-btn-accept" onClick={handleAccept}>
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}
