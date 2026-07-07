import { useEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { countMeasured, clearLoudnessCache } from '../services/loudnessService';

const SECTIONS = [
  { id: 'view-mode', label: 'View Mode' },
  { id: 'startup', label: 'Startup Options' },
  { id: 'normalization', label: 'Normalization' },
  { id: 'visual', label: 'Visual Effects' },
  { id: 'formats', label: 'Formats & Scanning' },
];

const VIEW_MODES = [
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Every control is always visible. Best for learning the app and quick access to all features.',
  },
  {
    id: 'commander',
    name: 'Commander',
    description: 'Compact layout showing only the track and controls. Hover to reveal volume, chips, and options.',
  },
  {
    id: 'immersive',
    name: 'Immersive',
    description: 'Coming soon.',
    disabled: true,
  },
];

const NORMALIZER_MODES = [
  {
    id: 'reactive',
    name: 'Reactive',
    description: 'Follows the music live as it plays, then adjusts the volume accordingly. Lightweight and fast for CPU usage.',
  },
  {
    id: 'contextual',
    name: 'Contextual',
    description: 'Pre-measures each track for one precise correction, like Spotify or YouTube.',
  },
];

const REACTIVE_PRESETS = [
  {
    id: 'normal',
    name: 'Normal',
    description: 'Well-tested and stable, the recommended reactive preset. Gentle, steady correction within ±6 dB.',
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Reacts within seconds to loud or quiet sections. More prone to accidental overcorrections than normal.',
  },
  {
    id: 'rigorous',
    name: 'Rigorous',
    description: 'Fastest reaction, widest −10 / +8 dB range. Most prone to overcorrections, but very fast reaction time.',
  },
];

const PLAYER_BEHAVIOR_TOGGLES = [
  {
    key: 'behaviorNormalizeOnStart',
    setter: 'setBehaviorNormalizeOnStart',
    label: 'Volume Normalization on Start',
    description: 'Automatically enable volume normalization each time the player opens.',
  },
  {
    key: 'behaviorShuffleOnStart',
    setter: 'setBehaviorShuffleOnStart',
    label: 'Shuffle on Start',
    description: 'Automatically shuffle the playlist each time a folder is loaded.',
  },
];

const VISUAL_EFFECTS_TOGGLES = [
  {
    key: 'behaviorAlbumBackground',
    setter: 'setBehaviorAlbumBackground',
    label: 'Album Art Background',
    description: 'Display album cover art as the player background when available.',
  },
  {
    key: 'behaviorHideProgressBar',
    setter: 'setBehaviorHideProgressBar',
    label: 'Hide Progress Bar',
    description: 'Remove the thin progress slider along the top of the window.',
  },
  {
    key: 'behaviorDisableSlidingTitles',
    setter: 'setBehaviorDisableSlidingTitles',
    label: 'Disable Sliding Titles',
    description: 'Stop long track names from scrolling and truncate them instead.',
    liteOverride: 'liteDisableAnimations',
  },
  {
    key: 'behaviorHoldVideoFrame',
    setter: 'setBehaviorHoldVideoFrame',
    label: 'Hold Video Frame on Pause',
    description: 'Keep the paused video frame visible instead of fading to the default background.',
    liteOverride: 'liteDisableVideoBackground',
  },
  {
    key: 'behaviorHideVisualizer',
    setter: 'setBehaviorHideVisualizer',
    label: 'Hide Visualizer',
    description: 'Why would you disable this?',
    liteOverride: 'liteDisableVisualizer',
  },
];

const FORMAT_TOGGLES = [
  {
    key: 'acceptMp3',
    setter: 'setAcceptMp3',
    label: 'Accept MP3',
    description: 'Include .mp3 files when scanning folders.',
  },
  {
    key: 'acceptFlac',
    setter: 'setAcceptFlac',
    label: 'Accept FLAC',
    description: 'Include .flac files when scanning folders.',
  },
  {
    key: 'acceptWav',
    setter: 'setAcceptWav',
    label: 'Accept WAV',
    description: 'Include .wav files when scanning folders.',
  },
  {
    key: 'acceptMp4',
    setter: 'setAcceptMp4',
    label: 'Accept MP4',
    description: 'Include .mp4 files when scanning folders.',
  },
];

const SCANNING_TOGGLES = [
  {
    key: 'behaviorWatchFolder',
    setter: 'setBehaviorWatchFolder',
    label: 'Watch Folder for Changes',
    description: 'Periodically check the current playlist folder for new supported files and prompt to reload.',
  },
];

