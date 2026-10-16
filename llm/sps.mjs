// .sps: a song as text (structure, harmony, repeats) -> a song.json Sega Paint opens with Import.
// The syntax is in llm/README.md. Sounds are copied into the song the way app.js does it (addCatalogSound,
// addCatalogSample, libSound), so the file needs nothing but its base example and the library.
import fs from 'node:fs';
import path from 'node:path';
import { stepTime, timeToStep, MELODIC_VOICE } from '../player/engine/song.js';
import { readSoundFile } from '../player/soundfile.js';
import { sppSound } from './patch.mjs';
import { findSound, fetchRef, fetchBank, refList, baseRef, parseNote, voiceSpec, voiceOf, KIT, soundName, spriteName, spritePool, macroPitch, STEPS_PER_BAR, UserError, readText, noBom } from './core.mjs';

export class SpsError extends UserError {
  constructor(file, line, col, msg, hint = '') {
    super(`${file}:${line}:${col}: ${msg}${hint ? `\n  hint: ${hint}` : ''}`);
    Object.assign(this, { line, col, hint });
  }
}

// ---------- parsing ----------
const SCALE_WORDS = { major: 'major', maj: 'major', minor: 'minor', min: 'minor', 'major-pent': 'mpent', 'minor-pent': 'npent', blues: 'blues', dorian: 'dorian', mixolydian: 'mixo', phrygian: 'phryg', 'harmonic-minor': 'harmin' };
const ATTRS = ['vol', 'pan', 'slide'];
const EXACT = ['d', 'n', 'm', 'i', 'smp', 'md', 'gm', 'p', 'e', 's', 'S'];

// Words of a line with their columns (1-based); a quoted string is one word (q: true); # after a space starts a comment.
function words(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '#') break;
    if (c === '"') {
      const j = text.indexOf('"', i + 1);
      if (j < 0) return { out, bad: i + 1 };
      out.push({ t: text.slice(i + 1, j), col: i + 1, q: true });
      i = j + 1; continue;
    }
    let j = i;
    while (j < text.length && !' \t'.includes(text[j])) { // F#3 keeps its #; a word starting with # is a comment
      if (text[j] === '{') { const k = text.indexOf('}', j); j = k < 0 ? text.length : k + 1; } else j++;
    }
    out.push({ t: text.slice(i, j), col: i + 1 });
    i = j;
  }
  return { out };
}

export function parseSps(text, file = 'song.sps') {
  const E = (line, col, msg, hint) => new SpsError(file, line, col, msg, hint);
  const ast = { file, title: null, bpm: null, meter: [4, 4], grid: 16, base: null, bars: null, key: null, sounds: new Map(), tracks: new Map(), patterns: new Map(), sections: new Map(), arrange: null, loop: null, exact: null };
  const lines = noBom(text).replace(/\r/g, '').split('\n'); // a BOM first is not text
  let pat = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln], L = ln + 1;
    const { out: w, bad } = words(raw);
    if (bad) throw E(L, bad, 'a quote is not closed');
    if (!w.length) continue;
    const indented = /^[ \t]/.test(raw);
    if (indented && pat) { parsePatternLine(pat, w, L, E); continue; }
    if (indented) throw E(L, w[0].col, 'an indented line outside a pattern', 'pattern lines go under "pattern name bars:"');
    pat = null;
    const k = w[0].t.replace(/:$/, '');
    if (k === 'exact') { // section 3: the exact data of an imported song, JSON up to the end of the file
      const rest = lines.slice(ln).join('\n').replace(/^\s*exact:?/, '');
      try { ast.exact = JSON.parse(rest); } catch (e) { throw E(L, 1, `exact: is not JSON (${e.message})`); }
      break;
    }
    if (['song', 'bpm', 'grid', 'base', 'bars', 'key', 'offset'].includes(k) || /^\d+\/\d+$/.test(k)) { parseHeader(ast, w, L, E); continue; }
    if (k === 'sound') { parseSound(ast, w, L, E); continue; }
    if (k === 'track') {
      const v = w[1] && voiceSpec(w[1].t);
      if (!v || !w[2]) throw E(L, w[0].col, 'track: a voice and a name', 'track FM1 "Slap bass"');
      ast.tracks.set(w[1].t.toUpperCase(), { name: w[2].t, line: L });
      continue;
    }
    if (k === 'pattern') {
      const m = w.length >= 2 && /^([A-Za-z_][\w-]*)$/.exec(w[1].t);
      if (!m) throw E(L, (w[1] || w[0]).col, 'pattern needs a name', 'pattern groove 2:   (2 = its length in bars)');
      const name = m[1];
      if (ast.patterns.has(name) || ast.sections.has(name)) throw E(L, w[1].col, `"${name}" is defined twice`);
      const lenW = w[2];
      const bars = lenW ? +lenW.t.replace(/:$/, '') : 1;
      if (!(bars > 0) || !Number.isInteger(bars)) throw E(L, lenW.col, `pattern length "${lenW.t}" is not a whole number of bars`);
      if (w.length > 3) throw E(L, w[3].col, 'nothing goes after the pattern length');
      pat = { name, bars, line: L, voices: [], attrs: [] };
      ast.patterns.set(name, pat);
      continue;
    }
    if (k === 'section') {
      const name = w[1]?.t;
      if (!name || !/^[A-Za-z_][\w-]*$/.test(name)) throw E(L, (w[1] || w[0]).col, 'section needs a name', 'section verse = groove x2, fill');
      if (w[2]?.t !== '=') throw E(L, (w[2] || w[1]).col, 'expected "=" after the section name');
      if (ast.patterns.has(name) || ast.sections.has(name)) throw E(L, w[1].col, `"${name}" is defined twice`);
      ast.sections.set(name, { name, items: parseItems(w.slice(3), L, E), line: L });
      continue;
    }
    if (k === 'arrange') { ast.arrange = { items: parseItems(w.slice(1), L, E), line: L }; continue; }
    if (k === 'loop') {
      const a = w.slice(1);
      if (a[0]?.t === 'bar' && a[1]) ast.loop = { bar: +a[1].t, line: L, col: a[1].col };
      else if (a[0]?.t === 'off' || a[0]?.t === 'none') ast.loop = { off: true };
      else if (a[0]) ast.loop = { name: a[0].t, line: L, col: a[0].col };
      else throw E(L, w[0].col, 'loop: a section name or "bar N"');
      continue;
    }
    throw E(L, w[0].col, `unknown statement "${w[0].t}"`, 'song, bpm, base, key, sound, track, pattern, section, arrange, loop');
  }
  if (!ast.bpm) throw E(1, 1, 'no tempo', 'song "Title" bpm 140 4/4 grid 16');
  return ast;
}

