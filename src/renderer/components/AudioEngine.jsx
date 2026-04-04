import { useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';

let audioCtx = null;
let sourceNode = null;
let eqFilters = [];
let normGainNode = null;
let measureAnalyser = null;

const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function applyVolumeCurve(linear) {
  return linear * linear;
}

export default function AudioEngine() {
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const musicVolume = useAppStore((s) => s.musicVolume);
  const musicRepeat = useAppStore((s) => s.musicRepeat);
  const musicNormalize = useAppStore((s) => s.musicNormalize);
  const eqBands = useAppStore((s) => s.eqBands);
  const setMusicPlaying = useAppStore((s) => s.setMusicPlaying);
  const setMusicAnalyser = useAppStore((s) => s.setMusicAnalyser);
  const setMusicAudioRef = useAppStore((s) => s.setMusicAudioRef);
  const playNextTrack = useAppStore((s) => s.playNextTrack);

  const audioRef = useRef(null);
  const currentPathRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const normIntervalRef = useRef(null);
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

    measureAnalyser = audioCtx.createAnalyser();
    measureAnalyser.fftSize = 2048;

    normGainNode = audioCtx.createGain();
    normGainNode.gain.value = 1.0;

    sourceNode = audioCtx.createMediaElementSource(audio);

    let prev = sourceNode;
    for (const filter of eqFilters) {
      prev.connect(filter);
      prev = filter;
    }
    prev.connect(measureAnalyser);
    measureAnalyser.connect(normGainNode);
    normGainNode.connect(analyser);
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

  useEffect(() => {
    clearInterval(normIntervalRef.current);

    if (!musicNormalize || !measureAnalyser || !normGainNode || !musicCurrent) {
      if (normGainNode) {
        normGainNode.gain.cancelScheduledValues(audioCtx?.currentTime || 0);
        normGainNode.gain.value = 1.0;
      }
      return;
    }

    normGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    normGainNode.gain.value = 1.0;

    const targetRMS = 0.125;
    const rmsValues = [];
    let count = 0;
    const maxSamples = 30;
    const dataArray = new Float32Array(measureAnalyser.fftSize);

    normIntervalRef.current = setInterval(() => {
      measureAnalyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const vol = audioRef.current?.volume || 1;
      if (rms > 0.001 && vol > 0.01) {
        rmsValues.push(rms / vol);
      }
      count++;
      if (count >= maxSamples) {
        clearInterval(normIntervalRef.current);
        if (rmsValues.length > 0) {
          const avgRMS = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
          const gain = Math.min(4.0, Math.max(0.25, targetRMS / avgRMS));
          normGainNode.gain.setTargetAtTime(gain, audioCtx.currentTime, 0.15);
        }
      }
    }, 50);

    return () => clearInterval(normIntervalRef.current);
  }, [musicCurrent, musicNormalize]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (musicRepeat) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        playNextTrack();
      }
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [playNextTrack, musicRepeat]);

  return <audio ref={audioRef} crossOrigin="anonymous" style={{ display: 'none' }} />;
}
