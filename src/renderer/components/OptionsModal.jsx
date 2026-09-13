import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';

const LITE_TOGGLES = [
  {
    key: 'liteDisableBlur',
    setter: 'setLiteDisableBlur',
    label: 'Disable Blur Effects',
    description:
      'Removes backdrop-filter blur from all panels, modals, and overlays. This is typically the single most expensive effect on integrated GPUs.',
  },
  {
    key: 'liteDisableAnimations',
    setter: 'setLiteDisableAnimations',
    label: 'Reduce Animations',
    description:
      'Shortens transitions and slide-in animations to near-instant. Spinners and the startup sequence are kept intact.',
  },
  {
    key: 'liteDisableVisualizer',
    setter: 'setLiteDisableVisualizer',
    label: 'Disable Audio Visualizer',
    description:
      'Stops the 60 fps frequency-bar canvas that renders behind the player. Frees up a full animation frame loop.',
  },
  {
    key: 'liteDisableVideoBackground',
    setter: 'setLiteDisableVideoBackground',
    label: 'Disable Video Backgrounds',
    description:
      'Prevents MP4 files from playing as the full-screen background. Still images and album art are unaffected.',
  },
];

const STARTUP_TOGGLES = [
  {
    key: 'checkUpdatesOnStart',
    setter: 'setCheckUpdatesOnStart',
    label: 'Check for Updates on Start',
    description:
      'Query the latest version info each time the app launches and show a banner if a newer release is available.',
  },
];

// modular profile list, add new rendering profiles here as they're built.
// `toggles: null` renders an empty-state message in the drawer instead.
const PROFILES = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'The full visual experience -- blur, smooth animations, and the audio visualizer all enabled.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.6 6.6L21 10l-5 4.3L17.4 21 12 17.3 6.6 21 8 14.3 3 10l6.4-1.4z" />
      </svg>
    ),
    toggles: null,
  },
  {
    id: 'lite',
    name: 'Lite Mode',
    description: 'Reduces GPU-intensive effects for smoother performance on older or low-power hardware.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    toggles: LITE_TOGGLES,
  },
];

