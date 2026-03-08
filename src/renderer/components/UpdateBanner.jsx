import { useState, useEffect } from 'react';

export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.electronAPI.checkVersion().then((data) => {
      if (data && data.outdated) setInfo(data);
    });
  }, []);

  if (!info || dismissed) return null;

  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <svg className="update-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="update-banner-text">{info.message}</span>
      </div>
      <div className="update-banner-actions">
        {info.updateUrl && (
          <button
            className="update-banner-btn update-banner-btn-update"
            onClick={() => window.electronAPI.openExternalUrl(info.updateUrl)}
          >
            Update
          </button>
        )}
        <button className="update-banner-btn update-banner-btn-dismiss" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
