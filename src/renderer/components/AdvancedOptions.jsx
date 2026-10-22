import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';

// preferences that "reset settings" puts back to their defaults.
// saved folders, custom eq presets, loudness measurements and onboarding progress are left alone.
const SETTING_KEYS = [
  'acceptMp3', 'acceptMp4', 'acceptFlac', 'acceptWav',
  'behaviorAlbumBackground', 'behaviorDisableSlidingTitles', 'behaviorHideProgressBar', 'behaviorHideVisualizer',
  'behaviorHoldVideoFrame', 'behaviorNormalizeOnStart', 'behaviorShuffleOnStart', 'behaviorWatchFolder',
  'checkUpdatesOnStart', 'eqActivePreset', 'eqBands', 'fastDownloadPacing',
  'liteDisableAnimations', 'liteDisableBlur', 'liteDisableVideoBackground', 'liteDisableVisualizer',
  'musicLibrarySort', 'normalizerMode', 'normalizerReactivePreset', 'playerViewMode',
  'renderProfile', 'showAutoLiteNotice', 'touchBarPrefs', 'visualizerDetail', 'visualizerStyle',
];

function timeAgo(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function formatSize(bytes) {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

function Switch({ on, onClick }) {
  return (
    <div className={`behavior-switch${on ? ' behavior-switch-on' : ''}`} onClick={onClick}>
      <div className="behavior-switch-thumb" />
    </div>
  );
}

function YtDlpPanel() {
  const [info, setInfo] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // keeps reading while a background update is running, so the status stays current.
  useEffect(() => {
    let live = true;
    let timer = null;
    const read = async () => {
      try {
        const result = await window.electronAPI.getYtDlpInfo();
        if (!live) return;
        if (result?.error) setError(result.error);
        else setInfo(result);
        if (result?.updating) timer = setTimeout(read, 1500);
      } catch {
        if (live) setError('Could not read the active yt-dlp version.');
      }
      if (live) setLoadingInfo(false);
    };
    read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  const run = async (id, action, failure) => {
    setBusy(id);
    setError(null);
    try {
      const result = await action();
      if (result?.error) setError(result.error);
      else setInfo(result);
    } catch {
      setError(failure);
    } finally {
      setBusy(null);
    }
  };

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

  const locked = !!busy || !!info?.updating;
  const versionLabel = loadingInfo ? 'Checking...' : info?.version || 'Unavailable';
  const targetLabel = info?.automatic ? 'Automatic nightly updates' : `Pinned to ${info?.target || 'an unknown release'}`;
  const sourceLabel = info?.bundled ? 'Running the copy bundled with Downstream.' : 'Running a downloaded update.';
  const updateLabel = info?.updating || busy === 'check' || busy === 'repair'
    ? 'Downloading and preparing an update...'
    : info?.updateError
      ? `Last update failed: ${info.updateError}`
      : info?.checkedAt ? `Checked for updates ${timeAgo(info.checkedAt)}.` : 'Not checked for updates yet.';

  return (
    <div className="advanced-panel">
      <div className="advanced-panel-heading">
        <div>
          <span className="advanced-panel-title">YT-DLP</span>
          <span className="advanced-panel-desc">The downloader Downstream uses for searching and downloading.</span>
        </div>
        <span className="advanced-panel-badge">{versionLabel}</span>
      </div>
      {info && (
        <div className="advanced-panel-status">
          <span>{targetLabel}. {sourceLabel}</span>
          <span className={info.updating || busy ? 'advanced-panel-status-busy' : ''}>{updateLabel}</span>
        </div>
      )}

      <div className="advanced-panel-actions">
        {info?.automatic && (
          <button className="advanced-action-button" onClick={() => run('check', window.electronAPI.checkYtDlpUpdate, 'Could not check for updates.')} disabled={locked}>
            {busy === 'check' ? 'Checking...' : 'Check for updates'}
          </button>
        )}
        <button className="advanced-action-button" onClick={fetchVersions} disabled={loadingVersions || locked}>
          {loadingVersions ? 'Fetching versions...' : 'Fetch available versions'}
        </button>
        {info && !info.automatic && (
          <button className="advanced-action-button advanced-action-button-muted" onClick={() => run('nightly', () => window.electronAPI.setYtDlpVersion('nightly'), 'Could not change the yt-dlp version.')} disabled={locked}>
            {busy === 'nightly' ? 'Restoring automatic updates...' : 'Use automatic nightly updates'}
          </button>
        )}
        <button
          className="advanced-action-button advanced-action-button-muted"
          onClick={() => run('repair', window.electronAPI.repairYtDlp, 'Could not repair yt-dlp.')}
          disabled={locked}
          title="Downloads the current version again, for when searches or downloads keep failing"
        >
          {busy === 'repair' ? 'Repairing...' : 'Repair'}
        </button>
      </div>

      {error && <p className="advanced-panel-error">{error}</p>}

      {versions.length > 0 && (
        <div className="advanced-version-list">
          <p className="advanced-version-list-note">Choosing a release downloads it and pins Downstream to it until you restore automatic nightly updates. This can take a minute.</p>
          {versions.map((release) => {
            const selected = info?.target === release.id;
            return (
              <button
                key={release.id}
                className={`advanced-version-option${selected ? ' advanced-version-option-selected' : ''}`}
                onClick={() => run(release.id, () => window.electronAPI.setYtDlpVersion(release.id), 'Could not change the yt-dlp version.')}
                disabled={locked || selected}
              >
                <span>{release.version}</span>
                <small>{release.channel}{selected ? ' · Selected' : ''}</small>
                {busy === release.id && <em>Downloading...</em>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DownloadsPanel() {
  const fastPacing = useAppStore((s) => s.fastDownloadPacing);
  const setFastPacing = useAppStore((s) => s.setFastDownloadPacing);

  return (
    <div className="advanced-panel">
      <div className="advanced-panel-heading">
        <div>
          <span className="advanced-panel-title">Downloads</span>
          <span className="advanced-panel-desc">How the downloader works through a queue.</span>
        </div>
      </div>
      <div className="advanced-row">
        <div>
          <span className="advanced-row-label">Shorter pauses between downloads</span>
          <span className="advanced-row-desc">Waits 1 second between downloads instead of 3, and skips the longer break after every 5. YouTube is more likely to slow down or block downloads that start back to back.</span>
        </div>
        <Switch on={fastPacing} onClick={() => setFastPacing(!fastPacing)} />
      </div>
    </div>
  );
}

function AppPanel() {
  const setOptionsOpen = useAppStore((s) => s.setOptionsOpen);
  const setDebugConsoleOpen = useAppStore((s) => s.setDebugConsoleOpen);
  const [settings, setSettings] = useState(null);
  const [cleanup, setCleanup] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    window.electronAPI.getAppSettings().then(setSettings).catch(() => {});
  }, []);

  const toggleHardwareAcceleration = async () => {
    setSettings(await window.electronAPI.setHardwareAcceleration(!settings.hardwareAcceleration));
  };

  const toggleDedicatedGpu = async () => {
    setSettings(await window.electronAPI.setDedicatedGpu(!settings.dedicatedGpu));
  };

  const cleanTempFiles = async () => {
    setCleaning(true);
    const result = await window.electronAPI.cleanTempFiles().catch(() => ({ error: 'Could not clean up temporary files.' }));
    setCleaning(false);
    if (result?.error) setCleanup(result.error);
    else if (result.removed === 0) setCleanup('Nothing to clean up.');
    else setCleanup(`Freed ${formatSize(result.freed)} from ${result.removed} folder${result.removed === 1 ? '' : 's'}.`);
  };

  const resetSettings = async () => {
    SETTING_KEYS.forEach((key) => localStorage.removeItem(key));
    await window.electronAPI.resetAppSettings();
    window.location.reload();
  };

  const accelerationRestart = settings && settings.hardwareAcceleration !== settings.hardwareAccelerationActive;
  const gpuRestart = settings && settings.dedicatedGpu !== settings.dedicatedGpuActive;

  return (
    <div className="advanced-panel">
      <div className="advanced-panel-heading">
        <div>
          <span className="advanced-panel-title">App</span>
          <span className="advanced-panel-desc">Troubleshooting and maintenance.</span>
        </div>
      </div>

      {settings && (
        <div className="advanced-row">
          <div>
            <span className="advanced-row-label">Hardware acceleration</span>
            <span className="advanced-row-desc">
              Uses the graphics card to draw the app. Turn it off if the window flickers, goes black, or crashes on an older computer.
              {accelerationRestart && <span className="advanced-row-result"> Restart Downstream to apply this.</span>}
            </span>
          </div>
          <div className="advanced-row-controls">
            {accelerationRestart && (
              <button className="advanced-action-button" onClick={() => window.electronAPI.restartApp()}>Restart now</button>
            )}
            <Switch on={settings.hardwareAcceleration} onClick={toggleHardwareAcceleration} />
          </div>
        </div>
      )}

      {settings?.hasDedicatedGpu && (
        <div className="advanced-row">
          <div>
            <span className="advanced-row-label">Dedicated graphics</span>
            <span className="advanced-row-desc">
              Draws Downstream on this Mac's dedicated graphics card, which keeps the blur effects smooth. It uses more battery while Downstream is open, so turn it off to stay on the built-in graphics.
              {gpuRestart && <span className="advanced-row-result"> Restart Downstream to apply this.</span>}
            </span>
          </div>
          <div className="advanced-row-controls">
            {gpuRestart && (
              <button className="advanced-action-button" onClick={() => window.electronAPI.restartApp()}>Restart now</button>
            )}
            <Switch on={settings.dedicatedGpu} onClick={toggleDedicatedGpu} />
          </div>
        </div>
      )}

      <div className="advanced-row">
        <div>
          <span className="advanced-row-label">Debugging outlog</span>
          <span className="advanced-row-desc">Shows what Downstream is doing behind the scenes, useful when reporting a problem.</span>
        </div>
        <button className="advanced-action-button advanced-action-button-muted" onClick={() => { setOptionsOpen(false); setDebugConsoleOpen(true); }}>Open</button>
      </div>

      <div className="advanced-row">
        <div>
          <span className="advanced-row-label">App data folder</span>
          <span className="advanced-row-desc">Where Downstream keeps its settings and downloaded yt-dlp versions.</span>
        </div>
        <button className="advanced-action-button advanced-action-button-muted" onClick={() => window.electronAPI.openAppData()}>Show</button>
      </div>

      <div className="advanced-row">
        <div>
          <span className="advanced-row-label">Temporary files</span>
          <span className="advanced-row-desc">
            Removes leftover files the downloader can leave behind when a download is stopped.
            {cleanup && <span className="advanced-row-result"> {cleanup}</span>}
          </span>
        </div>
        <button className="advanced-action-button advanced-action-button-muted" onClick={cleanTempFiles} disabled={cleaning}>
          {cleaning ? 'Cleaning...' : 'Clean up'}
        </button>
      </div>

      <div className="advanced-row">
        <div>
          <span className="advanced-row-label">Reset settings</span>
          <span className="advanced-row-desc">
            {confirmReset
              ? 'Every preference goes back to its default and the app reloads.'
              : 'Puts every preference back to its default. Saved music folders, custom EQ presets and loudness measurements are kept.'}
          </span>
        </div>
        <div className="advanced-row-controls">
          {confirmReset ? (
            <>
              <button className="advanced-action-button advanced-action-button-muted" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="advanced-action-button advanced-action-button-danger" onClick={resetSettings}>Yes, reset</button>
            </>
          ) : (
            <button className="advanced-action-button advanced-action-button-danger" onClick={() => setConfirmReset(true)}>Reset</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdvancedOptions() {
  return (
    <>
      <YtDlpPanel />
      <DownloadsPanel />
      <AppPanel />
    </>
  );
}
