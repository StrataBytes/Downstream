// turns the analyser's frequency data into visualizer bar heights.
// bars are spaced on a log scale, and the bass reads the loudest bin in each bar the way it always has.
// above the crossover, neighboring bars are blended into smooth humps, then each hump is lifted against a much wider baseline, so every section of a song stands apart without combing.
// below it, the bass's gain steps become short slopes and its blocks are softened slightly, so the sub-bass blends into the bass.
// the bass's loudest moments are also squashed a touch, so heavy bass doesn't take over.
// everything is relative, so turning the volume down shrinks every bar together, the way the bass always has.
// the legacy style skips all of that and reads every bar the original way.

const FREQ_MIN = 30;
const FREQ_MAX = 16000;
// the standard bar count, where legacy keeps its original bass reading exactly.
export const STANDARD_BARS = 80;

// the modern reading eases in across this range, so there's no seam.
const TUNED_FROM = 200;
const TUNED_TO = 400;
// how wide a hump is, and the baseline it's lifted against, in octaves so every detail level shows the same humps.
const HUMP_WIDTH = 0.15;
const BASELINE_WIDTH = 1.1;
// how far a hump is lifted above its baseline.
const HUMP_LIFT = 1.25;
// wide bars mix their loudest bin with the average of their bins, so one stray bin doesn't stand for the whole bar.
const BLEND = 0.5;
// an average reads a few db under the loudest bin, so the averaged half gets that back, in bytes.
const AVERAGE_LIFT = 14;
const CURVE = 1.4;
// the bass gain steps [frequency, gain below, gain above], turned into slopes reaching this far either side of each step.
const BASS_STEPS = [[60, 0.6, 0.75], [200, 0.75, 0.8]];
const STEP_SPREAD = 1.5;
// a light blur through the bass, in octaves, which softens its block edges without losing them.
const BASS_SOFTEN = 0.06;
// bass taller than the knee is squashed, more the higher it reaches, which takes its top down about 5% and leaves quieter bass alone.
const BASS_KNEE = 0.4;
const BASS_SQUASH = 0.5;

function bandGain(freq) {
  if (freq < 60)   return 0.6;
  if (freq < 200)  return 0.75;
  if (freq < 500)  return 0.8;
  if (freq < 2000) return 0.9;
  if (freq < 4000) return 1.1;
  if (freq < 8000) return 1.25;
  return 1.0;
}

// 0 below a and 1 above b, eased on a log scale.
function ramp(freq, a, b) {
  return Math.min(1, Math.max(0, Math.log(freq / a) / Math.log(b / a)));
}

// the band gain with the bass steps sloped, so the sub-bass doesn't drop off a cliff.
function smoothBassGain(freq) {
  if (freq >= BASS_STEPS[BASS_STEPS.length - 1][0] * STEP_SPREAD) return bandGain(freq);
  let gain = BASS_STEPS[0][1];
  for (const [at, below, above] of BASS_STEPS) gain += (above - below) * ramp(freq, at / STEP_SPREAD, at * STEP_SPREAD);
  return gain;
}

function gaussian(sigma) {
  const reach = Math.ceil(sigma * 3);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, j) => Math.exp(-((j - reach) ** 2) / (2 * sigma * sigma)));
  return { reach, weights };
}

// blurs across bars.
// past either end the slope carries on, so bars on a steady slope match their baseline instead of being pulled toward louder neighbors.
function blur(src, out, { reach, weights }) {
  const n = src.length;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let total = 0;
    for (let j = -reach; j <= reach; j++) {
      const t = i + j;
      let v;
      if (t < 0) v = 2 * src[0] - src[Math.min(n - 1, -t)];
      else if (t >= n) v = 2 * src[n - 1] - src[Math.max(0, 2 * n - 2 - t)];
      else v = src[t];
      sum += Math.min(1, Math.max(0, v)) * weights[j + reach];
      total += weights[j + reach];
    }
    out[i] = sum / total;
  }
}

