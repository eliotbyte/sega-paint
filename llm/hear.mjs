// "Ears" for one sound: render notes of a patch, compare a patch with a target WAV, find the nearest FM sounds of
// the library, a spectrogram picture. The distance is a log spectrogram at three resolutions plus the envelope.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { hzMidi } from '../player/engine/song.js';
import { readSoundFile } from '../player/soundfile.js';
import { RATE, readWav, writeWav, catOf, noteName, KIT, fail } from './core.mjs';
import { power, db } from './dsp.mjs';
import { summarize, formatSummary, envelope, pitchOf } from './analyze.mjs';
import { renderPatch, soundRecord } from './patch.mjs';

// ---------- a target: a WAV (mono, 44.1 kHz, leading silence cut) ----------
export function loadTarget(file) {
  const { L, R, rate } = readWav(file);
  let x = Float32Array.from(L, (v, i) => (v + R[i]) / 2);
  if (rate !== RATE) { // linear resampling is enough for analysis
    const n = Math.floor(x.length * RATE / rate), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i * rate / RATE, k = Math.floor(t), f = t - k; y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f; }
    x = y;
  }
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  if (!pk) fail(`${file}: silent`);
  let s = 0; while (s < x.length && Math.abs(x[s]) < pk * 0.003) s++;
  return x.subarray(Math.max(0, s - 64));
}

// ---------- features and distance ----------
const BANDS = (() => { const b = []; for (let f = 50; f < 16000; f *= 2 ** 0.25) b.push([f, f * 2 ** 0.25]); return b; })();
const RES = [512, 2048, 8192];
function spectro(x, N, len) {
  const hop = N / 2, frames = Math.max(1, Math.floor((len - N / 2) / hop) + 1), out = [];
  const bin = RATE / N;
  const map = BANDS.map(([lo, hi]) => { let a = Math.floor(lo / bin), b = Math.ceil(hi / bin); if (b <= a) b = a + 1; return [Math.max(1, a), Math.min(N / 2 - 1, b)]; });
  for (let f = 0; f < frames; f++) {
    const p = power(x, f * hop - N / 2, N);
    out.push(map.map(([a, b]) => { let s = 0; for (let k = a; k < b; k++) s += p[k]; return db(s / (b - a) + 1e-20, -200); }));
  }
  return out;
}
// x: mono at 44.1 kHz from the note start; len: samples compared
export function features(x, len = x.length) {
  len = Math.min(len, x.length);
  const env = envelope(x.subarray(0, len));
  const top = Math.max(...env);
  return { len, top, env: Array.from(env, (v) => Math.max(v - top, -80)), spec: RES.map((N) => { const s = spectro(x, N, len); const m = Math.max(...s.flat()); return s.map((r) => r.map((v) => Math.max(v - m, -80))); }) };
}
// 0 = the same; about 1 = clearly different; level differences are left out (both are matched at their peak)
export function distance(a, b) {
  const mean = (A, B) => { let s = 0, n = 0; for (let i = 0; i < Math.min(A.length, B.length); i++) { const x = A[i], y = B[i]; if (Array.isArray(x)) for (let k = 0; k < x.length; k++) { s += Math.abs(x[k] - y[k]); n++; } else { s += Math.abs(x - y); n++; } } return n ? s / n : 0; };
  const spec = RES.reduce((s, _, k) => s + mean(a.spec[k], b.spec[k]), 0) / RES.length;
  return (0.7 * spec + 0.3 * mean(a.env, b.env)) / 10;
}

