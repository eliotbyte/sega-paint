// Song model -> chip write timeline ("sound driver").
import { TimelineBuilder, KIND_YM0, KIND_PSG } from './vgm.js';
import { YM_CLOCK } from './renderer.js';

const PSG_CLOCK = 3579545;

export const fmHz = (block, fnum) => fnum * YM_CLOCK / 144 / Math.pow(2, 21 - block);
export const psgHz = (tone) => PSG_CLOCK / 32 / Math.max(tone, 1);
export const hzMidi = (f) => 69 + 12 * Math.log2(f / 440);

// Transpose an FM [block, fnum] by k semitones, keeping fnum in a sane range.
export function fmTranspose(block, fnum, k) {
  if (!k) return [block, fnum];
  let f = fnum * Math.pow(2, k / 12);
  while (f >= 2048 && block < 7) { f /= 2; block++; }
  while (f < 1024 && block > 0) { f *= 2; block--; }
  return [block, Math.max(0, Math.min(2047, Math.round(f)))];
}

export function psgTranspose(tone, k) {
  return k ? Math.max(1, Math.min(1023, Math.round(tone * Math.pow(2, -k / 12)))) : tone;
}

export function prepareSong(song) {
  // base pitch of every macro, used for transposition of edited notes
  for (const m of song.macros) {
    if (m.noise) m.pitch = 60;
    else if (Array.isArray(m.base)) m.pitch = Math.round(hzMidi(fmHz(m.base[0], m.base[1])));
    else m.pitch = Math.round(hzMidi(psgHz(m.base)));
  }
  for (const L of song.layers) {
    if (L.kind === 'dac' || !L.notes.length) continue;
    // default instrument / macro for new notes = most frequent pair
    const cnt = new Map();
    for (const n of L.notes) {
      const key = (n.i ?? -1) + ':' + n.m;
      cnt.set(key, (cnt.get(key) || 0) + 1);
    }
    let best = null, bc = 0;
    for (const [k, c] of cnt) if (c > bc) { best = k; bc = c; }
    const [i, m] = best.split(':').map(Number);
    const durs = L.notes.map((n) => n.d).sort((a, b) => a - b);
    L.def = { i: i < 0 ? undefined : i, m, d: durs[durs.length >> 1] };
  }
  return song;
}

export function stepTime(song, s) {
  const st = song.stepTimes, i = s + song.step0;
  if (i < 0) return st[0] + i * song.step;
  if (i >= st.length - 1) return st[st.length - 1] + (i - st.length + 1) * song.step;
  const f = Math.floor(i), fr = i - f;
  return st[f] + (st[f + 1] - st[f]) * fr;
}

// A recorded note's macro ends with the next note's pitch, written a frame early by the game's driver. A note made
// longer than it was recorded (n.md, see app.js) stops its macro a frame before that, so the early pitch never plays.
const macroLimit = (T, n, end) => (n.md != null && n.d > n.md ? Math.min(end, T + n.md - 1000) : end);

export const noteTime = (song, n) => stepTime(song, n.s) + (n.n || 0);

// Inverse: real time (samples) -> fractional step
export function timeToStep(song, t) {
  const st = song.stepTimes;
  if (t <= st[0]) return (t - st[0]) / song.step - song.step0;
  let lo = 0, hi = st.length - 1;
  if (t >= st[hi]) return hi - song.step0 + (t - st[hi]) / song.step;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (st[m] <= t) lo = m; else hi = m; }
  return lo + (t - st[lo]) / (st[hi] - st[lo]) - song.step0;
}

// Step (8.8 fixed point) a sample note plays at, or 0 if the driver would skip it.
// Only the melodic voice (DAC4) is resampled to the note; on the other voices samples play at their base pitch.
export const MELODIC_VOICE = 3;
export function sampleStep(smp, note, voice = MELODIC_VOICE) {
  if (!smp.pitched || voice !== MELODIC_VOICE) return smp.baseStep;
  const idx = note + smp.transp - 0x24;
  return idx >= 0 && idx < 48 ? smp.steps[idx] : 0;
}