function parseHeader(ast, w, L, E) {
  for (let i = 0; i < w.length; i++) {
    const t = w[i].t;
    const val = () => { const x = w[++i]; if (!x) throw E(L, w[i - 1].col, `${t} needs a value`); return x; };
    if (t === 'song') { const x = val(); ast.title = x.t; }
    else if (t === 'offset') { const x = val(); ast.offset = +x.t; if (!(ast.offset >= 0 && ast.offset < 16)) throw E(L, x.col, `offset ${x.t}: steps before bar 1, 0..15`); }
    else if (t === 'bpm') { const x = val(); ast.bpm = +x.t; ast.bpmAt = { line: L, col: x.col }; if (!(ast.bpm >= 20 && ast.bpm <= 400)) throw E(L, x.col, `bpm ${x.t}: 20..400`); }
    else if (t === 'grid') { const x = val(); ast.grid = +x.t; if (!(Number.isInteger(ast.grid) && ast.grid >= 1 && ast.grid <= 64)) throw E(L, x.col, `grid ${x.t}: steps per bar, a whole number (16 = sixteenths)`); }
    else if (t === 'base') { const x = val(); ast.base = { name: x.t, line: L, col: x.col }; }
    else if (t === 'bars') { const x = val(); ast.bars = +x.t; if (!(Number.isInteger(ast.bars) && ast.bars > 0)) throw E(L, x.col, `bars ${x.t}: a whole number`); }
    else if (t === 'key') {
      const r = val(), s = val();
      const root = parseNote(r.t + '4');
      const id = SCALE_WORDS[s.t.toLowerCase()];
      if (root == null) throw E(L, r.col, `key: "${r.t}" is not a note name`, 'key A minor');
      if (!id) throw E(L, s.col, `key: unknown scale "${s.t}"`, Object.keys(SCALE_WORDS).join(', '));
      ast.key = { id, root: root % 12 };
    } else if (/^\d+\/\d+$/.test(t)) {
      ast.meter = t.split('/').map(Number);
      if (ast.meter[0] !== 4 || ast.meter[1] !== 4) throw E(L, w[i].col, `meter ${t}: only 4/4`, 'Sega Paint draws a bar every 16 steps; write 3/4 music as 4/4 bars or with a grid of 12');
    } else throw E(L, w[i].col, `unknown header word "${t}"`, 'song "Title" bpm 140 4/4 grid 16');
  }
}

function parseSound(ast, w, L, E) {
  // sound name = "key" | "file.spsound" | "file.spp"
  if (w.length !== 4 || w[2].t !== '=') throw E(L, w[0].col, 'sound name = "key"', 'keys come from: sp sounds');
  const name = w[1].t;
  if (!/^[A-Za-z_][\w-]*$/.test(name)) throw E(L, w[1].col, `"${name}" is not a sound name (letters, digits, _ and -)`);
  if (ast.sounds.has(name)) throw E(L, w[1].col, `sound "${name}" is defined twice`);
  ast.sounds.set(name, { name, ref: w[3].t, line: L, col: w[3].col });
}