// ---------- a sound to hear: a patch (key, .spp, .spsound) or a WAV ----------
export const isWav = (x) => /\.wav$/i.test(x);
// the hold of a patch render matched to a target of `len` samples, its last 0.6 s taken as the release (as hear
// renders a WAV): one more guess at the key-up
export const holdFor = (len) => Math.max(0.2, Math.min(2, len / RATE - 0.6));
// Where the key went up in a target (t, in seconds), the likeliest first: the points where its level starts falling
// faster than before (the sustain or the decay giving way to the release; a cymbal's release can fade slowly at first,
// then drop). Up to 2, the second at least a sixth as clear; none when the sound only dies away (then any hold after
// its end sounds the same). s: how clear (dB per hop the fall speeds up by; a held note's key-up: 2 and more).
export function keyUps(x) {
  const HOP = 256, SM = 4, W = 8; // the envelope's hop; smoothing (± 23 ms); the slopes before and after (46 ms each)
  // the envelope smoothed (a low note's waves ripple it by a few dB)
  const e0 = envelope(x), n = e0.length, e = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) { let p = 0, c = 0; for (let j = Math.max(0, i - SM); j <= Math.min(n - 1, i + SM); j++, c++) p += 10 ** (e0[j] / 10); e[i] = 10 * Math.log10(p / c + 1e-12); }
  const top = Math.max(...e), a0 = e.findIndex((v) => v >= top - 6);
  // how much the fall speeds up, from 70 ms after the attack (before that: the attack giving way to the decay)
  for (let i = a0 + 12; i + W < n && e[i] > top - 50; i++) s[i] = (e[i] - e[i - W]) / W - (e[i + W] - e[i]) / W;
  const k = [];
  for (let i = 1; i < n - 1; i++) if (s[i] >= 0.15 && s[i] >= s[i - 1] && s[i] > s[i + 1]) k.push({ i, s: s[i] });
  k.sort((p, q) => q.s - p.s);
  const out = [];
  for (const c of k) if (out.length < 2 && c.s >= k[0].s / 6 && out.every((o) => Math.abs(o.i - c.i) > 9)) out.push(c);
  // a clear one is placed on the steepest drop of the envelope as measured (± 35 ms); else - 1 hop: the smoothing
  // shows the drop a little late
  const at = (c) => {
    if (c.s < 1.5) return c.i - 1;
    let bi = c.i, bd = -Infinity;
    for (let i = Math.max(0, c.i - 6); i <= Math.min(n - 3, c.i + 6); i++) if (e0[i] - e0[i + 2] > bd) { bd = e0[i] - e0[i + 2]; bi = i; }
    return bi + 0.5;
  };
  return out.map((c) => ({ t: +(at(c) * HOP / RATE).toFixed(3), s: c.s }));
}
export function sourceOf(ref) {
  if (isWav(ref)) return { wav: true, name: ref, x: loadTarget(ref) };
  const rec = soundRecord(ref);
  return { wav: false, name: rec.name, rec };
}
const pitchOfWav = (x) => pitchOf(x, Math.round(0.05 * RATE)) || pitchOf(x, Math.round(0.15 * RATE)) || pitchOf(x, Math.round(0.3 * RATE));
export const noteOfWav = (x) => { const f = pitchOfWav(x); return f ? Math.round(hzMidi(f)) : null; };

// ---------- hear ----------
export function hear(ref, { notes = null, hold = 1, png = false, wav = false, out = null } = {}) {
  const s = sourceOf(ref), lines = [];
  if (s.wav) {
    const h = Math.min(hold ?? 99, s.x.length / RATE);
    const sum = summarize(s.x, { hold: h });
    lines.push(`${ref}: ${(s.x.length / RATE).toFixed(2)} s${sum.f0 ? `, pitch ${noteName(Math.round(hzMidi(sum.f0)))}` : ''}${hold == null ? ' (where the key went up is not known: --hold sets it)' : ''}`);
    lines.push(formatSummary('', sum, { hold: h, wav: hold == null }).replace(/^ {2}/, ''));
    if (png) lines.push(`  picture: ${spectrogramPng(s.x, out('wav'))}`);
    return lines.join('\n');
  }
  const rec = s.rec, ps = notes || (rec.type === 'drums' ? [rec.p] : [rec.p - 12, rec.p, rec.p + 12]);
  lines.push(`"${rec.name}" (${rec.type === 'drums' ? `FM drum ${KIT[rec.gm]?.name || rec.gm}` : 'FM'}), held ${hold} s then released:`);
  for (const p of ps) {
    const x = renderPatch(rec, p, { hold, release: 0.6 });
    lines.push(formatSummary(noteName(p).padEnd(4), summarize(x, { hold }), { hold }));
    if (png) lines.push(`      picture: ${spectrogramPng(x, out(noteName(p)))}`);
    if (wav) { const f = out(noteName(p)).replace(/\.png$/, '.wav'); writeMono(f, x); lines.push(`      wav: ${f}`); }
  }
  return lines.join('\n');
}
export const writeMono = (f, x) => writeWav(f, x, x);

