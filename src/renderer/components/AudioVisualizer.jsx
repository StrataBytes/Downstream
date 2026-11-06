import { useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { createBarReader, DETAIL_BARS, liftReadings, paintBars } from '../utils/spectrumBars';

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
    const lifted = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    // the analyser's readings run from its quietest to loudest decibels across a byte.
    const perDb = analyser ? 255 / (analyser.maxDecibels - analyser.minDecibels) : 0;

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
      // the brightness setting scales how strongly every bar shows.
      const { lookVisualizerBrightness: brightness, lookVisualizerLift } = useAppStore.getState();
      ctx.clearRect(0, 0, w, h);

      if (!reader) return;
      analyser.getByteFrequencyData(dataArray);
      const data = lookVisualizerLift ? liftReadings(dataArray, lifted, lookVisualizerLift, perDb) : dataArray;
      paintBars(ctx, reader.read(data), w, h, brightness);
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