// "groove x3, groove +5 fill" -> [{ name, times, transp }]
function parseItems(ws, L, E) {
  const items = [];
  for (const x of ws) {
    for (const part of x.t.split(',')) {
      if (!part) continue;
      const col = x.col;
      let m;
      if ((m = /^x(\d+)$/.exec(part))) { if (!items.length) throw E(L, col, `"${part}" repeats nothing`); items.at(-1).times *= +m[1]; }
      else if ((m = /^([+-]\d+)$/.exec(part))) { if (!items.length) throw E(L, col, `"${part}" transposes nothing`); items.at(-1).transp += +m[1]; }
      else if (/^[A-Za-z_][\w-]*$/.test(part)) items.push({ name: part, times: 1, transp: 0, line: L, col });
      else throw E(L, col, `"${part}": expected a pattern or section name, xN or +N`, 'section verse = groove x3, groove +5');
    }
  }
  if (!items.length) throw E(L, 1, 'an empty list', 'arrange: intro verse chorus');
  return items;
}

// "{vol=12,pan=L}" -> object
function parseAttrs(t, L, col, E) {
  const o = {};
  for (const kv of t.split(',')) {
    if (!kv) continue;
    const [k, v] = kv.split('=');
    if (v == null) throw E(L, col, `attribute "${kv}": key=value`);
    if (k === 'pan') { if (!['L', 'C', 'R'].includes(v)) throw E(L, col, `pan=${v}: L, C or R`); o.pan = v; continue; }
    if (!ATTRS.includes(k) && !EXACT.includes(k)) throw E(L, col, `unknown attribute "${k}"`, 'vol=0..15, pan=L|C|R, slide=semitones');
    const n = +v;
    if (!Number.isFinite(n)) throw E(L, col, `${k}=${v} is not a number`);
    if (k === 'vol' && !(Number.isInteger(n) && n >= 0 && n <= 15)) throw E(L, col, `vol=${v}: 0..15 (15 = full)`);
    o[k] = n;
  }
  return o;
}

function parsePatternLine(pat, w, L, E) {
  const v = w[0].t.toUpperCase(), spec = voiceSpec(v);
  if (!spec) {
    if (/^FM6$/i.test(w[0].t)) throw E(L, w[0].col, 'FM6 is not available: it plays the DAC (samples)', 'use FM1-FM5');
    throw E(L, w[0].col, `"${w[0].t}" is not a voice`, 'FM1-5, PSG1-3, NOISE, DAC1-4');
  }
  if (spec.kind === 'fm' && spec.ch === 5) throw E(L, w[0].col, 'FM6 is not available: it plays the DAC (samples)', 'use FM1-FM5');
  const a = w[1];
  if (!a) throw E(L, w[0].col, 'a voice line needs a sound and notes', `${v} bass : A2/2 -/2 C3/4`);
  if (ATTRS.includes(a.t)) { // FM1 vol 12 [at 3,7] [from 9]
    const val = w[2];
    if (!val) throw E(L, a.col, `${a.t} needs a value`);
    let value = a.t === 'pan' ? val.t.toUpperCase() : +val.t;
    if (a.t === 'pan' && !['L', 'C', 'R'].includes(value)) throw E(L, val.col, `pan ${val.t}: L, C or R`);
    if (a.t === 'vol' && !(Number.isInteger(value) && value >= 0 && value <= 15)) throw E(L, val.col, `vol ${val.t}: 0..15 (15 = full)`);
    if (a.t === 'slide' && !Number.isFinite(value)) throw E(L, val.col, `slide ${val.t}: semitones, e.g. +2 or -12`);
    const at = { voice: v, key: a.t, value, line: L, col: a.col, steps: null, from: 1 };
    for (let i = 3; i < w.length; i += 2) {
      const what = w[i].t, arg = w[i + 1];
      if (!arg) throw E(L, w[i].col, `${what} needs a step number`);
      if (what === 'at') at.steps = arg.t.split(',').map(Number);
      else if (what === 'from') at.from = +arg.t;
      else throw E(L, w[i].col, `"${what}": expected "at" or "from"`, `${v} vol 12 at 3,7  or  ${v} vol 12 from 9`);
      if ((at.steps || [at.from]).some((x) => !(x >= 1))) throw E(L, arg.col, `steps count from 1 within the pattern`);
    }
    pat.attrs.push(at);
    return;
  }
  const colon = w.findIndex((x) => x.t === ':' || x.t.endsWith(':'));
  if (colon < 0) throw E(L, a.col, 'expected ":" between the sound and the notes', `${v} ${a.t} : A2/2 -/2`);
  let sw = w.slice(1, colon + 1).map((x) => x.t).join(' ').replace(/:$/, '').trim();
  if (!sw) throw E(L, a.col, 'which sound? name it before ":"', `${v} bass : A2/2`);
  if (sw.includes(' ')) throw E(L, a.col, `one sound per line ("${sw}")`, 'put each sound on a line of its own; lines of one voice are merged');
  pat.voices.push({ voice: v, spec, sound: sw, soundCol: a.col, line: L, tokens: w.slice(colon + 1) });
}

// ---------- building ----------
const fileOf = (ast) => ast.file;
// The reference a song is based on: a folder of player/songs, or a game (its example new songs start from)
function resolveBase(ast) {
  const refs = refList();
  if (!ast.base) return baseRef();
  const want = ast.base.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = refs.find((x) => x.dir === ast.base.name);
  if (r) return r.dir;
  const def = baseRef(), defGame = refs.find((x) => x.dir === def)?.game;
  const games = refs.filter((x) => x.game.toLowerCase().replace(/[^a-z0-9]/g, '') === want);
  if (games.length) return games.some((x) => x.game === defGame) ? def : games[0].dir;
  throw new SpsError(fileOf(ast), ast.base.line, ast.base.col, `base "${ast.base.name}" is neither a game nor a song of player/songs`, `games: ${[...new Set(refs.map((x) => x.game))].join(', ')}`);
}

