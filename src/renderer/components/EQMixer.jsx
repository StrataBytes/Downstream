import { useState } from 'react';
import useAppStore from '../stores/useAppStore';

const PRESETS = [
  { name: 'Balanced',      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost',    values: [5, 4.5, 3.5, 2, 0.5, 0, 0, 0, 0, 0] },
  { name: 'Treble',        values: [0, 0, 0, 0, 0, 0.5, 2, 3.5, 4.5, 5] },
  { name: 'Smooth',        values: [2, 1.5, 1, 0, -1, -1, 0, 1, 1.5, 2] },
  { name: 'Dynamic',       values: [4, 3, 1, -1, -2, -2, -1, 1, 3, 4] },
  { name: 'Clear',         values: [-1, -1.5, -1, 0, 1, 2, 3, 3.5, 3, 2] },
  { name: 'Amplified',    values: [3, 4.5, 3, 2, 4.5, 0.5, 0.5, 1.5, 3, 0.5] },
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

export default function EQMixer() {
  const eqOpen = useAppStore((s) => s.eqOpen);
  const setEqOpen = useAppStore((s) => s.setEqOpen);
  const eqBands = useAppStore((s) => s.eqBands);
  const setEqBand = useAppStore((s) => s.setEqBand);
  const resetEq = useAppStore((s) => s.resetEq);

  const [closing, setClosing] = useState(false);

  const getActivePreset = () => {
    return PRESETS.find((p) =>
      p.values.every((v, i) => v === eqBands[i])
    )?.name || null;
  };

  const applyPreset = (preset) => {
    preset.values.forEach((v, i) => setEqBand(i, v));
  };

  if (!eqOpen && !closing) return null;

  const handleClose = () => {
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
          <button className="eq-reset-btn" onClick={resetEq} title="Reset to flat">
            Reset
          </button>
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
            className={`eq-preset-btn${getActivePreset() === p.name ? ' eq-preset-active' : ''}`}
            onClick={() => applyPreset(p)}
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
                onChange={(e) => setEqBand(i, parseFloat(e.target.value))}
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