// Re-creation of the Skitchin' (EA) DAC mixer, reverse-engineered from the ROM:
//  * 4 voices; each sample layer is one voice (layer.voice 0..3), so a new note replaces the voice's current sound.
//  * The Z80 sums voices: out = clamp(sum - 0x80 * (voices - 1)); samples are unsigned 8-bit, 0 = end marker.
//  * Only the first voice in the Z80 list (highest voice number) is resampled to its pitch; the others
//    advance one byte per output sample. Output goes to the YM2612 DAC at `song.mixRate` Hz.
function mixSamples(song, bank, tb, muted) {
  const evs = [];
  const songEnd = song.end - 1;
  song.layers.forEach((L, li) => {
    if (L.kind !== 'sample' || muted.has(li)) return;
    const voice = L.voice ?? MELODIC_VOICE;
    for (const n of L.notes) {
      const smp = song.samples[n.smp];
      if (!smp) continue;
      const step = sampleStep(smp, n.p, voice);
      if (!step) continue;
      const T = noteTime(song, n);
      if (T >= songEnd) continue;
      evs.push({ T, stop: smp.oneShot ? Infinity : T + n.d, smp, step: step / 256, voice });
    }
  });
  evs.sort((a, b) => a.T - b.T);
  const dt = 44100 / song.mixRate;
  const slots = [null, null, null, null];
  let t = evs.length ? evs[0].T : 0, ei = 0, enabled = false, active = 0, loopMarked = song.loopStart < 0;
  const start = (e) => {
    slots[e.voice] = { pos: e.smp.off, end: e.smp.off + e.smp.len, loop: e.smp.loop, step: e.step, stop: e.stop };
  };
  while (ei < evs.length || active) {
    if (!active && ei < evs.length && evs[ei].T > t) t = evs[ei].T;
    // after the jump back to the loop start the chip still has the DAC state of the song end: restate it there
    if (!loopMarked && t >= song.loopStart) { loopMarked = true; if (enabled) tb.push(song.loopStart, KIND_YM0, 0x2b, 0x80); }
    while (ei < evs.length && evs[ei].T <= t) start(evs[ei++]);
    active = 0;
    let sum = 0, lead = -1;
    for (let k = 3; k >= 0; k--) if (slots[k]) { active++; sum += bank[slots[k].pos | 0]; if (lead < 0) lead = k; }
    if (!active) continue;
    if (!enabled) { tb.push(t, KIND_YM0, 0x2b, 0x80); enabled = true; }
    let out = sum - 0x80 * (active - 1);
    out = out < 0 ? 0 : out > 255 ? 255 : out;
    tb.push(t, KIND_YM0, 0x2a, out);
    for (let k = 0; k < 4; k++) {
      const v = slots[k];
      if (!v) continue;
      v.pos += active > 1 && k !== lead ? 1 : v.step;
      if (v.pos >= v.end) {
        if (v.loop >= 0) v.pos = v.loop + (v.pos - v.end);
        else slots[k] = null;
      }
      // stop everything just before the song end, so the DAC-off write is still played before the loop jump
      if (t >= v.stop || t + 2 * dt >= songEnd) slots[k] = null;
    }
    t += dt;
    active = slots.filter(Boolean).length;
    if (!active && enabled) { tb.push(t, KIND_YM0, 0x2b, 0x00); enabled = false; }
  }
}

// A user-set slide (n.slide, semitones; 0 = flat) replaces the recorded pitch movement inside the note:
// the pitch glides from the note to the target over the first part of the note, updated every frame.
const FRAME = 735;
function glide(T, end, slide, emit) {
  if (!slide) return;
  const len = Math.max(2 * FRAME, Math.min(11025, (end - T) * 0.6));
  for (let t = T + FRAME; t < end; t += FRAME) {
    const f = Math.min(1, (t - T) / len);
    emit(t, slide * f);
    if (f >= 1) break;
  }
}

// Note volume n.vol: 0..15 (default 15 = as recorded). Each step down is 2 dB, like the PSG's attenuator.
// FM has no volume register: the carriers' total level (0.75 dB steps) is raised instead.
const CARRIERS = [[0x4c], [0x4c], [0x4c], [0x4c], [0x48, 0x4c], [0x44, 0x48, 0x4c], [0x44, 0x48, 0x4c], [0x40, 0x44, 0x48, 0x4c]];
const volSteps = (n) => 15 - (n.vol ?? 15);
// Note stereo n.pan: 'L' | 'C' | 'R' (default: as recorded). The YM2612 only switches a channel to the
// left / right speaker or both (bits 7-6 of register B4), so there are just these three positions.
export const PAN_BITS = { L: 0x80, C: 0xc0, R: 0x40 };
// Register writes of one FM note with its volume and stereo applied.
function fmNoteRegs(ins, n) {
  const quiet = volSteps(n), pan = PAN_BITS[n.pan];
  const alg = (ins.regs.find(([r]) => r === 0xb0)?.[1] ?? 7) & 7;
  const atten = quiet === 15 ? 127 : Math.round(quiet * 2 / 0.75);
  return (reg, v) => {
    if (quiet && CARRIERS[alg].includes(reg)) return Math.min(127, (v & 0x7f) + atten);
    if (pan && reg === 0xb4) return (v & 0x3f) | pan;
    return v;
  };
}