const SAMPLE_KEYS = ['oneShot', 'baseStep', 'pitched', 'transp', 'steps', 'voice', 'romAddr', 'dpcm', 'drumRow']; // app.js
const FREE_ROWS = [29, 33, 37, 39, 41, 30, 32, 34, 36, 38, 40, 42, 28, 27, 43, 26, 44, 25, 24, 23, 22, 21, 20]; // app.js
const toB64 = (u8) => Buffer.from(u8).toString('base64');
const COLORS = ['#ff5d5d', '#ffb341', '#ffe14d', '#7be36b', '#4dd6ff', '#5a7bff', '#a06bff', '#ff5d8f', '#ff6a3d', '#4cc24c', '#2fb8e8', '#ffb020', '#c0c0c0'];

// The song being built and the library sounds copied into it: must match app.js addCatalogSound / libSound /
// addCatalogSample / assignSampleRows (checked by llm/tests/s2-build.mjs against the code of app.js itself).
export class SongMaker {
  constructor(song, catOff) { this.song = song; this.catOff = catOff; this.log = []; } // log: the sounds in the order added
  // app.js libUsed
  libUsed(c) { const S = this.song, u = S.libUse?.[c.key]; return u && S.macros[u.m] && (u.i == null || S.instruments[u.i]) ? u : null; }
  // app.js libSound: the palette entry of a library sound in the song
  libSound(c, u) {
    const base = { i: u.i, m: u.m, d: Math.round(this.song.step * 2), lib: c.key };
    if (c.gm != null && c.my) return { ...base, key: 'g' + c.gm + '.' + u.i, gm: c.gm, p: c.p, sprite: spriteName(c.sprite), name: c.name };
    if (c.gm != null) return { ...base, key: 'g' + c.gm, gm: c.gm, p: c.p, sprite: KIT[c.gm]?.sprite || 'cymbal', name: KIT[c.gm]?.name || 'Drum' };
    if (c.ins) return { ...base, key: 'i' + u.i, p: c.p, sprite: spriteName(c.sprite), name: c.name };
    return { ...base, key: 'm' + u.m, p: 69, sprite: spriteName(c.sprite), name: c.name };
  }
  // app.js addCatalogSound: FM / FM drum / PSG / noise; instrument and macro join the song when first used
  addSound(c) {
    const S = this.song;
    this.log.push(c);
    let u = this.libUsed(c);
    if (!u) {
      S.macros.push(structuredClone(c.mac)); // (the app also sets mac.pitch, a runtime field it does not save)
      u = { m: S.macros.length - 1 };
      if (c.ins) { S.instruments.push(structuredClone(c.ins)); u.i = S.instruments.length - 1; }
      (S.libUse ??= {})[c.key] = u;
    }
    return this.libSound(c, u);
  }
  // app.js addCatalogSample (+ catPoint, assignSampleRows): the song's sample for a library sample
  addSample(c) {
    const S = this.song;
    this.log.push(c);
    let i = (S.samples || []).findIndex((x) => x.cat === c.key || (x.romAddr === c.romAddr && (S.game || '') === c.game));
    if (i < 0) {
      const x = { cat: c.key, name: c.name, sprite: c.sprite };
      for (const k of SAMPLE_KEYS) if (c[k] !== undefined) x[k] = c[k];
      if (c.pcm) Object.assign(x, { pcm: toB64(c.pcm), loopAt: c.loopAt ?? -1 });
      else Object.assign(x, { off: this.catOff + c.off, len: c.len, loop: c.loop >= 0 ? this.catOff + c.loop : -1 });
      if (x.drumRow != null && S.samples?.some((y) => y.drumRow === x.drumRow)) delete x.drumRow;
      (S.samples ??= []).push(x);
      const used = new Set(S.samples.map((y) => y.drumRow).filter((r) => r != null));
      for (const smp of S.samples) if (smp.drumRow == null) { smp.drumRow = FREE_ROWS.find((r) => !used.has(r)) ?? 30; used.add(smp.drumRow); }
      const pool = spritePool();
      S.samples.forEach((smp, k) => { smp.name ??= `Sample ${k + 1}`; smp.sprite = spriteName(smp.sprite ?? pool[(k * 7) % pool.length]); });
      i = S.samples.length - 1;
    }
    const smp = S.samples[i];
    // app.js sampleSound: the palette entry
    return { key: 's' + i, smp: i, p: 36 + 24 - (smp.transp || 0), d: Math.round(S.step * 2), sprite: smp.sprite, name: smp.name };
  }
}

