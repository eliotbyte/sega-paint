// FM patches as text (.spp): algorithm, operators and envelopes by the names of the FM editor of Sega Paint.
//   patch "Slap bass"  alg 4  fb 5  ams 0  fms 0  [pan L|R]  [drum 41]
//     op1  mul 1  dt 0  tl 28  ar 31  dr 12  sl 6  sr 4  rr 8  ks 1  am 0  ssg 0
//     op2 ... op3 ... op4 ...
//   note A2                 the sound's own note (what a hit x plays, the pitch the macro is written for)
//   macro base 3/1288       the macro (block / F-number it starts from) and its events in samples:
//   macro 1332 f 2/1179     a frequency, or a register: macro 900 r 0x4c=20
// Operators are numbered as in the FM editor: op1..op4 are register slots 0, 2, 1, 3 (fmedit.js OP_OF_SLOT).
import fs from 'node:fs';
import path from 'node:path';
import { prepareSong, buildTimeline, fmHz, hzMidi } from '../player/engine/song.js';
import { writeSound, readSoundFile } from '../player/soundfile.js';
import { findSound, fetchRef, baseRef, parseNote, noteName, renderTimeline, UserError, KIT, RATE, spriteName, readText, noBom } from './core.mjs';
import { summarize } from './analyze.mjs';

// ---------- voices: the same as player/patches.js (voiceFromRaw, rawOfVoice, voiceToRegs, regsToVoice) ----------
const SLOT_ORDER = [0, 2, 1, 3]; // the library's order of the operator registers
const OP_REGS = [0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90];
const op = (o) => ({ mul: o.mul & 15, dt: o.dt & 7, tl: o.tl & 127, rs: o.rs & 3, ar: o.ar & 31, am: o.am ? 1 : 0, dr: o.dr & 31, sr: o.sr & 31, sl: o.sl & 15, rr: o.rr & 15, ssg: o.ssg & 15 });
export function regsToVoice(regs) {
  const raw = {};
  for (const [r, v] of regs) raw[r] = v;
  const ops = [0, 1, 2, 3].map((s) => {
    const r = (base) => raw[base + 4 * s] ?? 0;
    return op({ mul: r(0x30), dt: r(0x30) >> 4, tl: r(0x40), rs: r(0x50) >> 6, ar: r(0x50), am: r(0x60) >> 7, dr: r(0x60), sr: r(0x70), sl: r(0x80) >> 4, rr: r(0x80), ssg: r(0x90) });
  });
  const b0 = raw[0xb0] ?? 0, b4 = raw[0xb4] ?? 0xc0;
  return { alg: b0 & 7, fb: (b0 >> 3) & 7, ams: (b4 >> 4) & 3, fms: b4 & 7, ops };
}
export function voiceToRegs(v) {
  const raw = {};
  v.ops.forEach((o, s) => {
    raw[0x30 + 4 * s] = (o.dt << 4) | o.mul; raw[0x40 + 4 * s] = o.tl; raw[0x50 + 4 * s] = (o.rs << 6) | o.ar;
    raw[0x60 + 4 * s] = (o.am << 7) | o.dr; raw[0x70 + 4 * s] = o.sr; raw[0x80 + 4 * s] = (o.sl << 4) | o.rr; raw[0x90 + 4 * s] = o.ssg;
  });
  raw[0xb0] = (v.fb << 3) | v.alg;
  raw[0xb4] = 0xc0 | (v.ams << 4) | v.fms;
  const regs = [];
  for (const base of OP_REGS) for (const s of SLOT_ORDER) regs.push([base + 4 * s, raw[base + 4 * s]]);
  regs.push([0xb0, raw[0xb0]], [0xb4, raw[0xb4]]);
  return regs;
}
const VOICE_REGS = new Set(voiceToRegs(regsToVoice([])).map(([r]) => r));
// The bits the chip reads; the rest of a register is ignored (some game patches have junk there).
export const USED_BITS = { 0x30: 0x7f, 0x40: 0x7f, 0x50: 0xdf, 0x60: 0x9f, 0x70: 0x1f, 0x80: 0xff, 0x90: 0x0f, 0xb0: 0x3f, 0xb4: 0xf7 };
export const usedBits = (r, v) => v & (USED_BITS[r >= 0xb0 ? r : r & 0xf0] ?? 0xff);

