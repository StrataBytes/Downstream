import { useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';

const BAR_COUNT = 80;
const BAR_GAP = 2;

const FREQ_MIN = 30;
const FREQ_MAX = 16000;

function bandGain(freq) {
  if (freq < 60)   return 0.6;
  if (freq < 200)  return 0.75;
  if (freq < 500)  return 0.8;
  if (freq < 2000) return 0.9;
  if (freq < 4000) return 1.1;
  if (freq < 8000) return 1.25;
  return 1.0;
}

export default function AudioVisualizer() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const analyser = useAppStore((s) => s.musicAnalyser);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const smoothed = new Float32Array(BAR_COUNT);

    const logMin = Math.log(FREQ_MIN);
    const logMax = Math.log(FREQ_MAX);
    const barFreqs = [];

    const buildBinMap = () => {
      barFreqs.length = 0;
      if (!analyser) return;
      const nyquist = analyser.context.sampleRate / 2;
      const binCount = analyser.frequencyBinCount;
      for (let i = 0; i < BAR_COUNT; i++) {
        const fLow = Math.exp(logMin + (i / BAR_COUNT) * (logMax - logMin));
        const fHigh = Math.exp(logMin + ((i + 1) / BAR_COUNT) * (logMax - logMin));
        const bLow = Math.max(0, Math.round((fLow / nyquist) * binCount));
        const bHigh = Math.min(binCount - 1, Math.round((fHigh / nyquist) * binCount));
        barFreqs.push({ low: bLow, high: Math.max(bLow, bHigh), freq: (fLow + fHigh) / 2 });
      }
    };
    buildBinMap();

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

      if (!analyser || !dataArray || barFreqs.length === 0) return;
      analyser.getByteFrequencyData(dataArray);

      const barW = (w - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;

      for (let i = 0; i < BAR_COUNT; i++) {
        const { low, high, freq } = barFreqs[i];

        let peak = 0;
        for (let b = low; b <= high; b++) {
          if (dataArray[b] > peak) peak = dataArray[b];
        }
        const raw = peak / 255;

        const gained = raw * bandGain(freq);
        const curved = Math.pow(Math.min(gained, 1), 1.4);

        const prev = smoothed[i];
        smoothed[i] = curved > prev
          ? prev + (curved - prev) * 0.6
          : prev + (curved - prev) * 0.12;

        const val = smoothed[i];
        const barH = val * h;

        const x = i * (barW + BAR_GAP);
        const y = h - barH;

        const hue = 170 + (i / BAR_COUNT) * 20;
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
  }, [analyser]);

  return <canvas ref={canvasRef} className="audio-visualizer" />;
}
