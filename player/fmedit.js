// The FM editor's sound logic (the drawing is in app.js). A sound is a "voice" of patches.js: ALG, FB, AMS, FMS and four
// operators in register slot order (slot 0..3 = operators 1, 3, 2, 4). The simple mode keeps no state of its own:
// each knob reads a voice ("how bright is it") and writes one ("make it this bright"), moving several registers at once.

export const clone = (v) => ({ ...v, ops: v.ops.map((o) => ({ ...o })) });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Operator number (1..4) of a slot and back.
export const OP_OF_SLOT = [1, 3, 2, 4];
export const SLOT_OF_OP = [0, 2, 1, 3]; // operator 1..4 -> slot (index op - 1)

// The operators that are heard (carriers) for each algorithm, as slots; the others modulate.
const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
export const carrierSlots = (alg) => CAR[alg & 7];
export const isCarrier = (alg, slot) => CAR[alg & 7].includes(slot);
export const modulatorSlots = (alg) => [0, 1, 2, 3].filter((s) => !isCarrier(alg, s));

// The algorithms as pictures: where operators 1..4 sit (column, row) and who feeds whom (0 = the output).
export const ALG_GRAPH = [
  { pos: [[0, 0], [1, 0], [2, 0], [3, 0]], links: [[1, 2], [2, 3], [3, 4], [4, 0]] },
  { pos: [[0, 0], [0, 1], [1, 0], [2, 0]], links: [[1, 3], [2, 3], [3, 4], [4, 0]] },
  { pos: [[1, 0], [0, 1], [1, 1], [2, 0]], links: [[1, 4], [2, 3], [3, 4], [4, 0]] },
  { pos: [[0, 0], [1, 0], [1, 1], [2, 0]], links: [[1, 2], [2, 4], [3, 4], [4, 0]] },
  { pos: [[0, 0], [1, 0], [0, 1], [1, 1]], links: [[1, 2], [3, 4], [2, 0], [4, 0]] },
  { pos: [[0, 1], [1, 0], [1, 1], [1, 2]], links: [[1, 2], [1, 3], [1, 4], [2, 0], [3, 0], [4, 0]] },
  { pos: [[0, 0], [1, 0], [1, 1], [1, 2]], links: [[1, 2], [2, 0], [3, 0], [4, 0]] },
  { pos: [[0, 0], [1, 0], [2, 0], [3, 0]], links: [[1, 0], [2, 0], [3, 0], [4, 0]] },
];

// ---------- the registers of one operator ----------
// Detune: the chip's 3 bits are 0..3 up, 4..7 down (4 is 0 again). Shown as -3..+3.
export const dtShown = (raw) => (raw >= 4 ? -(raw - 4) : raw);
export const dtRaw = (k) => (k < 0 ? 4 - k : k);
// SSG-EG: bit 3 switches it on, bits 0..2 are the shape. Shown as 0 (off) or 1..8.
export const ssgShown = (raw) => (raw & 8 ? (raw & 7) + 1 : 0);
export const ssgRaw = (k) => (k ? 8 | (k - 1) : 0);

