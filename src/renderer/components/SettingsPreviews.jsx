import { useEffect, useMemo, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { createBarReader, DETAIL_BARS, liftReadings, paintBars } from '../utils/spectrumBars';

// small moving pictures of what a setting does, at the top of its page or inside its cards.

const liteBlurOff = (s) => s.renderProfile === 'lite' && s.liteDisableBlur;
const liteBarsOff = (s) => s.renderProfile === 'lite' && s.liteDisableVisualizer;

// --- the player, drawn small ---

// how long the pointer takes to pass over the player, matching its animation in the styles.
const PASS_MS = 3600;
// how long the drawings stay faded before the pointer moves again.
const WAKE_MS = 2000;
// with fading off, the pointer still passes now and then.
const NEVER_MS = 2000;
// the wait before fading runs at this share of the real one, so a whole loop is quick to watch while longer settings still wait longer.
const WAIT_SCALE = 0.3;

// a pointer passes over the player, and once it's been still for the chosen time the drawings fade the way the player does.
// each pass is counted, so its animation can start over.
export function usePointerLoop() {
  const fadeAfter = useAppStore((s) => s.voyagerFadeAfter);
  const [loop, setLoop] = useState({ idle: false, pass: 0 });
  useEffect(() => {
    let timer;
    let pass = 0;
    const still = fadeAfter === 'never' ? NEVER_MS : Number(fadeAfter) * 1000 * WAIT_SCALE;
    const move = () => {
      pass += 1;
      setLoop({ idle: false, pass });
      timer = setTimeout(rest, PASS_MS + still);
    };
    const rest = () => {
      if (fadeAfter === 'never') {
        move();
        return;
      }
      setLoop({ idle: true, pass });
      timer = setTimeout(move, WAKE_MS);
    };
    move();
    return () => clearTimeout(timer);
  }, [fadeAfter]);
  return loop;
}

function Controls() {
  return <span className="sp-controls"><i /><i /><i className="sp-play" /><i /><i /></span>;
}

function Chips() {
  return <span className="sp-chips"><i /><i /><i /><i /></span>;
}

// the visualizer along the bottom, each bar moving at its own pace.
function MiniBars({ count = 18 }) {
  return (
    <span className="sp-bars">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ animationDuration: `${(2 + (i % 5) * 0.4).toFixed(1)}s`, animationDelay: `-${((i * 0.53) % 2.4).toFixed(2)}s` }} />
      ))}
    </span>
  );
}

// the same stars stay put as the density changes, and more join them.
function Stars({ density }) {
  const stars = useMemo(() => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: Math.round(34 * density) }, () => ({
      left: `${(rnd() * 100).toFixed(1)}%`,
      top: `${(rnd() * 100).toFixed(1)}%`,
      animationDelay: `-${(rnd() * 5).toFixed(1)}s`,
      big: rnd() > 0.8,
    }));
  }, [density]);
  return (
    <span className="sp-stars">
      {stars.map(({ big, ...style }, i) => <i key={i} className={big ? 'sp-star-big' : undefined} style={style} />)}
    </span>
  );
}

// commander and voyager keep the volume and chips tucked away until the pointer is over the player.
export function ModeDrawing({ mode, idle, pass }) {
  const progress = useAppStore((s) => !s.behaviorHideProgressBar);
  const bars = useAppStore((s) => !s.behaviorHideVisualizer && !liteBarsOff(s));
  const density = useAppStore((s) => s.voyagerStarDensity);
  const tucked = mode !== 'explorer';
  return (
    <span className={`sp-mini sp-mini-${mode}${idle ? ' sp-idle' : ''}`} aria-hidden="true">
      {mode === 'immersive' && <Stars density={density} />}
      {progress && <i className="sp-progress" />}
      <i className="sp-back" />
      <span className="sp-panel">
        <i className="sp-title" />
        <Controls />
        {tucked
          ? <span key={pass} className="sp-reveal"><i className="sp-volume" /><Chips /></span>
          : <><i className="sp-volume" /><Chips /></>}
      </span>
      {bars && <MiniBars />}
      <svg key={pass} className="sp-cursor" viewBox="0 0 12 12"><path d="M1 1l9 4-4 1.2L4.8 10z" fill="#fff" stroke="#000" strokeWidth="0.6" /></svg>
    </span>
  );
}

