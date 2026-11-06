import { useEffect, useMemo, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { SIDES, page as pageOf, sidePages, entry, findSettings, pageChanged } from '../utils/settingsCatalog';
import { SearchIcon } from './InputBar';
import AdvancedPage from './AdvancedOptions';
import { SettingsContext, PageReset } from './SettingsParts';
import {
  GeneralPage, DownloadsPage, LibraryPage, PerformancePage, TouchBarPage, ViewPage, BackgroundPage, VisualizerPage, SoundPage, PlaybackPage,
} from './SettingsPages';

const VIEWS = {
  general: GeneralPage,
  downloads: DownloadsPage,
  library: LibraryPage,
  performance: PerformancePage,
  touchbar: TouchBarPage,
  advanced: AdvancedPage,
  view: ViewPage,
  background: BackgroundPage,
  visualizer: VisualizerPage,
  sound: SoundPage,
  playback: PlaybackPage,
};

const ICON_PATHS = {
  general: <><path d="M4 6h10M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  downloads: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  library: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  performance: <><path d="M12 14l4-4" /><path d="M3.5 18a9 9 0 1 1 17 0" /></>,
  touchbar: <><rect x="2" y="9" width="20" height="6" rx="2" /><path d="M6 12h.01M10 12h4M18 12h.01" /></>,
  advanced: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
  view: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  background: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  visualizer: <path d="M5 20v-6M9.5 20V8M14 20v-9M18.5 20V5" />,
  sound: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  playback: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
};

// the home screen opens the app's side, and the player opens its own.
const DOOR_SIDE = { home: 'app', player: 'player' };

// the page each side showed last, so coming back to a side returns there.
const lastPage = { app: 'general', player: 'view' };

// how long a setting found by search or a link stays lit.
const FLASH_MS = 1600;

export function PageButton({ page, active, onClick }) {
  const changed = useAppStore((s) => pageChanged(page.id, s));
  return (
    <button type="button" className={`settings-nav-btn${active ? ' settings-nav-btn-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[page.id]}</svg>
      {page.name}
      {changed && <span className="settings-page-changed" title="Something here is changed from the original" />}
    </button>
  );
}

export function SideButton({ side, active, onClick }) {
  return (
    <button type="button" className={`settings-side${active ? ' settings-side-active' : ''}`} aria-pressed={active} onClick={onClick}>
      {side.name}
    </button>
  );
}

// one window for every setting, in two sides: how the app itself runs, and how the player looks and sounds.
// each page is a short list, mostly under a picture of what it changes, and search finds a setting on either side.
export default function SettingsModal() {
  const door = useAppStore((s) => s.settingsOpen);
  const asked = useAppStore((s) => s.settingsPage);
  if (!door) return null;
  return <SettingsWindow key={`${door}:${asked}`} door={door} asked={asked} />;
}

// opening starts on the page asked for, or where the door's side left off.
// a setting asked for by name opens on its page, lit up.
function SettingsWindow({ door, asked }) {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setting = asked && !VIEWS[asked] ? entry(asked) : null;
  const [page, setPage] = useState(() => (setting ? setting.page : asked && VIEWS[asked] && pageOf(asked) ? asked : lastPage[DOOR_SIDE[door] || 'app']));
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(() => (setting ? { id: asked } : null));
  const bodyRef = useRef(null);
  const results = useMemo(() => findSettings(query), [query]);
  const current = pageOf(page) || pageOf('general');
  const View = VIEWS[current.id];

  useEffect(() => {
    lastPage[current.side] = current.id;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [current]);

  // escape clears a search first, then closes the window.
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape') return;
      if (query) setQuery('');
      else closeSettings();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [query, closeSettings]);

  const goTo = (id) => {
    const found = entry(id);
    if (!found) return;
    setQuery('');
    setPage(found.page);
    setTarget({ id });
  };

  // once its page shows, the setting is scrolled to and lit up.
  // one that's folded away lights up what it's folded inside instead, or what's holding it off.
  useEffect(() => {
    if (!target) return;
    let frame;
    let timer;
    let tries = 0;
    const find = () => {
      const body = bodyRef.current;
      let el = body?.querySelector(`[data-setting="${target.id}"]`);
      // rows that load in a moment, like the graphics settings, get a few frames to show up.
      if (!el && ++tries < 20) {
        frame = requestAnimationFrame(find);
        return;
      }
      const inside = (id, depth) => {
        const found = body?.querySelector(`[data-setting="${id}"]`);
        if (found || depth > 3) return found;
        for (const next of [].concat(entry(id)?.under || [])) {
          const held = inside(next, depth + 1);
          if (held) return held;
        }
        return null;
      };
      if (!el) el = inside(target.id, 0);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.removeAttribute('data-flash');
      void el.offsetWidth;
      el.setAttribute('data-flash', '');
      timer = setTimeout(() => el.removeAttribute('data-flash'), FLASH_MS);
    };
    frame = requestAnimationFrame(find);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [target]);

  const sideName = (id) => SIDES.find((s) => s.id === id)?.name;

  return (
    <SettingsContext.Provider value={{ goTo }}>
      <div className="settings-backdrop" onClick={closeSettings}>
        <div className="settings-modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2 className="settings-title">Settings</h2>
            <div className="settings-sides">
              {SIDES.map((side) => (
                <SideButton key={side.id} side={side} active={side.id === current.side} onClick={() => { setQuery(''); setPage(lastPage[side.id]); }} />
              ))}
            </div>
            <button type="button" className="settings-close" onClick={closeSettings} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="settings-main">
            <nav className="settings-nav">
              <label className="settings-search">
                <SearchIcon size={12} />
                <input
                  type="text"
                  value={query}
                  placeholder="Search all settings"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) goTo(results[0].id); }}
                />
              </label>
              {query.trim() ? (
                results.length ? (
                  results.map((r) => (
                    <button key={r.id} type="button" className="settings-result" onClick={() => goTo(r.id)}>
                      <span>{r.label}</span>
                      <small>{sideName(pageOf(r.page).side)} › {pageOf(r.page).name}</small>
                    </button>
                  ))
                ) : (
                  <p className="settings-no-results">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
                )
              ) : (
                sidePages(current.side).map((p) => <PageButton key={p.id} page={p} active={p.id === current.id} onClick={() => setPage(p.id)} />)
              )}
            </nav>

            <div className="settings-body" ref={bodyRef}>
              <div className="settings-page-head">
                <h3 className="settings-page-title">{current.name}</h3>
                <PageReset page={current.id} />
              </div>
              <View />
            </div>
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}
