import { useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { countMeasured } from '../services/loudnessService';
import { LoudnessPreview } from './SettingsPreviews';

// what the measuring under the player is doing, opened from its notice.
// the picture shows the idea, the count shows how far along it is, and the sound settings are one step away.
export default function NormalizationInfoModal() {
  const open = useAppStore((s) => s.normInfoOpen && s.currentView === 'player');
  const setNormInfoOpen = useAppStore((s) => s.setNormInfoOpen);
  const files = useAppStore((s) => s.musicFiles);
  const scanning = useAppStore((s) => s.loudnessScanningTrack);
  useAppStore((s) => s.loudnessScanTick);

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') setNormInfoOpen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, setNormInfoOpen]);

  if (!open) return null;

  const measured = countMeasured(files);
  const close = () => setNormInfoOpen(false);
  const toSettings = () => {
    close();
    useAppStore.getState().openSettings('player', 'normalizerMode');
  };

  return (
    <div className="modal" onClick={close}>
      <div className="norm-info" role="dialog" aria-label="Leveling your songs" onClick={(e) => e.stopPropagation()}>
        <LoudnessPreview />
        <div className="norm-info-body">
          <h2 className="norm-info-title">Leveling your songs</h2>
          <p className="norm-info-text">
            Downstream listens to each song once, in the background, to learn how loud it is.
            From then on it plays at the same steady level as everything else, and keeps its own quiet and loud moments.
          </p>
          {files.length > 0 && (
            <div className="norm-info-progress">
              <div className="norm-info-progress-text">
                <span>{measured} of {files.length} measured in this folder</span>
                {scanning && <span className="norm-info-now">Measuring {scanning}</span>}
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${(measured / files.length) * 100}%` }} />
              </div>
            </div>
          )}
          <ul className="norm-info-points">
            <li>Until a song is measured, Reactive levels it as it plays.</li>
            <li>Only the measurement is kept. Your files are never changed.</li>
          </ul>
          <div className="norm-info-buttons">
            <button type="button" className="welcome-btn" onClick={toSettings}>Sound settings</button>
            <button type="button" className="welcome-btn welcome-btn-main" onClick={close} autoFocus>Got it</button>
          </div>
        </div>
      </div>
    </div>
  );
}
