import { useState, useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import UpdateBanner from '../components/UpdateBanner';
import MissingBinaryBanner from '../components/MissingBinaryBanner';
import { dbg, noteStartup } from '../services/debugLog';
import { readSource, startupSource, sourceName } from '../services/musicLibrary';

// how long each startup step took, kept for the outlog.
const stepTimes = {};

// wraps a startup promise so the outlog records how long it actually took.
// on first launch some of these can stall for many seconds behind macos's first-exec security assessment, and this pinpoints which one.
function timed(name, promise) {
  const t0 = performance.now();
  return promise.then((result) => {
    stepTimes[name] = Math.round(performance.now() - t0);
    dbg('startup', `${name} finished in ${stepTimes[name]}ms`);
    return result;
  });
}

let introDone = false;

export default function HomeView() {
  const goToView            = useAppStore((s) => s.goToView);
  const homeIdleMode        = useAppStore((s) => s.homeIdleMode);
  const setHomeIdleMode     = useAppStore((s) => s.setHomeIdleMode);
  const musicPlaying        = useAppStore((s) => s.musicPlaying);
  const setVersionInfo      = useAppStore((s) => s.setVersionInfo);
  const setFfmpegReady      = useAppStore((s) => s.setFfmpegReady);
  const setYtDlpReady       = useAppStore((s) => s.setYtDlpReady);
  const setNetworkConnected = useAppStore((s) => s.setNetworkConnected);
  const setMusicFolder      = useAppStore((s) => s.setMusicFolder);
  const setMusicFiles       = useAppStore((s) => s.setMusicFiles);
  const musicFolder         = useAppStore((s) => s.musicFolder);
  const openSettings        = useAppStore((s) => s.openSettings);
  const setRenderProfile    = useAppStore((s) => s.setRenderProfile);
  const setShowAutoLiteNotice = useAppStore((s) => s.setShowAutoLiteNotice);
  const showAutoLiteNotice  = useAppStore((s) => s.showAutoLiteNotice);
  const toggleDebugConsole  = useAppStore((s) => s.toggleDebugConsole);
  const original            = useAppStore((s) => s.homeOriginal);
  const musicCurrent        = useAppStore((s) => s.musicCurrent);
  const sourceLabel         = useAppStore((s) => (s.musicFolder ? sourceName(s.musicFolder, s) : null));
  const libraryEmpty        = useAppStore((s) => s.library.folders.length === 0 && s.library.mixtapes.length === 0);

  // tap the version number 5x within 2s to toggle the hidden debugging outlog.
  const versionTaps = useRef([]);
  const handleVersionTap = () => {
    const now = Date.now();
    versionTaps.current = versionTaps.current.filter((t) => now - t < 2000);
    versionTaps.current.push(now);
    if (versionTaps.current.length >= 5) {
      versionTaps.current = [];
      toggleDebugConsole();
    }
  };

  const [phase, setPhase] = useState(() => introDone ? 'content' : 'intro');
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState('Starting up');
  const [contentVisible, setContentVisible] = useState(() => introDone);
  const [clock, setClock] = useState(() => new Date());

  // startup runs its checks for real.
  // the bar fills as each step finishes, and the home screen shows as soon as the last one does.
  useEffect(() => {
    if (introDone) return;
    let active = true;

    const state = useAppStore.getState();
    const checkUpdates = state.checkUpdatesOnStart;
    // only ever auto-detects the very first time the app runs, once renderProfile exists (set by the app or the user), it's never touched again.
    const needsTierDetection = localStorage.getItem('renderProfile') === null;
    const source = musicFolder ? null : startupSource(state.library);
    const api = window.electronAPI;

    // a step with `after` waits for that step and is handed its result.
    const steps = [
      { id: 'ffmpeg', label: 'Checking ffmpeg', run: () => api.verifyFfmpeg() },
      {
        id: 'ytDlp',
        label: 'Checking yt-dlp',
        slowLabel: api.platform === 'darwin'
          ? 'Preparing yt-dlp for macOS, this is only slow the first time'
          : 'Checking yt-dlp, this is only slow the first time',
        run: () => api.verifyYtDlp(),
      },
      { id: 'network', label: 'Checking your connection', run: () => api.checkNetwork() },
      checkUpdates && {
        id: 'version',
        label: 'Looking for Downstream updates',
        after: 'network',
        run: (online) => (online ? api.checkVersion() : null),
      },
      needsTierDetection && { id: 'tier', label: 'Checking your hardware', run: () => api.detectRenderTier() },
      source && { id: 'music', label: 'Loading your media library', run: () => readSource(source) },
    ].filter(Boolean);

    const results = {};
    const running = new Set(steps.map((s) => s.id));
    const slow = new Set();
    const show = () => {
      if (!active) return;
      const current = steps.find((s) => running.has(s.id));
      const label = current ? (slow.has(current.id) && current.slowLabel) || current.label : 'Ready';
      setProgress((steps.length - running.size) / steps.length);
      setStepLabel(label);
      useAppStore.getState().setStartupStep(label);
    };

    const startedAt = performance.now();
    dbg('startup', `begin (${steps.map((s) => s.id).join(', ')})`);
    const finished = {};
    for (const step of steps) {
      const ready = step.after ? finished[step.after] : Promise.resolve();
      finished[step.id] = ready
        .then((dep) => timed(step.id, Promise.resolve().then(() => step.run(dep))))
        .catch(() => null)
        .then((result) => {
          results[step.id] = result;
          running.delete(step.id);
          show();
          return result;
        });
    }
    // only changes the label, nothing waits on it.
    const slowTimer = setTimeout(() => {
      slow.add('ytDlp');
      show();
    }, 2500);
    show();

    Promise.all(Object.values(finished)).then(() => {
      clearTimeout(slowTimer);
      if (!active) return;
      const { ffmpeg, ytDlp, network, version, tier, music } = results;
      dbg('startup', `all steps complete (ffmpeg=${!!ffmpeg?.ok}, ytDlp=${!!ytDlp?.ok}, network=${!!network})`);
      const times = Object.entries(stepTimes).map(([id, ms]) => `${id} ${ms}ms`).join(', ');
      const failed = [ffmpeg?.error, ytDlp?.error].filter(Boolean);
      noteStartup(`startup took ${Math.round(performance.now() - startedAt)}ms (${times}), ffmpeg ${ffmpeg?.ok ? 'ok' : 'failed'}, yt-dlp ${ytDlp?.ok ? (ytDlp.slow ? 'slow' : 'ok') : 'failed'}, ${network ? 'online' : 'offline'}${failed.length ? `: ${failed.join(' | ')}` : ''}`);
      setFfmpegReady(!!ffmpeg?.ok);
      setYtDlpReady(!!ytDlp?.ok);
      setNetworkConnected(!!network);
      if (version) setVersionInfo(version);
      if (music?.length > 0) {
        setMusicFolder(source);
        setMusicFiles(music);
      }
      if (tier) {
        setRenderProfile(tier.profile);
        if (tier.profile === 'lite') setShowAutoLiteNotice(true);
      }
      introDone = true;
      useAppStore.getState().setStartupStep(null);
      setPhase('content');
    });

    return () => {
      active = false;
      clearTimeout(slowTimer);
    };
  }, []);

  // content reveal
  useEffect(() => {
    if (phase !== 'content') return;
    const id = requestAnimationFrame(() => setContentVisible(true));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  // The home screen intentionally becomes quiet after a period without mouse input.
  // Listening only after the intro prevents startup pointer movement from immediately
  // altering the welcome sequence.
  useEffect(() => {
    if (phase !== 'content' || !musicPlaying) {
      setHomeIdleMode(false);
      return;
    }
    let idleTimer;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      setHomeIdleMode(false);
      idleTimer = setTimeout(() => {
        setClock(new Date());
        setHomeIdleMode(true);
      }, 45000);
    };

    resetIdleTimer();
    window.addEventListener('pointermove', resetIdleTimer, { passive: true });
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('pointermove', resetIdleTimer);
      setHomeIdleMode(false);
    };
  }, [phase, musicPlaying, setHomeIdleMode]);

  // No seconds are shown, but update while a clock is visible so it rolls over
  // naturally at the next minute. The ambient home always shows one.
  useEffect(() => {
    if (original && !homeIdleMode) return;
    const tick = () => setClock(new Date());
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [original, homeIdleMode]);

  const now = new Date();
  let h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const timeStr = `It's currently ${h}:${String(m).padStart(2, '0')}${ampm}`;
  const idleTime = clock.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const idleDate = `${clock.toLocaleString([], { month: 'long' })}, ${clock.getDate()}`;

  const isIntro = phase !== 'content';

  const contentStyle = isIntro
    ? { opacity: 0, visibility: 'hidden' }
    : {
        opacity: contentVisible ? 1 : 0,
        transform: contentVisible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      };

  // settings opens on performance while lite mode's first-launch notice is up.
  const openHomeSettings = () => {
    openSettings('home', showAutoLiteNotice ? 'performance' : null);
    setShowAutoLiteNotice(false);
  };

  const liteNotice = showAutoLiteNotice && (
    <div className={`auto-lite-bubble${original ? '' : ' auto-lite-bubble-side'}`} onClick={(e) => e.stopPropagation()}>
      <button
        className="auto-lite-bubble-close"
        onClick={() => setShowAutoLiteNotice(false)}
        title="Dismiss"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <span>Lite Mode was selected as the default for your hardware. Click here to change it.</span>
      <div className="auto-lite-bubble-arrow" />
    </div>
  );

  const version = (
    <span
      className="home-version"
      onClick={handleVersionTap}
      title={__DOWNSTREAM_LEGACY__ ? 'Downstream built for macOS 10.13 and 10.14. Downstream for newer macOS can be a version ahead.' : undefined}
    >
      v{__APP_VERSION__}{__DOWNSTREAM_LEGACY__ && ' for legacy macOS'}
    </span>
  );

  // no panel: a large wordmark and a short list low on the left, the song playing large on the right, and the time in the corner, over the background.
  // left alone with music playing, the list fades and the rest stays, with the stars if they're allowed.
  if (!original) {
    return (
      <div className={`layout home-ambient${homeIdleMode ? ' home-ambient-idle' : ''}`}>
        <UpdateBanner />
        <MissingBinaryBanner />
        <div className="ambient-clock">
          <time dateTime={clock.toTimeString()}>{idleTime}</time>
          <time className="ambient-date" dateTime={clock.toISOString().slice(0, 10)}>
            {clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </time>
        </div>

        <div className="ambient-menu">
          {isIntro ? (
            <div className="ambient-intro">
              <p className="ambient-hello">Hello!</p>
              <p className="ambient-intro-time">{timeStr}</p>
              <div className="ambient-status">
                <div className="shimmer-bar">
                  <div className="shimmer-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <span key={stepLabel} className="intro-status-text">{stepLabel}</span>
              </div>
            </div>
          ) : (
            <div style={contentStyle}>
              <h1 className="ambient-title">Downstream</h1>
              <nav className="ambient-list">
                <AmbientItem label="Downloader" note="Save media from the internet" onClick={() => goToView('download')}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </AmbientItem>
                <AmbientItem label="Player" note={libraryEmpty ? 'Pick a folder to start' : 'Play your local media'} onClick={() => goToView('player')}>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </AmbientItem>
                <div className="ambient-settings">
                  <AmbientItem label="Settings" quiet onClick={openHomeSettings}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
                  </AmbientItem>
                  {liteNotice}
                </div>
              </nav>
            </div>
          )}
        </div>

        {/* the song playing, which goes back to the player. */}
        {!isIntro && musicCurrent && (
          <button type="button" className="ambient-now" onClick={() => goToView('player')}>
            <span className="ambient-now-label">{musicPlaying ? 'Now playing' : 'Paused'}</span>
            <span className="ambient-now-title">{musicCurrent.name}</span>
            {sourceLabel && <span className="ambient-now-source">{sourceLabel}</span>}
          </button>
        )}
        {version}
      </div>
    );
  }

  return (
    <div className="layout">
      <UpdateBanner />
      <MissingBinaryBanner />
      <div className={`home-idle-hud${homeIdleMode ? ' home-idle-hud-visible' : ''}`} aria-hidden={!homeIdleMode}>
        <time className="home-idle-widget home-idle-time" dateTime={clock.toTimeString()}>{idleTime}</time>
        <time className="home-idle-widget home-idle-date" dateTime={clock.toISOString().slice(0, 10)}>{idleDate}</time>
      </div>
      <div className={`home-widget${homeIdleMode ? ' home-widget-idle' : ''}`}>
        {isIntro && (
          <>
            <div className="intro-overlay">
              <div className="intro-greeting">
                <p className="intro-phrase">Hello!</p>
                <p className="intro-time">{timeStr}</p>
              </div>
            </div>

            <div className="intro-status">
              <div className="shimmer-bar">
                <div className="shimmer-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span key={stepLabel} className="intro-status-text">{stepLabel}</span>
            </div>
          </>
        )}

        <div style={contentStyle}>
          <div className="home-content">
            <h1 className="home-title">Downstream</h1>
            <p className="home-subtitle">What would you like to do?</p>

            <div className="home-options">
              <button className="home-option" onClick={() => goToView('download')}>
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

              <button className="home-option" onClick={() => goToView('player')}>
                <div className="home-option-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
                <span className="home-option-label">Media Player</span>
                <span className="home-option-desc">Play your local media library</span>
              </button>

              <button className="home-option" onClick={openHomeSettings}>
                {liteNotice}
                <div className="home-option-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
                  </svg>
                </div>
                <span className="home-option-label">Settings</span>
                <span className="home-option-desc">Make Downstream your own</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {version}
    </div>
  );
}

// one of the ambient home's choices, with an arrow that slides in while the pointer is on it.
function AmbientItem({ label, note, quiet = false, onClick, children }) {
  return (
    <button type="button" className={`ambient-item${quiet ? ' ambient-item-quiet' : ''}`} onClick={onClick}>
      <svg className="ambient-item-icon" width={quiet ? 18 : 22} height={quiet ? 18 : 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="ambient-item-text">
        {label}
        {note && <small>{note}</small>}
      </span>
      <svg className="ambient-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}
