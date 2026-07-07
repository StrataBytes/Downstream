import { useState, useEffect, useRef } from 'react';
import useAppStore, { getAcceptedExtensions } from '../stores/useAppStore';
import UpdateBanner from '../components/UpdateBanner';
import MissingBinaryBanner from '../components/MissingBinaryBanner';
import { dbg } from '../services/debugLog';

// wraps a startup promise so the outlog records how long it actually took.
// on first launch some of these can stall for many seconds behind macos's first-exec security assessment, and this pinpoints which one.
function timed(name, promise) {
  const t0 = performance.now();
  return promise.then((result) => {
    dbg('startup', `${name} finished in ${Math.round(performance.now() - t0)}ms`);
    return result;
  });
}

let introDone = false;

export default function HomeView() {
  const setCurrentView      = useAppStore((s) => s.setCurrentView);
  const setVersionInfo      = useAppStore((s) => s.setVersionInfo);
  const setFfmpegReady      = useAppStore((s) => s.setFfmpegReady);
  const setYtDlpReady       = useAppStore((s) => s.setYtDlpReady);
  const setNetworkConnected = useAppStore((s) => s.setNetworkConnected);
  const setMusicFolder      = useAppStore((s) => s.setMusicFolder);
  const setMusicFiles       = useAppStore((s) => s.setMusicFiles);
  const savedFolders        = useAppStore((s) => s.savedFolders);
  const musicFolder         = useAppStore((s) => s.musicFolder);
  const setOptionsOpen      = useAppStore((s) => s.setOptionsOpen);
  const setRenderProfile    = useAppStore((s) => s.setRenderProfile);
  const setShowAutoLiteNotice = useAppStore((s) => s.setShowAutoLiteNotice);
  const showAutoLiteNotice  = useAppStore((s) => s.showAutoLiteNotice);
  const toggleDebugConsole  = useAppStore((s) => s.toggleDebugConsole);

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

  const [phase, setPhase]     = useState(() => introDone ? 'content' : 'greeting');
  const [status, setStatus]   = useState('starting');
  const [subLabel, setSubLabel] = useState('');
  const [contentVisible, setContentVisible] = useState(() => introDone);
  const timers = useRef([]);

  // intro phase timer
  useEffect(() => {
    if (introDone) return; // lazy initialisers already set correct state

    const t1 = setTimeout(() => setPhase('time'), 2200);
    const t2 = setTimeout(() => { setPhase('jamming'); setStatus('finalizing'); }, 4400);
    const t3 = setTimeout(() => setStatus('done'), 6000);
    const t4 = setTimeout(() => {
      introDone = true;
      setPhase('content');
    }, 6600);
    timers.current = [t1, t2, t3, t4];

    return () => timers.current.forEach(clearTimeout);
  }, []);

  // actual startup work, tasks run in parallel, labels cycle on a fixed schedule
  useEffect(() => {
    if (introDone) return;
    let active = true;

    // build label list based on what will actually run
    const checkUpdates = useAppStore.getState().checkUpdatesOnStart;
    // only ever auto-detects the very first time the app runs, once renderProfile exists (set by the app or the user), it's never touched again.
    const needsTierDetection = localStorage.getItem('renderProfile') === null;
    const labels = [
      'Verifying required components',
      'Checking network connection',
    ];
    if (checkUpdates) {
      labels.push('Fetching latest version info');
    }
    if (needsTierDetection) {
      labels.push('Checking hardware capabilities');
    }
    if (savedFolders.length > 0 && !musicFolder) {
      labels.push('Scanning music library');
    }

    // shows first label immediately, then spaces the rest evenly across the 4s window
    setSubLabel(labels[0]);
    const slot = Math.floor(4000 / labels.length);
    const labelTimers = labels.slice(1).map((label, i) =>
      setTimeout(() => { if (active) setSubLabel(label); }, (i + 1) * slot)
    );

    // runs all tasks in parallel, results stored in the store whenever they finish
    dbg('startup', `begin (firstLaunch=${needsTierDetection}, checkUpdates=${checkUpdates})`);
    const ffmpegP  = timed('checkFfmpeg', window.electronAPI.checkFfmpeg().catch(() => false));
    const ytDlpP   = timed('checkYtDlp', window.electronAPI.checkYtDlp().catch(() => false));
    const networkP = timed('checkNetwork', window.electronAPI.checkNetwork().catch(() => false));
    const versionP = checkUpdates
      ? timed('checkVersion', window.electronAPI.checkVersion().catch(() => null))
      : Promise.resolve(null);
    const exts = getAcceptedExtensions(useAppStore.getState());
    const musicP   = (savedFolders.length > 0 && !musicFolder)
      ? timed('readMusicFolder', window.electronAPI.readMusicFolder(savedFolders[0], exts).catch(() => []))
      : Promise.resolve([]);
    const tierP = needsTierDetection
      ? timed('detectRenderTier', window.electronAPI.detectRenderTier().catch(() => null))
      : Promise.resolve(null);

    Promise.all([ffmpegP, ytDlpP, networkP, versionP, musicP, tierP]).then(([ffmpegOk, ytDlpOk, connected, info, files, tier]) => {
      if (!active) return;
      dbg('startup', `all tasks complete (ffmpeg=${ffmpegOk}, ytDlp=${ytDlpOk}, network=${connected})`);
      setFfmpegReady(ffmpegOk);
      setYtDlpReady(ytDlpOk);
      setNetworkConnected(connected);
      if (info) setVersionInfo(info);
      if (files.length > 0) {
        setMusicFolder(savedFolders[0]);
        setMusicFiles(files);
      }
      if (tier) {
        setRenderProfile(tier.profile);
        if (tier.profile === 'lite') {
          setShowAutoLiteNotice(true);
        }
      }
    });

    return () => {
      active = false;
      labelTimers.forEach(clearTimeout);
    };
  }, []);

  // content reveal
  useEffect(() => {
    if (phase !== 'content') return;
    const id = requestAnimationFrame(() => setContentVisible(true));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const now = new Date();
  let h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const timeStr = `It's ${h}:${String(m).padStart(2, '0')}${ampm}`;

  const isIntro = phase !== 'content';

  const contentStyle = isIntro
    ? { opacity: 0, visibility: 'hidden' }
    : {
        opacity: contentVisible ? 1 : 0,
        transform: contentVisible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      };

  const phraseText =
    phase === 'greeting' ? 'Hi there!'
    : phase === 'time'    ? timeStr
    : "Ready to go!";

  return (
    <div className="layout">
      <UpdateBanner />
      <MissingBinaryBanner />
      <div className="home-widget">
        {isIntro && (
          <>
            <div className="intro-overlay">
              <p key={phase} className="intro-phrase">{phraseText}</p>
            </div>

            <div key={status} className="intro-status">
              {status === 'done' ? (
                <div className="intro-status-row">
                  <span className="intro-status-check">✓</span>
                  <span className="intro-status-text done">Done</span>
                </div>
              ) : (
                <>
                  <div className="intro-status-row">
                    <div className="intro-spinner" />
                    <span className="intro-status-text">
                      {status === 'finalizing' ? 'Finalizing...' : 'Starting up...'}
                    </span>
                  </div>
                  {status === 'starting' && subLabel && (
                    <span key={subLabel} className="intro-status-sub">{subLabel}</span>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <div style={contentStyle}>
          <div className="home-content">
            <h1 className="home-title">Downstream</h1>
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

              <button
                className="home-option"
                onClick={() => { setOptionsOpen(true); setShowAutoLiteNotice(false); }}
              >
                {showAutoLiteNotice && (
                  <div className="auto-lite-bubble" onClick={(e) => e.stopPropagation()}>
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
                )}
                <div className="home-option-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
                  </svg>
                </div>
                <span className="home-option-label">Options</span>
                <span className="home-option-desc">Rendering profile & app preferences</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <span className="home-version" onClick={handleVersionTap}>v2.2.8</span>
    </div>
  );
}
