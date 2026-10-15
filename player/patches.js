// FM patch files of other programs -> sounds of ours, and back. Every format is read into one "voice"
// (ALG, FB, AMS, FMS and four operators in register slot order: slot s is at register offset 4*s, i.e. operators
// 1, 3, 2, 4), which becomes ins.regs: [register, value] pairs for channel 0, as in library/sounds.json.
// Formats as published: TFM Music Maker (.tfi), VGM Music Maker (.vgi), DefleMask (.dmp), Furnace (.fui, the
// papers/newIns.md and oldIns.md of its repository), Gens KMod (.y12), ECHO (.eif), GYBuild (.gyb, the
// specification in OPN2BankEditor). VGM / VGZ: the patches a recording keys on.

export const PATCH_EXT = ['tfi', 'vgi', 'dmp', 'fui', 'y12', 'eif', 'gyb', 'vgm', 'vgz'];
const BANKS = ['gyb', 'vgm', 'vgz'];
export const extOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] || '').toLowerCase();
export const isPatchFile = (name) => PATCH_EXT.includes(extOf(name));
const stem = (name) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

// The order of the operator registers in ins.regs (operators 1, 2, 3, 4), as the library writes them.
const SLOT_ORDER = [0, 2, 1, 3];
const OP_REGS = [0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90];

// Detune: the chip's 3 bits are 0..3 up, 4..7 down (4 = 0 again). TFI, VGI, DMP and Furnace count 0..6, 3 = none.
const dtFromMid = (d) => (d >= 3 ? (d - 3) & 3 : 7 - d);
const dtToMid = (r) => (r >= 4 ? 7 - r : r + 3);

const op = (o) => ({ mul: o.mul & 15, dt: o.dt & 7, tl: o.tl & 127, rs: o.rs & 3, ar: o.ar & 31, am: o.am ? 1 : 0, dr: o.dr & 31, sr: o.sr & 31, sl: o.sl & 15, rr: o.rr & 15, ssg: o.ssg & 15 });

// A voice from the chip's own register values: raw[reg] for reg = 0x30.. of channel 0.
function voiceFromRaw(raw) {
  const ops = [0, 1, 2, 3].map((s) => {
    const r = (base) => raw[base + 4 * s] ?? 0;
    return op({
      mul: r(0x30), dt: r(0x30) >> 4, tl: r(0x40), rs: r(0x50) >> 6, ar: r(0x50), am: r(0x60) >> 7, dr: r(0x60),
      sr: r(0x70), sl: r(0x80) >> 4, rr: r(0x80), ssg: r(0x90),
    });
  });
  const b0 = raw[0xb0] ?? 0, b4 = raw[0xb4] ?? 0xc0;
  return { alg: b0 & 7, fb: (b0 >> 3) & 7, ams: (b4 >> 4) & 3, fms: b4 & 7, ops };
}
function rawOfVoice(v) {
  const raw = {};
  v.ops.forEach((o, s) => {
    raw[0x30 + 4 * s] = (o.dt << 4) | o.mul;
    raw[0x40 + 4 * s] = o.tl;
    raw[0x50 + 4 * s] = (o.rs << 6) | o.ar;
    raw[0x60 + 4 * s] = (o.am << 7) | o.dr;
    raw[0x70 + 4 * s] = o.sr;
    raw[0x80 + 4 * s] = (o.sl << 4) | o.rr;
    raw[0x90 + 4 * s] = o.ssg;
  });
  raw[0xb0] = (v.fb << 3) | v.alg;
  raw[0xb4] = 0xc0 | (v.ams << 4) | v.fms; // both speakers: stereo is a note's, not a sound's
  return raw;
}
// ins.regs of a voice, in the library's order.
export function voiceToRegs(v) {
  const raw = rawOfVoice(v), regs = [];
  for (const base of OP_REGS) for (const s of SLOT_ORDER) regs.push([base + 4 * s, raw[base + 4 * s]]);
  regs.push([0xb0, raw[0xb0]], [0xb4, raw[0xb4]]);
  return regs;
}
export function regsToVoice(regs) {
  const raw = {};
  for (const [r, v] of regs) raw[r] = v;
  return voiceFromRaw(raw);
}

