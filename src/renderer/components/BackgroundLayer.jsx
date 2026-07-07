import { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';

const SYNC_INTERVAL = 1000;
const DRIFT_THRESHOLD = 0.3;
const HARD_SYNC_THRESHOLD = 1.5;

export default function BackgroundLayer() {
  const thumbnail = useAppStore((s) => s.backgroundThumbnail);
  const rawVideo = useAppStore((s) => s.backgroundVideo);
  const isLite = useAppStore((s) => s.renderProfile === 'lite');
  const liteDisableVideoBackground = useAppStore((s) => s.liteDisableVideoBackground);
  const video = (isLite && liteDisableVideoBackground) ? null : rawVideo;
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const holdFrame = useAppStore((s) => s.behaviorHoldVideoFrame);
  const audioRef = useAppStore((s) => s.musicAudioRef);
  const layerRef = useRef(null);
  const videoRef = useRef(null);
  const pauseFadeRef = useRef(null);
  const syncRef = useRef(null);

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
    } else if (!video) {
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
      el.style.backgroundImage = '';
      el.classList.add('active');
    }
  }, [video]);

  useEffect(() => {
    const vid = videoRef.current;
    const audio = audioRef?.current;
    if (!vid || !video) return;
    vid.src = video;
    if (audio && audio.currentTime > 0) {
      vid.currentTime = audio.currentTime;
    }
    vid.play().catch(() => {});
  }, [video]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !video) return;
    clearTimeout(pauseFadeRef.current);
    clearInterval(syncRef.current);

    if (musicPlaying) {
      vid.classList.remove('background-video-faded');
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

    const onSeeked = () => {
      vid.currentTime = audio.currentTime;
      vid.classList.add('background-video-flash');
      setTimeout(() => vid.classList.remove('background-video-flash'), 800);
    };

    audio.addEventListener('seeked', onSeeked);
    return () => audio.removeEventListener('seeked', onSeeked);
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