// A sound named in the .sps: a library key, a .spsound / .spkit of My sounds, or a .spp patch (section 5).
function resolveSound(ast, def, rate) {
  const E = (msg, hint) => new SpsError(fileOf(ast), def.line, def.col, msg, hint);
  const ref = def.ref;
  if (/\.(spsound|spkit|spp)$/i.test(ref)) {
    const f = path.resolve(path.dirname(path.resolve(ast.file)), ref);
    if (!fs.existsSync(f)) throw E(`no such file: ${ref}`);
    if (/\.spp$/i.test(ref)) {
      return sppSound(f);
    }
    const res = readSoundFile(path.basename(f), readText(f), rate);
    if (!res.sounds.length) throw E(`${ref}: no sound in it (${res.skipped.join('; ')})`);
    const rec = res.sounds[0];
    return { ...rec, my: true, game: 'My sounds', key: 'my:' + (rec.id || path.basename(f).replace(/\.[^.]+$/, '')) };
  }
  const c = findSound(ref);
  if (!c) throw E(`no sound "${ref}" in the library`, 'see: sp sounds (or sp sounds --find word)');
  return c;
}

const kindOf = (c) => c.type;
// "song:i3/m40", "song:g46/i1/m110", "song:m151", "song:s4", with ",p=36" for the pitch of x: a sound of the song itself
// (an imported song: its instruments, macros and samples are in its exact: block)
function songSound(ast, def, song) {
  const E = (msg) => new SpsError(fileOf(ast), def.line, def.col, msg, 'song:i3/m40 (FM), song:g46/i1/m110 (FM drum), song:m7 (PSG / noise), song:s2 (sample)');
  const [body, ...opts] = def.ref.slice(5).split(',');
  const o = {};
  for (const part of body.split('/')) {
    const m = /^([igms])(\d+)$/.exec(part);
    if (!m) throw E(`"${def.ref}" is not a sound of the song`);
    o[{ i: 'i', g: 'gm', m: 'm', s: 'smp' }[m[1]]] = +m[2];
  }
  for (const x of opts) { const m = /^p=(\d+)$/.exec(x); if (!m) throw E(`"${x}": only p=<MIDI note> may follow`); o.p = +m[1]; }
  if (o.smp != null) {
    const smp = song.samples?.[o.smp];
    if (!smp) throw E(`the song has no sample ${o.smp}`);
    return { type: 'samples', song: true, snd: { smp: o.smp, p: o.p ?? 60 - (smp.transp || 0) }, name: smp.name, pitched: smp.pitched };
  }
  const mac = song.macros?.[o.m];
  if (!mac) throw E(`the song has no macro ${o.m}`);
  if (o.i != null && !song.instruments?.[o.i]) throw E(`the song has no instrument ${o.i}`);
  const type = o.gm != null ? 'drums' : o.i != null ? 'fm' : mac.noise ? 'noise' : 'psg';
  return { type, song: true, snd: { i: o.i, m: o.m, gm: o.gm, p: o.p ?? macroPitch(mac) }, name: def.name };
}
const ONLY_EXACT = ['m', 'i', 'smp', 'gm', 'md', 's', 'S', 'e'];

