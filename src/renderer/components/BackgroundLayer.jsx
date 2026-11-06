import { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';

const SYNC_INTERVAL = 1000;
const DRIFT_THRESHOLD = 0.3;
const HARD_SYNC_THRESHOLD = 1.5;
// how long after the last seek the video lines back up with the music.
const SEEK_SETTLE_MS = 250;

// the lower blur qualities shrink album art this small and soften it once, and the browser stretches it back up for free.
const PREBAKE_SIZE = { low: 32, medium: 96 };
const prebaked = new Map();

function prebake(src, quality, intensity) {
  const key = `${quality}:${intensity}:${src}`;
  if (prebaked.has(key)) return prebaked.get(key);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = PREBAKE_SIZE[quality];
      const scale = size / Math.max(img.width, img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      // the blur matches the live one's softness once stretched across a window.
      const radius = (intensity * size) / 1100;
      // the art reaches past the edges first, so the blur has art to soften into instead of fading at the edges.
      const pad = Math.ceil(radius * 3) + 1;
      const wide = document.createElement('canvas');
      wide.width = w + pad * 2;
      wide.height = h + pad * 2;
      wide.getContext('2d').drawImage(img, 0, 0, wide.width, wide.height);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(wide, -pad, -pad);
      resolve(out.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  prebaked.set(key, job);
  return job;
}

export default function BackgroundLayer() {
  const thumbnail = useAppStore((s) => s.backgroundThumbnail);
  const rawVideo = useAppStore((s) => s.backgroundVideo);
  const isLite = useAppStore((s) => s.renderProfile === 'lite');
  const liteDisableVideoBackground = useAppStore((s) => s.liteDisableVideoBackground);
  const video = (isLite && liteDisableVideoBackground) ? null : rawVideo;
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const holdFrame = useAppStore((s) => s.behaviorHoldVideoFrame);
  const audioRef = useAppStore((s) => s.musicAudioRef);
  const setBackgroundVideoReady = useAppStore((s) => s.setBackgroundVideoReady);
  const setBackgroundVideoFaded = useAppStore((s) => s.setBackgroundVideoFaded);
  const quality = useAppStore((s) => s.lookBlurQuality);
  const intensity = useAppStore((s) => s.lookBlurIntensity);
  const layerRef = useRef(null);
  const videoRef = useRef(null);
  const pauseFadeRef = useRef(null);
  const syncRef = useRef(null);
  const shownArtRef = useRef(null);

  // the art at the blur quality picked: blurred ahead of time for low and medium, and as it is for high, which blurs it live, or off.
  const paintArt = async (el, art) => {
    const { lookBlurQuality: q, lookBlurIntensity: i } = useAppStore.getState();
    const ahead = PREBAKE_SIZE[q] ? await prebake(art, q, i) : null;
    if (shownArtRef.current !== art) return;
    el.style.backgroundImage = `url('${ahead || art}')`;
    el.classList.toggle('background-prebaked', !!ahead);
  };

  // blur off shows the art or video sharp.
  useEffect(() => {
    layerRef.current?.classList.toggle('background-sharp', quality === 'off');
  }, [quality]);

  // a new quality or softness repaints the art straight away, without fading it out first.
  useEffect(() => {
    const el = layerRef.current;
    if (el && shownArtRef.current) paintArt(el, shownArtRef.current);
  }, [quality, intensity]);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;

    if (thumbnail) {
      el.classList.remove('active');
      const timer = setTimeout(async () => {
        shownArtRef.current = thumbnail;
        await paintArt(el, thumbnail);
        if (shownArtRef.current === thumbnail) el.classList.add('active');
      }, 500);
      return () => clearTimeout(timer);
    } else if (!video) {
      shownArtRef.current = null;
      el.classList.remove('active');
      const timer = setTimeout(() => {
        el.style.backgroundImage = '';
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [thumbnail, video]);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;

    if (video) {
      shownArtRef.current = null;
      el.style.backgroundImage = '';
      el.classList.remove('background-prebaked');
      el.classList.add('active');
    }
  }, [video]);

  useEffect(() => {
    const vid = videoRef.current;
    const audio = audioRef?.current;
    if (!vid || !video) {
      setBackgroundVideoReady(false);
      setBackgroundVideoFaded(false);
      return;
    }
    setBackgroundVideoReady(false);
    vid.src = video;
    if (audio && audio.currentTime > 0) {
      vid.currentTime = audio.currentTime;
    }
    vid.play().catch(() => {});
    const onReady = () => setBackgroundVideoReady(true);
    vid.addEventListener('loadeddata', onReady);
    return () => vid.removeEventListener('loadeddata', onReady);
  }, [video]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !video) return;
    clearTimeout(pauseFadeRef.current);
    clearInterval(syncRef.current);

    if (musicPlaying) {
      vid.classList.remove('background-video-faded');
      setBackgroundVideoFaded(false);
      vid.playbackRate = 1;

      const audio = audioRef?.current;
      if (audio && Math.abs(vid.currentTime - audio.currentTime) > DRIFT_THRESHOLD) {
        vid.currentTime = audio.currentTime;
      }

      vid.play().catch(() => {});

      syncRef.current = setInterval(() => {
        const a = audioRef?.current;
        if (!a || vid.paused) return;
        const drift = vid.currentTime - a.currentTime;
        if (Math.abs(drift) > HARD_SYNC_THRESHOLD) {
          vid.currentTime = a.currentTime;
        } else if (Math.abs(drift) > DRIFT_THRESHOLD) {
          vid.playbackRate = drift > 0 ? 0.9 : 1.1;
        } else {
          vid.playbackRate = 1;
        }
      }, SYNC_INTERVAL);
    } else {
      const steps = 20;
      const interval = 20;
      let remaining = steps;
      const rampDown = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(rampDown);
          vid.pause();
          vid.playbackRate = 1;
          if (!holdFrame) {
            pauseFadeRef.current = setTimeout(() => {
              vid.classList.add('background-video-faded');
              setBackgroundVideoFaded(true);
            }, 5000);
          }
        } else {
          vid.playbackRate = Math.max(0.1, remaining / steps);
        }
      }, interval);
      return () => {
        clearInterval(rampDown);
        clearTimeout(pauseFadeRef.current);
        clearInterval(syncRef.current);
        vid.playbackRate = 1;
      };
    }

    return () => {
      clearTimeout(pauseFadeRef.current);
      clearInterval(syncRef.current);
    };
  }, [musicPlaying, video, holdFrame]);

  useEffect(() => {
    const audio = audioRef?.current;
    const vid = videoRef.current;
    if (!audio || !vid || !video) return;

    // a run of seeks, like a held arrow key or a dragged bar, dims the video once and lines it up after the last one.
    // seeking the video every time would flash it on each seek, and keep its decoder jumping.
    let settle = null;
    const onSeeked = () => {
      vid.classList.add('background-video-seeking');
      clearTimeout(settle);
      settle = setTimeout(() => {
        vid.currentTime = audio.currentTime;
        vid.classList.remove('background-video-seeking');
      }, SEEK_SETTLE_MS);
    };

    audio.addEventListener('seeked', onSeeked);
    return () => {
      clearTimeout(settle);
      audio.removeEventListener('seeked', onSeeked);
      vid.classList.remove('background-video-seeking');
    };
  }, [audioRef, video]);

  return (
    <div id="background-layer" ref={layerRef}>
      {video && (
        <video
          ref={videoRef}
          className="background-video"
          muted
          playsInline
        />
      )}
    </div>
  );
}