// ---------- the formats ----------
class Reader {
  constructor(b) { this.b = b; this.p = 0; }
  u8() { if (this.p >= this.b.length) throw new Error('the file ends too early'); return this.b[this.p++]; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  str(n) { const s = this.b.subarray(this.p, this.p + n); this.p += n; return text(s); }
  cstr() { const e = this.b.indexOf(0, this.p); const s = text(this.b.subarray(this.p, e < 0 ? this.b.length : e)); this.p = e < 0 ? this.b.length : e + 1; return s; }
  need(n) { if (this.b.length - this.p < n) throw new Error('the file ends too early'); }
}
// Names: ASCII, UTF-8 or (Japanese banks) Shift-JIS, up to a 0.
function text(u8) {
  const e = u8.indexOf(0), s = e < 0 ? u8 : u8.subarray(0, e);
  for (const enc of ['utf-8', 'shift_jis']) {
    try { return new TextDecoder(enc, { fatal: true }).decode(s).trim(); } catch (err) { /* the next one */ }
  }
  return new TextDecoder('latin1').decode(s).trim();
}

// TFI: ALG, FB, then per operator MUL, DT, TL, RS, AR, DR, SR, RR, SL, SSG-EG. VGI: the same with AMS/FMS after FB
// and AM in bit 7 of DR.
function readTfi(b, vgi) {
  const R = new Reader(b);
  R.need(vgi ? 43 : 42);
  const alg = R.u8(), fb = R.u8();
  let ams = 0, fms = 0;
  if (vgi) { const x = R.u8(); fms = x & 7; ams = (x >> 4) & 3; }
  const ops = [0, 1, 2, 3].map(() => {
    const mul = R.u8(), dt = dtFromMid(R.u8()), tl = R.u8(), rs = R.u8(), ar = R.u8(), drb = R.u8();
    const sr = R.u8(), rr = R.u8(), sl = R.u8(), ssg = R.u8();
    return op({ mul, dt, tl, rs, ar, am: vgi ? drb >> 7 : 0, dr: drb & 0x7f, sr, rr, sl, ssg });
  });
  return { alg: alg & 7, fb: fb & 7, ams, fms, ops };
}

// DefleMask: version (11 is 1.0 and later), system (11+: 2 Genesis, 9 Neo Geo), mode (1 FM), then FMS, FB, ALG, AMS
// and per operator MUL, TL, AR, DR, SL, RR, AM, RS, DT (DT2 in the high bits), D2R, SSG-EG. Older versions have no
// system and an operator count byte.
function readDmp(b) {
  const R = new Reader(b);
  const ver = R.u8();
  if (ver > 11) throw new Error(`DefleMask instrument version ${ver} is not known`);
  if (ver >= 11) {
    const sys = R.u8();
    if (sys !== 2 && sys !== 9) throw new Error('not a Genesis FM instrument (DefleMask system ' + sys + ')');
  }
  if (ver > 1 && R.u8() !== 1) throw new Error('a DefleMask STD instrument, not FM');
  if (ver < 10) {
    const n = R.u8();
    if (b.length !== 51 && ver > 1 && !n) throw new Error('a 2-operator instrument');
  }
  const fms = ver > 1 ? R.u8() : 0, fb = R.u8(), alg = R.u8(), ams = R.u8();
  const ops = [0, 1, 2, 3].map(() => {
    const mul = R.u8(), tl = R.u8(), ar = R.u8(), dr = R.u8(), sl = R.u8(), rr = R.u8(), am = R.u8(), rs = R.u8();
    const dt = dtFromMid(R.u8() & 15), sr = R.u8(), ssg = R.u8();
    return op({ mul, dt, tl, rs, ar, am, dr, sr, sl, rr, ssg });
  });
  return { alg: alg & 7, fb: fb & 7, ams: ams & 3, fms: fms & 7, ops };
}

// Furnace: "FINS" (features: NA name, FM data) or the older "-Furnace instr.-" with an INST block.
function readFui(b) {
  const R = new Reader(b), magic = R.str(4);
  if (magic === 'FINS') {
    const ver = R.u16(), type = R.u16();
    if (type !== 1) throw new Error(`a Furnace instrument of type ${type}, not FM (OPN)`);
    let name = '', voice = null;
    while (b.length - R.p >= 4) {
      const code = R.str(2), len = R.u16(), end = R.p + len;
      if (code === 'EN') break;
      if (code === 'NA') name = R.cstr();
      else if (code === 'FM') {
        const n = R.u8() & 15;
        const ab = R.u8(), fx = R.u8();
        R.u8(); if (ver >= 224) R.u8();
        if (n < 4) throw new Error('a 2-operator instrument');
        const ops = [0, 1, 2, 3].map(() => {
          const x = [R.u8(), R.u8(), R.u8(), R.u8(), R.u8(), R.u8(), R.u8(), R.u8()];
          return op({ mul: x[0], dt: dtFromMid((x[0] >> 4) & 7), tl: x[1], rs: x[2] >> 6, ar: x[2], am: x[3] >> 7, dr: x[3],
            sr: x[4], sl: x[5] >> 4, rr: x[5], ssg: x[6] });
        });
        voice = { alg: (ab >> 4) & 7, fb: ab & 7, ams: (fx >> 3) & 3, fms: fx & 7, ops };
      }
      R.p = end;
    }
    if (!voice) throw new Error('a Furnace instrument without FM data');
    return { voice, name };
  }
  R.p = 0;
  if (R.str(16) !== '-Furnace instr.-') throw new Error('not a Furnace instrument');
  R.u16(); R.u16(); R.p = R.u32();
  if (R.str(4) !== 'INST') throw new Error('not a Furnace instrument');
  R.u32(); R.u16();
  const type = R.u8(); R.u8();
  if (type !== 1) throw new Error(`a Furnace instrument of type ${type}, not FM (OPN)`);
  const name = R.cstr();
  const alg = R.u8(), fb = R.u8(), fms = R.u8(), ams = R.u8();
  R.u8(); R.u8(); R.u16();
  const ops = [0, 1, 2, 3].map(() => {
    R.need(32);
    const [am, ar, dr, mul, rr, sl, tl, , rs, dt, sr, ssg] = b.subarray(R.p, R.p + 12);
    R.p += 32;
    return op({ mul, dt: dtFromMid(dt), tl, rs, ar, am, dr, sr, sl, rr, ssg });
  });
  return { voice: { alg: alg & 7, fb: fb & 7, ams: ams & 3, fms: fms & 7, ops }, name };
}

// Gens KMod dump (128 bytes): per operator 16 bytes, the first seven its registers 30..90; ALG and FB at 0x40,
// then the game's name (0x50, again at 0x60, 0x70): the patch goes by its file's name.
function readY12(b) {
  if (b.length < 0x60) throw new Error('the file ends too early');
  const raw = {};
  for (let s = 0; s < 4; s++) OP_REGS.forEach((base, k) => { raw[base + 4 * s] = b[s * 16 + k]; });
  raw[0xb0] = ((b[0x41] & 7) << 3) | (b[0x40] & 7);
  return { voice: voiceFromRaw(raw) };
}

// ECHO: B0, then the registers 30..90 of the four operators (29 bytes).
function readEif(b) {
  if (b.length < 29) throw new Error('the file ends too early');
  const raw = { 0xb0: b[0] };
  OP_REGS.forEach((base, k) => { for (let s = 0; s < 4; s++) raw[base + 4 * s] = b[1 + k * 4 + s]; });
  return voiceFromRaw(raw);
}

// GYBuild bank: registers 30..9C, B0 (and B4 from version 2) per patch, names after the patches (v1/v2) or with
// each patch (v3).
function readGyb(b) {
  const R = new Reader(b);
  if (R.u8() !== 26 || R.u8() !== 12) throw new Error('not a GYB bank');
  const ver = R.u8();
  const regsOf = (b4) => {
    const raw = {};
    for (const base of OP_REGS) for (let s = 0; s < 4; s++) raw[base + 4 * s] = R.u8();
    raw[0xb0] = R.u8();
    if (b4) raw[0xb4] = R.u8();
    return voiceFromRaw(raw);
  };
  const out = [];
  if (ver === 1 || ver === 2) {
    const melody = R.u8(), drums = R.u8();
    R.p += 0x100;
    if (ver === 2) R.u8();
    for (let i = 0; i < melody + drums; i++) {
      out.push({ voice: regsOf(ver === 2), drum: i >= melody });
      R.u8(); if (ver === 2) R.u8();
    }
    for (const x of out) x.name = R.str(R.u8());
  } else if (ver === 3) {
    R.u8();
    R.u32();
    const bankAt = R.u32(), mapAt = R.u32();
    R.p = bankAt;
    const end = mapAt > bankAt ? mapAt : b.length - 4; // the maps may come before the banks; a checksum ends the file
    for (let bank = 0; bank < 2 && R.p + 2 <= end; bank++) { // melody, then drums
      const n = R.u16();
      for (let i = 0; i < n; i++) {
        const at = R.p, size = R.u16();
        const voice = regsOf(true);
        R.u8();
        if (R.u8() & 1) R.p += R.u8();
        out.push({ voice, name: R.str(R.u8()), drum: bank === 1 });
        R.p = at + size;
      }
    }
  } else throw new Error(`GYB version ${ver} is not known`);
  return out;
}

// VGM / VGZ: every patch the recording keys on (any of the six channels), once. Patches that differ only in the
// carriers' total level (the volume) count as one; the first of them is kept.
const CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]]; // slots of the carriers per ALG
async function readVgm(b) {
  if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if (text(b.subarray(0, 4)) !== 'Vgm') throw new Error('not a VGM file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ver = dv.getUint32(8, true);
  if (ver >= 0x110 && b.length >= 0x30 && !dv.getUint32(0x2c, true)) throw new Error('the recording has no YM2612');
  let p = ver >= 0x150 && dv.getUint32(0x34, true) ? 0x34 + dv.getUint32(0x34, true) : 0x40;
  const regs = [new Uint8Array(256), new Uint8Array(256)];
  regs[0].fill(0xc0, 0xb4, 0xb7); regs[1].fill(0xc0, 0xb4, 0xb7);
  let dac = false;
  const seen = new Map(), out = [];
  const LEN = (c) => (c >= 0x30 && c <= 0x3f ? 2 : c >= 0x40 && c <= 0x4e ? 3 : c === 0x4f || c === 0x50 ? 2 : c >= 0x51 && c <= 0x5f ? 3
    : c === 0x61 ? 3 : c >= 0x62 && c <= 0x63 ? 1 : c >= 0x70 && c <= 0x8f ? 1 : c === 0x90 || c === 0x91 || c === 0x95 ? 5 : c === 0x92 ? 6
      : c === 0x93 ? 11 : c === 0x94 ? 2 : c >= 0xa0 && c <= 0xbf ? 3 : c >= 0xc0 && c <= 0xdf ? 4 : c >= 0xe0 ? 5 : 1);
  while (p < b.length) {
    const c = b[p];
    if (c === 0x66) break;
    if (c === 0x67) { p += 7 + dv.getUint32(p + 3, true); continue; }
    if (c === 0x52 || c === 0x53) {
      const part = c - 0x52, r = b[p + 1], v = b[p + 2];
      regs[part][r] = v;
      if (part === 0 && r === 0x2b) dac = !!(v & 0x80);
      if (part === 0 && r === 0x28 && (v & 0xf0) && (v & 3) !== 3) {
        const pt = (v >> 2) & 1, c3 = v & 3;
        if (!(dac && pt === 1 && c3 === 2)) { // FM6 plays samples while the DAC is on
          const raw = {};
          for (const base of OP_REGS) for (let s = 0; s < 4; s++) raw[base + 4 * s] = regs[pt][base + 4 * s + c3];
          raw[0xb0] = regs[pt][0xb0 + c3]; raw[0xb4] = regs[pt][0xb4 + c3];
          const voice = voiceFromRaw(raw);
          const key = JSON.stringify({ ...voice, ops: voice.ops.map((o, s) => (CARRIERS[voice.alg].includes(s) ? { ...o, tl: 0 } : o)) });
          if (!seen.has(key)) { seen.set(key, true); out.push({ voice, ch: pt * 3 + c3 + 1 }); }
        }
      }
    }
    p += LEN(c);
  }
  if (!out.length) throw new Error('the recording plays no FM notes');
  return out;
}

// A file -> [{ name, regs }]. bank: true when the file holds a set of patches (the user picks which to keep).
export async function readPatchFile(fileName, bytes) {
  const ext = extOf(fileName), base = stem(fileName);
  let list;
  if (ext === 'tfi') list = [{ voice: readTfi(bytes, false) }];
  else if (ext === 'vgi') list = [{ voice: readTfi(bytes, true) }];
  else if (ext === 'dmp') list = [{ voice: readDmp(bytes) }];
  else if (ext === 'fui') list = [readFui(bytes)];
  else if (ext === 'y12') list = [readY12(bytes)];
  else if (ext === 'eif') list = [{ voice: readEif(bytes) }];
  else if (ext === 'gyb') list = readGyb(bytes);
  else if (ext === 'vgm' || ext === 'vgz') list = (await readVgm(bytes)).map((x, k) => ({ ...x, name: `${base} FM${x.ch} #${k + 1}` }));
  else throw new Error('not a patch file');
  return {
    bank: BANKS.includes(ext),
    patches: list.map((x, k) => ({ name: (x.name || '').trim() || (list.length > 1 ? `${base} ${k + 1}` : base), regs: voiceToRegs(x.voice), drum: !!x.drum })),
  };
}

// ---------- writing ----------
// TFI keeps neither AM nor AMS / FMS (the LFO); everything else comes back as it was.
export function regsToTfi(regs) {
  const v = regsToVoice(regs), out = [v.alg, v.fb];
  for (const o of v.ops) out.push(o.mul, dtToMid(o.dt), o.tl, o.rs, o.ar, o.dr, o.sr, o.rr, o.sl, o.ssg);
  return new Uint8Array(out);
}
// DefleMask 1.0 (version 11), Genesis, FM.
export function regsToDmp(regs) {
  const v = regsToVoice(regs), out = [11, 2, 1, v.fms, v.fb, v.alg, v.ams];
  for (const o of v.ops) out.push(o.mul, o.tl, o.ar, o.dr, o.sl, o.rr, o.am, o.rs, dtToMid(o.dt), o.sr, o.ssg);
  return new Uint8Array(out);
}

// ---------- a picture for a patch, by its name ----------
const SPRITE_WORDS = [
  [/kick|\bbd\b|bass ?drum/i, 'drum'], [/snare|\bsd\b|clap/i, 'snare'], [/hat|\bhh\b/i, 'hihat'], [/cymb|crash|ride/i, 'cymbal'],
  [/\btom/i, 'tom'], [/bass|\bbas\b|\bsub/i, 'cat'], [/bell|chime|glock|celest|vibra/i, 'bell'],
  [/piano|organ|key|clav|\bep\b|rhodes|harpsi/i, 'key'], [/guitar|gtr|dist|pluck|harp|sitar|banjo/i, 'guitar'],
  [/brass|horn|trump|tromb|tuba/i, 'coin'], [/string|\bstr\b|pad|violin|cello|choir/i, 'moon'],
  [/flute|whistl|sax|clarin|oboe|pipe|wind/i, 'bat'], [/lead|synth|saw|square|sqr/i, 'ufo'],
  [/\bfx|laser|zap|noise|explo/i, 'bolt'], [/voice|vox|ghost/i, 'ghost'], [/marimba|xylo|kalimba|mallet/i, 'diamond'],
];
export const guessSprite = (name) => SPRITE_WORDS.find(([re]) => re.test(name))?.[1] || null;
// The note a new sound starts on in the palette (MIDI).
export const guessNote = (name) => (/kick|\bbd\b|bass ?drum/i.test(name) ? 48 : /bass|\bbas\b|\bsub/i.test(name) ? 41 : 60);
