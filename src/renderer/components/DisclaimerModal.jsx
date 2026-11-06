import useAppStore from '../stores/useAppStore';

// each side asks once to be used responsibly before it opens, on its own, apart from any help.
const AGREEMENTS = {
  download: {
    title: 'Before you download',
    body: 'Only download content you own or have permission to access. Downloading copyrighted material without authorization may violate applicable laws. You are solely responsible for your use.',
    privacy: 'Downstream never tracks, logs or reports your downloads. Everything stays on your device.',
    storageKey: 'disclaimerDownloadAccepted',
  },
  player: {
    title: 'Before you play',
    body: 'Only play media you own or hold a valid license to use. Copyright compliance is your responsibility.',
    privacy: 'Downstream never monitors or logs your playback. Your library stays private.',
    storageKey: 'disclaimerPlayerAccepted',
  },
};

// whether a side has been agreed to, which any screen without an agreement always has.
export const agreed = (view) => !AGREEMENTS[view] || !!localStorage.getItem(AGREEMENTS[view].storageKey);

export default function DisclaimerModal({ type, onAccept }) {
  const goToView = useAppStore((s) => s.goToView);
  const agreement = AGREEMENTS[type];

  const handleAccept = () => {
    localStorage.setItem(agreement.storageKey, 'true');
    onAccept();
  };

  return (
    <div className="disclaimer-backdrop">
      <div className="disclaimer-modal" role="dialog" aria-label={agreement.title}>
        <span className="disclaimer-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </span>
        <h2 className="disclaimer-title">{agreement.title}</h2>
        <p className="disclaimer-text">{agreement.body}</p>
        <div className="disclaimer-privacy">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{agreement.privacy}</span>
        </div>
        <div className="disclaimer-buttons">
          <button type="button" className="disclaimer-btn disclaimer-btn-decline" onClick={() => goToView('home')}>
            Go back
          </button>
          <button type="button" className="disclaimer-btn disclaimer-btn-accept" onClick={handleAccept} autoFocus>
            I understand and agree
          </button>
        </div>
      </div>
    </div>
  );
}
