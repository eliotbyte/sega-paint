// Shared ground of the LLM tools: paths, the sound library, a song loaded the way Sega Paint loads it, voices,
// bar / step positions, rendering and WAV files. Only UI-free modules of player/ are imported, nothing is changed there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSong, buildTimeline, stepTime, timeToStep, hzMidi, fmHz, psgHz, MELODIC_VOICE } from '../player/engine/song.js';
import { Renderer } from '../player/engine/renderer.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLAYER = path.join(ROOT, 'player');
export const SONGS = path.join(PLAYER, 'songs');
export const OUT = path.join(ROOT, 'llm', 'out');
export const RATE = 44100;
export const STEPS_PER_BAR = 16; // the app draws a bar every 16 steps (app.js barStart)

// a text file without the BOM some editors put first (Notepad's "UTF-8 with BOM")
export const noBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
export const readText = (f) => noBom(fs.readFileSync(f, 'utf8'));
export const readJson = (f) => JSON.parse(readText(f));
export const outPath = (name) => { fs.mkdirSync(OUT, { recursive: true }); return path.join(OUT, name); };
// every output file goes through here: its folder is made first (llm/out/ is not in git)
export const writeOut = (file, data) => { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, data); };
// a file's name without extension; an example's song.json goes by its folder
export const stem = (f) => (path.basename(f) === 'song.json' ? path.basename(path.dirname(path.resolve(f))) : path.basename(f).replace(/\.[^.]+$/, ''));
export class UserError extends Error {}
export const fail = (msg) => { throw new UserError(msg); };