// ---------- algorithms: as player/fmedit.js (CAR, ALG_GRAPH, OP_OF_SLOT, dtShown / dtRaw, ssgShown / ssgRaw) ----------
export const OP_OF_SLOT = [1, 3, 2, 4], SLOT_OF_OP = [0, 2, 1, 3];
const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]]; // slots heard, per algorithm
export const carrierOps = (alg) => CAR[alg & 7].map((s) => OP_OF_SLOT[s]).sort();
export const ALG_LINKS = [ // who feeds whom (operators 1..4, 0 = the output)
  [[1, 2], [2, 3], [3, 4], [4, 0]], [[1, 3], [2, 3], [3, 4], [4, 0]], [[1, 4], [2, 3], [3, 4], [4, 0]], [[1, 2], [2, 4], [3, 4], [4, 0]],
  [[1, 2], [3, 4], [2, 0], [4, 0]], [[1, 2], [1, 3], [1, 4], [2, 0], [3, 0], [4, 0]], [[1, 2], [2, 0], [3, 0], [4, 0]], [[1, 0], [2, 0], [3, 0], [4, 0]],
];
export const dtShown = (raw) => (raw >= 4 ? -(raw - 4) : raw);
export const dtRaw = (k) => (k < 0 ? 4 - k : k);
export const ssgShown = (raw) => (raw & 8 ? (raw & 7) + 1 : 0);
export const ssgRaw = (k) => (k ? 8 | (k - 1) : 0);

// the fields of an operator line, in the FM editor's order, with their ranges (shown values)
export const OPF = [['mul', 0, 15], ['dt', -3, 3], ['tl', 0, 127], ['ar', 0, 31], ['dr', 0, 31], ['sl', 0, 15], ['sr', 0, 31], ['rr', 0, 15], ['ks', 0, 3], ['am', 0, 1], ['ssg', 0, 8]];
export const ALIAS = { d1r: 'dr', d2r: 'sr', rs: 'ks', d1l: 'sl', ml: 'mul', ssgeg: 'ssg' };
const FM_C4 = [3, 1288]; // app.js: block / F-number of C4, the base of a new patch's macro