// a profile drawn the way it really looks, over the example art.
// standard has it all, and lite follows its own switches: blur, the sliding title, and the visualizer.
export function ProfileDrawing({ profile }) {
  const lite = profile === 'lite';
  const flat = useAppStore((s) => lite && s.liteDisableBlur);
  const still = useAppStore((s) => lite && s.liteDisableAnimations);
  const bars = useAppStore((s) => !(lite && s.liteDisableVisualizer));
  return (
    <span className={`sp-mini sp-mini-wide sp-profile${flat ? ' sp-profile-flat' : ''}${still ? ' sp-profile-still' : ''}`} aria-hidden="true">
      <span className="sp-profile-art" style={{ background: EXAMPLE_COVER.art }} />
      {flat && <span className="sp-background-shade" />}
      <span className="sp-panel">
        <span className="sp-slide"><i className="sp-title" /></span>
        <Controls />
      </span>
      {bars && <MiniBars count={28} />}
    </span>
  );
}

// --- the background ---

// flat planes in the app's teals and slate blues, layered like sheets of paper with soft shadows, around a pale sun.
const EXAMPLE_ART = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 960 400'>
  <rect width='960' height='400' fill='#2E4A63'/>
  <circle cx='680' cy='150' r='80' fill='#E6FBF8'/>
  <polygon points='0,0 520,0 268,400 0,400' fill='#000' fill-opacity='0.2'/>
  <polygon points='0,0 520,0 260,400 0,400' fill='#3B6280'/>
  <polygon points='0,0 370,0 0,268' fill='#000' fill-opacity='0.2'/>
  <polygon points='0,0 360,0 0,260' fill='#4F86A0'/>
  <polygon points='0,250 300,400 0,400' fill='#253D52'/>
  <polygon points='280,408 960,28 960,168 500,408' fill='#000' fill-opacity='0.24'/>
  <polygon points='280,400 960,20 960,160 500,400' fill='#4CD0C1'/>
  <polygon points='600,408 960,198 960,408' fill='#000' fill-opacity='0.24'/>
  <polygon points='600,400 960,190 960,400' fill='#35A89E'/>
  <polygon points='780,408 960,298 960,408' fill='#000' fill-opacity='0.2'/>
  <polygon points='780,400 960,290 960,400' fill='#A6EEE5'/>