function ToggleRow({ toggle, store }) {
  const locked = toggle.liteOverride && store.renderProfile === 'lite' && store[toggle.liteOverride];

  return (
    <label className={`behavior-toggle-row${locked ? ' behavior-toggle-locked' : ''}`}>
      <div className="behavior-toggle-info">
        <span className="behavior-toggle-label">{toggle.label}</span>
        {locked ? (
          <span className="behavior-toggle-desc behavior-toggle-lite-hint">
            Controlled by Lite Mode -- switch to Standard in Options on the home screen to modify.
          </span>
        ) : (
          <span className="behavior-toggle-desc">{toggle.description}</span>
        )}
      </div>
      <div
        className={`behavior-switch${(locked || store[toggle.key]) ? ' behavior-switch-on' : ''}${locked ? ' behavior-switch-locked' : ''}`}
        onClick={() => !locked && store[toggle.setter](!store[toggle.key])}
      >
        <div className="behavior-switch-thumb" />
      </div>
    </label>
  );
}

function ToggleGroup({ toggles, store }) {
  return (
    <div className="behavior-toggles">
      {toggles.map((toggle) => (
        <ToggleRow key={toggle.key} toggle={toggle} store={store} />
      ))}
    </div>
  );
}

export default function BehaviorModal() {
  const behaviorOpen = useAppStore((s) => s.behaviorOpen);
  const setBehaviorOpen = useAppStore((s) => s.setBehaviorOpen);
  const playerViewMode = useAppStore((s) => s.playerViewMode);
  const setPlayerViewMode = useAppStore((s) => s.setPlayerViewMode);
  const normalizerMode = useAppStore((s) => s.normalizerMode);
  const setNormalizerMode = useAppStore((s) => s.setNormalizerMode);
  const normalizerReactivePreset = useAppStore((s) => s.normalizerReactivePreset);
  const setNormalizerReactivePreset = useAppStore((s) => s.setNormalizerReactivePreset);
  const loudnessScanningTrack = useAppStore((s) => s.loudnessScanningTrack);
  const store = useAppStore();

  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [confirmingMemoryReset, setConfirmingMemoryReset] = useState(false);
  const bodyRef = useRef(null);
  const sectionRefs = useRef({});

  const handleDeleteMemory = () => {
    clearLoudnessCache();
    setConfirmingMemoryReset(false);
  };

  // highlights whichever section is currently being read.
  // a section counts as "active" once it's scrolled into the top band of the panel, so the nav tracks scroll position as well as clicks.
  useEffect(() => {
    if (!behaviorOpen) return;
    const root = bodyRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0].target.dataset.sectionId;
        if (id) setActiveSection(id);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [behaviorOpen]);

  const scrollToSection = (id) => {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!behaviorOpen) return null;

  return (
    <div className="behavior-backdrop" onClick={() => setBehaviorOpen(false)}>
      <div className="behavior-modal" onClick={(e) => e.stopPropagation()}>
        <div className="behavior-header">
          <h2 className="behavior-title">Behavior</h2>
          <button className="behavior-close" onClick={() => setBehaviorOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="behavior-main">
          <nav className="behavior-nav">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                className={`behavior-nav-btn${activeSection === section.id ? ' behavior-nav-btn-active' : ''}`}
                onClick={() => scrollToSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="behavior-body" ref={bodyRef}>
          <section
            className="behavior-section"
            data-section-id="view-mode"
            ref={(el) => { sectionRefs.current['view-mode'] = el; }}
          >
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">View Mode</h3>
              <p className="behavior-section-desc">Controls how the player panel is displayed.</p>
            </div>
            <div className="behavior-modes">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`behavior-mode-card${playerViewMode === mode.id ? ' behavior-mode-active' : ''}${mode.disabled ? ' behavior-mode-disabled' : ''}`}
                  onClick={() => !mode.disabled && setPlayerViewMode(mode.id)}
                  disabled={mode.disabled}
                >
                  <span className="behavior-mode-name">{mode.name}</span>
                  <span className="behavior-mode-desc">{mode.description}</span>
                  {playerViewMode === mode.id && (
                    <span className="behavior-mode-badge">Active</span>
                  )}
                </button>
              ))}
            </div>
          </section>

          <div className="behavior-divider" />

          <section
            className="behavior-section"
            data-section-id="startup"
            ref={(el) => { sectionRefs.current['startup'] = el; }}
          >
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Startup Options</h3>
              <p className="behavior-section-desc">Controls how the player behaves the moment you open a music folder.</p>
            </div>
            <ToggleGroup toggles={PLAYER_BEHAVIOR_TOGGLES} store={store} />
          </section>

          <div className="behavior-divider" />

          <section
            className="behavior-section"
            data-section-id="normalization"
            ref={(el) => { sectionRefs.current['normalization'] = el; }}
          >
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Normalization Options</h3>
              <p className="behavior-section-desc">Choose how volume normalization levels your tracks while it&apos;s enabled.</p>
            </div>
            <div className="behavior-modes">
              {NORMALIZER_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`behavior-mode-card${normalizerMode === mode.id ? ' behavior-mode-active' : ''}${mode.disabled ? ' behavior-mode-disabled' : ''}`}
                  onClick={() => !mode.disabled && setNormalizerMode(mode.id)}
                  disabled={mode.disabled}
                >
                  <span className="behavior-mode-name">{mode.name}</span>
                  <span className="behavior-mode-desc">{mode.description}</span>
                  {normalizerMode === mode.id && (
                    <span className="behavior-mode-badge">Active</span>
                  )}
                </button>
              ))}
            </div>

            {normalizerMode === 'contextual' && (
              <div className="behavior-subpanel">
                {store.musicFiles.length > 0 ? (
                  <div className={`norm-stats-box${loudnessScanningTrack ? ' norm-stats-scanning' : ''}`}>
                    <div className="norm-stats-count">
                      <span className="norm-stats-number">
                        {countMeasured(store.musicFiles)}/{store.musicFiles.length}
                      </span>
                      <span className="norm-stats-label">Measured</span>
                    </div>
                    <p className="norm-stats-desc">
                      Scanned once in the background. Unmeasured tracks use Reactive for now.
                    </p>
                  </div>
                ) : (
                  <p className="behavior-subpanel-note">Tracks are measured in the background once a folder is loaded.</p>
                )}

                <div className="norm-memory-row">
                  {confirmingMemoryReset ? (
                    <div className="norm-memory-confirm">
                      <span className="norm-memory-confirm-text">Delete every saved measurement?</span>
                      <button className="norm-memory-confirm-yes" onClick={handleDeleteMemory}>Delete</button>
                      <button className="norm-memory-confirm-cancel" onClick={() => setConfirmingMemoryReset(false)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="norm-memory-btn"
                        onClick={() => setConfirmingMemoryReset(true)}
                        title="Deletes every loudness measurement Contextual has made, across every media library you've used -- not just this one. Affected tracks are measured again automatically."
                      >
                        Delete Memory
                      </button>
                      <p className="norm-memory-desc">
                        Clears saved measurements for every library -- tracks re-measure automatically.
                      </p>
                    </>
                  )}
                </div>

                <p className="behavior-subpanel-note">
                  Runs ~6 dB louder than Reactive by design, matching Spotify/YouTube's loudness -- volume may feel different right after switching.
                </p>
              </div>
            )}

            {normalizerMode === 'reactive' && (
              <div className="behavior-subpanel">
                <div className="behavior-pill-row">
                  {REACTIVE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`behavior-pill${normalizerReactivePreset === preset.id ? ' behavior-pill-active' : ''}`}
                      onClick={() => setNormalizerReactivePreset(preset.id)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
                <p className="behavior-subpanel-note">
                  {REACTIVE_PRESETS.find((p) => p.id === normalizerReactivePreset)?.description}
                </p>
              </div>
            )}
          </section>

          <div className="behavior-divider" />

          <section
            className="behavior-section"
            data-section-id="visual"
            ref={(el) => { sectionRefs.current['visual'] = el; }}
          >
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Visual Effects</h3>
              <p className="behavior-section-desc">Adjust how the player looks. Some options may be locked by Lite Rendering.</p>
            </div>
            <ToggleGroup toggles={VISUAL_EFFECTS_TOGGLES} store={store} />
          </section>

          <div className="behavior-divider" />

          <section
            className="behavior-section"
            data-section-id="formats"
            ref={(el) => { sectionRefs.current['formats'] = el; }}
          >
            <div className="behavior-section-header">
              <h3 className="behavior-section-title">Formats &amp; File Scanning</h3>
              <p className="behavior-section-desc">Choose which file types to include and how the player detects changes.</p>
            </div>
            <ToggleGroup toggles={FORMAT_TOGGLES} store={store} />
            <div style={{ marginTop: 8 }}>
              <ToggleGroup toggles={SCANNING_TOGGLES} store={store} />
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}