export function buildSong(ast) {
  const file = fileOf(ast);
  const E = (line, col, msg, hint) => new SpsError(file, line, col, msg, hint);
  const base = resolveBase(ast);
  const ref = fetchRef(base);
  const exact = !!ast.exact;
  const grid = ast.grid, unit = STEPS_PER_BAR / grid; // app steps per grid step
  let song;
  if (exact) { // an imported song: everything but the notes as it was
    song = structuredClone(ast.exact);
    if (ast.title) song.title = ast.title;
    if (ast.bpm !== song.bpm) throw E(ast.bpmAt.line, ast.bpmAt.col, `bpm ${ast.bpm}: this imported song keeps its recorded timing (bpm ${song.bpm})`, 'change the tempo in Sega Paint, or write the music into a new .sps');
    song.base = base;
    song.game = ref.game || '';
    if (ast.key) song.scale = ast.key;
  } else {
    const step = 44100 * 60 / (ast.bpm * 4);
    song = {
      title: ast.title || path.basename(file).replace(/\.[^.]+$/, ''), base, rate: 44100, uniform: true, bpm: ast.bpm, step, step0: 0,
      stepsPerBeat: 4, beatsPerBar: 4, stepTimes: [], end: 0, loopStart: -1,
      globals: ref.globals.filter((x) => x[0] <= 1).map((x) => [0, x[1], x[2], x[3]]), // as app.js newSongData
      instruments: [], macros: [], layers: [], samples: [], bankFile: ref.bankFile, mixRate: ref.mixRate, library: { fm: [], psg: [] },
      game: ref.game || '',
    };
    if (ast.key) song.scale = ast.key;
  }
  const maker = new SongMaker(song, fetchBank(base, song.bankFile || 'pcm.bin').length);
  Object.defineProperty(song, '_maker', { value: maker }); // for the checks
  const off = ast.offset || 0; // steps before bar 1 (an imported song whose bars do not start at step 0)

  // sounds, checked against the voices that use them
  const sounds = new Map();
  const soundOf = (name, line, col) => {
    if (sounds.has(name)) return sounds.get(name);
    const def = ast.sounds.get(name);
    if (!def) throw E(line, col, `no sound "${name}"`, `define it first: sound ${name} = "key" (keys: sp sounds)`);
    let c;
    if (def.ref.startsWith('song:')) {
      if (!exact) throw new SpsError(file, def.line, def.col, `"${def.ref}": song: sounds exist only in an imported song (with exact:)`, 'use a library key: sp sounds');
      c = songSound(ast, def, song);
    } else c = resolveSound(ast, def, song.mixRate);
    sounds.set(name, c);
    return c;
  };
  const fits = (c, spec, v) => {
    const k = kindOf(c), nm = c.song ? c.name : soundName(c);
    if (spec.kind === 'fm') return k === 'fm' || k === 'drums' ? '' : `${v} plays FM sounds; "${nm}" is ${k}`;
    if (c.song && (spec.kind === 'psg' || spec.kind === 'noise') && (k === 'psg' || k === 'noise')) return '';
    if (spec.kind === 'psg') return k === 'psg' ? '' : `${v} plays square waves (psg sounds); "${nm}" is ${k}`;
    if (spec.kind === 'noise') return k === 'noise' ? '' : `NOISE plays noise sounds; "${nm}" is ${k}`;
    if (k !== 'samples') return `${v} plays samples; "${nm}" is ${k}`;
    if (!c.song && spec.voice === MELODIC_VOICE && !c.pitched) return `DAC4 is the pitched sample voice and "${nm}" has no pitch: put it on DAC1-DAC3`;
    return '';
  };

  // the arrangement: patterns with their bar and transposition
  const placed = [];
  const expand = (items, transp, stack) => {
    for (const it of items) {
      if (stack.includes(it.name)) throw E(it.line, it.col, `"${it.name}" contains itself`);
      const p = ast.patterns.get(it.name), sec = ast.sections.get(it.name);
      if (!p && !sec) throw E(it.line, it.col, `no pattern or section "${it.name}"`);
      for (let k = 0; k < it.times; k++) {
        if (p) placed.push({ pat: p, transp: transp + it.transp, section: stack[0] ?? it.name, item: it });
        else expand(sec.items, transp + it.transp, [...stack, it.name]);
      }
    }
  };
  const arr = ast.arrange?.items || (ast.sections.size ? [...ast.sections.keys()] : [...ast.patterns.keys()]).map((name) => ({ name, times: 1, transp: 0, line: 1, col: 1 }));
  expand(arr, 0, []);
  if (!placed.length && !exact) throw E(1, 1, 'no music: write a pattern (and arrange: ...)');
  let bar = 0;
  const sectionStart = new Map();
  for (const x of placed) {
    x.bar = bar;
    for (const name of [x.section, x.pat.name]) if (!sectionStart.has(name)) sectionStart.set(name, bar);
    bar += x.pat.bars;
  }
  let steps;
  if (!exact) {
    const bars = ast.bars || bar;
    steps = bars * STEPS_PER_BAR;
    song.stepTimes = Array.from({ length: steps + 1 }, (_, i) => Math.round(i * song.step * 10) / 10); // as app.js setTiming
    song.end = Math.round(steps * song.step);
  } else {
    // longer than recorded (more bars written, or bars N): the grid goes on at the song's step, as app.js setUnevenTiming
    const have = Math.ceil((timeToStep(song, song.end) - off) / STEPS_PER_BAR - 1e-6);
    const want = ast.bars || (bar > have ? bar : 0);
    if (want) {
      const last = off + want * STEPS_PER_BAR;
      while (song.stepTimes.length - 1 - song.step0 < last + STEPS_PER_BAR) song.stepTimes.push(Math.round((song.stepTimes.at(-1) + song.step) * 10) / 10);
      song.end = Math.round(stepTime(song, last));
    }
    steps = Infinity;
  }
  const nBars = Math.round((timeToStep(song, song.end) - off) / STEPS_PER_BAR);
  if (ast.loop && !ast.loop.off) {
    let lb;
    if (ast.loop.bar != null) { lb = ast.loop.bar - 1; if (!(lb >= 0 && lb < nBars)) throw E(ast.loop.line, ast.loop.col, `loop bar ${ast.loop.bar}: the song has ${nBars} bars`); }
    else {
      lb = sectionStart.get(ast.loop.name);
      if (lb == null) {
        lb = placed.find((x) => x.item.name === ast.loop.name)?.bar;
        if (lb == null) throw E(ast.loop.line, ast.loop.col, `loop: "${ast.loop.name}" does not play in the arrangement`);
      }
    }
    song.loopStart = Math.round(stepTime(song, off + lb * STEPS_PER_BAR));
  } else if (ast.loop?.off) song.loopStart = -1;

  // notes, voice by voice
  const layers = new Map(); // voice -> { L, palette keys, notes by step }
  if (exact) for (const L of song.layers) {
    if (L.kind !== 'dac') L.notes = [];
    layers.set(voiceOf(L), { L, keys: new Map(), at: new Map(), names: [], old: true });
  }
  const layerFor = (v, spec, line, col, c) => {
    if (!layers.has(v)) {
      const L = { id: '', kind: spec.kind, ch: spec.ch, name: ast.tracks.get(v)?.name || '', color: '', role: spec.kind === 'fm' ? (kindOf(c) === 'drums' ? 'perc' : 'lead') : spec.kind === 'sample' ? 'sample' : spec.kind === 'noise' ? 'noise' : 'psg', notes: [], palette: [] };
      if (spec.kind === 'sample') L.voice = spec.voice;
      if (spec.kind === 'fm' && kindOf(c) === 'drums') L.kit = true;
      layers.set(v, { L, keys: new Map(), at: new Map(), names: [] });
    }
    const X = layers.get(v);
    if (!exact && spec.kind === 'fm' && !!X.L.kit !== (kindOf(c) === 'drums')) throw E(line, col, `${v} mixes FM drums and FM instruments`, 'an FM voice is either a drum track (drums sounds) or a melodic one; use another FM voice');
    if (X.old && ast.tracks.get(v)) X.L.name = ast.tracks.get(v).name;
    return X;
  };
  const paletteOf = (X, name, c) => {
    if (X.keys.has(name)) return X.keys.get(name);
    let snd;
    if (c.song) snd = c.snd;
    else {
      snd = kindOf(c) === 'samples' ? maker.addSample(c) : maker.addSound(c);
      if (X.L.palette && !X.L.palette.some((x) => x.key === snd.key)) X.L.palette.push(snd);
      if (!X.names.includes(soundName(c))) X.names.push(soundName(c));
    }
    X.keys.set(name, snd);
    return snd;
  };

  for (const P of placed) {
    const pat = P.pat, S0 = off + P.bar * STEPS_PER_BAR, patSteps = pat.bars * grid;
    const local = new Map(); // voice -> [{ k (grid step), note }]
    for (const line of pat.voices) {
      const { voice: v, spec } = line;
      const c = soundOf(line.sound, line.line, line.soundCol);
      const why = fits(c, spec, v);
      if (why) throw E(line.line, line.soundCol, why);
      const X = layerFor(v, spec, line.line, line.soundCol, c);
      const snd = paletteOf(X, line.sound, c);
      const lane = spec.kind === 'noise' || (spec.kind === 'sample' && spec.voice !== MELODIC_VOICE) || (spec.kind === 'fm' && !!X.L.kit);
      const drum = lane || kindOf(c) === 'drums';
      const natural = snd.p ?? 60;
      let k = 0;
      const list = local.get(v) || [];
      local.set(v, list);
      const put = (tok, col, pitch, len, attrs) => {
        if (!(len > 0)) throw E(line.line, col, `length /${len}: more than 0 steps`);
        let s = S0 + k * unit;
        if (attrs.s != null) { s = S0 + attrs.s; k = attrs.s / unit; }
        if (attrs.S != null) { s = attrs.S; k = (attrs.S - S0) / unit; }
        if (!exact && k + len > patSteps + 1e-9) throw E(line.line, col, `${v}: the notes run past the end of "${pat.name}" (${pat.bars} bar${pat.bars > 1 ? 's' : ''} = ${patSteps} steps)`, `make the pattern longer (pattern ${pat.name} ${pat.bars + 1}:) or the notes shorter`);
        if (pitch != null) {
          const clash = !exact && list.find((x) => Math.abs(x.k - k) < 1e-9);
          if (clash) throw E(line.line, col, `${v}: two notes at once at step ${k + 1} of "${pat.name}" (also line ${clash.line})`, 'one voice plays one note at a time; put the other note on another voice');
          const p = pitch === 'x' ? natural : pitch + (drum ? 0 : P.transp);
          const n = { s, n: 0, d: 0, p };
          n.d = drum && snd.d != null ? snd.d : Math.round(stepTime(song, s + len * unit) - stepTime(song, s));
          if (kindOf(c) === 'samples') n.smp = snd.smp; else { if (snd.i !== undefined) n.i = snd.i; n.m = snd.m; }
          if (snd.gm != null) { n.gm = snd.gm; if (pitch === 'x') n.p = snd.p; }
          for (const [a, val] of Object.entries(attrs)) {
            if (ONLY_EXACT.includes(a) && !exact) throw E(line.line, col, `{${a}=...} belongs to imported songs (with exact:)`, 'vol, pan, slide, d (length in samples) and n (offset in samples) work everywhere');
            if (a === 'vol' && spec.kind === 'sample' && !exact) throw E(line.line, col, 'samples have no volume: the DAC plays them as they are', 'use a quieter sample or leave vol out');
            if (a === 'pan' && spec.kind !== 'fm' && !exact) throw E(line.line, col, spec.kind === 'sample' ? 'all samples share one DAC channel: no pan per note' : 'the PSG is mono: no pan', 'only FM voices pan');
            if (a === 'slide' && !exact && (drum || spec.kind === 'sample')) throw E(line.line, col, `${v}: slide works on FM and PSG notes`);
            if (a === 's' || a === 'S') continue;
            n[a] = val;
          }
          list.push({ k, n, line: line.line, col });
        }
        k += len;
      };
      for (const tk of line.tokens) {
        const t = tk.t;
        if (t === '|') continue; // a separator for the eye (bars, beats): not checked
        let m = /^([^/{]+)(?:\/([\d.]+))?(?:\{(.*)\})?$/.exec(t);
        if (!m) throw E(line.line, tk.col, `"${t}" is not a note`, 'A2/2 (note/length in steps), -/4 (rest), x... (hits)');
        const [, head, lenS, attrS] = m;
        const len = lenS != null ? +lenS : 1;
        const attrs = attrS != null ? parseAttrs(attrS, line.line, tk.col, E) : {};
        if (/^[xX.\-]{2,}$/.test(head) && lenS == null) { // a drum string: one character per step
          for (const ch of head) put(t, tk.col, ch === 'x' || ch === 'X' ? 'x' : null, 1, attrs);
          continue;
        }
        if (head === '-' || head === '.' || head === 'r') { put(t, tk.col, null, len, {}); continue; }
        if (head === 'x' || head === 'X') { put(t, tk.col, 'x', len, attrs); continue; }
        const p = parseNote(head);
        if (p == null) throw E(line.line, tk.col, `"${head}" is not a note`, 'notes: C4, F#3, Bb2 (C4 = middle C); x = a hit; - = rest');
        if (drum) {
          const why2 = spec.kind === 'sample' ? `${v}: pitch changes only on DAC4 - DAC1-3 play samples at their own pitch` : spec.kind === 'noise' ? 'NOISE has no pitch' : `${v} is an FM drum track: drums have a fixed pitch`;
          throw E(line.line, tk.col, why2, 'write x for a hit (x... or x/4)');
        }
        put(t, tk.col, p, len, attrs);
      }
    }
    // vol / pan / slide lines
    for (const at of pat.attrs) {
      const list = local.get(at.voice);
      if (!list) throw E(at.line, at.col, `${at.voice} has no notes in "${pat.name}"`);
      const spec = voiceSpec(at.voice);
      if (at.key === 'vol' && spec.kind === 'sample') throw E(at.line, at.col, 'samples have no volume: the DAC plays them as they are');
      if (at.key === 'pan' && spec.kind !== 'fm') throw E(at.line, at.col, spec.kind === 'sample' ? 'all samples share one DAC channel: no pan per note' : 'the PSG is mono: no pan', 'only FM voices pan');
      let hit = 0;
      for (const x of list) {
        const st = x.k + 1;
        if (at.steps ? at.steps.some((y) => Math.abs(y - st) < 1e-9) : st >= at.from - 1e-9) { x.n[at.key] = at.value; hit++; }
      }
      if (!hit) throw E(at.line, at.col, `${at.voice} ${at.key}: no note starts ${at.steps ? 'at step ' + at.steps.join(',') : 'from step ' + at.from} in "${pat.name}"`, `${at.voice} notes start at steps ${[...new Set(list.map((x) => Math.round((x.k + 1) * 1000) / 1000))].sort((a, b) => a - b).join(',')}`);
    }
    for (const [v, list] of local) {
      const X = layers.get(v);
      for (const x of list) {
        const key = Math.round(x.n.s * 1e6);
        if (!exact && X.at.has(key)) throw E(x.line, x.col, `${v}: two notes at once (with line ${X.at.get(key)})`);
        if (x.n.s >= steps) continue; // after the song end (bars N): left out
        X.at.set(key, x.line);
        X.L.notes.push(x.n);
      }
    }
  }

  // layers in voice order (an imported song keeps its own order), with names, colours and roles
  const order = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'PSG1', 'PSG2', 'PSG3', 'NOISE', 'DAC4', 'DAC1', 'DAC2', 'DAC3'];
  let id = exact ? Math.max(-1, ...song.layers.map((x) => +String(x.id).slice(1) || 0)) + 1 : 0;
  for (const X of layers.values()) if (X.old) X.L.notes.sort((a, b) => a.s - b.s);
  for (const v of order) {
    const X = layers.get(v);
    if (!X || X.old) continue;
    const L = X.L;
    L.id = 'L' + id;
    L.color = COLORS[id % COLORS.length];
    id++;
    const joined = X.names.join(' / ');
    L.name ||= (joined.length <= 24 ? joined : `${X.names[0].slice(0, 20)} +${X.names.length - 1}`) || v;
    L.notes.sort((a, b) => a.s - b.s);
    if (L.kind === 'fm' && !L.kit && L.notes.length) {
      const ps = L.notes.map((n) => n.p).sort((a, b) => a - b);
      L._median = ps[ps.length >> 1];
    }
    song.layers.push(L);
  }
  // the lowest FM track is the bass (the app opens a song on it)
  if (!exact) {
    const fms = song.layers.filter((L) => L._median != null).sort((a, b) => a._median - b._median);
    if (fms[0] && fms[0]._median < 55) fms[0].role = 'bass';
  }
  return song;
}

// app.js serializeObj: the song file without runtime-only fields
const RUNTIME_KEYS = new Set(['sounds', 'sel', 'def', 'pitch', 'game', 'tone', 'group', 'pick']);
export const serializeSong = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') || RUNTIME_KEYS.has(k) ? undefined : v)));

export function buildFile(file) {
  if (!fs.existsSync(file)) throw new UserError(`no such file: ${file}`);
  return serializeSong(buildSong(parseSps(readText(file), file)));
}