export function createBarReader(analyser, bars, { legacy = false } = {}) {
  const nyquist = analyser.context.sampleRate / 2;
  const binCount = analyser.frequencyBinCount;
  const binHz = nyquist / binCount;
  const logMin = Math.log(FREQ_MIN);
  const logMax = Math.log(FREQ_MAX);
  const edge = (i) => Math.exp(logMin + (i / bars) * (logMax - logMin));
  const barsPerOctave = bars / Math.log2(FREQ_MAX / FREQ_MIN);
  // standard keeps its original look exactly, so only the finer levels read between bins.
  const between = bars > STANDARD_BARS;

  const map = [];
  for (let i = 0; i < bars; i++) {
    const fLow = edge(i);
    const fHigh = edge(i + 1);
    const freq = (fLow + fHigh) / 2;
    // written exactly as the original visualizer did, so legacy rounds every edge the same way.
    let low = Math.max(0, Math.round((fLow / nyquist) * binCount));
    let high = Math.max(low, Math.min(binCount - 1, Math.round((fHigh / nyquist) * binCount)));
    const tuned = legacy ? 0 : ramp(freq, TUNED_FROM, TUNED_TO);
    let at = null;
    if (tuned > 0) {
      // modern bars only own the bins whose centers fall inside them, and one narrower than a bin reads between its neighbors.
      const first = Math.ceil(fLow / binHz);
      const last = Math.min(binCount - 1, Math.ceil(fHigh / binHz) - 1);
      if (last >= first) {
        low = first;
        high = last;
      } else {
        at = Math.min(binCount - 1, freq / binHz);
      }
    } else if (between && (fHigh - fLow) / binHz < 1) {
      // a bar narrower than one bin reads between its neighbors, so the bass doesn't move in identical pairs.
      at = Math.min(binCount - 1, freq / binHz);
    }
    const gain = bandGain(freq);
    map.push({ low, high, at, gain, barGain: legacy ? gain : smoothBassGain(freq), tuned });
  }

  const humpBlur = gaussian(HUMP_WIDTH * barsPerOctave);
  const baselineBlur = gaussian(BASELINE_WIDTH * barsPerOctave);
  const bassBlur = gaussian(BASS_SOFTEN * barsPerOctave);
  // full precision until the curve, like the original.
  const raw = new Float64Array(bars);
  const softened = new Float64Array(bars);
  const blended = new Float64Array(bars);
  const humps = new Float64Array(bars);
  const baseline = new Float64Array(bars);
  const heights = new Float32Array(bars);

  // one frame of byte frequency data in, every bar's height from 0 to 1 out.
  const read = (data) => {
    for (let i = 0; i < bars; i++) {
      const { low, high, at, gain, barGain } = map[i];
      let peak = 0;
      let mean = 0;
      if (at !== null) {
        const b = Math.floor(at);
        const t = at - b;
        peak = data[b] * (1 - t) + data[Math.min(b + 1, data.length - 1)] * t;
        mean = peak;
      } else {
        let sum = 0;
        for (let b = low; b <= high; b++) {
          if (data[b] > peak) peak = data[b];
          sum += data[b];
        }
        mean = sum / (high - low + 1);
      }
      raw[i] = Math.min((peak / 255) * barGain, 1);
      if (!legacy) blended[i] = Math.min(1, ((peak * (1 - BLEND) + (mean + AVERAGE_LIFT) * BLEND) / 255) * gain);
    }

    if (!legacy) {
      blur(blended, humps, humpBlur);
      blur(blended, baseline, baselineBlur);
      blur(raw, softened, bassBlur);
    }

    for (let i = 0; i < bars; i++) {
      const { tuned } = map[i];
      let v = raw[i];
      if (!legacy) {
        const lifted = Math.min(1, Math.max(0, humps[i] + HUMP_LIFT * (humps[i] - baseline[i])));
        v = softened[i] * (1 - tuned) + lifted * tuned;
      }
      let target = Math.pow(v, CURVE);
      if (!legacy && target > BASS_KNEE) target -= BASS_SQUASH * (1 - tuned) * (target - BASS_KNEE) ** 2;
      // rises fast and falls quickly, so it never feels sticky.
      const prev = heights[i];
      heights[i] = target > prev ? prev + (target - prev) * 0.6 : prev + (target - prev) * 0.12;
    }
    return heights;
  };

  return { read };
}
