import { useState, useRef, useEffect, useCallback } from 'react';

// an inline error that clears itself after a few seconds.
export function useTimedError(ms = 5000) {
  const [error, setError] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((reason) => {
    setError(reason);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setError(null), ms);
  }, [ms]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setError(null);
  }, []);

  return [error, show, clear];
}

export default function InputError({ message }) {
  if (!message) return null;
  return (
    <div className="input-bar-error">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
