// Sample import (no UI): any audio file the browser can decode becomes a sample as the Skitchin' driver keeps them:
// mono, 8 bit unsigned, values 1..255 (0 ends a sample), at the mixer's rate (song.mixRate, ~11.3 kHz).
// The steps are: decode, mono, trim (start / end, fade out, loop point), normalise (and a light compressor),
// anti-alias filter + resampling, 8 bit with dither. The budgets say how big a sample of each kind may be.

// Budgets (bytes = samples at the mixer's rate), after the real samples of Skitchin': kick and snare ~2.2 KB,
// melodic ones 3-5.4 KB, voice and guitar phrases 10-28 KB.
export const BUDGETS = [
  { id: 'drum', label: 'DRUM', kb: 3, melodic: false, tip: 'Kick, snare, hi-hat: ~0.27 s' },
  { id: 'long', label: 'LONG HIT', kb: 6, melodic: false, tip: 'Cymbal, long hit: ~0.5 s' },
  { id: 'melodic', label: 'MELODIC', kb: 6, melodic: true, tip: 'Pitched, with a loop: ~0.5 s' },
  { id: 'phrase', label: 'PHRASE', kb: 28, melodic: null, tip: 'Voice, guitar phrase: ~2.5 s' },
];
export const SONG_BUDGET_KB = 64; // all the samples of one song: a hint, not a limit
export const budgetsFor = (melodic) => BUDGETS.filter((b) => b.melodic == null || b.melodic === melodic);

// The pitch table of a melodic sample, as in Skitchin': 4 octaves of 8.8 steps, 256 (the sample's own speed) at
// index 24. The note n plays steps[n + transp - 36], so transp = 60 - base note puts the base note on 256.
export const STEPS = Array.from({ length: 48 }, (_, i) => Math.floor(256 * Math.pow(2, (i - 24) / 12)));

// ---------- decoding ----------
// Web Audio decodes WAV / MP3 / OGG / FLAC (whatever the browser knows); the channels are averaged to mono.
export async function decodeAudio(bytes, rate = 44100) {
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i];
  }
  if (buf.numberOfChannels > 1) for (let i = 0; i < n; i++) mono[i] /= buf.numberOfChannels;
  return { mono, rate: buf.sampleRate, channels: buf.numberOfChannels };
}

const peakOf = (x, a = 0, b = x.length) => { let p = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > p) p = v; } return p; };

// The sound without the silence around it: from a bit before it is first heard to a bit after it dies away
// (below `db` under its peak).
export function trimSilence(mono, rate, db = -40) {
  const thr = peakOf(mono) * Math.pow(10, db / 20);
  if (!thr) return [0, mono.length];
  let a = 0, b = mono.length - 1;
  while (a < b && Math.abs(mono[a]) <= thr) a++;
  while (b > a && Math.abs(mono[b]) <= thr) b--;
  return [Math.max(0, a - Math.round(rate * 0.002)), Math.min(mono.length, b + 1 + Math.round(rate * 0.01))];
}

// The note of a pitched sound (MIDI), by autocorrelation over a stretch after its attack; null when it has none.
export function guessPitch(mono, rate, start = 0, end = mono.length) {
  const len = Math.min(4096, end - start);
  if (len < 512) return null;
  let at = start, p = 0; // the loudest point of the first half second, then a bit after it
  for (let i = start; i < Math.min(end - len, start + rate * 0.5); i++) if (Math.abs(mono[i]) > p) { p = Math.abs(mono[i]); at = i; }
  at = Math.min(end - len, at + Math.round(rate * 0.03));
  const x = mono.subarray(at, at + len);
  const lo = Math.floor(rate / 1500), hi = Math.min(len >> 1, Math.ceil(rate / 40));
  // normalised square difference (as in YIN): the first deep dip is the period
  const d = new Float32Array(hi + 1);
  let run = 0;
  for (let tau = 1; tau <= hi; tau++) {
    let s = 0;
    for (let i = 0; i + tau < len; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    run += s;
    d[tau] = run ? s * tau / run : 1;
  }
  let tau = -1;
  for (let t = lo; t < hi; t++) if (d[t] < 0.2 && d[t] <= d[t - 1] && d[t] <= d[t + 1]) { tau = t; break; }
  if (tau < 0) return null;
  // between samples: the parabola through the dip
  const a = d[tau - 1], b = d[tau], c = d[tau + 1], k = a - 2 * b + c;
  const t = tau + (k > 0 ? (a - c) / (2 * k) : 0);
  const midi = Math.round(69 + 12 * Math.log2(rate / t / 440));
  return midi >= 24 && midi <= 96 ? midi : null;
}

// Min / max of each of `cols` columns of [a, b), for drawing the wave.
export function peaks(mono, cols, a = 0, b = mono.length) {
  const lo = new Float32Array(cols), hi = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const i0 = a + Math.floor((b - a) * c / cols), i1 = Math.max(i0 + 1, a + Math.floor((b - a) * (c + 1) / cols));
    let mn = 0, mx = 0;
    for (let i = i0; i < i1 && i < b; i++) { const v = mono[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo[c] = mn; hi[c] = mx;
  }
  return { lo, hi };
}

// ---------- processing ----------
// A light compressor (3:1 over -10 dB of the peak), so a sample does not drown next to the FM.
function compress(x, rate) {
  const thr = 0.32, ratio = 3, att = 1 - Math.exp(-1 / (rate * 0.002)), rel = 1 - Math.exp(-1 / (rate * 0.08));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    env += (v - env) * (v > env ? att : rel);
    if (env > thr) x[i] *= thr * Math.pow(env / thr, 1 / ratio) / env;
  }
}
function normalize(x) {
  const p = peakOf(x);
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] /= p;
}