function ProfileTile({ profile, active, expanded, onSelect, onToggleExpand, store }) {
  const drawerOpen = active && expanded;

  return (
    <div className={`profile-tile${active ? ' profile-tile-active' : ''}`}>
      <button className="profile-tile-main" onClick={onSelect}>
        <div className="profile-tile-icon">{profile.icon}</div>
        <div className="profile-tile-info">
          <span className="profile-tile-name">{profile.name}</span>
          <span className="profile-tile-desc">{profile.description}</span>
        </div>
        {active && <span className="profile-tile-badge">Active</span>}
      </button>

      <button
        className={`profile-tile-expand${drawerOpen ? ' profile-tile-expand-open' : ''}${!active ? ' profile-tile-expand-disabled' : ''}`}
        onClick={() => active && onToggleExpand()}
        disabled={!active}
        title={active ? undefined : 'Select this profile to view its options'}
      >
        <span>
          {!active
            ? 'Select profile to view options'
            : profile.toggles ? `${profile.toggles.length} options` : 'No options'}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {drawerOpen && (
        <div className="profile-tile-drawer">
          {profile.toggles ? (
            profile.toggles.map((toggle) => (
              <label key={toggle.key} className="behavior-toggle-row">
                <div className="behavior-toggle-info">
                  <span className="behavior-toggle-label">{toggle.label}</span>
                  <span className="behavior-toggle-desc">{toggle.description}</span>
                </div>
                <div
                  className={`behavior-switch${store[toggle.key] ? ' behavior-switch-on' : ''}`}
                  onClick={() => store[toggle.setter](!store[toggle.key])}
                >
                  <div className="behavior-switch-thumb" />
                </div>
              </label>
            ))
          ) : (
            <p className="profile-tile-empty">Nothing to configure for this profile yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function YtDlpVersionPicker() {
  const [info, setInfo] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [switchingTo, setSwitchingTo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    window.electronAPI.getYtDlpInfo().then((result) => {
      if (!live) return;
      if (result?.error) setError(result.error);
      else setInfo(result);
      setLoadingInfo(false);
    }).catch(() => {
      if (live) {
        setError('Could not read the active yt-dlp version.');
        setLoadingInfo(false);
      }
    });
    return () => { live = false; };
  }, []);

  const fetchVersions = async () => {
    setLoadingVersions(true);
    setError(null);
    try {
      const result = await window.electronAPI.getYtDlpVersions();
      if (result?.error) setError(result.error);
      else setVersions(result?.versions || []);
    } catch {
      setError('Could not fetch official yt-dlp releases.');
    } finally {
      setLoadingVersions(false);
    }
  };

  const selectVersion = async (target) => {
    setSwitchingTo(target);
    setError(null);
    try {
      const result = await window.electronAPI.setYtDlpVersion(target);
      if (result?.error) setError(result.error);
      else setInfo(result);
    } catch {
      setError('Could not change the yt-dlp version.');
    } finally {
      setSwitchingTo(null);
    }
  };

  const activeLabel = loadingInfo
    ? 'Checking active version...'
    : info?.version || 'Unavailable';
  const targetLabel = info?.automatic
    ? 'Automatic nightly updates'
    : `Pinned to ${info?.target || 'an unknown release'}`;

  return (
    <div className="advanced-ytdlp">
      <div className="advanced-ytdlp-heading">
        <div>
          <span className="advanced-ytdlp-title">YT-DLP</span>
          <span className="advanced-ytdlp-desc">Controls the downloader executable used by Downstream.</span>
        </div>
        <span className="advanced-ytdlp-version">{activeLabel}</span>
      </div>
      <div className="advanced-ytdlp-status">{targetLabel}</div>

      <div className="advanced-ytdlp-actions">
        <button className="advanced-action-button" onClick={fetchVersions} disabled={loadingVersions || !!switchingTo}>
          {loadingVersions ? 'Fetching versions...' : 'Fetch available versions'}
        </button>
        {!info?.automatic && (
          <button className="advanced-action-button advanced-action-button-muted" onClick={() => selectVersion('nightly')} disabled={!!switchingTo}>
            {switchingTo === 'nightly' ? 'Restoring automatic updates...' : 'Use automatic nightly updates'}
          </button>
        )}
      </div>

      {error && <p className="advanced-ytdlp-error">{error}</p>}

      {versions.length > 0 && (
        <div className="advanced-version-list">
          <p className="advanced-version-list-note">Choosing a release pins Downstream to it until you restore automatic nightly updates.</p>
          {versions.map((release) => {
            const selected = info?.target === release.id;
            const changing = switchingTo === release.id;
            return (
              <button
                key={release.id}
                className={`advanced-version-option${selected ? ' advanced-version-option-selected' : ''}`}
                onClick={() => selectVersion(release.id)}
                disabled={!!switchingTo || selected}
              >
                <span>{release.version}</span>
                <small>{release.channel}{selected ? ' · Selected' : ''}</small>
                {changing && <em>Switching...</em>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function OptionsModal() {
  const optionsOpen = useAppStore((s) => s.optionsOpen);
  const setOptionsOpen = useAppStore((s) => s.setOptionsOpen);
  const renderProfile = useAppStore((s) => s.renderProfile);
  const setRenderProfile = useAppStore((s) => s.setRenderProfile);
  const store = useAppStore();
  const [expandedId, setExpandedId] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedAcknowledged, setAdvancedAcknowledged] = useState(false);

  // locked drawers can't stay open, collapse if the user switches away from it.
  useEffect(() => {
    setExpandedId((id) => (id === renderProfile ? id : null));
  }, [renderProfile]);

  if (!optionsOpen) return null;

  return (
    <div className="options-backdrop" onClick={() => setOptionsOpen(false)}>
      <div className="options-modal" onClick={(e) => e.stopPropagation()}>
        <div className="options-header">
          <h2 className="options-title">Options</h2>
          <button className="behavior-close" onClick={() => setOptionsOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="options-body">
          <section className="behavior-section">
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Rendering Profile</h3>
              <p className="behavior-section-desc">
                Choose how the app renders its UI. Select a tile to switch profiles, or expand one to fine-tune its effects.
              </p>
            </div>
            <div className="profile-tiles">
              {PROFILES.map((profile) => (
                <ProfileTile
                  key={profile.id}
                  profile={profile}
                  active={renderProfile === profile.id}
                  expanded={expandedId === profile.id}
                  onSelect={() => setRenderProfile(profile.id)}
                  onToggleExpand={() => setExpandedId(expandedId === profile.id ? null : profile.id)}
                  store={store}
                />
              ))}
            </div>
          </section>

          <div className="behavior-divider" />

          <section className="behavior-section">
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Updates</h3>
              <p className="behavior-section-desc">Control how the app checks for new releases.</p>
            </div>
            <div className="behavior-toggles">
              {STARTUP_TOGGLES.map((toggle) => (
                <label key={toggle.key} className="behavior-toggle-row">
                  <div className="behavior-toggle-info">
                    <span className="behavior-toggle-label">{toggle.label}</span>
                    <span className="behavior-toggle-desc">{toggle.description}</span>
                  </div>
                  <div
                    className={`behavior-switch${store[toggle.key] ? ' behavior-switch-on' : ''}`}
                    onClick={() => store[toggle.setter](!store[toggle.key])}
                  >
                    <div className="behavior-switch-thumb" />
                  </div>
                </label>
              ))}
            </div>
          </section>

          <div className="behavior-divider" />

          <section className="behavior-section advanced-options-section">
            <button
              className={`advanced-options-toggle${advancedOpen ? ' advanced-options-toggle-open' : ''}`}
              onClick={() => {
                const nextOpen = !advancedOpen;
                setAdvancedOpen(nextOpen);
                if (nextOpen) setAdvancedAcknowledged(false);
              }}
              aria-expanded={advancedOpen}
            >
              <span>
                <strong>Advanced Options</strong>
                <small>Downloader recovery and compatibility controls</small>
              </span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {advancedOpen && (
              <div className="advanced-options-drawer">
                {!advancedAcknowledged ? (
                  <div className="advanced-warning">
                    <p>Changing advanced settings can make downloads fail or leave the app on an unstable downloader build. Only change them when troubleshooting.</p>
                    <button className="advanced-got-it" onClick={() => setAdvancedAcknowledged(true)}>Got it</button>
                  </div>
                ) : (
                  <YtDlpVersionPicker />
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
