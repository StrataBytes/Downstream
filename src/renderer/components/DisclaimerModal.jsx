import useAppStore from '../stores/useAppStore';

const DOWNLOAD_DISCLAIMER = {
  title: 'Content Download Disclaimer',
  paragraphs: [
    'This downloader is provided for personal and lawful use only. You must have explicit permission from the content creator or rights holder before downloading any material.',
    'Downloading copyrighted content without authorization may violate applicable laws and the terms of service of the source platform.',
    'By proceeding, you confirm that you will only download content you have the right to access and that you accept full responsibility for your use of this tool.',
  ],
  storageKey: 'disclaimerDownloadAccepted',
};

const PLAYER_DISCLAIMER = {
  title: 'Music Player Disclaimer',
  paragraphs: [
    'This music player is intended primarily for playing No Copyright Sounds (NCS), royalty-free music, and content you own or have been granted a license to use.',
    'You are solely responsible for ensuring that any music you play complies with applicable copyright laws. Playing copyrighted material without proper authorization may violate those laws.',
    'By proceeding, you confirm that you will abide by all copyright laws and accept full responsibility for the content you play.',
  ],
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
        {disclaimer.paragraphs.map((p, i) => (
          <p className="disclaimer-text" key={i}>{p}</p>
        ))}
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