</svg>`;

const EXAMPLE_COVER = { name: 'Example background', art: `url("data:image/svg+xml,${encodeURIComponent(EXAMPLE_ART)}") center / cover` };

// the real qualities look much alike, so the preview spreads them a little to show which way each one leans.
// low loses the most shape, medium keeps more, and high is the live blur at the chosen intensity.
const QUALITY_BLUR = { off: 0, low: 2, medium: 1.4, high: 1 };

// a small player over the art, drawn with the same blur, dimness and panels as the real one.
export function BackgroundPreview() {
  const thumbnail = useAppStore((s) => s.backgroundThumbnail);
  const songName = useAppStore((s) => s.musicCurrent?.name);
  const albumBg = useAppStore((s) => s.behaviorAlbumBackground);
  const quality = useAppStore((s) => s.lookBlurQuality);
  const intensity = useAppStore((s) => s.lookBlurIntensity);
  const dim = useAppStore((s) => s.lookBackgroundDim);
  const panels = useAppStore((s) => s.lookPanelOpacity);
  const noBlur = useAppStore(liteBlurOff);
  const covers = useMemo(() => (thumbnail
    ? [{ name: songName || 'Now playing', art: `url('${thumbnail}') center / cover`, playing: true }, EXAMPLE_COVER]
    : [EXAMPLE_COVER]), [thumbnail, songName]);
  const [pick, setPick] = useState(0);
  const cover = covers[Math.min(pick, covers.length - 1)];
  const stageRef = useRef(null);
  // the preview is a small window, so the blur shrinks with it.
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    if (stageRef.current) setScale(stageRef.current.offsetWidth / window.innerWidth);
  }, []);

  // half dimness is the original brightness, as on the real background.
  const brightness = 0.6 - (dim / 100) * 0.5;
  let art = { background: cover.art, filter: `brightness(${brightness})` };
  if (noBlur) art = { background: cover.art, filter: `brightness(${brightness * 1.086}) saturate(0.8) contrast(0.92)` };
  else if (quality !== 'off') art = { ...art, filter: `blur(${(intensity * scale * QUALITY_BLUR[quality]).toFixed(1)}px) brightness(${brightness})`, transform: 'scale(1.15)' };
  const panel = noBlur
    ? { background: 'rgba(15, 25, 35, 0.95)' }
    : { background: `rgba(15, 25, 35, ${panels})`, backdropFilter: `blur(${(12 * scale).toFixed(1)}px)`, WebkitBackdropFilter: `blur(${(12 * scale).toFixed(1)}px)` };

  return (
    <div className="settings-stage sp-background" ref={stageRef}>
      {albumBg && <span className="sp-background-art" style={art} />}
      {albumBg && noBlur && <span className="sp-background-shade" />}
      <span className="sp-background-player" style={panel}>
        <span className="sp-background-song">{cover.name}</span>
        <Controls />
        <i className="sp-volume" />
      </span>
      {albumBg && covers.length > 1 && (
        <span className="sp-covers">
          <span>Try a cover</span>
          {covers.map((c, i) => (
            <button
              key={c.name + i}
              type="button"
              className={i === covers.indexOf(cover) ? 'sp-cover-on' : undefined}
              style={{ background: c.art }}
              title={c.playing ? `Now playing: ${c.name}` : c.name}
              aria-label={c.playing ? `Now playing: ${c.name}` : c.name}
              onClick={() => setPick(i)}
            />
          ))}
        </span>
      )}
    </div>
  );
}

// --- the visualizer ---

// a made-up song for when nothing is playing, read through the same bars as the real one.
const SAMPLE_SOURCE = { context: { sampleRate: 48000 }, frequencyBinCount: 1024, minDecibels: -100, maxDecibels: -30 };

function sampleReadings(data, held, t, binHz) {
  const kick = Math.exp(-((t % 0.5) / 0.12));
  const swell = 5 * Math.sin(t * 0.3);
  const centre = 2 ** (8.6 + 1.2 * Math.sin(t * 0.45));
  for (let k = 0; k < data.length; k++) {
    const f = Math.max(20, k * binHz);
    const octave = Math.log2(f / 100);
    let db = -42 - 7.5 * Math.max(0, octave) - 6 * Math.max(0, -octave) + swell;
    if (f < 140) db += 9 * kick;
    db += 9 * Math.exp(-((Math.log2(f / centre) / 0.35) ** 2));
    db += 3 * Math.sin(k * 1.37 + t * 4.1) + 2 * Math.sin(k * 0.21 - t * 2.3);
    // the analyser smooths each reading into the last.
    held[k] = held[k] * 0.4 + Math.min(255, Math.max(0, ((db + 100) / 70) * 255)) * 0.6;
    data[k] = held[k];
  }
}

// draws the real bars into a canvas, on the playing song when there is one, in the style asked for.
export function useBars(canvasRef, { legacy, on = true }) {
  const analyser = useAppStore((s) => s.musicAnalyser);
  const playing = useAppStore((s) => s.musicPlaying);
  const bars = DETAIL_BARS[useAppStore((s) => s.visualizerDetail)] || DETAIL_BARS.standard;
  const live = !!analyser && playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !on) return undefined;
    const ctx = canvas.getContext('2d');
    const source = live ? analyser : SAMPLE_SOURCE;
    const reader = createBarReader(source, bars, { legacy });
    const data = new Uint8Array(source.frequencyBinCount);
    const held = new Float32Array(source.frequencyBinCount);
    const lifted = new Float32Array(source.frequencyBinCount);
    const perDb = 255 / (source.maxDecibels - source.minDecibels);
    const binHz = source.context.sampleRate / 2 / source.frequencyBinCount;
    let frame;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (live) analyser.getByteFrequencyData(data);
      else sampleReadings(data, held, now / 1000, binHz);
      const { lookVisualizerBrightness: brightness, lookVisualizerLift: lift } = useAppStore.getState();
      paintBars(ctx, reader.read(lift ? liftReadings(data, lifted, lift, perDb) : data), w, h, brightness);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [canvasRef, live, analyser, on, bars, legacy]);
}

export function VisualizerPreview() {
  const canvasRef = useRef(null);
  const liteOff = useAppStore(liteBarsOff);
  const shown = useAppStore((s) => !s.behaviorHideVisualizer) && !liteOff;
  const legacy = useAppStore((s) => s.visualizerStyle === 'legacy');
  useBars(canvasRef, { legacy, on: shown });

  return (
    <div className="settings-stage sp-visualizer">
      {shown ? (
        <canvas ref={canvasRef} />
      ) : (
        <span className="sp-stage-caption">{liteOff ? 'Off in Lite Mode' : 'Hidden'}</span>
      )}
    </div>
  );
}

// a style's own strip of bars, on the same song as the other, so the two can be told apart side by side.
export function StyleDrawing({ style }) {
  const canvasRef = useRef(null);
  useBars(canvasRef, { legacy: style === 'legacy' });
  return (
    <span className="sp-mini sp-mini-bars" aria-hidden="true">
      <canvas ref={canvasRef} />
    </span>
  );
}

// --- normalization ---

const SAMPLES = 300;
const TARGET = -14;
// one pass of the playhead across all three songs.
const PLAYHEAD_MS = 30000;
const dbY = (db) => 164 - ((db + 32) / 30) * 144;

// three made-up songs, one quiet, one loud, and one that starts quiet and gets loud.
const RECORDED = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let wobble = 0;
  return Array.from({ length: SAMPLES }, (_, i) => {
    wobble = wobble * 0.7 + (rnd() - 0.5) * 1.6;
    const song = Math.floor(i / 100);
    const u = (i % 100) / 100;
    let level;
    if (song === 0) level = -24 + 1.5 * Math.sin(u * 9);
    else if (song === 1) level = -9 + 1.2 * Math.sin(u * 7 + 1);
    else {
      const k = Math.min(1, Math.max(0, (u - 0.45) / 0.15));
      level = -25 + 15 * k * k * (3 - 2 * k) + Math.sin(u * 8);
    }
    return level + wobble * 1.4;
  });
})();

// a song's loudness the way a measurement hears it, with the loud parts counting most.
const SONG_LOUDNESS = [0, 1, 2].map((song) => {
  const part = RECORDED.slice(song * 100, song * 100 + 100);
  return 10 * Math.log10(part.reduce((sum, v) => sum + 10 ** (v / 10), 0) / part.length);
});

// how closely each reactive preset follows the music, how fast it corrects, and how far.
const REACTIVE = {
  normal: { follow: 0.05, rate: 0.05, low: -6, high: 6 },
  aggressive: { follow: 0.16, rate: 0.14, low: -6, high: 6 },
  rigorous: { follow: 0.3, rate: 0.3, low: -10, high: 8 },
};

function heard(mode, preset) {
  if (mode === 'contextual') return RECORDED.map((v, i) => v + TARGET - SONG_LOUDNESS[Math.floor(i / 100)]);
  const p = REACTIVE[preset] || REACTIVE.normal;
  let level = RECORDED[0];
  let gain = 0;
  return RECORDED.map((v) => {
    level += (v - level) * p.follow;
    gain += (Math.min(p.high, Math.max(p.low, TARGET - level)) - gain) * p.rate;
    return v + gain;
  });
}

// each song is drawn on its own stretch with a gap between, so they read as separate songs brought to one level.
const SONG_W = 176;
const SONG_GAP = 36;
const songX = (song) => song * (SONG_W + SONG_GAP);
const sampleX = (i) => songX(Math.floor(i / 100)) + ((i % 100) / 99) * SONG_W;

// a series as a line for each song, starting fresh after each gap.
const line = (series) => series.map((v, i) => `${i % 100 ? 'L' : 'M'}${sampleX(i).toFixed(1)} ${dbY(v).toFixed(1)}`).join(' ');
const RECORDED_LINE = line(RECORDED);
// the shaded ground under each song's recorded line.
const RECORDED_AREA = [0, 1, 2].map((song) => {
  const x0 = songX(song);
  const top = RECORDED.slice(song * 100, song * 100 + 100).map((v, i) => `${i ? 'L' : 'M'}${(x0 + (i / 99) * SONG_W).toFixed(1)} ${dbY(v).toFixed(1)}`).join(' ');
  return `${top} L${x0 + SONG_W} 164 L${x0} 164 Z`;
}).join(' ');

export function LoudnessPreview() {
  const mode = useAppStore((s) => s.normalizerMode);
  const preset = useAppStore((s) => s.normalizerReactivePreset);
  const on = useAppStore((s) => s.musicNormalize);
  // with normalizing off, what you hear is just what was recorded.
  const out = useMemo(() => (on ? heard(mode, preset) : RECORDED), [on, mode, preset]);
  const outRef = useRef(out);
  const headRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    outRef.current = out;
  }, [out]);

  // the playhead walks across slowly, and holds still while lite mode stops animations.
  useEffect(() => {
    let frame;
    const move = (now) => {
      frame = requestAnimationFrame(move);
      const u = document.body.classList.contains('lite-no-anim') ? 0.38 : (now / PLAYHEAD_MS) % 1;
      const i = Math.min(SAMPLES - 1, Math.floor(u * SAMPLES));
      const x = sampleX(i);
      headRef.current?.setAttribute('x1', x);
      headRef.current?.setAttribute('x2', x);
      dotRef.current?.setAttribute('cx', x);
      dotRef.current?.setAttribute('cy', dbY(outRef.current[i]));
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="settings-stage sp-loudness">
      <svg viewBox="0 0 600 172" role="img" aria-label="Three songs' loudness, as recorded and as heard">
        {['A quiet song', 'A loud song', 'Quiet start, loud chorus'].map((name, song) => (
          <text key={name} className="sp-loudness-song" x={songX(song) + SONG_W / 2} y="12" textAnchor="middle">{name}</text>
        ))}
        <line className="sp-loudness-target" x1="0" x2="600" y1={dbY(TARGET)} y2={dbY(TARGET)} />
        <text className="sp-loudness-target-label" x="596" y={dbY(TARGET) + 13} textAnchor="end">Even level</text>
        <path className="sp-loudness-area" d={RECORDED_AREA} />
        <path className="sp-loudness-recorded" d={RECORDED_LINE} />
        <path className="sp-loudness-heard" d={line(out)} />
        <line className="sp-loudness-head" ref={headRef} y1="20" y2="164" />
        <circle className="sp-loudness-dot" ref={dotRef} r="3.5" />
      </svg>
      <div className="sp-legend">
        <span><i className="sp-legend-recorded" />As recorded</span>
        <span><i className="sp-legend-heard" />What you hear</span>
      </div>
    </div>
  );
}

// --- the touch bar ---

const GLYPHS = {
  back: <path d="M15 6l-6 6 6 6" />,
  prev: <path d="M6 5v14M19 5 9 12l10 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  next: <path d="M18 5v14M5 5l10 7-10 7z" />,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>,
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  note: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
};

function Key({ glyph, label, tone }) {
  return (
    <span className={`sp-tb-key${tone ? ` sp-tb-key-${tone}` : ''}`}>
      {glyph ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{GLYPHS[glyph]}</svg> : label}
    </span>
  );
}

function KeyGroup({ children }) {
  return <span className="sp-tb-group">{children}</span>;
}

export const TOUCH_BAR_PLACES = [
  { id: 'player', name: 'In the player' },
  { id: 'download', name: 'In the downloader' },
  { id: 'home', name: 'On the home screen' },
];

// the touch bar as it shows in each part of the app, with a song playing and a few downloads waiting.
// the system's own buttons on the right are left out, since everyone sets those up differently, apart from downstream's own one.
export function TouchBarPreview({ place }) {
  const prefs = useAppStore((s) => s.touchBarPrefs);
  const songName = useAppStore((s) => s.musicCurrent?.name) || 'Example song';
  const transport = <KeyGroup><Key glyph="prev" /><Key glyph="pause" /><Key glyph="next" /></KeyGroup>;
  let items;
  if (place === 'player') {
    items = (
      <>
        <Key glyph="back" />
        {transport}
        {prefs.trackTitle && <span className="sp-tb-title">{songName}</span>}
        {prefs.volume && <Key glyph="volume" />}
        {prefs.shuffleRepeat && <><Key glyph="shuffle" tone="lit" /><Key glyph="repeat" /></>}
      </>
    );
  } else if (place === 'download') {
    items = (
      <>
        <Key glyph="back" />
        <KeyGroup><Key glyph="download" /><Key glyph="stop" tone="dim" /></KeyGroup>
        <Key glyph="folder" />
        {prefs.formatSwitch && <KeyGroup><Key label="All MP4" /><Key label="All MP3" /></KeyGroup>}
        {prefs.downloadStatus && <span className="sp-tb-label">3 queued</span>}
        {prefs.musicEverywhere && <><span className="sp-tb-space" /><Key glyph="pause" /></>}
      </>
    );
  } else {
    items = (
      <>
        <Key glyph="download" />
        <Key glyph="volume" />
        <Key glyph="gear" />
        {prefs.musicEverywhere && <><span className="sp-tb-space" />{transport}</>}
      </>
    );
  }
  return (
    <div className="sp-tb" aria-hidden="true">
      <span className="sp-tb-esc">esc</span>
      <span className="sp-tb-app">{items}</span>
      {prefs.controlStrip && <span className="sp-tb-strip"><Key glyph="note" tone="lit" /></span>}
    </div>
  );
}
