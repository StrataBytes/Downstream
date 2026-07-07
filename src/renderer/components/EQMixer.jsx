import { useState } from 'react';
import useAppStore from '../stores/useAppStore';

const PRESETS = [
  { name: 'Balanced',   values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost', values: [5, 4.5, 3.5, 2, 0.5, 0, 0, 0, 0, 0] },
  { name: 'Treble',     values: [0, 0, 0, 0, 0, 0.5, 2, 3.5, 4.5, 5] },
  { name: 'Smooth',     values: [2, 1.5, 1, 0, -1, -1, 0, 1, 1.5, 2] },
  { name: 'Dynamic',    values: [4, 3, 1, -1, -2, -2, -1, 1, 3, 4] },
  { name: 'Clear',      values: [-1, -1.5, -1, 0, 1, 2, 3, 3.5, 3, 2] },
  { name: 'Amplified',  values: [3, 4.5, 3, 2, 4.5, 0.5, 0.5, 1.5, 3, 0.5] },
];

const BANDS = [
  { freq: 31,    label: '31Hz',  group: 'SUB BASS' },
  { freq: 63,    label: '63Hz',  group: 'SUB BASS' },
  { freq: 125,   label: '125Hz', group: 'BASS' },
  { freq: 250,   label: '250Hz', group: 'BASS' },
  { freq: 500,   label: '500Hz', group: 'LOW MIDS' },
  { freq: 1000,  label: '1kHz',  group: 'MID RANGE' },
  { freq: 2000,  label: '2kHz',  group: 'MID RANGE' },
  { freq: 4000,  label: '4kHz',  group: 'UPPER MID' },
  { freq: 8000,  label: '8kHz',  group: 'TREBLE' },
  { freq: 16000, label: '16kHz', group: 'TREBLE' },
];

const BALANCED = PRESETS[0]; // 'balanced' is always index 0

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem('eqPresetOverrides') || '{}');
  } catch {
    return {};
  }
}

function loadActivePreset() {
  const saved = localStorage.getItem('eqActivePreset');
  // validates it's still a known preset (guard against renamed presets)
  return PRESETS.some((p) => p.name === saved) ? saved : BALANCED.name;
}

export default function EQMixer() {
  const eqOpen = useAppStore((s) => s.eqOpen);
  const setEqOpen = useAppStore((s) => s.setEqOpen);
  const eqBands = useAppStore((s) => s.eqBands);
  const setEqBand = useAppStore((s) => s.setEqBand);

  const [closing, setClosing] = useState(false);
  const [activePreset, setActivePreset] = useState(loadActivePreset);
  const [overrides, setOverrides] = useState(loadOverrides);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const getPresetBands = (name) =>
    overrides[name] ?? PRESETS.find((p) => p.name === name).values;

  const savePresetBands = (name, bands) => {
    const next = { ...overrides, [name]: bands };
    setOverrides(next);
    localStorage.setItem('eqPresetOverrides', JSON.stringify(next));
  };

  const handleApplyPreset = (preset) => {
    setActivePreset(preset.name);
    localStorage.setItem('eqActivePreset', preset.name);
    setConfirmingReset(false);
    getPresetBands(preset.name).forEach((v, i) => setEqBand(i, v));
  };

  const handleBandChange = (i, v) => {
    setEqBand(i, v);
    if (activePreset) {
      const newBands = eqBands.map((b, j) => j === i ? v : b);
      savePresetBands(activePreset, newBands);
    }
  };

  const handleResetClick = () => {
    if (!activePreset) return;
    setConfirmingReset(true);
  };

  const handleResetConfirm = () => {
    const factory = PRESETS.find((p) => p.name === activePreset).values;
    factory.forEach((v, i) => setEqBand(i, v));
    const next = { ...overrides };
    delete next[activePreset];
    setOverrides(next);
    localStorage.setItem('eqPresetOverrides', JSON.stringify(next));
    // eqBands localStorage entry is updated via setEqBand above, no separate write needed here.
    setConfirmingReset(false);
  };

  if (!eqOpen && !closing) return null;

  const handleClose = () => {
    setConfirmingReset(false);
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setEqOpen(false);
    }, 350);
  };

  return (
    <div className={`eq-backdrop${closing ? ' eq-backdrop-closing' : ''}`} onClick={handleClose}>
      <div className={`eq-panel${closing ? ' eq-panel-closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="eq-header">
          <h2>Equalizer</h2>
          <div className="eq-header-actions">
            {confirmingReset ? (
              // replaces the reset button in place, same header row, so the eq content below never shifts.
              <div className="eq-reset-confirm">
                <span className="eq-reset-confirm-text">
                  Reset <strong>{activePreset}</strong>?
                </span>
                <button className="eq-reset-confirm-yes" onClick={handleResetConfirm}>Reset</button>
                <button className="eq-reset-confirm-cancel" onClick={() => setConfirmingReset(false)}>Cancel</button>
              </div>
            ) : (
              <button
                className={`eq-reset-btn${!activePreset ? ' eq-reset-btn-disabled' : ''}`}
                onClick={handleResetClick}
                title={activePreset ? `Reset ${activePreset} to defaults` : 'Select a preset to reset it'}
                disabled={!activePreset}
              >
                Reset
              </button>
            )}
            <button className="eq-close-btn" onClick={handleClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="eq-presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className={`eq-preset-btn${activePreset === p.name ? ' eq-preset-active' : ''}`}
              onClick={() => handleApplyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="eq-db-labels">
          <span>+6dB</span>
          <span>+3dB</span>
          <span>0</span>
          <span>-3dB</span>
          <span>-6dB</span>
        </div>

        <div className="eq-bands">
          {BANDS.map((band, i) => (
            <div className="eq-band" key={band.freq}>
              <div className="eq-slider-track">
                <div className="eq-grid-line eq-grid-6" />
                <div className="eq-grid-line eq-grid-3" />
                <div className="eq-grid-line eq-grid-0" />
                <div className="eq-grid-line eq-grid-n3" />
                <div className="eq-grid-line eq-grid-n6" />
                <input
                  type="range"
                  className="eq-slider"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={eqBands[i]}
                  onChange={(e) => handleBandChange(i, parseFloat(e.target.value))}
                  orient="vertical"
                />
                <div
                  className="eq-dot"
                  style={{ bottom: `${((eqBands[i] + 6) / 12) * 100}%` }}
                />
              </div>
              <span className="eq-freq-label">{band.label}</span>
            </div>
          ))}
        </div>

        <div className="eq-group-labels">
          <span style={{ gridColumn: '1 / 3' }}>SUB BASS</span>
          <span style={{ gridColumn: '3 / 5' }}>BASS</span>
          <span style={{ gridColumn: '5 / 6' }}>LOW MIDS</span>
          <span style={{ gridColumn: '6 / 8' }}>MID RANGE</span>
          <span style={{ gridColumn: '8 / 9' }}>UPPER MID</span>
          <span style={{ gridColumn: '9 / 11' }}>TREBLE</span>
        </div>
      </div>
    </div>
  );
}
