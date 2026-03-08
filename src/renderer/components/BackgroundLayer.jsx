import { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';

export default function BackgroundLayer() {
  const thumbnail = useAppStore((s) => s.backgroundThumbnail);
  const layerRef = useRef(null);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;

    if (thumbnail) {
      el.classList.remove('active');
      const timer = setTimeout(() => {
        el.style.backgroundImage = `url('${thumbnail}')`;
        el.classList.add('active');
      }, 500);
      return () => clearTimeout(timer);
    } else {
      el.classList.remove('active');
      const timer = setTimeout(() => {
        el.style.backgroundImage = '';
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [thumbnail]);

  return <div id="background-layer" ref={layerRef} />;
}