// ---------- compare ----------
const pct = (a, b) => Math.round((a / b - 1) * 100);
export function compareWords(a, b, levelDiff) { // a = the patch, b = the target (summaries)
  const w = [];
  const ca = a.cents.filter(Boolean), cb = b.cents.filter(Boolean);
  const avg = (c) => c.reduce((s, v) => s + Math.log(v), 0) / c.length;
  if (ca.length && cb.length) { const r = Math.exp(avg(ca) - avg(cb)); if (Math.abs(r - 1) > 0.12) w.push(`${r >= 2 ? `${r.toFixed(1)}x brighter` : r <= 0.5 ? `${(1 / r).toFixed(1)}x darker` : `${r > 1 ? 'brighter' : 'darker'} by ${Math.abs(pct(r, 1))}%`} (centroid ${ca.map((v) => Math.round(v)).join('/')} vs ${cb.map((v) => Math.round(v)).join('/')} Hz)`); }
  if (Math.abs(a.attack - b.attack) > Math.max(5, 0.3 * b.attack)) w.push(`attack ${a.attack > b.attack ? 'slower' : 'faster'} by ${Math.abs(a.attack - b.attack)} ms (${a.attack} vs ${b.attack})`);
  const dk = (s) => s.decay ?? 9999;
  if (Math.abs(dk(a) - dk(b)) > Math.max(30, 0.3 * Math.min(dk(a), dk(b)))) w.push(dk(a) < dk(b) ? `fades faster (−20 dB at ${a.decay} ms vs ${b.decay ?? 'never'})` : `fades slower (−20 dB at ${a.decay ?? 'never'} vs ${b.decay} ms)`);
  const sa = a.sustain - a.peak, sb = b.sustain - b.peak;
  if (Math.abs(sa - sb) > 4) w.push(`level at the key-up ${Math.round(sa - sb) > 0 ? 'higher' : 'lower'} by ${Math.abs(Math.round(sa - sb))} dB`);
  if (a.release != null && b.release != null && Math.abs(a.release - b.release) > Math.max(30, 0.4 * b.release)) w.push(`release ${a.release > b.release ? 'longer' : 'shorter'} (${a.release} vs ${b.release} ms)`);
  const hd = [];
  for (let k = 1; k < Math.min(a.harm.length, b.harm.length); k++) { const d = a.harm[k] - b.harm[k]; if (Math.abs(d) > 6 && Math.max(a.harm[k], b.harm[k]) > -40) hd.push([k + 1, d]); }
  hd.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  for (const [k, d] of hd.slice(0, 2)) w.push(`${k === 2 ? '2nd' : k === 3 ? '3rd' : k + 'th'} harmonic ${d > 0 ? 'stronger' : 'weaker'} by ${Math.abs(d)} dB${d < 0 && b.harm[k - 1] > -20 ? ' (missing)' : ''}`);
  if (Math.abs(a.noise - b.noise) > 0.15) w.push(`${a.noise > b.noise ? 'noisier / less harmonic' : 'cleaner / more harmonic'} (${Math.round(a.noise * 100)}% vs ${Math.round(b.noise * 100)}% off the harmonics)`);
  if (Math.abs(levelDiff) > 3) w.push(`${levelDiff > 0 ? 'louder' : 'quieter'} by ${Math.abs(Math.round(levelDiff))} dB (not in the distance)`);
  return w;
}
// The patch rendered to match a target: its pitch (or the patch's own note for drums / unpitched targets) and length
// Semitones between the note a patch plays and the pitch heard (a modulator under the carrier sounds an octave
// lower, a carrier at MUL 2 an octave higher): found once by playing the patch's own note.
const offsets = new WeakMap();
export function pitchShift(rec) {
  if (!offsets.has(rec)) {
    const p = rec.p ?? 60, f = pitchOf(renderPatch(rec, p, { hold: 0.25, release: 0.05 }), Math.round(0.05 * RATE));
    offsets.set(rec, f ? Math.round(hzMidi(f) - p) : 0);
  }
  return offsets.get(rec);
}
export function renderLike(rec, target, note = null, hold = target.hold) {
  const p = note ?? (rec.type === 'drums' || target.note == null ? rec.p : target.note - pitchShift(rec));
  return { p, x: renderPatch(rec, p, { hold, release: Math.max(0.1, target.x.length / RATE - hold) }) };
}
// holds: the key-ups to try (--hold, else those seen in the target and the guess of holdFor); hold: the first of them
export function prepareTarget(x, { note = null, hold = null } = {}) {
  // the guess too unless a key-up is clear (a held note cut by the release); a key-up within 30 ms of it is taken as
  // the guess (a WAV of hear: held exactly that long)
  const ups = keyUps(x), guess = +holdFor(x.length).toFixed(3), near = (u) => Math.abs(u.t - guess) < 0.03;
  const ts = ups.map((u) => (near(u) ? guess : u.t));
  const holds = hold != null ? [hold] : ups.some((u) => u.s >= 1.5 || near(u)) ? ts : [...ts, guess];
  return { x, note: note ?? noteOfWav(x), hold: holds[0], holds, f: features(x), sum: summarize(x, { hold: holds[0] }) };
}
// The patch rendered like the target at each of its key-ups: the closest one (p, x, hold, d)
export function closestHold(rec, T, note = null) {
  let best = null;
  for (const hold of T.holds) {
    const { p, x } = renderLike(rec, T, note, hold), d = distance(features(x, T.x.length), T.f);
    if (!best || d < best.d) best = { p, x, hold, d };
  }
  return best;
}
// the target taken as released at `hold`
export const withHold = (T, hold) => (hold === T.hold ? T : { ...T, hold, sum: summarize(T.x, { hold }) });
export function compare(ref, targetRef, { note = null, hold = null } = {}) {
  const s = sourceOf(ref);
  if (s.wav) fail('compare: the first sound is the patch (a key, .spp or .spsound), the second the target');
  const tx = isWav(targetRef) ? loadTarget(targetRef) : (() => { const r = soundRecord(targetRef); return renderPatch(r, note ?? r.p, { hold: hold ?? 1, release: 0.6 }); })();
  const T0 = prepareTarget(tx, { note, hold: isWav(targetRef) ? hold : hold ?? 1 });
  const { p, x, hold: h, d } = closestHold(s.rec, T0, note), T = withHold(T0, h);
  const F = features(x, T.x.length);
  const sa = summarize(x, { hold: T.hold });
  const words = compareWords(sa, T.sum, F.top - T.f.top);
  return { d, p, hold: h, words, text: `"${s.rec.name}" at ${noteName(p)}, key-up at ${h} s, vs ${targetRef}: distance ${d.toFixed(3)}${d < 0.05 ? ' (the same sound)' : d < 0.3 ? ' (close)' : d < 0.8 ? ' (related)' : ' (different)'}\n` + (words.length ? words.map((x2) => '  - ' + x2).join('\n') : '  - no clear difference in envelope, brightness or harmonics') };
}

