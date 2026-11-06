import { createContext, useContext, useId } from 'react';
import useAppStore from '../stores/useAppStore';
import { ENTRIES, isChanged, pageChanged, resetPage, resetSetting } from '../utils/settingsCatalog';

// how a page reaches the window around it, to jump to a setting.
export const SettingsContext = createContext({ goTo: () => {} });

// a quiet arrow beside a setting that's been changed from the original, which puts it back.
export function Changed({ id }) {
  const changed = useAppStore((s) => isChanged(id, s));
  if (!changed) return null;
  return (
    <button
      type="button"
      className="settings-changed"
      title="Changed from the original. Click to put it back."
      aria-label="Put back the original"
      onClick={(e) => {
        e.stopPropagation();
        resetSetting(id, useAppStore.getState());
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
    </button>
  );
}

export function Group({ id, title, note, children }) {
  return (
    <section className="settings-group" data-setting={id}>
      {title && (
        <h4 className="settings-group-title">
          {title}
          {id && <Changed id={id} />}
        </h4>
      )}
      {note && <p className="settings-group-note">{note}</p>}
      {children}
    </section>
  );
}

// the box a group's rows sit in, with a line between each.
export function Rows({ children }) {
  return <div className="settings-rows">{children}</div>;
}

// a setting's name and a line about it, with its control at the end.
export function Row({ id, label, desc, children }) {
  return (
    <div className="settings-row" data-setting={id}>
      <span className="settings-row-info">
        <span className="settings-row-label">{label}<Changed id={id} /></span>
        {desc && <span className="settings-row-desc">{desc}</span>}
      </span>
      {children && <span className="settings-row-control">{children}</span>}
    </div>
  );
}

// a setting lite mode is holding off, shown as a line in its place with a way to the lite switch doing it.
export function LiteHeld({ id, lite, children }) {
  const { goTo } = useContext(SettingsContext);
  return (
    <p className="settings-held" data-setting={id}>
      {children}{' '}
      <button type="button" className="settings-link" onClick={() => goTo(lite)}>Lite Mode settings</button>
    </p>
  );
}

// the chosen card's own settings, hung under the cards on an accent rail.
// the cards not chosen show nothing, since their settings have no bearing.
export function ModeOptions({ id, title, children }) {
  return (
    <div className="settings-mode-options" data-setting={id}>
      {title && <span className="settings-mode-title">{title}</span>}
      {children}
    </div>
  );
}

export function Switch({ on }) {
  return (
    <span className={`behavior-switch${on ? ' behavior-switch-on' : ''}`}>
      <span className="behavior-switch-thumb" />
    </span>
  );
}

// a whole row that turns something on or off, read as on when the thing shows or happens.
// the switch is a button stretched across the row, under the arrow that puts it back.
export function SwitchRow({ id, label, desc, on, onChange }) {
  const labelId = useId();
  return (
    <div className="settings-row settings-row-switch" data-setting={id}>
      <span className="settings-row-info">
        <span className="settings-row-label"><span id={labelId}>{label}</span><Changed id={id} /></span>
        {desc && <span className="settings-row-desc">{desc}</span>}
      </span>
      <span className="settings-row-control"><Switch on={on} /></span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={labelId} className="settings-row-hit" onClick={() => onChange(!on)} />
    </div>
  );
}

// a setting's name and value over its slider, with a line under it.
export function SliderRow({ id, label, value, note, children }) {
  return (
    <div className="settings-row settings-row-slider" data-setting={id}>
      <span className="settings-slider-head">
        <span className="settings-row-label">{label}<Changed id={id} /></span>
        {value !== undefined && <span className="behavior-slider-value">{value}</span>}
      </span>
      {children}
      {note && <span className="settings-row-desc">{note}</span>}
    </div>
  );
}

// one of a few whole ways of working, picked from cards with a picture of each.
export function Cards({ options, value, onChange }) {
  return (
    <div className={`settings-cards${options.some((o) => o.drawing) ? '' : ' settings-cards-plain'}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button key={option.id} type="button" className={`settings-card${value === option.id ? ' settings-card-on' : ''}`} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.drawing}
          <span className="settings-card-name">
            {option.name}
            {option.tag && <span className="settings-card-tag">{option.tag}</span>}
          </span>
          <span className="settings-card-desc">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

// a few unordered choices as a row of labels.
export function Pills({ options, value, onChange }) {
  return (
    <div className="behavior-pill-row">
      {options.map((option) => (
        <button key={option.id} type="button" className={`behavior-pill${value === option.id ? ' behavior-pill-active' : ''}`} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

// puts every setting on the page back to the original, shown only once something there is changed.
export function PageReset({ page }) {
  const changed = useAppStore((s) => pageChanged(page, s));
  if (!changed || !ENTRIES.some((e) => e.page === page && e.key)) return null;
  return (
    <button type="button" className="settings-page-reset" onClick={() => resetPage(page, useAppStore.getState())}>
      Reset page
    </button>
  );
}