// ---------- notes ----------
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (p) => NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// "A2", "C#4", "Bb3" -> MIDI (C4 = 60), or null
export function parseNote(t) {
  const m = /^([A-Ga-g])(#|b|s)?(-?\d)$/.exec(t);
  if (!m) return null;
  return (+m[3] + 1) * 12 + LETTERS[m[1].toUpperCase()] + (m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0);
}

// app.js KIT: the General MIDI drums an FM drum track shows (row, icon, name)
export const KIT = {
  41: { row: 32, sprite: 'tom', name: 'Floor tom' }, 42: { row: 39, sprite: 'hihat', name: 'Closed hat' },
  43: { row: 33, sprite: 'drum', name: 'Floor tom 2' }, 44: { row: 29, sprite: 'key', name: 'Pedal hat' },
  45: { row: 34, sprite: 'mushroom', name: 'Low tom' }, 46: { row: 40, sprite: 'cymbal', name: 'Open hat' },
  47: { row: 36, sprite: 'coin', name: 'Mid tom' }, 48: { row: 37, sprite: 'heart', name: 'Mid tom 2' },
  49: { row: 41, sprite: 'star', name: 'Crash' }, 50: { row: 38, sprite: 'diamond', name: 'High tom' },
  51: { row: 42, sprite: 'bell', name: 'Ride' }, 55: { row: 43, sprite: 'cymbal', name: 'Splash' },
};
// sprites.js spriteName: the note pictures are those of art/art.json (pixel.js NOTE_NAMES), old names have aliases
let NOTE_NAMES = null;
export const spritePool = () => (NOTE_NAMES ??= readJson(path.join(PLAYER, 'art', 'art.json')).notes.map((x) => x.name));
const ALIAS = { invader: 'ufo', apple: 'heart', cherry: 'ring', crown: 'coin', rocket: 'plane', flower: 'fly', note: 'guitar', flame: 'bomb', clover: 'mushroom' };
export const spriteName = (name) => (spritePool().includes(name) ? name : ALIAS[name] || 'star');
// The name a library sound is shown by (app.js soundLibrary: a game's drums go by their kit name)
export const soundName = (c) => (c.type === 'drums' && !c.my ? KIT[c.gm]?.name || 'Drum' : c.name);

// ---------- the reference songs and the library ----------
export const refList = () => readJson(path.join(SONGS, 'index.json'));
// app.js baseRef: the example new songs take their sounds from
export const baseRef = () => (refList().find((r) => r.dir === 'cheese-grater') || refList()[0]).dir;

// library.js fetchRef: a reference song with its display metadata merged in
export function fetchRef(dir) {
  const song = readJson(path.join(SONGS, dir, 'song.json'));
  let meta = {};
  try { meta = readJson(path.join(SONGS, dir, 'meta.json')); } catch (e) { /* none */ }
  for (const L of song.layers) Object.assign(L, meta.layers?.[L.id] || {});
  (song.samples || []).forEach((smp, i) => Object.assign(smp, meta.samples?.[i] || {}));
  song.game = meta.game || song.game || '';
  return song;
}
const banks = new Map();
export function fetchBank(dir, file) {
  const key = dir + '/' + file;
  if (!banks.has(key)) banks.set(key, new Uint8Array(fs.readFileSync(path.join(SONGS, dir, file))));
  return banks.get(key);
}

export const SECTIONS = ['fm', 'drums', 'psg', 'noise', 'samples'];
let catalog = null;
// library.js fetchCatalog: every sound of library/sounds.json (x.game set), the samples' bank
export function loadCatalog() {
  if (catalog) return catalog;
  const cat = readJson(path.join(PLAYER, 'library', 'sounds.json'));
  const bank = new Uint8Array(fs.readFileSync(path.join(PLAYER, 'library', 'samples.bin')));
  for (const g of cat.games) for (const sec of SECTIONS) for (const x of g[sec] || []) { x.game = g.game; x.type = sec; }
  catalog = { games: cat.games, bank, my: [] };
  return catalog;
}
// Sounds of a My sounds export (.spsound / .spkit, soundfile.js) join the catalog as the app's My sounds do.
export function addMySounds(recs) {
  const c = loadCatalog();
  for (const r of recs) c.my.push({ ...r, game: 'My sounds', my: true, key: r.key || 'my:' + (r.id || r.name) });
}
export const catOf = (sec) => { const c = loadCatalog(); return [...c.my.filter((x) => x.type === sec), ...c.games.flatMap((g) => g[sec] || [])]; };
export const allSounds = () => SECTIONS.flatMap((sec) => catOf(sec));
export function findSound(key) {
  const all = allSounds();
  return all.find((x) => x.key === key) || all.find((x) => x.key.toLowerCase() === key.toLowerCase()) || null;
}

// ---------- a song as the app loads it ----------
// app.js mergeLibrary: sounds the reference got after this song was made join its library; DPCM fixes by ROM address
function mergeLibrary(song, ref) {
  for (const x of song.samples || []) {
    const r = x.romAddr != null && ref.samples?.find((y) => y.romAddr === x.romAddr && y.dpcm);
    if (r && !x.dpcm) Object.assign(x, { off: r.off, len: r.len, loop: r.loop, dpcm: true });
  }
  const lib = (song.library ??= { fm: [], psg: [] });
  lib.fm ??= [];
  const played = new Set(song.layers.flatMap((L) => L.notes.map((n) => n.i)));
  lib.fm = lib.fm.filter((x) => x.rom == null || played.has(x.i) || ref.library?.fm?.some((y) => y.rom === x.rom));
  for (const x of ref.library?.fm || []) {
    if (x.rom == null || lib.fm.some((y) => y.rom === x.rom)) continue;
    song.instruments.push(structuredClone(ref.instruments[x.i]));
    song.macros.push(structuredClone(ref.macros[x.m]));
    lib.fm.push({ ...x, i: song.instruments.length - 1, m: song.macros.length - 1 });
  }
}
const fromB64 = (t) => new Uint8Array(Buffer.from(t, 'base64'));
// app.js withCatalog + catPoint + withMySamples: the library's bank after the song's own, then samples of My sounds
function withCatalog(bank, song) {
  const lib = loadCatalog().bank;
  const catOff = bank.length;
  let pcm = bank;
  if (lib.length) {
    pcm = new Uint8Array(bank.length + lib.length);
    pcm.set(bank); pcm.set(lib, bank.length);
    const cs = catOf('samples');
    for (const x of song.samples || []) {
      if (!x.cat || x.pcm) continue;
      const c = cs.find((y) => y.key === x.cat);
      if (c) Object.assign(x, { off: catOff + c.off, len: c.len, loop: c.loop >= 0 ? catOff + c.loop : -1 });
    }
  }
  const own = (song.samples || []).filter((x) => x.pcm);
  if (!own.length) return pcm;
  const data = own.map((x) => fromB64(x.pcm));
  const out = new Uint8Array(pcm.length + data.reduce((a, u) => a + u.length + 1, 0));
  out.set(pcm);
  let at = pcm.length;
  own.forEach((x, k) => {
    out.set(data[k], at);
    Object.assign(x, { off: at, len: data[k].length, loop: x.loopAt >= 0 ? at + x.loopAt : -1 });
    at += data[k].length + 1;
  });
  return out;
}
// Which reference a song file is: player/songs/<dir>/song.json is that example itself.
function refDirOf(file) {
  const rel = path.relative(SONGS, path.resolve(file)).split(path.sep);
  return rel.length === 2 && rel[1] === 'song.json' && !rel[0].startsWith('..') && fs.existsSync(path.join(SONGS, rel[0], 'song.json')) ? rel[0] : null;
}
// The song as Sega Paint plays it: an example as openDoc opens it, any other file as Import (importFile -> openDoc
// of a user song). Returns { song (prepared), pcm, base, ref }.
export function loadSongObject(obj, file = null) {
  const dir = file && refDirOf(file);
  let song, base;
  if (dir) { song = fetchRef(dir); base = dir; }
  else {
    song = structuredClone(obj);
    if (!Array.isArray(song.layers) || !song.stepTimes) fail(`${file || 'song'}: not a Sega Paint song (no layers / stepTimes)`);
    base = song.base || baseRef();
    if (!fs.existsSync(path.join(SONGS, base, 'song.json'))) fail(`${file}: base "${base}" is not a song of player/songs`);
    const ref = fetchRef(base);
    mergeLibrary(song, ref);
    song.game = ref.game || '';
  }
  const pcm = withCatalog(fetchBank(base, song.bankFile || 'pcm.bin'), song);
  // app.js setupSong: md, how long a recorded note was when its macro was taken
  for (const L of song.layers) if (L.kind === 'fm' || L.kind === 'psg' || L.kind === 'noise') for (const n of L.notes) if (n.m != null && n.md == null && n.slide == null) n.md = n.d;
  prepareSong(song);
  return { song, pcm, base, ref: !!dir };
}
export function loadSongFile(file) {
  if (!fs.existsSync(file)) fail(`no such file: ${file}`);
  return loadSongObject(file.toLowerCase().endsWith('.json') ? readJson(file) : null, file);
}

// ---------- voices ----------
// app.js chipName, without the space: FM1..FM6, PSG1..3, NOISE, DAC1..4 (DAC = a premixed stream of an old song)
export function voiceOf(L) {
  if (L.kind === 'fm') return `FM${L.ch + 1}`;
  if (L.kind === 'sample') return `DAC${(L.voice ?? MELODIC_VOICE) + 1}`;
  if (L.kind === 'dac') return 'DAC';
  if (L.kind === 'noise') return 'NOISE';
  return `PSG${L.ch + 1}`;
}
export const VOICES = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'PSG1', 'PSG2', 'PSG3', 'NOISE', 'DAC1', 'DAC2', 'DAC3', 'DAC4'];
export function voiceSpec(name) {
  const v = name.toUpperCase();
  let m;
  if ((m = /^FM([1-6])$/.exec(v))) return { kind: 'fm', ch: +m[1] - 1 };
  if ((m = /^PSG([1-3])$/.exec(v))) return { kind: 'psg', ch: +m[1] - 1 };
  if (v === 'NOISE') return { kind: 'noise', ch: 3 };
  if ((m = /^DAC([1-4])$/.exec(v))) return { kind: 'sample', ch: +m[1] - 1, voice: +m[1] - 1 };
  return null;
}

