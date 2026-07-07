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

export default function OptionsModal() {
  const optionsOpen = useAppStore((s) => s.optionsOpen);
  const setOptionsOpen = useAppStore((s) => s.setOptionsOpen);
  const renderProfile = useAppStore((s) => s.renderProfile);
  const setRenderProfile = useAppStore((s) => s.setRenderProfile);
  const store = useAppStore();
  const [expandedId, setExpandedId] = useState(null);

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
        </div>
      </div>
    </div>
  );
}