// ---------- repeats inside a song ----------
// song.repeats = [{ from, to, times }] in steps (bar lines). Bars are written once and played `times` times,
// like |: ... :| in printed music; playback unrolls them ("played" steps) while the staff shows written steps.
export function repeatSpans(song) {
  return (song.repeats || []).filter((r) => r.times > 1 && r.to > r.from).sort((a, b) => a.from - b.from);
}
// All played steps of written step w (one per pass when w is inside a repeat).
export function playedSteps(song, w) {
  let extra = 0;
  for (const r of repeatSpans(song)) {
    const len = r.to - r.from;
    if (w >= r.to) extra += len * (r.times - 1);
    else if (w >= r.from) return Array.from({ length: r.times }, (_, k) => w + extra + k * len);
    else break;
  }
  return [w + extra];
}
// Written step of played step p.
export function writtenStep(song, p) {
  let extra = 0;
  for (const r of repeatSpans(song)) {
    const len = r.to - r.from, start = r.from + extra;
    if (p < start) break;
    if (p < start + len * r.times) return r.from + ((p - start) % len);
    extra += len * (r.times - 1);
  }
  return p - extra;
}
// The song as it is played: repeated bars unrolled. Every played step keeps the length of its written step,
// so songs with an uneven grid (the examples, recorded from the game) repeat with their own timing.
export function performSong(song) {
  if (!repeatSpans(song).length) return song;
  const q = (t) => Math.round(timeToStep(song, t) * 1000) / 1000; // bar lines, without float noise
  const endP = playedSteps(song, q(song.end)).at(-1);
  const s0 = song.step0, n = Math.ceil(endP) + s0 + 1;
  const st = [stepTime(song, -s0)];
  for (let i = 1; i < n; i++) {
    const p = i - 1 - s0, w = p < 0 ? p : writtenStep(song, p);
    st.push(st[i - 1] + stepTime(song, w + 1) - stepTime(song, w));
  }
  const out = {
    ...song, repeats: [], stepTimes: st, step0: s0,
    layers: song.layers.map((L) => ({ ...L, notes: L.notes.flatMap((n) => playedSteps(song, n.s).map((s) => ({ ...n, s }))) })),
  };
  // register writes outside the notes happen on every pass too
  out.globals = song.globals.flatMap((g) => {
    if (g[0] <= 0) return [g];
    const w = timeToStep(song, g[0]);
    return playedSteps(song, w).map((p) => [Math.round(stepTime(out, p)), g[1], g[2], g[3]]);
  });
  out.end = Math.round(stepTime(out, endP));
  out.loopStart = song.loopStart < 0 ? -1 : Math.round(stepTime(out, playedSteps(song, q(song.loopStart))[0]));
  return out;
}