// ---------- bars ----------
// app.js setupSong barOffset: song.barOffset (a game song with a pickup), else game songs and new songs start at step 0
export const barOffset = (song) => song.barOffset ?? (song.ticksPerStep || song.uniform ? 0 : (() => {
  const L = song.layers.find((l) => l.role === 'bass') || song.layers[0];
  const f = L ? L.notes.reduce((m, n) => Math.min(m, n.s), Infinity) : 0;
  return Number.isFinite(f) ? f % STEPS_PER_BAR : 0;
})());
const r2 = (x) => Math.round(x * 100) / 100;
// "bar 12, step 3" (both from 1)
export function where(song, s) {
  const o = s - barOffset(song), bar = Math.floor(o / STEPS_PER_BAR);
  return `bar ${bar + 1}, step ${r2(o - bar * STEPS_PER_BAR + 1)}`;
}
export const barStep = (song, bar) => (bar - 1) * STEPS_PER_BAR + barOffset(song);
export const songBars = (song) => Math.max(1, Math.round((timeToStep(song, song.end) - barOffset(song)) / STEPS_PER_BAR));
export const macroPitch = (mac) => (mac.noise ? 60 : Array.isArray(mac.base) ? Math.round(hzMidi(fmHz(mac.base[0], mac.base[1]))) : Math.round(hzMidi(psgHz(mac.base))));