// Each parameter: shown value range [lo, hi], read and written through get / set (raw register values inside).
export const OP_PARAMS = [
  { key: 'ar', label: 'AR', lo: 0, hi: 31, tip: 'Attack rate: 31 = instant' },
  { key: 'dr', label: 'DR', lo: 0, hi: 31, tip: 'Decay rate: fall to sustain level' },
  { key: 'sl', label: 'SL', lo: 0, hi: 15, tip: 'Sustain level: 0 = loud, 15 = silent' },
  { key: 'sr', label: 'SR', lo: 0, hi: 31, tip: 'Sustain rate: fade while held' },
  { key: 'rr', label: 'RR', lo: 0, hi: 15, tip: 'Release rate: fade after key up' },
  { key: 'tl', label: 'TL', lo: 0, hi: 127, tip: 'Total level: 0 = loudest', invert: true },
  { key: 'rs', label: 'KS', lo: 0, hi: 3, tip: 'Key scale: faster envelopes up high' },
  { key: 'mul', label: 'MUL', lo: 0, hi: 15, tip: 'Multiple: frequency x MUL (0 = x0.5)' },
  { key: 'dt', label: 'DT', lo: -3, hi: 3, tip: 'Detune: a slight shift of the frequency', get: (o) => dtShown(o.dt), set: (o, k) => { o.dt = dtRaw(k); } },
  { key: 'am', label: 'AM', lo: 0, hi: 1, tip: 'Amplitude modulation by the LFO' },
  { key: 'ssg', label: 'SSG', lo: 0, hi: 8, tip: 'SSG-EG: repeating envelope (0 = off)', get: (o) => ssgShown(o.ssg), set: (o, k) => { o.ssg = ssgRaw(k); } },
];
export const VOICE_PARAMS = [
  { key: 'fb', label: 'FB', lo: 0, hi: 7, tip: 'Feedback: 0 = sine, 7 = noisy' },
  { key: 'ams', label: 'AMS', lo: 0, hi: 3, tip: 'LFO tremolo depth' },
  { key: 'fms', label: 'FMS', lo: 0, hi: 7, tip: 'LFO vibrato depth' },
];
export const getParam = (p, o) => (p.get ? p.get(o) : o[p.key]);
export function setParam(p, o, k) {
  k = clamp(Math.round(k), p.lo, p.hi);
  if (p.set) p.set(o, k); else o[p.key] = k;
}

// ---------- sound types: an algorithm and its operators, ready to play ----------
const OP = (mul, tl, ar, dr, sl, sr, rr, dt = 0, rs = 0) => ({ mul, dt, tl, rs, ar, am: 0, dr, sr, sl, rr, ssg: 0 });
// operators given as 1, 2, 3, 4; stored in slot order
const voice = (alg, fb, o1, o2, o3, o4) => ({ alg, fb, ams: 0, fms: 0, ops: [o1, o3, o2, o4] });

export const TYPES = [
  { id: 'bass', label: 'BASS', sprite: 'cat', note: 36, // 1>2>3>4, the modulators fade: a plucked, round bass
    voice: voice(0, 5, OP(1, 38, 31, 14, 8, 6, 8), OP(1, 48, 31, 12, 8, 4, 8), OP(1, 22, 31, 13, 7, 5, 8, 0, 1), OP(1, 2, 31, 9, 5, 5, 9, 0, 1)) },
  { id: 'lead', label: 'LEAD', sprite: 'ufo', note: 72, // 1 > 2, 3, 4: three detuned carriers on one bright modulator
    voice: voice(5, 6, OP(1, 30, 31, 3, 2, 0, 7), OP(1, 12, 30, 2, 1, 0, 7, 1), OP(1, 16, 30, 2, 1, 0, 7, 5), OP(1, 12, 30, 2, 1, 0, 7, 6)) },
  { id: 'bell', label: 'BELL', sprite: 'bell', note: 72, // two pairs: 7 on 2 (x3.5, not a harmonic) rings over a soft fundamental
    voice: voice(4, 0, OP(7, 30, 31, 7, 15, 0, 5, 3), OP(2, 14, 31, 6, 15, 0, 5, 2), OP(3, 44, 31, 8, 15, 0, 5), OP(1, 4, 31, 5, 15, 0, 5)) },
  { id: 'organ', label: 'ORGAN', sprite: 'key', note: 60, // four sines as drawbars (x1, x2, x3, x4), held, no decay
    voice: voice(7, 0, OP(1, 8, 31, 0, 0, 0, 9), OP(2, 14, 31, 0, 0, 0, 9), OP(3, 24, 31, 0, 0, 0, 9), OP(4, 20, 31, 0, 0, 0, 9)) },
  { id: 'brass', label: 'BRASS', sprite: 'coin', note: 60, // slow attack: the modulators swell in, so it brightens as it starts
    voice: voice(3, 5, OP(1, 26, 17, 4, 2, 0, 8), OP(1, 30, 19, 3, 2, 0, 8), OP(2, 34, 19, 4, 3, 0, 8), OP(1, 4, 23, 2, 1, 1, 8)) },
  { id: 'pluck', label: 'PLUCK', sprite: 'guitar', note: 60, // everything falls to silence: guitar, harp, kalimba
    voice: voice(2, 4, OP(1, 32, 31, 16, 12, 8, 9), OP(3, 40, 31, 17, 15, 8, 9), OP(1, 28, 31, 15, 10, 8, 9), OP(1, 2, 31, 12, 15, 0, 8)) },
];
// The empty template: one sine wave (operator 4), the modulators silent.
export const BLANK = voice(1, 0, OP(1, 127, 31, 0, 0, 0, 8), OP(1, 127, 31, 0, 0, 0, 8), OP(1, 127, 31, 0, 0, 0, 8), OP(1, 0, 31, 0, 0, 0, 8));