export function buildTimeline(song, pcm, muted = new Set()) {
  song = performSong(song);
  // Every song loops: without a loop start of its own (the green repeat) it starts over from the beginning.
  if (song.loopStart < 0) song = { ...song, loopStart: 0 };
  const tb = new TimelineBuilder(1 << 20);
  // Notes are cut 1 sample before the song end: writes at or after it are never played (the renderer
  // jumps back to the loop start first), so a key-off there would leave the note hanging on repeat.
  const songEnd = song.end - 1;
  const hasMixer = !!song.samples;
  for (const [t, part, reg, val] of song.globals) {
    if (hasMixer && part === 0 && reg === 0x2b) continue; // DAC enable is driven by the mixer
    tb.push(t, part, reg, val);
  }
  if (hasMixer) mixSamples(song, pcm, tb, muted);

  for (const L of song.layers) {
    const notes = L.notes.slice().sort((a, b) => noteTime(song, a) - noteTime(song, b));
    if (L.kind === 'fm') {
      const ch = L.ch, part = ch >= 3 ? 1 : 0, c3 = ch % 3, code = c3 | (ch >= 3 ? 4 : 0);
      const shadow = new Map();
      let loopMarked = song.loopStart < 0;
      for (let ni = 0; ni < notes.length; ni++) {
        const n = notes[ni];
        const T = noteTime(song, n);
        if (T >= songEnd) continue;
        // first note of the loop: write the whole instrument, the chip holds the song end's state after the jump
        if (!loopMarked && T >= song.loopStart) { loopMarked = true; shadow.clear(); }
        const nextT = ni + 1 < notes.length ? noteTime(song, notes[ni + 1]) : Infinity;
        const end = Math.min(T + n.d, nextT, songEnd);
        const ins = song.instruments[n.i], mac = song.macros[n.m];
        const k = n.p - mac.pitch;
        const vol = fmNoteRegs(ins, n);
        for (const [r, v0] of ins.regs) {
          const reg = r + c3, v = vol(r, v0);
          if (shadow.get(reg) !== v) { shadow.set(reg, v); tb.push(T, part, reg, v); }
        }
        const [b, f] = fmTranspose(mac.base[0], mac.base[1], k);
        tb.push(T, part, 0xa4 + c3, (b << 3) | (f >> 8));
        tb.push(T, part, 0xa0 + c3, f & 0xff);
        tb.push(T, KIND_YM0, 0x28, ins.ops | code);
        const own = n.slide != null;
        if (own) glide(T, end, n.slide, (t, semis) => {
          const [gb, gf] = fmTranspose(mac.base[0], mac.base[1], k + semis);
          tb.push(t, part, 0xa4 + c3, (gb << 3) | (gf >> 8));
          tb.push(t, part, 0xa0 + c3, gf & 0xff);
        });
        const macEnd = macroLimit(T, n, end);
        for (const e of mac.ev) {
          if (T + e[0] >= macEnd) break;
          if (e[1] === 'f' && own) continue;
          if (e[1] === 'f') {
            const [eb, ef] = fmTranspose(e[2], e[3], k);
            tb.push(T + e[0], part, 0xa4 + c3, (eb << 3) | (ef >> 8));
            tb.push(T + e[0], part, 0xa0 + c3, ef & 0xff);
          } else {
            const reg = e[2] + c3, v = vol(e[2], e[3]);
            shadow.set(reg, v);
            tb.push(T + e[0], part, reg, v);
          }
        }
        tb.push(end, KIND_YM0, 0x28, code);
      }
    } else if (L.kind === 'psg' || L.kind === 'noise') {
      const c = L.ch, lat = c << 5;
      for (let ni = 0; ni < notes.length; ni++) {
        const n = notes[ni];
        const T = noteTime(song, n);
        if (T >= songEnd) continue;
        const nextT = ni + 1 < notes.length ? noteTime(song, notes[ni + 1]) : Infinity;
        const legato = T + n.d >= nextT - 4 && nextT < songEnd;
        const end = Math.min(T + n.d, nextT, songEnd);
        const mac = song.macros[n.m];
        const k = L.kind === 'psg' ? n.p - mac.pitch : 0;
        const tone = (t) => {
          const v = psgTranspose(t, k);
          tb.push(T, KIND_PSG, 0x80 | lat | (v & 15), 0);
          tb.push(T, KIND_PSG, (v >> 4) & 0x3f, 0);
        };
        if (mac.noise) tb.push(T, KIND_PSG, 0xe0 | (mac.base & 7), 0);
        else tone(mac.base);
        const quiet = volSteps(n), att = (v) => Math.min(15, v + quiet);
        tb.push(T, KIND_PSG, 0x90 | lat | att(mac.vol), 0);
        const own = n.slide != null && !mac.noise;
        if (own) glide(T, end, n.slide, (t, semis) => {
          const v = psgTranspose(mac.base, k + semis);
          tb.push(t, KIND_PSG, 0x80 | lat | (v & 15), 0);
          tb.push(t, KIND_PSG, (v >> 4) & 0x3f, 0);
        });
        const macEnd = macroLimit(T, n, end);
        for (const e of mac.ev) {
          const t = T + e[0];
          if (t >= macEnd) break;
          if (e[1] === 't' && own) continue;
          if (e[1] === 't') {
            const v = psgTranspose(e[2], k);
            tb.push(t, KIND_PSG, 0x80 | lat | (v & 15), 0);
            tb.push(t, KIND_PSG, (v >> 4) & 0x3f, 0);
          } else if (e[1] === 'v') tb.push(t, KIND_PSG, 0x90 | lat | att(e[2]), 0);
          else if (e[1] === 'n') tb.push(t, KIND_PSG, 0xe0 | (e[2] & 7), 0);
        }
        if (!legato) tb.push(end, KIND_PSG, 0x9f | lat, 0);
      }
    } else if (L.kind === 'dac') {
      for (const n of notes) {
        const T = noteTime(song, n);
        for (const [dt, off, len, w] of n.ch) {
          const T0 = T + dt;
          for (let j = 0; j < len; j++) tb.push(T0 + j * w, KIND_YM0, 0x2a, pcm[off + j]);
        }
      }
    }
  }
  return tb.finish(song.end, song.loopStart);
}
