import { useRef, useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';

export default function ScrollingText({ text, className = '', variant = 'default' }) {
  const disableSliding = useAppStore((s) => s.behaviorDisableSlidingTitles);
  const containerRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  const isAmbient = variant === 'ambient';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => {
      const isOverflowing = !disableSliding && el.scrollWidth > el.clientWidth + 1;
      setOverflows(isOverflowing);
      if (isOverflowing) {
        const inner = el.firstElementChild;
        if (inner) {
          const dist = el.scrollWidth - el.clientWidth;
          inner.style.setProperty('--scroll-dist', `${-dist}px`);
          // ambient: slower speed, longer cycle; default: snappy queue/mini-player speed
          const dur = isAmbient ? (dist / 6) + 16 : (dist / 20) + 4;
          inner.style.setProperty('--scroll-dur', `${dur}s`);
        }
      }
    };
    check();
    const obs = new ResizeObserver(check);
    obs.observe(el);
    return () => obs.disconnect();
  }, [text, isAmbient, disableSliding]);

  const innerClass = isAmbient ? 'scrolling-text-inner-ambient' : 'scrolling-text-inner';

  return (
    <div
      ref={containerRef}
      className={`scrolling-text${overflows ? ' scrolling-text-active' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className={overflows ? innerClass : ''}>{text}</span>
    </div>
  );
}
