import { useState, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import { submitLink } from '../services/downloadService';
import { startSearch } from '../services/searchService';
import { looksLikeUrl } from '../utils/linkCheck';
import InputError, { useTimedError } from './InputError';
import DownloadOptions from './DownloadOptions';

export function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="22" y2="22" />
    </svg>
  );
}

// the downloader's icon, which animates while a batch runs and shows a check once it's done.
export function DownloadIcon({ size, busy, done }) {
  return (
    <svg
      className={busy ? 'download-icon-busy' : done ? 'download-icon-done' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path className="download-tray" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <g className="download-arrow">
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </g>
      <polyline className="download-check" points="7.5 9 10.5 12 16.5 6" pathLength="1" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default function InputBar() {
  const [text, setText] = useState('');
  const [error, showError, clearError] = useTimedError();
  const inputRef = useRef(null);
  const revealed = useAppStore((s) => s.linkControlsRevealed);
  const setRevealed = useAppStore((s) => s.setLinkControlsRevealed);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const totalProgress = useAppStore((s) => s.totalProgress);
  const isLink = looksLikeUrl(text.trim());
  // says what the downloader is doing while a batch runs, and for the moment after it finishes.
  const several = totalProgress.total > 1;
  const finished = !isDownloading && totalProgress.visible && totalProgress.text === 'Complete!';
  const intro = isDownloading
    ? `Downloading your selection${several ? 's' : ''}`
    : finished
      ? `Your selection${several ? 's are' : ' is'} ready`
      : 'What are you looking for?';

  const handleChange = (e) => {
    setText(e.target.value);
    clearError();
    if (!revealed && looksLikeUrl(e.target.value.trim())) setRevealed(true);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!looksLikeUrl(trimmed)) {
      startSearch(trimmed);
      return;
    }
    const { downloadQuality, downloadFormat } = useAppStore.getState();
    const result = await submitLink(trimmed, downloadQuality, downloadFormat);
    if (result?.error) showError(result.error);
    // a cancelled playlist keeps the link in the field.
    if (result) return;
    setText('');
    // unfocusing brings the downloader touch bar back after a link is added.
    inputRef.current?.blur();
  };

  return (
    <div className="input-bar">
      <div className={`input-bar-intro${isDownloading ? ' input-bar-intro-busy' : ''}${finished ? ' input-bar-intro-done' : ''}`}>
        <DownloadIcon size={28} busy={isDownloading} done={finished} />
        <div className="input-bar-intro-text">
          <span>{intro}</span>
          {/* stays in place while hidden, so it can ease open and shut instead of jumping. */}
          <span className="input-bar-sub" aria-hidden={!isDownloading}>
            You can keep browsing while {several ? 'they download' : 'it downloads'}
          </span>
        </div>
      </div>
      <div className="url-field">
        <input
          ref={inputRef}
          type="text"
          className="url-input"
          placeholder="Search for anything, or paste a link"
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <button className="url-submit" onClick={submit} disabled={!text.trim()} title={isLink ? 'Add link' : 'Search'}>
          {isLink ? <PlusIcon /> : <SearchIcon />}
        </button>
      </div>
      {revealed && <DownloadOptions className="input-controls input-controls-reveal" />}
      <InputError message={error} />
    </div>
  );
}