// ---------- knobs ----------
// The operators the colour knobs (brightness, ring) work on: the modulators; with no modulators (algorithm 7) the
// carriers other than the loudest one (the main one), like an organ's upper drawbars.
const mainSlot = (v) => [0, 1, 2, 3].reduce((a, s) => (v.ops[s].tl < v.ops[a].tl ? s : a), 3);
function colourSlots(v) {
  const mods = modulatorSlots(v.alg);
  return mods.length ? mods : [0, 1, 2, 3].filter((s) => s !== mainSlot(v));
}
// How loud a colour operator may get: any level for a modulator; a drawbar no louder than the main one (else the
// four of them clip).
const colourFloor = (v) => (modulatorSlots(v.alg).length ? 0 : v.ops[mainSlot(v)].tl);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Each knob: measure(voice) -> 0..1, and shift(voice, s) for s in -1..1 that moves its registers the same way.
// Setting a knob finds the shift that brings the measure to the wanted value, so the operators keep their differences.
export const KNOBS = [
  { id: 'bright', label: 'BRIGHT', lo: 'DARK', hi: 'BRIGHT', tip: 'Brightness of the modulators',
    measure: (v) => clamp(1 - (Math.min(...colourSlots(v).map((s) => v.ops[s].tl)) - colourFloor(v)) / 96, 0, 1),
    shift: (v, s) => { const lo = colourFloor(v); for (const k of colourSlots(v)) v.ops[k].tl = clamp(v.ops[k].tl - Math.round(s * 127), lo, 127); } },
  { id: 'attack', label: 'ATTACK', lo: 'SOFT', hi: 'SHARP', tip: 'Attack: how fast it starts',
    measure: (v) => clamp((mean(carrierSlots(v.alg).map((s) => v.ops[s].ar)) - 6) / 25, 0, 1),
    shift: (v, s) => { for (const o of v.ops) o.ar = clamp(o.ar + Math.round(s * 31), 6, 31); } },
  { id: 'length', label: 'LENGTH', lo: 'PLUCK', hi: 'HOLD', tip: 'Length: pluck or hold',
    measure: (v) => mean(carrierSlots(v.alg).map((s) => {
      const o = v.ops[s];
      return 0.5 * (1 - o.sl / 15) + 0.3 * (1 - Math.min(o.sr, 16) / 16) + 0.2 * (1 - Math.min(o.dr, 24) / 24);
    })),
    shift: (v, s) => {
      for (const k of carrierSlots(v.alg)) {
        const o = v.ops[k];
        o.sl = clamp(o.sl - Math.round(s * 15), 0, 15);
        o.sr = clamp(o.sr - Math.round(s * 16), 0, 31);
        o.dr = clamp(o.dr - Math.round(s * 24), 0, 31);
        o.rr = clamp(o.rr - Math.round(s * 8), 3, 15);
      }
    } },
  { id: 'ring', label: 'RING', lo: 'PURE', hi: 'METAL', tip: 'Ring: modulator MUL and DT',
    measure: (v) => { const sl = colourSlots(v); return 0.8 * mean(sl.map((s) => v.ops[s].mul)) / 15 + 0.2 * mean(sl.map((s) => Math.abs(dtShown(v.ops[s].dt)))) / 3; },
    shift: (v, s) => {
      for (const k of colourSlots(v)) {
        const o = v.ops[k], d = dtShown(o.dt), mag = clamp(Math.abs(d) + Math.round(s * 3), 0, 3);
        o.mul = clamp(o.mul + Math.round(s * 15), 0, 15);
        o.dt = dtRaw(d < 0 ? -mag : mag);
      }
    } },
  { id: 'dirt', label: 'DIRT', lo: 'CLEAN', hi: 'DIRTY', tip: 'Dirt: feedback of operator 1',
    measure: (v) => v.fb / 7,
    shift: (v, s) => { v.fb = clamp(v.fb + Math.round(s * 7), 0, 7); } },
];
export const knobValue = (k, v) => k.measure(v);
// The voice with knob k set to t (0..1), starting from base.
export function setKnob(k, base, t) {
  const at = (s) => { const v = clone(base); k.shift(v, s); return v; };
  if (k.measure(at(-1)) >= t) return at(-1);
  if (k.measure(at(1)) <= t) return at(1);
  let lo = -1, hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (k.measure(at(m)) < t) lo = m; else hi = m;
  }
  const a = at(lo), b = at(hi);
  return Math.abs(k.measure(a) - t) < Math.abs(k.measure(b) - t) ? a : b;
}
// One notch of the wheel: the next voice the knob makes in that direction (registers are whole numbers).
export function nudgeKnob(k, base, dir) {
  const key = JSON.stringify(base), t0 = k.measure(base);
  for (let t = t0 + dir / 32; t >= -0.05 && t <= 1.05; t += dir / 32) {
    const v = setKnob(k, base, clamp(t, 0, 1));
    if (JSON.stringify(v) !== key) return v;
  }
  return base;
}
// Is the knob meaningful for this voice? (brightness and ring need operators to work on)
export const knobLive = (k, v) => (k.id === 'bright' || k.id === 'ring' ? colourSlots(v).length > 0 : true);