// ---------- nearest: the FM sounds of the library (and of a .spkit / .spsound of My sounds) closest to a target ----------
export function candidates(kits = []) {
  const out = [];
  for (const c of [...catOf('fm'), ...catOf('drums')]) out.push({ key: c.key, rec: soundRecord(c.key) });
  for (const f of kits) {
    const { sounds } = readSoundFile(f, fs.readFileSync(f, 'utf8'), 11300);
    for (const r of sounds) if (r.ins) out.push({ key: `${f}: ${r.name}`, rec: r });
  }
  return out;
}
export function nearest(targetRef, { n = 5, kits = [], note = null, hold = null } = {}) {
  let tx;
  if (isWav(targetRef)) tx = loadTarget(targetRef);
  else { const r = soundRecord(targetRef); tx = renderPatch(r, note ?? r.p, { hold: hold ?? 1, release: 0.6 }); }
  const T = prepareTarget(tx, { note, hold: isWav(targetRef) ? hold : hold ?? 1 });
  const res = [];
  for (const c of candidates(kits)) {
    const { p, hold: h, d } = closestHold(c.rec, T, note);
    res.push({ ...c, p, hold: h, d });
  }
  res.sort((a, b) => a.d - b.d);
  return { target: T, list: res.slice(0, n) };
}

// ---------- a spectrogram picture (PNG, no dependencies) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// time across (5.8 ms a column), log frequency up (40 Hz .. 16 kHz), 70 dB of range; a dark-blue-yellow-white scale
export function spectrogramPng(x, file) {
  const N = 2048, hop = 256, H = 160, W = Math.max(1, Math.floor(x.length / hop));
  const rows = Array.from({ length: H }, (_, y) => 40 * (16000 / 40) ** (1 - y / (H - 1)));
  const cols = [];
  let top = -200;
  for (let c = 0; c < W; c++) {
    const p = power(x, c * hop - N / 2, N);
    const col = rows.map((f) => { const k = Math.min(N / 2 - 1, Math.max(1, Math.round(f / RATE * N))); return db(p[k] + 1e-20, -200); });
    for (const v of col) top = Math.max(top, v);
    cols.push(col);
  }
  const rgb = Buffer.alloc(W * H * 3);
  const pal = (t) => [Math.min(255, 510 * Math.max(0, t - 0.4)), Math.min(255, 400 * Math.max(0, t - 0.25)), Math.min(255, 255 * Math.min(1, t * 2.5)) * (t < 0.75 ? 1 : 4 * (1 - t))];
  for (let c = 0; c < W; c++) for (let y = 0; y < H; y++) {
    const t = Math.max(0, Math.min(1, (cols[c][y] - top + 70) / 70)), [r, g, b] = pal(t);
    const i = (y * W + c) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = Math.max(0, b);
  }
  fs.writeFileSync(file, png(W, H, rgb));
  return file;
}
