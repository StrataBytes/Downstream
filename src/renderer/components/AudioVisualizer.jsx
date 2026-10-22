import { useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { createBarReader, STANDARD_BARS } from '../utils/spectrumBars';

// bars drawn at each detail level, picked in behavior.
const DETAIL_BARS = { standard: STANDARD_BARS, high: 120, ultra: 160 };
const BAR_GAP = 2;

export default function AudioVisualizer() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const analyser = useAppStore((s) => s.musicAnalyser);
  const hidden = useAppStore((s) => s.behaviorHideVisualizer);
  const isLite = useAppStore((s) => s.renderProfile === 'lite');
  const liteDisableVisualizer = useAppStore((s) => s.liteDisableVisualizer);
  const visualizerOff = isLite && liteDisableVisualizer;
  const bars = DETAIL_BARS[useAppStore((s) => s.visualizerDetail)] || DETAIL_BARS.standard;
  const legacy = useAppStore((s) => s.visualizerStyle === 'legacy');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const reader = analyser ? createBarReader(analyser, bars, { legacy }) : null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      if (!reader) return;
      analyser.getByteFrequencyData(dataArray);
      const heights = reader.read(dataArray);

      const barW = (w - BAR_GAP * (bars - 1)) / bars;

      for (let i = 0; i < bars; i++) {
        const val = heights[i];
        const barH = val * h;

        const x = i * (barW + BAR_GAP);
        const y = h - barH;

        const hue = 170 + (i / bars) * 20;
        const alpha = 0.1 + val * 0.5;
        ctx.fillStyle = `hsla(${hue}, 65%, 55%, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 1.5);
        ctx.fill();
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [analyser, hidden, visualizerOff, bars, legacy]);

  if (hidden || visualizerOff) return null;

  return <canvas ref={canvasRef} className="audio-visualizer" />;
}