// ---------- Mutate: a small random step, in safe bounds ----------
// The carriers keep their level (the volume does not jump) and a quick enough attack (the sound does not vanish).
export function mutate(v, rnd = Math.random) {
  const n = clone(v), r = (a) => Math.round((rnd() * 2 - 1) * a);
  if (rnd() < 0.4) n.fb = clamp(n.fb + r(1.4), 0, 7);
  n.ops.forEach((o, s) => {
    const car = isCarrier(n.alg, s);
    o.ar = clamp(o.ar + r(2.4), car ? 12 : 6, 31);
    o.dr = clamp(o.dr + r(2.4), 0, 31);
    o.sr = clamp(o.sr + r(1.4), 0, car ? 20 : 31);
    o.sl = clamp(o.sl + r(1.4), 0, 15);
    o.rr = clamp(o.rr + r(1.4), car ? 3 : 1, 15);
    if (!car) {
      o.tl = clamp(o.tl + r(7), 0, 127);
      if (rnd() < 0.3) o.mul = clamp(o.mul + r(1.4), 0, 15);
      if (rnd() < 0.25) o.dt = dtRaw(clamp(dtShown(o.dt) + r(1.4), -3, 3));
    }
  });
  return n;
}

// ---------- the envelope picture ----------
// The level (0 = loudest .. 1 = silent, in 96 dB) of an operator over time: attack, decay to the sustain level, the
// sustain slope while held, then release. Times are rough (the chip's rates double every 4 steps), for drawing only.
const fallTime = (rate) => (rate <= 0 ? Infinity : 118 * 2 ** (-rate / 4)); // seconds for 96 dB at rate 2R+
export function envelope(o, hold = 1, total = 2, n = 64) {
  const pts = [], rate = (r) => (r ? Math.min(63, 2 * r) : 0);
  const aTime = o.ar >= 31 ? 0 : fallTime(rate(o.ar)) / 6; // the attack is curved and quicker than a decay
  const dTime = fallTime(rate(o.dr)), sTime = fallTime(rate(o.sr)), rTime = fallTime(2 * o.rr + 1);
  const slv = o.sl === 15 ? 1 : o.sl * 3 / 96;
  const base = o.tl * 0.75 / 96;
  let relFrom = null;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) ** 2 * total; // more room for the start
    let lv;
    const held = Math.min(t, hold);
    if (held < aTime) lv = 1 - Math.sqrt(held / aTime);
    else {
      const td = held - aTime, toSl = slv ? slv * dTime : 0;
      lv = td < toSl ? td / dTime : slv + (td - toSl) / sTime;
    }
    lv = Math.min(1, lv);
    if (t > hold) { relFrom ??= lv; lv = Math.min(1, relFrom + (t - hold) / rTime); }
    pts.push(Math.min(1, lv + base));
  }
  return pts;
}
