import { useState, useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import {
  useSearchStore, SEARCH_TABS, startSearch, openTab, refreshTab, loadMore,
  closeSearch, toggleSelected, clearSelected, addSelected,
} from '../services/searchService';
import { submitLink } from '../services/downloadService';
import { looksLikeUrl } from '../utils/linkCheck';
import InputError, { useTimedError } from './InputError';
import DownloadOptions from './DownloadOptions';
import { SearchIcon, PlusIcon } from './InputBar';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function formatDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function metaFor(result, tab) {
  if (result.kind === 'playlist') return ['Playlist', result.channel].filter(Boolean).join(' · ');
  const parts = [result.channel || (tab === 'music' ? 'Song' : null)];
  if (result.views != null) parts.push(`${compact.format(result.views)} views`);
  return parts.filter(Boolean).join(' · ');
}

function ResultRow({ result, tab, picked, queued }) {
  return (
    <button
      type="button"
      className={`search-row${picked ? ' search-row-picked' : ''}${queued ? ' search-row-queued' : ''}`}
      onClick={() => toggleSelected(result, tab)}
      disabled={queued}
      title={queued ? 'Already in the queue' : result.title}
    >
      <span className="search-row-check">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span className="search-row-thumb">
        {result.thumbnail && <img src={result.thumbnail} alt="" loading="lazy" draggable={false} />}
        {result.duration ? <span className="search-row-duration">{formatDuration(result.duration)}</span> : null}
        {result.kind === 'playlist' && (
          <span className="search-row-playlist">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="14" y2="18" />
            </svg>
          </span>
        )}
      </span>
      <span className="search-row-info">
        <span className="search-row-title">{result.title}</span>
        <span className="search-row-meta">{metaFor(result, tab)}</span>
      </span>
      {queued && <span className="search-row-tag">In queue</span>}
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="search-row search-row-skeleton">
      <span className="search-row-check" />
      <span className="search-row-thumb skeleton-loader" />
      <span className="search-row-info">
        <span className="search-skeleton-line skeleton-loader" />
        <span className="search-skeleton-line search-skeleton-short skeleton-loader" />
      </span>
    </div>
  );
}

export default function SearchPanel() {
  const query = useSearchStore((s) => s.query);
  const tab = useSearchStore((s) => s.tab);
  const state = useSearchStore((s) => s.tabs[s.tab]);
  const selected = useSearchStore((s) => s.selected);
  const notice = useSearchStore((s) => s.notice);
  const queue = useAppStore((s) => s.queue);
  const [text, setText] = useState(query);
  const [error, showError, clearError] = useTimedError();
  const listRef = useRef(null);

  useEffect(() => setText(query), [query]);
  // a new tab or search starts at the top of the list.
  useEffect(() => listRef.current?.scrollTo(0, 0), [tab, query]);

  const queued = new Set(queue.map((q) => q.url));
  const picks = Object.values(selected);
  const counts = {};
  picks.forEach((p) => { counts[p.tab] = (counts[p.tab] || 0) + 1; });
  const busy = state.status === 'loading' || state.status === 'loading-more';
  const skeletons = state.status === 'loading'
    ? Math.max(0, 6 - state.results.length)
    : state.status === 'loading-more' ? 3 : 0;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!looksLikeUrl(trimmed)) {
      startSearch(trimmed);
      return;
    }
    const { downloadQuality, downloadFormat, setLinkControlsRevealed } = useAppStore.getState();
    const result = await submitLink(trimmed, downloadQuality, downloadFormat);
    if (result?.error) showError(result.error);
    // a cancelled playlist keeps the search open.
    if (result) return;
    setLinkControlsRevealed(true);
    closeSearch();
  };

  return (
    <div className="search-panel">
      <div className="search-panel-top">
        <button className="search-panel-back" onClick={closeSearch} title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="url-field search-panel-field">
          <input
            type="text"
            className="url-input"
            placeholder="Search for anything, or paste a link"
            value={text}
            onChange={(e) => { setText(e.target.value); clearError(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') closeSearch();
            }}
          />
          <button className="url-submit" onClick={submit} disabled={!text.trim()} title={looksLikeUrl(text.trim()) ? 'Add link' : 'Search'}>
            {looksLikeUrl(text.trim()) ? <PlusIcon /> : <SearchIcon />}
          </button>
        </div>
      </div>
      <InputError message={error} />

      <div className="search-tabs" role="tablist">
        {SEARCH_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={`search-tab${t.id === tab ? ' search-tab-active' : ''}`}
            onClick={() => openTab(t.id)}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="search-tab-badge" title={`${counts[t.id]} selected here`}>{counts[t.id]}</span>}
          </button>
        ))}
        <button className="search-refresh" onClick={refreshTab} disabled={busy} title="Refresh results">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div className="search-body">
        <div className="search-list" ref={listRef}>
          {state.results.map((r) => (
            <ResultRow key={r.url} result={r} tab={tab} picked={!!selected[r.url]} queued={queued.has(r.url)} />
          ))}
          {Array.from({ length: skeletons }, (_, i) => <SkeletonRow key={`skeleton-${i}`} />)}
          {state.status === 'done' && state.results.length === 0 && (
            <div className="search-message">No results for &ldquo;{query}&rdquo;.</div>
          )}
          {state.status === 'error' && (
            <div className="search-message search-message-error">
              {state.error}
              <button className="search-message-action" onClick={refreshTab}>Try again</button>
            </div>
          )}
          {state.status === 'done' && state.more && (
            <button className="search-more" onClick={loadMore}>Load more</button>
          )}
        </div>

        <div className="search-footer">
          <div className="search-footer-status">
            {notice ? (
              <span className="search-footer-notice">{notice}</span>
            ) : picks.length > 0 ? (
              <>
                <span>{picks.length} selected</span>
                <button className="search-footer-clear" onClick={clearSelected}>Clear</button>
              </>
            ) : (
              <span className="search-footer-hint">Select results to add them</span>
            )}
          </div>
          <DownloadOptions className="search-footer-options" />
          <button className="search-add" onClick={addSelected} disabled={picks.length === 0}>
            <PlusIcon size={14} />
            Add selected to queue
          </button>
        </div>
      </div>
    </div>
  );
}