// ---------- .spp text ----------
const hex = (v) => '0x' + v.toString(16).padStart(2, '0');
export function writeSpp(rec) {
  const v = regsToVoice(rec.ins.regs), b4 = rec.ins.regs.find(([r]) => r === 0xb4)?.[1] ?? 0xc0;
  const pan = { 0x80: 'L', 0x40: 'R', 0x00: 'off' }[b4 & 0xc0];
  const o = [];
  o.push(`# ${rec.type === 'drums' ? 'FM drum' : 'FM sound'} for Sega Paint. ${rec.key ? `From the library: ${rec.key}. ` : ''}sp patch explain / hear / save work on this file.`);
  o.push(`patch "${(rec.name || 'Sound').replace(/"/g, "'")}"  alg ${v.alg}  fb ${v.fb}  ams ${v.ams}  fms ${v.fms}${pan ? `  pan ${pan}` : ''}${rec.type === 'drums' ? `  drum ${rec.gm}` : ''}`);
  for (let k = 1; k <= 4; k++) {
    const x = v.ops[SLOT_OF_OP[k - 1]];
    const shown = { mul: x.mul, dt: dtShown(x.dt), tl: x.tl, ar: x.ar, dr: x.dr, sl: x.sl, sr: x.sr, rr: x.rr, ks: x.rs, am: x.am, ssg: ssgShown(x.ssg) };
    o.push(`  op${k}  ` + OPF.map(([f]) => `${f} ${String(f === 'dt' && shown.dt > 0 ? '+' + shown.dt : shown[f]).padEnd(f === 'tl' ? 3 : 2)}`).join('  ').trimEnd());
  }
  o.push(`  # carriers (heard): ${carrierOps(v.alg).map((k) => 'op' + k).join(', ')}; links: ${ALG_LINKS[v.alg].map(([a, b]) => `${a}>${b || 'out'}`).join(' ')}`);
  if (rec.p != null) o.push(`note ${noteName(rec.p)}`);
  if (rec.sprite) o.push(`icon ${rec.sprite}`);
  if ((rec.ins.ops ?? 0xf0) !== 0xf0) o.push(`keyon ${hex(rec.ins.ops)}`);
  for (const [r, val] of rec.ins.regs) if (!VOICE_REGS.has(r)) o.push(`reg ${hex(r)}=${val}`);
  const mac = rec.mac || { base: FM_C4, ev: [] };
  if (JSON.stringify(mac.base) !== JSON.stringify(FM_C4) || mac.ev.length) {
    o.push(`macro base ${mac.base[0]}/${mac.base[1]}   # ${noteName(Math.round(hzMidi(fmHz(mac.base[0], mac.base[1]))))}`);
    for (const e of mac.ev) o.push(e[1] === 'f' ? `macro ${e[0]} f ${e[2]}/${e[3]}` : `macro ${e[0]} ${e[1]} ${hex(e[2])}=${e[3]}`);
  }
  return o.join('\n') + '\n';
}

