import { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import { analyserGainDb } from './AudioEngine';

// stars drift toward the camera, faster as the song gets more intense and slower as it calms down.
// intensity is how loud and busy the song is against its own recent average, so it follows verses, choruses and drops rather than single drum hits.
const DENSITY = 180;
const LITE_DENSITY = 130;
// each tint's glow is drawn once at this size and stamped onto every star, which costs far less than a new gradient per star each frame.
const GLOW_SPRITE = 64;
// how fast the stars fly, in depth per second, with the song at its calmest, the extra once the player fades away, and the extra at its most intense.
const CALM_SPEED = 0.065;
const IDLE_SPEED = 0.03;
const INTENSE_SPEED = 0.2;
// new stars start somewhere in this depth range, so the field keeps as many bright nearby stars as when it first appears.
const SPAWN_NEAR = 1.2;
const SPAWN_FAR = 2.4;

// the analyser's bytes span -100 to -30 db.
const BYTE_DB = 70 / 255;
// below this average level, in db above the analyser's floor, the song counts as silent and doesn't move the reading.
const SILENCE_DB = 3;
// how much busyness, the spectrum rising above where it just was, counts alongside loudness.
const BUSY_WEIGHT = 2;
const BUSY_TAU = 0.15;
// the song's level rises over about this many seconds and falls over this many.
const RISE_TAU = 1.5;
const FALL_TAU = 3;
// the song's recent average settles over its first few seconds, then follows it this slowly.
const SETTLE = 4;
const REFERENCE_TAU = 40;
// this far above or below the recent average, in db, reads as fully intense or fully calm.
const INTENSITY_RANGE_DB = 16;
// the stars ease into a new speed over about this many seconds.
const DRIVE_TAU = 2;

const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

function drawGlow(color) {
  const sprite = document.createElement('canvas');
  sprite.width = GLOW_SPRITE;
  sprite.height = GLOW_SPRITE;
  const g = sprite.getContext('2d');
  const r = GLOW_SPRITE / 2;
  const gradient = g.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, `rgba(${color},0.3)`);
  gradient.addColorStop(0.25, `rgba(${color},0.09)`);
  gradient.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gradient;
  g.fillRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
  return sprite;
}

// how intense the song is right now, from 0 (calm) to 1 (most intense), against its own recent average.
// the player's volume and normalization are taken back out first, so neither changes how the song reads.
function createIntensityReader(analyser) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  const recent = new Float32Array(data.length);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const low = Math.max(1, Math.floor(45 / binHz));
  const high = Math.min(data.length - 1, Math.ceil(9000 / binHz));
  const count = high - low + 1;
  let level = null;
  let reference = 0;
  let heard = 0;
  let intensity = 0.5;

  return {
    // a new song is read fresh.
    reset() {
      level = null;
      heard = 0;
    },
    read(dt) {
      analyser.getByteFrequencyData(data);
      if (level === null) for (let i = low; i <= high; i++) recent[i] = data[i] * BYTE_DB;
      let sum = 0;
      let busy = 0;
      for (let i = low; i <= high; i++) {
        const db = data[i] * BYTE_DB;
        sum += db;
        busy += Math.max(0, db - recent[i]);
        recent[i] += (db - recent[i]) * ease(dt, BUSY_TAU);
      }
      if (sum / count <= SILENCE_DB) return intensity;
      const now = sum / count - analyserGainDb() + BUSY_WEIGHT * (busy / count);
      heard += dt;
      if (level === null) {
        level = now;
        reference = now;
      }
      level += (now - level) * ease(dt, now > level ? RISE_TAU : FALL_TAU);
      reference = heard < SETTLE ? level : reference + (level - reference) * ease(dt, Math.min(REFERENCE_TAU, heard));
      intensity = Math.min(1, Math.max(0, 0.5 + (level - reference) / INTENSITY_RANGE_DB));
      return intensity;
    },
  };
}

function StarfieldCanvas() {
  const canvasRef = useRef(null);
  const analyser = useAppStore((s) => s.musicAnalyser);
  const lite = useAppStore((s) => s.renderProfile === 'lite');
  const videoVisible = useAppStore((s) => s.backgroundVideoReady && !s.backgroundVideoFaded && !!s.backgroundVideo && !(s.renderProfile === 'lite' && s.liteDisableVideoBackground));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let frame;
    let last = 0;
    let elapsed = 0;
    let trackPath;
    let drive = 0.5;
    let idleFactor = 0;
    let playFactor = 1;
    const intensity = analyser ? createIntensityReader(analyser) : null;
    const glows = {};
    const makeStar = (initial = false) => {
      const z = initial ? 0.4 + Math.random() * 2 : SPAWN_NEAR + Math.random() * (SPAWN_FAR - SPAWN_NEAR);
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
    const stars = Array.from({ length: lite ? LITE_DENSITY : DENSITY }, () => makeStar(true));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
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
        intensity?.reset();
      }
      if (intensity && state.musicPlaying) drive += (intensity.read(dt) - drive) * ease(dt, DRIVE_TAU);
      idleFactor += ((state.immersiveIdle ? 1 : 0) - idleFactor) * ease(dt, 3);
      playFactor += ((state.musicPlaying ? 1 : 0.1) - playFactor) * ease(dt, 1.4);
      ctx.clearRect(0, 0, width, height);
      const speed = (CALM_SPEED + idleFactor * IDLE_SPEED + drive * INTENSE_SPEED) * playFactor;
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
        const alpha = Math.min(0.85, 0.37 + near * 0.38) * edge * arrival * twinkle * cameraFade;
        const glowRadius = radius * 4;
        glows[star.color] ||= drawGlow(star.color);
        ctx.globalAlpha = alpha;
        ctx.drawImage(glows[star.color], x - glowRadius, y - glowRadius, glowRadius * 2, glowRadius * 2);
        ctx.globalAlpha = 1;
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
        // a core is never smaller than a pixel, so stars drawn at 1x stay as crisp as at 2x.
        ctx.arc(x, y, Math.max(0.7 / dpr, radius * 0.42), 0, Math.PI * 2);
        ctx.fill();

      }
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      last = 0;
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
  const active = useAppStore((s) => s.currentView === 'player' && s.playerViewMode === 'immersive' && !!s.musicCurrent && !s.folderScreen);
  return active ? <StarfieldCanvas /> : null;
}
