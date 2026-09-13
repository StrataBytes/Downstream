import { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';

// Perspective depth and capped impulses keep the field kinetic without hard jumps.
const DENSITY = 180;
const REACTION = 0.85;

function StarfieldCanvas() {
  const canvasRef = useRef(null);
  const analyser = useAppStore((s) => s.musicAnalyser);
  const lite = useAppStore((s) => s.renderProfile === 'lite');
  const videoVisible = useAppStore((s) => s.backgroundVideoReady && !!s.backgroundVideo && !(s.renderProfile === 'lite' && s.liteDisableVideoBackground));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = 1;
    let height = 1;
    let frame;
    let last = 0;
    let elapsed = 0;
    let impulse = 0;
    let response = 0;
    let baseline = 0.015;
    let peakFlux = 0.02;
    let lastBeat = -1;
    let warmed = false;
    let trackPath;
    let idleFactor = 0;
    let playFactor = 1;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const previous = data ? new Float32Array(data.length) : null;
    const binHz = analyser ? analyser.context.sampleRate / analyser.fftSize : 1;
    const low = Math.max(1, Math.floor(45 / binHz));
    const high = data ? Math.min(data.length - 1, Math.ceil(9000 / binHz)) : 0;
    const makeStar = (initial = false) => {
      const z = initial ? 0.4 + Math.random() * 2 : 2.4;
      const tint = Math.random();
      const size = Math.random();
      const prominent = size > 0.9;
      return {
        x: (Math.random() * 2 - 1) * z,
        y: (Math.random() * 2 - 1) * z,
        z, born: elapsed,
        phase: Math.random() * Math.PI * 2,
        twinkleRate: 0.9 + Math.random() * 0.8,
        twinkleDepth: 0.05 + Math.random() * 0.3,
        prominent,
        color: tint < 0.12 ? '225,236,255' : tint < 0.24 ? '255,244,224' : '232,243,242',
        radius: prominent ? 1.3 + Math.random() * 0.4
          : size > 0.65 ? 0.65 + Math.random() * 0.3
          : 0.25 + Math.random() * 0.25,
      };
    };
    const stars = Array.from({ length: lite ? 90 : DENSITY }, () => makeStar(true));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (last && now - last < (lite ? 1000 / 30 : 1000 / 60) - 1) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      elapsed += dt;
      const state = useAppStore.getState();
      if (trackPath !== state.musicCurrent?.path) {
        trackPath = state.musicCurrent?.path;
        warmed = false;
        baseline = 0.015;
        peakFlux = 0.02;
        impulse = 0;
        lastBeat = -1;
      }
      if (data && state.musicPlaying) {
        analyser.getByteFrequencyData(data);
        let flux = 0;
        let energy = 0;
        let weights = 0;
        for (let i = low; i <= high; i++) {
          const value = data[i] / 255;
          const weight = i * binHz < 250 ? 4 : 1;
          flux += Math.max(0, value - previous[i]) * weight;
          energy += value * weight;
          weights += weight;
          previous[i] = value;
        }
        const count = Math.max(1, weights);
        flux /= count;
        energy /= count;
        peakFlux = Math.max(flux, peakFlux * Math.exp(-dt / 4));
        const threshold = Math.max(0.006, baseline * 1.8, peakFlux * 0.3);
        if (warmed && energy > 0.02 && flux > threshold && elapsed - lastBeat > 0.22) {
          impulse = Math.min(1, impulse + Math.min(0.6, flux / threshold * 0.2));
          lastBeat = elapsed;
        }
        baseline += (flux - baseline) * (1 - Math.exp(-dt / 0.8));
        warmed = true;
      } else {
        warmed = false;
      }
      impulse *= Math.exp(-dt / 1.2);
      response += (impulse - response) * (1 - Math.exp(-dt / 0.22));
      idleFactor += ((state.immersiveIdle ? 1 : 0) - idleFactor) * (1 - Math.exp(-dt / 3));
      playFactor += ((state.musicPlaying ? 1 : 0.1) - playFactor) * (1 - Math.exp(-dt / 1.4));
      ctx.clearRect(0, 0, width, height);
      const speed = (0.065 + idleFactor * 0.03 + response * REACTION * 0.32) * playFactor;
      const centerX = width * (0.5 + Math.sin(elapsed * 0.09) * 0.018);
      const centerY = height * (0.5 + Math.cos(elapsed * 0.07) * 0.014);
      for (const star of stars) {
        star.z -= speed * dt;
        if (star.z <= 0.02) {
          Object.assign(star, makeStar());
          continue;
        }
        const x = centerX + star.x / star.z * width * 0.5;
        const y = centerY + star.y / star.z * height * 0.5;
        if (x < 0 || x > width || y < 0 || y > height) {
          Object.assign(star, makeStar());
          continue;
        }
        const near = Math.min(1, 0.5 / star.z);
        const radius = Math.min(3.5, star.radius / star.z + 0.35);
        const edge = Math.max(0, Math.min(1, Math.min(x, width - x, y, height - y) / 40));
        const arrival = Math.min(1, (elapsed - star.born) / 1.2);
        const nearFade = Math.max(0, Math.min(1, (star.z - 0.02) / 0.16));
        const cameraFade = nearFade * nearFade * (3 - 2 * nearFade);
        const shimmer = 0.5 + 0.5 * (
          0.7 * Math.sin(elapsed * star.twinkleRate + star.phase)
          + 0.3 * Math.sin(elapsed * star.twinkleRate * 0.43 + star.phase * 2)
        );
        const twinkleDepth = star.twinkleDepth * (1 + idleFactor * 0.4);
        const twinkle = 1 - twinkleDepth + twinkleDepth * shimmer;
        const alpha = Math.min(0.85, 0.22 + near * 0.38 + response * REACTION * 0.22) * edge * arrival * twinkle * cameraFade;
        const glowRadius = radius * 4;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        glow.addColorStop(0, `rgba(${star.color},${alpha * 0.3})`);
        glow.addColorStop(0.25, `rgba(${star.color},${alpha * 0.09})`);
        glow.addColorStop(1, `rgba(${star.color},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        const distance = Math.hypot(x - centerX, y - centerY) || 1;
        const trailDepth = Math.max(0, Math.min(1, (1.1 - star.z) / 0.6));
        const trail = Math.min(10, distance * speed / star.z * 0.065) * trailDepth;
        ctx.strokeStyle = `rgba(${star.color},${alpha * 0.3 * trailDepth})`;
        ctx.lineWidth = Math.max(0.6, radius * 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (x - centerX) / distance * trail, y - (y - centerY) / distance * trail);
        ctx.stroke();
        if (star.prominent) {
          const vertical = Math.min(10, radius * 3.3) * (0.9 + shimmer * 0.1);
          const horizontal = vertical * 0.65;
          const waist = radius * 0.3;
          ctx.fillStyle = `rgba(${star.color},${alpha * (0.55 + shimmer * 0.35)})`;
          ctx.beginPath();
          ctx.moveTo(x, y - vertical);
          ctx.quadraticCurveTo(x + waist, y - waist, x + horizontal, y);
          ctx.quadraticCurveTo(x + waist, y + waist, x, y + vertical);
          ctx.quadraticCurveTo(x - waist, y + waist, x - horizontal, y);
          ctx.quadraticCurveTo(x - waist, y - waist, x, y - vertical);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha * 1.2)})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.35, radius * 0.42), 0, Math.PI * 2);
        ctx.fill();

      }
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      last = 0;
      warmed = false;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    const onResize = () => { resize(); restart(); };
    resize();
    restart();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', restart);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', restart);
    };
  }, [analyser, lite]);

  return <canvas ref={canvasRef} className={`immersive-starfield${videoVisible ? ' immersive-starfield-video' : ''}`} aria-hidden="true" />;
}

export default function ImmersiveStarfield() {
  const active = useAppStore((s) => s.currentView === 'player' && s.playerViewMode === 'immersive' && !!s.musicCurrent && !s.musicFolderView);
  return active ? <StarfieldCanvas /> : null;
}
