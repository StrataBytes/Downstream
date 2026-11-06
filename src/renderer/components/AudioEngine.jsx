import { useRef, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { dbg } from '../services/debugLog';
import { getLoudness, requestScan } from '../services/loudnessService';
import { downloadOwnsBackground } from '../services/downloadService';
import { toMediaUrl } from '../utils/mediaUrl';

// contextual normalization target.
const TARGET_LUFS = -14;

const MEDIA_ERR = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };

// how long a playing song can sit waiting on data before it's skipped.
const STALL_MS = 12000;

// play and pause ease the sound in and out over this short moment, unless that's turned off in playback settings.
const PLAY_PAUSE_STEPS = 20;
const PLAY_PAUSE_INTERVAL = 20;

// a new song's soft start, when it's turned on in playback settings: the volume rises from silence the way pause lets it fall, a little slower.
const FADE_IN_STEPS = 30;
const FADE_IN_INTERVAL = 25;

let audioCtx = null;
let sourceNode = null;
let eqFilters = [];
let normGainNode = null;
let measureAnalyser = null;
// set when a wedged audiocontext was closed to restore direct element output.
// the graph stays down for the rest of the session (eq/visualizer/normalization disabled, but sound works).
// cleared by an app relaunch.
let graphDead = false;

const IS_DARWIN = window.electronAPI?.platform === 'darwin';

const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// reactive normalizer tuning per preset.
// windowSamples null means cumulative average since track start, settling on one level and holding it (the original engine). a number means a sliding window, so only the last few seconds count and the gain follows the song section by section.
// tauDown < tauUp gives fast-duck / slow-recover (broadcast agc behavior), pulling loud spikes down quickly while quiet gaps don't audibly "breathe" the noise floor back up.
// boost ceilings sit below cut floors on rigorous, since deep cuts are always safe but boosting is where clipping lives (no limiter in graph).
const REACTIVE_NORM_PRESETS = {
  normal:     { intervalMs: 100, windowSamples: null, warmupSamples: 10, tauUp: 0.5,  tauDown: 0.5,  minGain: 0.5,   maxGain: 2.0 },  // ±6 dB, current behavior
  aggressive: { intervalMs: 100, windowSamples: 30,   warmupSamples: 10, tauUp: 0.25, tauDown: 0.25, minGain: 0.5,   maxGain: 2.0 },  // 3s window, ±6 dB
  rigorous:   { intervalMs: 50,  windowSamples: 40,   warmupSamples: 20, tauUp: 0.4,  tauDown: 0.1,  minGain: 0.316, maxGain: 2.51 }, // 2s window, −10/+8 dB
};

function applyVolumeCurve(linear) {
  return linear * linear;
}

// how far the volume and normalization turn the music up or down before the analyser hears it, in db, so the starfield can read the song itself.
export function analyserGainDb() {
  if (!sourceNode || !normGainNode) return 0;
  const gain = sourceNode.mediaElement.volume * normGainNode.gain.value;
  return gain > 0 ? 20 * Math.log10(gain) : 0;
}

function buildAudioGraph(audio) {
  if (sourceNode || graphDead || !audio) return;
  try {
    audioCtx = new AudioContext();
  } catch (err) {
    dbg('audio', '!', `AudioContext creation failed: ${err.message}`);
    audioCtx = null;
    return;
  }
  dbg('audio', `AudioContext created (state: ${audioCtx.state}, rate: ${audioCtx.sampleRate}Hz)`);

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

  // safety limiter, transparent below -1 dbfs, hard-knee 20:1 above.
  // lets contextual boost quiet tracks past their true-peak headroom and catches reactive's boosted peaks (up to 2.5x), so peaks get removed musically instead of hard digital clipping at the destination.
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  sourceNode = audioCtx.createMediaElementSource(audio);

  let prev = sourceNode;
  for (const filter of eqFilters) {
    prev.connect(filter);
    prev = filter;
  }
  prev.connect(measureAnalyser);
  measureAnalyser.connect(normGainNode);
  normGainNode.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(audioCtx.destination);

  // applies persisted eq gains, since on the deferred (darwin) path the store's eqBands were loaded long before the filters existed.
  const { eqBands, setMusicAnalyser } = useAppStore.getState();
  eqFilters.forEach((f, i) => {
    if (eqBands[i] !== undefined) f.gain.value = eqBands[i];
  });

  dbg('audio', 'Web Audio graph connected (source → EQ → norm gain → limiter → analyser → destination)');
  setMusicAnalyser(analyser);
}