export function parseSpp(text, file = 'patch.spp') {
  const E = (l, c, msg, hint) => new UserError(`${file}:${l}:${c}: ${msg}${hint ? `\n  hint: ${hint}` : ''}`);
  const rec = { type: 'fm', name: 'Sound', sprite: null, p: null, ins: { regs: null, ops: 0xf0 }, mac: { base: FM_C4.slice(), ev: [] } };
  const v = { alg: 0, fb: 0, ams: 0, fms: 0, ops: [0, 1, 2, 3].map(() => op({ mul: 1, dt: 0, tl: 127, rs: 0, ar: 31, am: 0, dr: 0, sr: 0, sl: 0, rr: 15, ssg: 0 })) };
  let pan = 0xc0, head = false;
  const seenOp = new Set(), extra = [];
  const lines = noBom(text).replace(/\r/g, '').split('\n'); // a BOM first is not text
  lines.forEach((raw, i) => {
    const L = i + 1, line = raw.replace(/(^|\s)#.*$/, '');
    const w = [];
    line.replace(/"[^"]*"|\S+/g, (m, at) => { w.push({ t: m, c: at + 1 }); return m; });
    if (!w.length) return;
    const num = (x, lo, hi, what) => {
      let n = x?.t === 'on' ? 1 : x?.t === 'off' ? 0 : +x?.t;
      if (!x || !Number.isInteger(n) || n < lo || n > hi) throw E(L, x?.c ?? w[0].c, `${what}: ${x ? `"${x.t}"` : 'no value'}, expected ${lo}..${hi}`);
      return n;
    };
    const k = w[0].t;
    if (k === 'patch') {
      head = true;
      for (let j = 1; j < w.length; j++) {
        const t = w[j].t;
        if (t.startsWith('"')) { rec.name = t.slice(1, -1).slice(0, 24) || 'Sound'; continue; }
        const val = w[++j];
        if (t === 'alg') v.alg = num(val, 0, 7, 'alg');
        else if (t === 'fb') v.fb = num(val, 0, 7, 'fb');
        else if (t === 'ams') v.ams = num(val, 0, 3, 'ams');
        else if (t === 'fms') v.fms = num(val, 0, 7, 'fms');
        else if (t === 'pan') { const p = { L: 0x80, R: 0x40, C: 0xc0, off: 0 }[val?.t]; if (p == null) throw E(L, (val || w[j - 1]).c, 'pan: L, C or R'); pan = p; }
        else if (t === 'drum') { rec.type = 'drums'; rec.gm = num(val, 35, 81, 'drum (General MIDI note)'); }
        else throw E(L, w[j - 1].c, `unknown word "${t}"`, 'patch "Name" alg 0..7 fb 0..7 ams 0..3 fms 0..7 [pan L|R] [drum 41]');
      }
      return;
    }
    let m;
    if ((m = /^op([1-4])$/.exec(k))) {
      const x = v.ops[SLOT_OF_OP[+m[1] - 1]];
      seenOp.add(+m[1]);
      for (let j = 1; j < w.length; j += 2) {
        const f = ALIAS[w[j].t] || w[j].t, def = OPF.find(([n]) => n === f);
        if (!def) throw E(L, w[j].c, `unknown operator field "${w[j].t}"`, OPF.map(([n]) => n).join(' '));
        const n = num(w[j + 1], def[1], def[2], `op${m[1]} ${f}`);
        if (f === 'dt') x.dt = dtRaw(n); else if (f === 'ssg') x.ssg = ssgRaw(n); else if (f === 'ks') x.rs = n; else x[f] = n;
      }
      return;
    }
    if (k === 'note') { const p = parseNote(w[1]?.t || ''); if (p == null) throw E(L, (w[1] || w[0]).c, 'note: a note name like A2 or C#4'); rec.p = p; return; }
    if (k === 'icon') { rec.sprite = spriteName(w[1]?.t); return; }
    if (k === 'keyon') { rec.ins.ops = num({ ...w[1], t: String(parseInt(w[1]?.t)) }, 0, 255, 'keyon'); return; }
    if (k === 'reg') {
      const mm = /^(0x[0-9a-f]+|\d+)=(\d+)$/i.exec(w[1]?.t || '');
      if (!mm) throw E(L, (w[1] || w[0]).c, 'reg 0x22=8');
      extra.push([parseInt(mm[1]), +mm[2]]);
      return;
    }
    if (k === 'macro') {
      if (w[1]?.t === 'base') {
        const mm = /^(\d)\/(\d+)$/.exec(w[2]?.t || '');
        if (!mm) throw E(L, (w[2] || w[1]).c, 'macro base block/fnum, e.g. 3/1288');
        rec.mac.base = [+mm[1], +mm[2]];
        return;
      }
      const t = +w[1]?.t, type = w[2]?.t;
      if (!(t >= 0)) throw E(L, (w[1] || w[0]).c, 'macro <samples> f <block>/<fnum>  or  macro <samples> r <reg>=<value>');
      if (type === 'f') { const mm = /^(\d)\/(\d+)$/.exec(w[3]?.t || ''); if (!mm) throw E(L, (w[3] || w[2]).c, 'f block/fnum'); rec.mac.ev.push([t, 'f', +mm[1], +mm[2]]); }
      else { const mm = /^(0x[0-9a-f]+|\d+)=(\d+)$/i.exec(w[3]?.t || ''); if (!type || !mm) throw E(L, (w[3] || w[2] || w[1]).c, 'r reg=value'); rec.mac.ev.push([t, type, parseInt(mm[1]), +mm[2]]); }
      return;
    }
    throw E(L, w[0].c, `unknown line "${k}"`, 'patch, op1..op4, note, icon, macro, reg, keyon');
  });
  if (!head) throw E(1, 1, 'no patch line', 'patch "Name" alg 4 fb 5 ams 0 fms 0');
  if (seenOp.size < 4) throw E(lines.length, 1, `operators missing: ${[1, 2, 3, 4].filter((k) => !seenOp.has(k)).map((k) => 'op' + k).join(', ')}`);
  const regs = voiceToRegs(v).map(([r, val]) => [r, r === 0xb4 ? (val & 0x3f) | pan : val]);
  rec.ins.regs = [...regs, ...extra];
  if (rec.p == null) rec.p = rec.type === 'drums' ? 60 : Math.round(hzMidi(fmHz(rec.mac.base[0], rec.mac.base[1])));
  rec.sprite ??= rec.type === 'drums' ? KIT[rec.gm]?.sprite || 'cymbal' : 'star';
  return rec;
}
export const readSpp = (file) => {
  if (!fs.existsSync(file)) throw new UserError(`no such file: ${file}`);
  return parseSpp(readText(file), file);
};
// a .spp as a sound of a .sps (sound bass = "bass.spp"): a My sounds record, the key by its file
export const sppSound = (file) => ({ ...readSpp(file), my: true, game: 'My sounds', key: 'my:' + path.basename(file).replace(/\.[^.]+$/, '') });

// A sound record from a library key, a .spsound / .spkit (first FM sound), or a .spp
export function soundRecord(ref) {
  if (/\.spp$/i.test(ref)) return { ...readSpp(ref), file: ref };
  if (/\.(spsound|spkit)$/i.test(ref)) {
    if (!fs.existsSync(ref)) throw new UserError(`no such file: ${ref}`);
    const res = readSoundFile(path.basename(ref), readText(ref), 11300);
    const rec = res.sounds.find((x) => x.ins);
    if (!rec) throw new UserError(`${ref}: no FM sound in it`);
    return rec;
  }
  const c = findSound(ref);
  if (!c) throw new UserError(`no sound "${ref}" in the library (sp sounds --kind fm)`);
  if (!c.ins) throw new UserError(`"${ref}" is not an FM sound (it is ${c.type})`);
  return { type: c.type, name: c.type === 'drums' ? KIT[c.gm]?.name || c.name || 'Drum' : c.name, sprite: c.sprite, ins: structuredClone(c.ins), mac: structuredClone(c.mac), p: c.p, gm: c.gm, key: c.key };
}

// The record a .spsound gets (writeSound of soundfile.js), as the app's FM editor saves an FM sound
export function sppToSound(rec, name) {
  const out = { type: rec.type, name: (name || rec.name).slice(0, 24), sprite: rec.sprite, ins: rec.ins, mac: rec.mac, p: rec.p };
  if (rec.type === 'drums') out.gm = rec.gm;
  return writeSound(out, fetchRef(baseRef()).mixRate);
}

// ---------- rendering one note of a patch (as app.js previewPatch: the patch alone on FM1) ----------
const GLOBALS = () => fetchRef(baseRef()).globals.filter((x) => x[0] <= 0).map((x) => [0, x[1], x[2], x[3]]);
let globals = null;
export function renderPatch(rec, p, { hold = 1, release = 0.6, lfo = null } = {}) {
  globals ??= GLOBALS();
  const g = lfo != null ? [...globals, [0, 0, 0x22, lfo]] : globals;
  const d = Math.round(hold * RATE), end = d + Math.round(release * RATE);
  const song = prepareSong({
    title: 'patch', rate: RATE, step: RATE / 8, stepTimes: [0, RATE / 8], step0: 0, end, loopStart: -1, globals: g,
    instruments: [{ regs: rec.ins.regs, ops: rec.ins.ops ?? 0xf0 }], macros: [structuredClone(rec.mac)],
    layers: [{ kind: 'fm', ch: 0, notes: [{ s: 0, n: 0, d, p, i: 0, m: 0 }] }],
  });
  const tl = buildTimeline(song, new Uint8Array(0));
  const [L, R] = renderTimeline(tl, 0, end / RATE);
  return L.map((x, i) => (x + R[i]) / 2); // mono: a patch panned to one side is not half as loud
}

// ---------- explain: the patch in words ----------
// Rough times of the chip's envelope at C4 without key scaling, measured on the engine (llm/out calibration):
// decay / sustain rate 30 dB, release 30 dB, attack to 3 dB under the peak.
const tDecay = (r) => (r ? 3.98 * 2 ** (-(r - 8) * 0.42) : Infinity);
const tRelease = (r) => 3.29 * 2 ** (-(r - 4));
const tAttack = (r) => (r >= 26 ? 0 : r ? 0.29 * 2 ** (-(r - 10) / 2) : Infinity);
const secs = (t) => (t === Infinity ? 'never' : t >= 1 ? `~${t.toFixed(1)} s` : `~${Math.max(1, Math.round(t * 1000))} ms`);
const mulOf = (o) => (o.mul || 0.5);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function ratio(a, b) { // a:b in whole numbers (mul 0 is x0.5)
  const x = Math.round(a * 2), y = Math.round(b * 2), g = gcd(x, y);
  return [x / g, y / g];
}
const INTERVAL = { 1: 'at the note', 2: 'an octave up', 3: 'an octave and a fifth up', 4: 'two octaves up', 5: 'two octaves and a third up', 6: 'two octaves and a fifth up', 8: 'three octaves up' };
function envWords(o) {
  const a = tAttack(o.ar), sl = o.sl === 15 ? 'silence' : `−${o.sl * 3} dB`;
  const parts = [o.ar >= 26 ? 'starts at once' : `swells in ${secs(a)}`];
  if (o.dr && o.sl) parts.push(`falls to ${sl} (DR ${o.dr}: 30 dB in ${secs(tDecay(o.dr))})`);
  else if (!o.dr && o.sl) parts.push('no decay (DR 0)');
  parts.push(o.sr ? `then keeps fading (SR ${o.sr}: 30 dB in ${secs(tDecay(o.sr))})` : 'then holds while the key is down');
  parts.push(`release ${secs(tRelease(o.rr))} for 30 dB (RR ${o.rr})`);
  if (o.rs) parts.push(`key scaling ${o.rs}: shorter up high`);
  if (o.ssg) parts.push(`SSG-EG ${ssgShown(o.ssg)}: a repeating envelope`);
  return parts.join(', ');
}
const depth = (tl) => (tl <= 12 ? 'very deep (harsh, noisy)' : tl <= 24 ? 'deep (bright, buzzy)' : tl <= 36 ? 'medium (clearly coloured)' : tl <= 50 ? 'light (a little colour)' : tl <= 70 ? 'faint' : 'off (TL > 70 is silent)');

export function explainPatch(rec) {
  const v = regsToVoice(rec.ins.regs), O = (k) => v.ops[SLOT_OF_OP[k - 1]];
  const car = carrierOps(v.alg), links = ALG_LINKS[v.alg].filter(([, b]) => b);
  const o = [];
  o.push(`"${rec.name}"${rec.type === 'drums' ? ` (FM drum, General MIDI ${rec.gm})` : ''}: algorithm ${v.alg} - ${links.length ? links.map(([a, b]) => `op${a} > op${b}`).join(', ') + '; ' : ''}heard: ${car.map((k) => 'op' + k).join(', ')}${car.length === 4 ? ' (four sines added, like organ drawbars)' : ''}`);
  if (v.fb) o.push(`  feedback ${v.fb} on op1: ${v.fb <= 3 ? 'a little brighter' : v.fb <= 5 ? 'saw-like buzz' : 'gritty, noisy'}${car.includes(1) ? ' (op1 is heard itself)' : ''}`);
  for (const [a, b] of links) {
    const m = O(a), c = O(b), [p, q] = ratio(mulOf(m), mulOf(c)), r = `${p}:${q}`;
    // any whole-number ratio gives harmonics of (carrier / q): q = 1 keeps the pitch, a bigger q adds a lower one
    const kind = q === 1 ? (p === 1 ? 'same pitch: all harmonics, warm to brassy' : p === 2 ? 'odd harmonics first: hollow, square-like' : p <= 4 ? 'overtones from the 3rd up: bright, reedy' : 'high overtones only: glassy, bell-like when deep')
      : p === 1 ? `the modulator is ${q}x lower: a sub tone ${q === 2 ? 'an octave' : q === 4 ? 'two octaves' : `1/${q}`} under the note, growly`
        : `harmonics of 1/${q} of the note: clangy, metallic, bell`;
    const dts = dtShown(m.dt) || dtShown(c.dt) ? `, detune ${dtShown(m.dt)}/${dtShown(c.dt)}` : '';
    o.push(`  op${a} modulates op${b}: ratio ${r} (${kind})${dts}; depth ${depth(m.tl)} (TL ${m.tl})`);
    o.push(`    op${a}'s envelope shapes the colour: ${envWords(m)}`);
  }
  for (const k of car) {
    const c = O(k), mul = mulOf(c);
    const pitch = mul === 0.5 ? 'an octave below the note' : INTERVAL[mul] || `${mul}x the note (another note than the one played)`;
    o.push(`  op${k} is heard: level ${c.tl === 0 ? 'full' : `−${(c.tl * 0.75).toFixed(0)} dB`} (TL ${c.tl}), ${pitch}${dtShown(c.dt) ? `, detune ${dtShown(c.dt)}` : ''}`);
    o.push(`    envelope: ${envWords(c)}`);
  }
  const lfo = [v.ams ? `tremolo depth ${v.ams} on ops ${[1, 2, 3, 4].filter((k) => O(k).am).join(',') || '(none has AM on)'}` : '', v.fms ? `vibrato depth ${v.fms}` : ''].filter(Boolean);
  if (lfo.length) o.push(`  LFO: ${lfo.join(', ')} (heard only if the song turns the LFO on: register 0x22)`);
  const b4 = rec.ins.regs.find(([r]) => r === 0xb4)?.[1] ?? 0xc0;
  if ((b4 & 0xc0) !== 0xc0) o.push(`  pan: ${(b4 & 0xc0) === 0x80 ? 'left only' : (b4 & 0xc0) === 0x40 ? 'right only' : 'no speaker (silent!)'} (a note's own pan overrides it)`);
  // measured
  const p = rec.p ?? 60, hold = 1;
  const s = summarize(renderPatch(rec, p, { hold, release: 1 }), { hold, f0: 0 });
  if (s.silent) { o.push(`  measured at ${noteName(p)}: SILENT - the carriers are at TL 127 or never start (AR 0)`); return o.join('\n'); }
  const ch = s.attack > 200 ? `a slow swell (attack ~${s.attack} ms, pad-like)` : s.decay != null && s.decay < 150 ? `a pluck / hit: gone to −20 dB in ~${s.decay} ms` : s.decay != null && s.decay < 700 ? `a struck note: −20 dB after ~${s.decay} ms` : s.decay != null ? `a slow fade (−20 dB after ~${s.decay} ms)` : 'a held tone (organ / pad: stays while the key is down)';
  const heard = s.cents.filter(Boolean), c0 = heard[0], c1 = heard.at(-1);
  const tone = c1 < c0 * 0.7 ? 'darkens as it goes (the modulators fade)' : c1 > c0 * 1.3 ? 'brightens as it goes (the modulators swell)' : 'keeps its colour';
  const rel = s.sustain < s.peak - 50 ? 'gone before the key is up' : `release ${s.release != null ? s.release + ' ms' : 'over 1 s'}`;
  o.push(`  measured at ${noteName(p)}, held 1 s: ${ch}; attack ${s.attack} ms, peak ${Math.round(s.peak)} dBFS, ${rel}; ${tone} (${s.times.map((t, i) => `${Math.round(t * 1000)} ms ${s.cents[i] ? Math.round(s.cents[i]) + ' Hz' : 'silent'}`).join(' > ')})`);
  return o.join('\n');
}