// ---------- rendering ----------
// Voices to mute for a solo list (app.js sendMute / mixMutedSet): FM and PSG by chip mask, samples re-mixed.
export function soloMasks(song, solo) {
  const want = new Set(solo.map((x) => x.toUpperCase()));
  for (const v of want) if (!song.layers.some((L) => voiceOf(L) === v)) fail(`--solo: the song has no voice ${v} (it has ${song.layers.map(voiceOf).join(', ')})`);
  let ym = 0, psg = 0;
  const mixMuted = new Set();
  song.layers.forEach((L, i) => {
    if (want.has(voiceOf(L))) return;
    if (L.kind === 'fm') ym |= 1 << L.ch;
    else if (L.kind === 'dac') ym |= 0x40;
    else if (L.kind === 'sample') mixMuted.add(i);
    else psg |= 1 << L.ch;
  });
  return { ym, psg, mixMuted };
}
export function renderTimeline(tl, from, seconds, { mute = [0, 0], loop = false } = {}) {
  const r = new Renderer(RATE);
  r.loop = loop;
  r.setTimeline(tl, from);
  r.setMute(mute[0], mute[1]);
  const n = Math.max(0, Math.round(seconds * RATE));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 512) r.process(L.subarray(i, Math.min(n, i + 512)), R.subarray(i, Math.min(n, i + 512)));
  return [L, R];
}
// A song (or part of it) as the player plays it. opts: fromBar, bars, solo (voice names), maxSeconds
export function renderSong({ song, pcm }, { fromBar = 1, bars = 0, solo = null, maxSeconds = Infinity } = {}) {
  const m = solo?.length ? soloMasks(song, solo) : { ym: 0, psg: 0, mixMuted: new Set() };
  const tl = buildTimeline(song, pcm, m.mixMuted);
  const s0 = barStep(song, fromBar);
  const from = fromBar > 1 ? Math.max(0, stepTime(song, s0)) : Math.max(0, song.stepTimes[song.step0]);
  const to = bars > 0 ? Math.min(tl.end, stepTime(song, s0 + bars * STEPS_PER_BAR)) : tl.end;
  if (to <= from) fail(`nothing to render from bar ${fromBar}: the song has ${songBars(song)} bars`);
  const [L, R] = renderTimeline(tl, from, Math.min(maxSeconds, (to - from) / RATE), { mute: [m.ym, m.psg] });
  return { L, R, from, to: from + L.length, tl };
}

// ---------- WAV ----------
export function writeWav(file, L, R, rate = RATE) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  writeOut(file, buf);
}
// 8 / 16 / 24 / 32-bit PCM or 32-bit float WAV -> { L, R, rate } (mono files give L === R)
export function readWav(file) {
  if (!fs.existsSync(file)) fail(`no such file: ${file}`);
  const w = fs.readFileSync(file);
  if (w.toString('ascii', 0, 4) !== 'RIFF' || w.toString('ascii', 8, 12) !== 'WAVE') fail(`${file}: not a WAV file`);
  let at = 12, fmt = null, data = null;
  while (at + 8 <= w.length) {
    const id = w.toString('ascii', at, at + 4), len = w.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { tag: w.readUInt16LE(at + 8), ch: w.readUInt16LE(at + 10), rate: w.readUInt32LE(at + 12), bits: w.readUInt16LE(at + 22), sub: len >= 26 ? w.readUInt16LE(at + 32) : 1 };
    else if (id === 'data') { data = [at + 8, Math.min(len, w.length - at - 8)]; break; }
    at += 8 + len + (len & 1);
  }
  if (!fmt || !data) fail(`${file}: no fmt / data chunk`);
  const tag = fmt.tag === 0xfffe ? fmt.sub : fmt.tag; // WAVE_FORMAT_EXTENSIBLE: the sub format's tag
  const bps = fmt.bits / 8, frames = Math.floor(data[1] / bps / fmt.ch);
  const rd = (o) => (tag === 3 ? (bps === 8 ? w.readDoubleLE(o) : w.readFloatLE(o))
    : bps === 1 ? (w[o] - 128) / 128 : bps === 2 ? w.readInt16LE(o) / 32768 : bps === 3 ? w.readIntLE(o, 3) / 8388608 : w.readInt32LE(o) / 2147483648);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = data[0] + i * bps * fmt.ch;
    L[i] = rd(o); R[i] = fmt.ch > 1 ? rd(o + bps) : L[i];
  }
  return { L, R, rate: fmt.rate };
}
