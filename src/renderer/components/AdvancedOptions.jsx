import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { Group, Rows, Row, Switch } from './SettingsParts';

// preferences that "reset settings" puts back to their defaults.
// saved folders, custom eq presets, loudness measurements and onboarding progress are left alone.
const SETTING_KEYS = [
  'acceptMp3', 'acceptMp4', 'acceptFlac', 'acceptWav', 'askWhereToSave',
  'behaviorAlbumBackground', 'behaviorDisableSlidingTitles', 'behaviorHideProgressBar', 'behaviorHideVisualizer',
  'behaviorHoldVideoFrame', 'behaviorNormalizeOnStart', 'behaviorRememberShuffle', 'behaviorShuffleOnStart', 'behaviorWatchFolder',
  'checkUpdatesOnStart', 'eqActivePreset', 'eqBands', 'fastDownloadPacing',
  'liteDisableAnimations', 'liteDisableBlur', 'liteDisableVideoBackground', 'liteDisableVisualizer',
  'musicLibrarySort', 'musicNormalize', 'normalizerMode', 'normalizerReactivePreset', 'playerViewMode',
  'renderProfile', 'showAutoLiteNotice', 'touchBarPrefs', 'visualizerDetail', 'visualizerStyle',
  'lookVisualizerLift', 'lookVisualizerBrightness', 'lookBlurQuality', 'lookBlurIntensity', 'lookBackgroundDim', 'lookPanelOpacity',
  'voyagerFadeAfter', 'voyagerStarDensity', 'seekStep', 'homeStarfield', 'homeOriginal',
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

function SwitchButton({ on, label, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="settings-switch-button" onClick={onClick}>
      <Switch on={on} />
    </button>
  );
}

// the downloader's version, with ways to update, repair or pin it.
export function YtDlp() {
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
    <div className="settings-row settings-row-block" data-setting="ytdlp">
      <span className="settings-slider-head">
        <span className="settings-row-label">yt-dlp</span>
        <span className="advanced-panel-badge">{versionLabel}</span>
      </span>
      <span className="settings-row-desc">What Downstream searches and downloads with.</span>
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
        <button
          className="advanced-action-button advanced-action-button-muted"
          onClick={() => run('repair', window.electronAPI.repairYtDlp, 'Could not repair yt-dlp.')}
          disabled={locked}
          title="Downloads the current version again, for when searches or downloads keep failing"
        >
          {busy === 'repair' ? 'Repairing...' : 'Repair'}
        </button>
        <button className="advanced-action-button advanced-action-button-muted" onClick={fetchVersions} disabled={loadingVersions || locked}>
          {loadingVersions ? 'Fetching versions...' : 'Choose a version...'}
        </button>
        {info && !info.automatic && (
          <button className="advanced-action-button advanced-action-button-muted" onClick={() => run('nightly', () => window.electronAPI.setYtDlpVersion('nightly'), 'Could not change the yt-dlp version.')} disabled={locked}>
            {busy === 'nightly' ? 'Restoring automatic updates...' : 'Use automatic nightly updates'}
          </button>
        )}
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

// drawing with the graphics card, which takes a restart to change.
export function Graphics() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    window.electronAPI.getAppSettings().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;

  const toggleHardwareAcceleration = async () => {
    setSettings(await window.electronAPI.setHardwareAcceleration(!settings.hardwareAcceleration));
  };

  const toggleDedicatedGpu = async () => {
    setSettings(await window.electronAPI.setDedicatedGpu(!settings.dedicatedGpu));
  };

  const accelerationRestart = settings.hardwareAcceleration !== settings.hardwareAccelerationActive;
  const gpuRestart = settings.dedicatedGpu !== settings.dedicatedGpuActive;
  const restart = <span className="advanced-row-result"> Restart Downstream to apply this.</span>;

  return (
    <Group title="Graphics">
      <Rows>
        <Row id="hardwareAcceleration" label="Hardware acceleration" desc={<>Draws the app with the graphics card. Turn it off if the window flickers, goes black or crashes on an older computer.{accelerationRestart && restart}</>}>
          {accelerationRestart && <button className="advanced-action-button" onClick={() => window.electronAPI.restartApp()}>Restart now</button>}
          <SwitchButton on={settings.hardwareAcceleration} label="Hardware acceleration" onClick={toggleHardwareAcceleration} />
        </Row>
        {settings.hasDedicatedGpu && (
          <Row id="dedicatedGpu" label="Dedicated graphics" desc={<>Keeps the blur smooth on this Mac's dedicated graphics card, using more battery while Downstream is open.{gpuRestart && restart}</>}>
            {gpuRestart && <button className="advanced-action-button" onClick={() => window.electronAPI.restartApp()}>Restart now</button>}
            <SwitchButton on={settings.dedicatedGpu} label="Dedicated graphics" onClick={toggleDedicatedGpu} />
          </Row>
        )}
      </Rows>
    </Group>
  );
}

export default function AdvancedPage() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setDebugConsoleOpen = useAppStore((s) => s.setDebugConsoleOpen);
  const homeStarfield = useAppStore((s) => s.homeStarfield);
  const homeOriginal = useAppStore((s) => s.homeOriginal);
  const setSetting = useAppStore((s) => s.setSetting);
  const [cleanup, setCleanup] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

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

  return (
    <>
      <p className="settings-page-note">For when something isn't working right.</p>

      <Group title="Troubleshooting">
        <Rows>
          <Row id="debugLog" label="Debugging outlog" desc="What Downstream is doing behind the scenes, useful when reporting a problem.">
            <button className="advanced-action-button advanced-action-button-muted" onClick={() => { closeSettings(); setDebugConsoleOpen(true); }}>Open</button>
          </Row>
          <Row id="appData" label="App data folder" desc="Where Downstream keeps its settings and downloaded yt-dlp versions.">
            <button className="advanced-action-button advanced-action-button-muted" onClick={() => window.electronAPI.openAppData()}>Show</button>
          </Row>
          <Row id="tempFiles" label="Temporary files" desc={<>Leftovers the downloader can leave behind when a download is stopped.{cleanup && <span className="advanced-row-result"> {cleanup}</span>}</>}>
            <button className="advanced-action-button advanced-action-button-muted" onClick={cleanTempFiles} disabled={cleaning}>{cleaning ? 'Cleaning...' : 'Clean up'}</button>
          </Row>
        </Rows>
      </Group>

      <Group title="Extras">
        <Rows>
          <Row label="Allow Voyager starfield on main menu playback" desc="Leave the main menu be for a while with media playing, and see what turns up.">
            <SwitchButton on={homeStarfield} label="Allow Voyager starfield on main menu playback" onClick={() => setSetting('homeStarfield', !homeStarfield)} />
          </Row>
          <Row id="homeOriginal" label="Original home screen" desc="The earlier look, with Downloader, Media Player and Settings as cards in a panel.">
            <SwitchButton on={homeOriginal} label="Original home screen" onClick={() => setSetting('homeOriginal', !homeOriginal)} />
          </Row>
        </Rows>
      </Group>

      <Group title="Reset">
        <Rows>
          <Row
            id="resetAll"
            label="Reset all settings"
            desc={confirmReset
              ? 'Every setting on both sides goes back to the original and the app reloads.'
              : 'Puts every setting back to the original. Media folders, mixtapes, custom EQ presets and loudness measurements are kept.'}
          >
            {confirmReset ? (
              <>
                <button className="advanced-action-button advanced-action-button-muted" onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="advanced-action-button advanced-action-button-danger" onClick={resetSettings}>Yes, reset</button>
              </>
            ) : (
              <button className="advanced-action-button advanced-action-button-danger" onClick={() => setConfirmReset(true)}>Reset</button>
            )}
          </Row>
        </Rows>
      </Group>
    </>
  );
}
