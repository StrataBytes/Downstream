import { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '../stores/useAppStore';
import { getLogs, subscribe, clearLogs, setDebugCaptureEnabled } from '../services/debugLog';

const LEVEL_CLASS = { error: 'dbg-error', warn: 'dbg-warn', info: 'dbg-info', log: 'dbg-log' };

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function DebugConsole() {
  const open = useAppStore((s) => s.debugConsoleOpen);
  const setOpen = useAppStore((s) => s.setDebugConsoleOpen);

  const [logs, setLogs] = useState(getLogs);
  const [pos, setPos] = useState({ x: null, y: null });
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const autoScroll = useRef(true);

  // capture is only active while the pane is open: enables on open, subscribes for live updates, and disables and unsubscribes on close so nothing runs in the background.
  useEffect(() => {
    if (!open) return;
    setDebugCaptureEnabled(true);
    setLogs(getLogs());
    const unsub = subscribe(() => setLogs(getLogs()));
    return () => {
      unsub();
      setDebugCaptureEnabled(false);
    };
  }, [open]);

  // auto-scrolls to newest unless the user has scrolled up to read history.
  useEffect(() => {
    if (autoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const onDragStart = useCallback((e) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(window.innerWidth - 90, ev.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - 28, ev.clientY - offY));
      setPos({ x, y });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const copyAll = () => {
    const text = getLogs()
      .map((l) => `[${fmtTime(l.ts)}] ${l.source.toUpperCase()} ${l.level}: ${l.text}`)
      .join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  if (!open) return null;

  const style = pos.x === null
    ? undefined
    : { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' };

  return (
    <div className="dbg-console" ref={panelRef} style={style}>
      <div className="dbg-titlebar" onMouseDown={onDragStart}>
        <span className="dbg-title">
          Debugging Outlog
        </span>
        <div className="dbg-titlebar-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button className="dbg-btn" onClick={() => { clearLogs(); setLogs([]); }} title="Clear output">
            Clear
          </button>
          <button className="dbg-btn" onClick={copyAll} title="Copy all output">
            Copy
          </button>
          <button className="dbg-close" onClick={() => setOpen(false)} title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="dbg-log" ref={listRef} onScroll={onScroll}>
        {logs.length === 0 ? (
          <div className="dbg-empty">No output yet.</div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className={`dbg-line ${LEVEL_CLASS[l.level] || 'dbg-log'}`}>
              <span className="dbg-time">{fmtTime(l.ts)}</span>
              <span className={`dbg-src dbg-src-${l.source}`}>{l.source === 'main' ? 'MAIN' : 'UI'}</span>
              <span className="dbg-text">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