// the element's state, for logging a play or pause that didn't take.
function describeElement(audio) {
  return `paused=${audio.paused} t=${audio.currentTime.toFixed(1)} ready=${audio.readyState} net=${audio.networkState} seeking=${audio.seeking} err=${audio.error?.code ?? 'none'} ctx=${audioCtx?.state || 'none'}`;
}

export default function AudioEngine() {
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicPlaying = useAppStore((s) => s.musicPlaying);
  const musicVolume = useAppStore((s) => s.musicVolume);
  const musicRepeat = useAppStore((s) => s.musicRepeat);
  const musicNormalize = useAppStore((s) => s.musicNormalize);
  const normalizerMode = useAppStore((s) => s.normalizerMode);
  const normalizerReactivePreset = useAppStore((s) => s.normalizerReactivePreset);
  const albumBackground = useAppStore((s) => s.behaviorAlbumBackground);
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
  const loadGenRef = useRef(0);
  const probeTimerRef = useRef(null);
  // a pause pressed while a track is still loading wins over the load starting it.
  const pausedDuringLoadRef = useRef(false);
  // the song that came up on its own when the last one ended, which waits out the gap a skipped-to song doesn't.
  const autoAdvanceRef = useRef(null);
  const startTimerRef = useRef(null);

  // a new song's fade-in, on its own timer, and the load it belongs to while it's rising.
  const fadeInTimerRef = useRef(null);
  const fadingInRef = useRef(null);

  const stopFadeIn = () => {
    clearInterval(fadeInTimerRef.current);
    fadingInRef.current = null;
  };

  // raises the volume from silence to where it's set, following the volume slider if it moves meanwhile.
  const fadeIn = (audio, gen) => {
    stopFadeIn();
    fadingInRef.current = gen;
    let step = 0;
    fadeInTimerRef.current = setInterval(() => {
      step++;
      if (loadGenRef.current !== gen) {
        stopFadeIn();
        return;
      }
      const p = step / FADE_IN_STEPS;
      audio.volume = Math.min(1, targetVolumeRef.current * p * p);
      if (step >= FADE_IN_STEPS) stopFadeIn();
    }, FADE_IN_INTERVAL);
  };

  useEffect(() => {
    if (audioRef.current) setMusicAudioRef(audioRef);
    const audio = audioRef.current;
    if (!audio) return;
    // a track that can't be read, like one deleted before the folder watcher noticed, or one cut short by a stopped download, is skipped.
    // once every track has failed in a row it stops, instead of cycling through them for good.
    let failedInARow = 0;
    const skipUnreadable = (why) => {
      const { musicCurrent: current, musicFiles, setMusicPlaying: stop, setSkippedTrack } = useAppStore.getState();
      if (!current) return;
      failedInARow++;
      const stuck = musicFiles.length < 2 || failedInARow >= musicFiles.length;
      setSkippedTrack({ name: current.name, stopped: stuck, at: Date.now() });
      if (stuck) {
        dbg('player', '!', `"${current.name}" ${why}, and nothing else here can play, stopping`);
        audio.pause();
        stop(false);
        return;
      }
      dbg('player', `skipping "${current.name}", it ${why}`);
      setTimeout(() => {
        if (useAppStore.getState().musicCurrent === current) useAppStore.getState().playNextTrack();
      }, 400);
    };
    // surfaces media load/decode failures, the prime suspect for "plays but silent" or "won't play" symptoms.
    const onError = () => {
      const e = audio.error;
      dbg('audio', '!', `media element error: ${e ? MEDIA_ERR[e.code] || 'code ' + e.code : 'unknown'}${e?.message ? ' -- ' + e.message : ''}`);
      skipUnreadable("couldn't be read");
    };
    const onPlaying = () => { failedInARow = 0; };
    const onStalled = () => dbg('audio', 'stalled (data not arriving)');
    // a song that should be playing but hasn't moved for a while, waiting on data that never comes, is treated like one that can't be read.
    // a slow drive gets plenty of time first.
    let lastTime = -1;
    let stillSince = performance.now();
    const watchdog = setInterval(() => {
      const now = performance.now();
      const waiting = useAppStore.getState().musicPlaying && !audio.paused && audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
      if (!waiting || audio.currentTime !== lastTime) {
        lastTime = audio.currentTime;
        stillSince = now;
        return;
      }
      if (now - stillSince < STALL_MS) return;
      stillSince = now;
      skipUnreadable(`stopped getting data at ${audio.currentTime.toFixed(1)}s`);
    }, 2000);
    audio.addEventListener('error', onError);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('stalled', onStalled);
    return () => {
      clearInterval(watchdog);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('stalled', onStalled);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || sourceNode) return;
    // macos: defers graph creation until first playback.
    // creating the audiocontext at mount puts its coreaudio/audioservice handshake in the middle of the first-launch storm, since macos runs an xprotect/syspolicyd assessment on each of the app's helper executables the first time they run, and a stalled handshake can leave audio silently dead for the whole session.
    // by the time the user actually plays a track, the storm is over.
    // windows has no such mechanism and keeps its original mount-time creation.
    if (!IS_DARWIN) buildAudioGraph(audio);
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
    if (!audio) return;
    if (!musicCurrent) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      currentPathRef.current = null;
      clearInterval(fadeTimerRef.current);
      clearTimeout(startTimerRef.current);
      stopFadeIn();
      return;
    }
    // the folder moved under the playing track, and main still finds the song by its old link, so it just carries on.
    if (musicCurrent.movedFrom && musicCurrent.movedFrom === currentPathRef.current) {
      currentPathRef.current = musicCurrent.path;
      dbg('player', `"${musicCurrent.name}" moved with its folder, carrying on`);
      return;
    }

    const samePath = currentPathRef.current === musicCurrent.path;
    currentPathRef.current = musicCurrent.path;

    clearInterval(fadeTimerRef.current);
    stopFadeIn();
    loadGenRef.current++;

    if (samePath) {
      audio.currentTime = 0;
    } else {
      audio.src = toMediaUrl(musicCurrent.path);
    }
    audio.volume = targetVolumeRef.current;
    // deferred (darwin-only) graph creation, no-op once built or after recovery.
    if (IS_DARWIN) buildAudioGraph(audio);
    dbg('player', `load "${musicCurrent.name || musicCurrent.path}" (vol ${targetVolumeRef.current.toFixed(2)}, ctx ${audioCtx?.state || 'none'})`);
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => dbg('audio', `AudioContext resumed → ${audioCtx.state}`));
    }

    const readGraphRMS = () => {
      if (!measureAnalyser || !audioCtx) return -1;
      const data = new Float32Array(measureAnalyser.fftSize);
      measureAnalyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    };

    // closes a confirmed-wedged audiocontext.
    // chromium then releases the media element from the (dead) graph and it renders straight to the output device, so sound works but eq/visualizer/normalization sit out the rest of the session.
    const recoverFromWedgedGraph = () => {
      dbg('audio', '!', 'wedged AudioContext confirmed (two silent probes where the song has sound) -- closing it to restore direct output. EQ, visualizer & normalization are disabled until next launch.');
      graphDead = true;
      try { audioCtx.close(); } catch { /* already closed */ }
      audioCtx = null;
      useAppStore.getState().setMusicAnalyser(null);
    };

    clearTimeout(probeTimerRef.current);
    clearTimeout(startTimerRef.current);
    pausedDuringLoadRef.current = false;
    // a song that comes up on its own waits out the gap set in playback settings, and a skipped-to one starts straight away.
    const { advanceDelay, fadeInSongs } = useAppStore.getState();
    const gap = autoAdvanceRef.current === musicCurrent ? advanceDelay * 1000 : 0;
    autoAdvanceRef.current = null;
    const gen = loadGenRef.current;
    const path = musicCurrent.path;
    const begin = () => {
      if (loadGenRef.current !== gen) return;
      // a pause pressed during the gap keeps the song waiting until play is pressed.
      if (gap && !useAppStore.getState().musicPlaying) return;
      if (fadeInSongs) audio.volume = 0;
      audio.play()
        .then(() => {
          if (pausedDuringLoadRef.current) {
            audio.pause();
            dbg('player', 'loaded paused, since pause was pressed while it loaded');
            return;
          }
          setMusicPlaying(true);
          dbg('player', `playback started${gap ? ` after a ${gap / 1000}s gap` : ''}${fadeInSongs ? ', fading in' : ''}`);
          if (fadeInSongs) fadeIn(audio, gen);
          // probes the live graph ~2.5s in to check whether real signal is reaching the output.
          // a song that's truly silent at both probes, like one with a gap after its intro, is probed again a little later instead of being taken for a wedge.
          // closing the context on a healthy graph freezes the element for the rest of the session, so it only happens once the file itself has sound where the graph heard none.
          const probe = (round) => {
            probeTimerRef.current = setTimeout(() => {
              const a = audioRef.current;
              if (!a || graphDead) return;
              const srcRms = readGraphRMS();
              const firstAt = a.currentTime;
              dbg('audio', `probe ${round}: srcRMS=${srcRms.toFixed(4)} normGain=${normGainNode?.gain.value.toFixed(2)} vol=${a.volume.toFixed(2)} muted=${a.muted} paused=${a.paused} t=${firstAt.toFixed(1)} ready=${a.readyState} ctx=${audioCtx?.state} dest.ch=${audioCtx?.destination.channelCount}`);
              // watchdog (darwin): dead-silent graph under a healthy, audibly-playing element is the wedge signature.
              // confirms once before going further so a track's quiet intro can't false-positive.
              const suspectWedge = IS_DARWIN && srcRms >= 0 && srcRms < 1e-6 &&
                !a.paused && !a.muted && a.volume > 0.01 && a.readyState >= 3 &&
                audioCtx && audioCtx.state === 'running';
              if (!suspectWedge) return;
              dbg('audio', 'graph reads silent while element is playing -- re-checking in 1.5s');
              probeTimerRef.current = setTimeout(async () => {
                const a2 = audioRef.current;
                if (!a2 || graphDead || !audioCtx) return;
                const rms2 = readGraphRMS();
                if (!(rms2 >= 0 && rms2 < 1e-6 && !a2.paused && !a2.muted)) {
                  dbg('audio', `re-probe OK (srcRMS=${rms2.toFixed(4)}) -- graph healthy`);
                  return;
                }
                const secondAt = a2.currentTime;
                const songSilent = await window.electronAPI.mediaSilentAt?.(path, [firstAt, secondAt]);
                if (loadGenRef.current !== gen || graphDead || !audioCtx) return;
                if (songSilent) {
                  dbg('audio', `the song itself is silent at ${firstAt.toFixed(1)}s and ${secondAt.toFixed(1)}s, so the graph is fine${round < 3 ? ' -- probing again in 3s' : ''}`);
                  if (round < 3) probe(round + 1);
                  return;
                }
                if (songSilent !== false) {
                  dbg('audio', '!', "graph reads silent but the song couldn't be checked, so it's left as it is");
                  return;
                }
                recoverFromWedgedGraph();
              }, 1500);
            }, round === 1 ? 2500 : 3000);
          };
          probe(1);
        })
        .catch((err) => dbg('player', '!', `play() rejected: ${err.name} -- ${err.message}`));
    };
    if (gap) startTimerRef.current = setTimeout(begin, gap);
    else begin();
  }, [musicCurrent]);

  useEffect(() => {
    const { setBackgroundThumbnail, setBackgroundVideo, clearBackgroundThumbnail } = useAppStore.getState();
    // the downloader keeps its download's thumbnail, and hands this track's art back once it's done.
    if (downloadOwnsBackground()) return;
    if (!musicCurrent || !albumBackground) {
      clearBackgroundThumbnail();
      return;
    }
    const isMp4 = /\.mp4$/i.test(musicCurrent.path);
    if (isMp4) {
      setBackgroundVideo(toMediaUrl(musicCurrent.path));
      return;
    }
    let cancelled = false;
    window.electronAPI.getAlbumArt(musicCurrent.path).then((dataUrl) => {
      if (cancelled || downloadOwnsBackground()) return;
      if (dataUrl) setBackgroundThumbnail(dataUrl);
      else clearBackgroundThumbnail();
    });
    return () => { cancelled = true; };
  }, [musicCurrent, albumBackground]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    clearInterval(fadeTimerRef.current);

    const gen = loadGenRef.current;
    const { fadePlayPause } = useAppStore.getState();

    if (musicPlaying) {
      // the play that starts a new song lands here too, and leaves its fade-in rising.
      if (fadingInRef.current !== gen) {
        if (fadePlayPause) {
          // a resume rises from silence, or from wherever a pause that's still fading out had reached, and a song already playing stays where it is.
          const from = Math.min(audio.paused ? 0 : audio.volume, targetVolumeRef.current);
          audio.volume = from;
          let step = 0;
          fadeTimerRef.current = setInterval(() => {
            step++;
            if (loadGenRef.current !== gen) {
              clearInterval(fadeTimerRef.current);
              return;
            }
            audio.volume = Math.min(1, from + (targetVolumeRef.current - from) * (step / PLAY_PAUSE_STEPS));
            if (step >= PLAY_PAUSE_STEPS) clearInterval(fadeTimerRef.current);
          }, PLAY_PAUSE_INTERVAL);
        } else {
          audio.volume = targetVolumeRef.current;
        }
      }
      audio.play().catch((err) => dbg('player', '!', `play() rejected: ${err.name} -- ${err.message} (${describeElement(audio)})`));
      // a play that never starts, without an error, is logged too.
      const check = setTimeout(() => {
        if (useAppStore.getState().musicPlaying && audio.paused && loadGenRef.current === gen) {
          dbg('player', '!', `play pressed but the element is still paused (${describeElement(audio)})`);
        }
      }, 2000);
      return () => clearTimeout(check);
    } else {
      pausedDuringLoadRef.current = true;
      stopFadeIn();
      if (!fadePlayPause) {
        audio.pause();
        audio.volume = targetVolumeRef.current;
        if (!audio.paused) dbg('player', '!', `pause pressed but the element kept playing (${describeElement(audio)})`);
        return undefined;
      }
      const decrement = audio.volume / PLAY_PAUSE_STEPS;
      let remaining = PLAY_PAUSE_STEPS;
      fadeTimerRef.current = setInterval(() => {
        remaining--;
        if (remaining <= 0 || loadGenRef.current !== gen) {
          clearInterval(fadeTimerRef.current);
          if (loadGenRef.current === gen) {
            audio.pause();
            audio.volume = targetVolumeRef.current;
            if (!audio.paused) dbg('player', '!', `pause pressed but the element kept playing (${describeElement(audio)})`);
          }
        } else {
          audio.volume = Math.max(0, audio.volume - decrement);
        }
      }, PLAY_PAUSE_INTERVAL);
    }
    return () => clearInterval(fadeTimerRef.current);
  }, [musicPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const curved = applyVolumeCurve(musicVolume);
    targetVolumeRef.current = curved;
    // a song fading in picks up the new volume on its own as it rises.
    if (musicPlaying && fadingInRef.current !== loadGenRef.current) audio.volume = curved;
  }, [musicVolume]);

  useEffect(() => {
    clearInterval(normIntervalRef.current);

    // audioCtx null covers both the pre-first-play window on darwin (graph not built yet) and a post-recovery dead graph.
    if (!musicNormalize || !measureAnalyser || !normGainNode || !musicCurrent || !audioCtx) {
      if (normGainNode) {
        normGainNode.gain.cancelScheduledValues(audioCtx?.currentTime || 0);
        normGainNode.gain.value = 1.0;
      }
      return;
    }

    normGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    normGainNode.gain.value = 1.0;

    let presetName = normalizerReactivePreset;
    if (normalizerMode === 'contextual') {
      const entry = getLoudness(musicCurrent);
      if (entry && !entry.failed) {
        // one fixed gain for the whole track, set before playback reaches the ear, correct from the first sample with no drift or pumping.
        let gainDb = TARGET_LUFS - entry.i;
        if (gainDb > 0) {
          // boosts into true-peak headroom plus a small budget the safety limiter absorbs (~2 db of peaks, squashed musically).
          // the budget matters, since yt-dlp rips almost always peak near 0 dbtp (youtube levels loudness without touching peaks), so pure headroom-capped boost would round to zero for exactly the quiet tracks that need help.
          // +12 db absolute cap keeps noise floors in check.
          const headroom = Math.max(0, -1.0 - entry.tp);
          gainDb = Math.min(gainDb, headroom + 2, 12);
        } else {
          gainDb = Math.max(gainDb, -24);
        }
        normGainNode.gain.value = Math.pow(10, gainDb / 20);
        dbg('norm', `contextual: "${musicCurrent.name || musicCurrent.path}" ${entry.i.toFixed(1)} LUFS → ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB fixed`);
        return; // fixed gain, no measuring loop this track
      }
      // unmeasured (or a known-bad file): runs the classic reactive engine for this play and gets the track measured for next time.
      // no mid-track hot-swap by design, since a sudden gain shift mid-song is exactly the artifact contextual exists to remove.
      if (!entry) requestScan(musicCurrent, true);
      dbg('norm', `contextual: "${musicCurrent.name || musicCurrent.path}" ${entry?.failed ? 'scan previously failed' : 'not measured yet'} -- reactive fallback this play`);
      presetName = 'normal';
    }
    const p = REACTIVE_NORM_PRESETS[presetName] || REACTIVE_NORM_PRESETS.normal;
    dbg('norm', `reactive "${presetName}" armed (${p.intervalMs}ms tick, ${p.windowSamples ? `${p.windowSamples}-sample window` : 'cumulative'}, gain ${p.minGain}–${p.maxGain})`);

    // classic reactive targets rms 0.1 (about -20 dbfs), the loudness long-time users know, so user-chosen reactive keeps it.
    // when this loop runs as the contextual fallback (first play of an unmeasured track), it must aim for the same loudness the fixed -14 lufs gain will produce on every later play, otherwise the first listen sits ~5 db quieter than the rest and the handoff feels broken.
    const targetRMS = normalizerMode === 'contextual' ? 0.2 : 0.1;
    const dataArray = new Float32Array(measureAnalyser.fftSize);
    // cumulative path (normal): running totals, exactly the original math.
    let totalRMS = 0;
    let sampleCount = 0;
    // windowed path (aggressive/rigorous): ring of the last n samples.
    const win = [];
    let winSum = 0;

    normIntervalRef.current = setInterval(() => {
      measureAnalyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const vol = audioRef.current?.volume || 1;

      if (rms < 0.001 || vol < 0.01) return;

      const sample = rms / vol;
      let avgRMS;
      if (p.windowSamples === null) {
        totalRMS += sample;
        sampleCount++;
        if (sampleCount < p.warmupSamples) return;
        avgRMS = totalRMS / sampleCount;
      } else {
        win.push(sample);
        winSum += sample;
        if (win.length > p.windowSamples) winSum -= win.shift();
        if (win.length < p.warmupSamples) return;
        avgRMS = winSum / win.length;
      }

      const gain = Math.min(p.maxGain, Math.max(p.minGain, targetRMS / avgRMS));
      // fast attack / slow release: ducking uses tauDown, recovery tauUp.
      const tau = gain < normGainNode.gain.value ? p.tauDown : p.tauUp;
      normGainNode.gain.setTargetAtTime(gain, audioCtx.currentTime, tau);
    }, p.intervalMs);

    return () => clearInterval(normIntervalRef.current);
  }, [musicCurrent, musicNormalize, normalizerMode, normalizerReactivePreset]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (musicRepeat) {
        // a repeat waits out the same gap, and fades in the same way, as a song that comes up on its own.
        const { advanceDelay, fadeInSongs } = useAppStore.getState();
        const gen = loadGenRef.current;
        const again = () => {
          if (loadGenRef.current !== gen || !useAppStore.getState().musicPlaying) return;
          audio.currentTime = 0;
          if (fadeInSongs) audio.volume = 0;
          audio.play().then(() => { if (fadeInSongs) fadeIn(audio, gen); }).catch(() => {});
        };
        clearTimeout(startTimerRef.current);
        if (advanceDelay) startTimerRef.current = setTimeout(again, advanceDelay * 1000);
        else again();
        return;
      }
      const prevPath = useAppStore.getState().musicCurrent?.path;
      playNextTrack();
      if (useAppStore.getState().musicCurrent?.path === prevPath) {
        currentPathRef.current = null;
        const { musicCurrent: cur } = useAppStore.getState();
        if (cur) useAppStore.setState({ musicCurrent: { ...cur } });
      }
      autoAdvanceRef.current = useAppStore.getState().musicCurrent;
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [playNextTrack, musicRepeat]);

  return <audio ref={audioRef} crossOrigin="anonymous" style={{ display: 'none' }} />;
}
