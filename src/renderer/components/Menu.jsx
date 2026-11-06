import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// a menu at a point, kept on screen, that closes on an outside click or escape.
// without room below, it ends at flipTo instead, which is the point itself unless said otherwise.
// it renders at the page root, since a widget's backdrop blur would offset a fixed menu inside it.
export default function Menu({ x, y, flipTo = y, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
  // placed again whenever its size changes, so it never grows over what it opened from.
  // the size is read without the opening zoom, which starts it a little smaller.
  useLayoutEffect(() => {
    const place = () => {
      const width = ref.current.offsetWidth;
      const height = ref.current.offsetHeight;
      setPos({
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: y + height > window.innerHeight - 8 ? Math.max(8, flipTo - height) : y,
      });
    };
    place();
    const watcher = new ResizeObserver(place);
    watcher.observe(ref.current);
    return () => watcher.disconnect();
  }, [x, y, flipTo]);
  useEffect(() => {
    const outside = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(<div ref={ref} className="queue-ctx-menu folders-menu" style={pos}>{children}</div>, document.body);
}
