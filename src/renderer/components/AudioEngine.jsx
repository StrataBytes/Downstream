import { useRef, useEffect, useCallback } from 'react';
import useAppStore from '../stores/useAppStore';

let audioCtx = null;
let sourceNode = null;
let eqFilters = [];

const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function applyVolumeCurve(linear) {
  return linear * linear;
}

export default function AudioEngine() {
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const musicVolume = useAppStore((s) => s.musicVolume);
  const musicFiles = useAppStore((s) => s.musicFiles);
  const musicRepeat = useAppStore((s) => s.musicRepeat);
  const musicShuffle = useAppStore((s) => s.musicShuffle);
  const eqBands = useAppStore((s) => s.eqBands);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const setMusicCurrent = useAppStore((s) => s.setMusicCurrent);
  const setMusicAnalyser = useAppStore((s) => s.setMusicAnalyser);
  const setMusicAudioRef = useAppStore((s) => s.setMusicAudioRef);

  const audioRef = useRef(null);
  const currentPathRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const targetVolumeRef = useRef(applyVolumeCurve(musicVolume));

  useEffect(() => {
    if (audioRef.current) setMusicAudioRef(audioRef);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || sourceNode) return;
    audioCtx = new AudioContext();

    eqFilters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;

    sourceNode = audioCtx.createMediaElementSource(audio);

    let prev = sourceNode;
    for (const filter of eqFilters) {
      prev.connect(filter);
      prev = filter;
    }
    prev.connect(analyser);
    analyser.connect(audioCtx.destination);

    setMusicAnalyser(analyser);
  }, []);

  useEffect(() => {
    eqFilters.forEach((filter, i) => {
      if (filter && eqBands[i] !== undefined) {
        filter.gain.value = eqBands[i];
      }
    });
  }, [eqBands]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !musicCurrent) return;
    if (currentPathRef.current === musicCurrent.path) return;
    currentPathRef.current = musicCurrent.path;
    audio.src = `media:///${encodeURIComponent(musicCurrent.path)}`;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    audio.play().then(() => setMusicPlaying(true)).catch(() => {});
  }, [musicCurrent]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    clearInterval(fadeTimerRef.current);

    if (musicPlaying) {
      audio.volume = targetVolumeRef.current;
      audio.play().catch(() => {});
    } else {
      const steps = 20;
      const interval = 20;
      const decrement = audio.volume / steps;
      let remaining = steps;
      fadeTimerRef.current = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(fadeTimerRef.current);
          audio.pause();
          audio.volume = targetVolumeRef.current;
        } else {
          audio.volume = Math.max(0, audio.volume - decrement);
        }
      }, interval);
    }
    return () => clearInterval(fadeTimerRef.current);
  }, [musicPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const curved = applyVolumeCurve(musicVolume);
    targetVolumeRef.current = curved;
    if (musicPlaying) audio.volume = curved;
  }, [musicVolume]);

  const pickRandom = useCallback((exclude) => {
    if (musicFiles.length <= 1) return musicFiles[0] || null;
    const others = musicFiles.filter((f) => f.path !== exclude?.path);
    return others[Math.floor(Math.random() * others.length)];
  }, [musicFiles]);

  const handleNext = useCallback(() => {
    if (musicFiles.length === 0 || !musicCurrent) return;
    if (musicShuffle) {
      const next = pickRandom(musicCurrent);
      if (next) setMusicCurrent(next);
      return;
    }
    const idx = musicFiles.findIndex((f) => f.path === musicCurrent.path);
    setMusicCurrent(musicFiles[(idx + 1) % musicFiles.length]);
  }, [musicFiles, musicCurrent, musicShuffle, pickRandom]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (musicRepeat) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        handleNext();
      }
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [handleNext, musicRepeat]);

  return <audio ref={audioRef} crossOrigin="anonymous" style={{ display: 'none' }} />;
}
