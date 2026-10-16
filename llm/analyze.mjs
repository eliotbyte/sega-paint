// What one note sounds like, in numbers: envelope (attack, peak, decay, sustain, release), brightness over time,
// harmonics, how much of it is not harmonic. Used by explain, hear, compare, nearest and fit.
import { power, centroid, db, dbAmp, rms } from './dsp.mjs';
import { RATE, noteName } from './core.mjs';
import { hzMidi } from '../player/engine/song.js';

const HOP = 256;
// RMS level per hop (dB), over 512 samples
export function envelope(x) {
  const n = Math.ceil(x.length / HOP), e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = dbAmp(rms(x, i * HOP - 128, i * HOP + 384), -120);
  return e;
}
const t2i = (sec) => Math.round(sec * RATE / HOP);
const ms = (i) => Math.round(i * HOP / RATE * 1000);

// Fundamental (Hz) by autocorrelation of a window, between 30 Hz and 2 kHz; 0 when there is none
export function pitchOf(x, at = 0, N = 4096) {
  const a = Math.max(0, Math.min(at, x.length - N));
  const w = x.subarray(a, a + N);
  if (w.length < N) return 0;
  const lo = Math.floor(RATE / 2000), hi = Math.floor(RATE / 30);
  const r0 = w.reduce((s, v) => s + v * v, 0);
  if (r0 < 1e-9) return 0;
  const r = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag++) { let s = 0; for (let i = 0; i + lag < N; i++) s += w[i] * w[i + lag]; r[lag] = s / r0; }
  let best = -1, bl = 0;
  for (let lag = lo + 1; lag <= hi; lag++) if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > best + 0.05) { best = r[lag]; bl = lag; }
  if (best < 0.3) return 0;
  // the first peak nearly as high as the best one (avoids picking an octave below)
  for (let lag = lo + 1; lag < bl; lag++) if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > best * 0.9) { bl = lag; break; }
  const y0 = r[bl - 1], y1 = r[bl], y2 = r[bl + 1], d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return RATE / (bl + d);
}

// Harmonics 1..n at a time (dB, the first = 0) and how much energy lies off them (0..1)
export function harmonics(x, at, f0, n = 8, N = 8192) {
  const p = power(x, Math.max(0, at - N / 2), N), bin = RATE / N;
  const amp = [];
  let harm = 0, all = 0;
  for (let k = 1; k < p.length; k++) all += p[k];
  for (let h = 1; h * f0 < RATE / 2 - 100; h++) {
    const c = h * f0 / bin, w = Math.max(2, c * 0.03);
    let m = 0;
    for (let k = Math.max(1, Math.floor(c - w)); k <= Math.min(p.length - 1, Math.ceil(c + w)); k++) { harm += h <= 40 ? p[k] : 0; if (p[k] > m) m = p[k]; }
    if (h <= n) amp.push(m);
  }
  const ref = amp[0] || Math.max(...amp) || 1e-12;
  return { db: amp.map((a) => Math.round(db(a / ref, -99))), noise: all ? Math.max(0, 1 - harm / all) : 0 };
}

const bright = (x, at) => { const p = power(x, at, 2048); return centroid(p, RATE); };
// A note held for `hold` seconds then released. f0: its pitch if known (else measured).
export function summarize(x, { hold = 1, f0 = 0 } = {}) {
  const env = envelope(x);
  let pk = -120, pi = 0;
  const holdI = Math.min(env.length - 1, t2i(hold));
  for (let i = 0; i <= holdI; i++) if (env[i] > pk) { pk = env[i]; pi = i; }
  if (pk < -90) return { silent: true };
  const attack = ms(env.findIndex((v) => v >= pk - 3));
  const at = (sec) => env[Math.min(env.length - 1, t2i(sec))];
  const sustain = at(Math.max(0, hold - 0.03));
  // -20 dB under the peak while held (decay), and the release: from the note-off to 40 dB under its level there
  let decay = null;
  for (let i = pi; i <= holdI; i++) if (env[i] < pk - 20) { decay = ms(i); break; }
  let release = null;
  for (let i = holdI; i < env.length; i++) if (env[i] < Math.max(sustain - 40, -100)) { release = ms(i - holdI); break; }
  const f = f0 || pitchOf(x, Math.round(0.05 * RATE)) || pitchOf(x, Math.round(0.15 * RATE));
  const times = [0, 0.1, 0.5].filter((t) => t < hold);
  const cents = times.map((t) => (at(t + 0.02) > pk - 60 ? bright(x, Math.round(t * RATE)) : 0)); // 0: silent by then
  const h = f ? harmonics(x, Math.round(0.05 * RATE), f) : null;
  return { silent: false, peak: pk, attack, level200: at(0.2), sustain, decay, release, f0: f, times, cents, harm: h?.db || [], noise: h?.noise ?? 1, env };
}

const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);
const dB = (v) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))} dB`;
export function formatSummary(label, s, { hold = 1, wav = false } = {}) {
  if (s.silent) return `${label}  silent`;
  const o = [];
  const tail = wav ? `end ${dB(s.sustain)}` : s.sustain < s.peak - 50 ? `silent before the key-up (${hold} s)` : `held ${hold} s ${dB(s.sustain)} · release ${s.release != null ? s.release + ' ms' : '> ' + Math.round((s.env.length * HOP / RATE - hold) * 1000) + ' ms'}`;
  o.push(`${label}  attack ${s.attack} ms · peak ${dB(s.peak)} · 200 ms ${dB(s.level200)} · ${s.decay != null ? `−20 dB after ${s.decay} ms` : 'holds within 20 dB'} · ${tail}`);
  const pad = ' '.repeat(Math.max(4, label.length + 2));
  o.push(`${pad}brightness (centroid): ${s.times.map((t, i) => `${Math.round(t * 1000)} ms ${s.cents[i] ? hz(s.cents[i]) : 'silent'}`).join(' → ')}`);
  if (s.f0) o.push(`${pad}pitch ${hz(s.f0)} (${noteName(Math.round(hzMidi(s.f0)))}${(() => { const c = Math.round((hzMidi(s.f0) - Math.round(hzMidi(s.f0))) * 100); return c ? ` ${c > 0 ? '+' : ''}${c} cents` : ''; })()}) · harmonics @50 ms: ${s.harm.map((v, i) => `${i + 1}:${v}`).join(' ')} (dB)`);
  else o.push(`${pad}no clear pitch`);
  o.push(`${pad}inharmonic / noise: ${s.noise < 0.1 ? 'low' : s.noise < 0.3 ? 'some' : 'high'} (${Math.round(s.noise * 100)}% of the energy off the harmonics)`);
  return o.join('\n');
}