// Bytes a stretch of `len` source samples becomes.
export const bytesFor = (len, rate, mixRate) => Math.max(1, Math.round(len * mixRate / rate));
// Source samples that make `bytes` bytes.
export const srcFor = (bytes, rate, mixRate) => Math.floor(bytes * rate / mixRate);

// The sound as it goes into the chip, still at the source's rate: trimmed, faded, compressed, normalised
// (the "before" of the preview, and what gets resampled).
// o: { start, end, fade (seconds, at the end), loop (source index or -1: no fade then), compress }
export function shape(mono, rate, o) {
  const x = mono.slice(o.start, o.end);
  const looped = o.loop >= 0;
  if (o.start > 0) { const n = Math.min(x.length, Math.round(rate * 0.001)); for (let i = 0; i < n; i++) x[i] *= i / n; }
  if (!looped && o.fade > 0) {
    const n = Math.min(x.length, Math.round(o.fade * rate));
    for (let i = 0; i < n; i++) x[x.length - n + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / n);
  }
  normalize(x);
  if (o.compress) { compress(x, rate); normalize(x); }
  return x;
}

// Low-pass (anti-alias, cut at 0.45 of the lower rate) and resampling in one: a Blackman-windowed sinc.
export function resample(x, rate, to) {
  const n = bytesFor(x.length, rate, to), out = new Float32Array(n);
  const fc = 0.45 * Math.min(rate, to) / rate; // cut-off in cycles per source sample
  const half = Math.ceil(10 / (2 * fc)); // 10 zero crossings each side
  const ratio = rate / to;
  for (let j = 0; j < n; j++) {
    const t = j * ratio, c = Math.floor(t);
    let s = 0, w = 0;
    for (let i = c - half + 1; i <= c + half; i++) {
      const u = i - t, a = Math.abs(u) / half;
      if (a >= 1) continue;
      const sinc = u === 0 ? 1 : Math.sin(2 * Math.PI * fc * u) / (2 * Math.PI * fc * u);
      const k = sinc * (0.42 + 0.5 * Math.cos(Math.PI * a) + 0.08 * Math.cos(2 * Math.PI * a));
      w += k;
      if (i >= 0 && i < x.length) s += x[i] * k;
    }
    out[j] = w ? s / w : 0;
  }
  return out;
}

// 8 bit unsigned with triangular dither; never 0 (the end marker): 1..255, 128 = silence.
export function quantize(x, seed = 1) {
  let r = seed >>> 0 || 1;
  const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const out = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * 126.5;
    const dith = Math.abs(v) < 0.02 ? 0 : rnd() + rnd() - 1; // digital silence stays silent
    out[i] = Math.max(1, Math.min(255, Math.round(128 + v + dith)));
  }
  return out;
}

// Everything at once: { pcm (Uint8Array), loopAt (byte from the start, -1 none), before (Float32Array at `rate`) }.
export function render(mono, rate, mixRate, o) {
  const before = shape(mono, rate, o);
  const pcm = quantize(resample(before, rate, mixRate));
  const loopAt = o.loop >= 0 ? Math.min(pcm.length - 1, Math.round((o.loop - o.start) * mixRate / rate)) : -1;
  return { pcm, loopAt, before };
}

// ---------- fitting a budget ----------
// What can be done when a sample is too big, each with what it costs. All keep the start.
//  tail: cut the end, with a fade out (a looped sound loses its loop);
//  loop: (looped sounds) cut the end, the loop gets shorter: the loop start stays (or moves in when it must).
export function fitOptions(o, rate, mixRate, budgetBytes) {
  const keep = srcFor(budgetBytes, rate, mixRate) - 1, len = o.end - o.start;
  if (len <= keep) return [];
  const end = o.start + keep, lost = (len - keep) / rate, out = [];
  out.push({ id: 'tail', label: `CUT TAIL -${lost.toFixed(2)} S`, tip: `Cut ${lost.toFixed(2)} s off the end, with a fade out${o.loop >= 0 ? '; the loop goes' : ''}`,
    set: { end, loop: -1, fade: Math.max(o.fade, Math.min(0.08, keep / rate / 4)) } });
  if (o.loop >= 0) {
    // the loop start stays while the loop keeps 20 ms; else the loop moves in, at most half the sound long
    const minLoop = Math.round(rate * 0.02);
    const loop = o.loop < end - minLoop ? o.loop : end - Math.min(o.end - o.loop, keep >> 1);
    if (loop > o.start) {
      const was = (o.end - o.loop) / rate, now = (end - loop) / rate;
      out.push({ id: 'loop', label: `SHORTER LOOP ${now.toFixed(2)} S`, tip: `The loop gets ${now.toFixed(2)} s long instead of ${was.toFixed(2)} s`, set: { end, loop } });
    }
  }
  return out;
}
