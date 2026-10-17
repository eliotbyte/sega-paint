import { prepareSong, buildTimeline, noteTime, stepTime, timeToStep, fmHz, psgHz, hzMidi, MELODIC_VOICE, repeatSpans, playedSteps, writtenStep, performSong, sampleStep } from './engine/song.js';
import { THEMES, md, LAYER_TONES, NOTE_NAMES, toneOrder, toneCss, loadArt, hasFrame, frameCount, noteSprite, checkered, smallIcon, pointerIcon, picture, artInfo, clef, textWidth, fitText, rgbCss, snap } from './pixel.js';
import { SPRITE_POOL, ROLE_SPRITE, ROLE_SET, spriteName, sonic } from './sprites.js';
import { SCALE_LIST, findScale, guessScale } from './scales.js';
import { listRefs, listMine, getMine, putMine, deleteMine, newId, fetchRef, fetchBank, fetchCatalog, listMySounds, putMySound, deleteMySound } from './library.js';
import { SOUND_EXT, isSoundFile, readSoundFile, writeSound, writeKit } from './soundfile.js';
import { writeVGM } from './engine/vgm.js';
import { PATCH_EXT, isPatchFile, readPatchFile, regsToTfi, regsToDmp, guessSprite, guessNote, voiceToRegs, regsToVoice } from './patches.js';
import { clone as fmClone, TYPES as FM_TYPES, BLANK as FM_BLANK, KNOBS as FM_KNOBS, OP_PARAMS as FM_OP_PARAMS, VOICE_PARAMS as FM_VOICE_PARAMS, ALG_GRAPH, SLOT_OF_OP, isCarrier, getParam as fmGetParam, setParam as fmSetParam, setKnob, nudgeKnob, knobLive as fmKnobLive, mutate as fmMutate, envelope as fmEnvelope } from './fmedit.js';
import { BUDGETS as SMP_BUDGETS, SONG_BUDGET_KB, budgetsFor, STEPS as SMP_STEPS, decodeAudio, trimSilence, guessPitch, peaks as wavePeaks, bytesFor, render as renderSample, fitOptions } from './sampler.js';
import { ui, initScreen, resizeScreen, beginFrame, endFrame, region, hot, fill, frame, text, dither, ants, strip, stripW, BIG, SMALL, button, field, focusField, blurField } from './gui.js';

const LAST_KEY = 'segapaint:last', THEME_KEY = 'segapaint:theme', SCALE_KEY = 'segapaint:scale', SOUND_KEY = 'segapaint:sound';
const VGM_KEY = 'segapaint:vgm'; // the last export's author and DAC choice
const FOLD_KEY = 'segapaint:fold'; // which left panels are folded
const VERSION = 'BETA 1';
// The art editor saves through tools/serve.py, so it is offered only when the app runs from it (not on the web copy).
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const SCALES = [2, 3, 4, 5, 6];
const RATE = 44100;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- pitch helpers ----------
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const IS_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NAT_PC = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const diatOf = (p) => (Math.floor(p / 12) - 1) * 7 + LETTER[((p % 12) + 12) % 12];
const natFromDiat = (d) => (Math.floor(d / 7) + 1) * 12 + NAT_PC[((d % 7) + 7) % 7];
const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);

// General MIDI drum kit (channel 10) as shown on the staff: row, icon, name.
const KIT = {
  41: { row: 32, sprite: 'tom', name: 'Floor tom' }, 42: { row: 39, sprite: 'hihat', name: 'Closed hat' },
  43: { row: 33, sprite: 'drum', name: 'Floor tom 2' }, 44: { row: 29, sprite: 'key', name: 'Pedal hat' },
  45: { row: 34, sprite: 'mushroom', name: 'Low tom' }, 46: { row: 40, sprite: 'cymbal', name: 'Open hat' },
  47: { row: 36, sprite: 'coin', name: 'Mid tom' }, 48: { row: 37, sprite: 'heart', name: 'Mid tom 2' },
  49: { row: 41, sprite: 'star', name: 'Crash' }, 50: { row: 38, sprite: 'diamond', name: 'High tom' },
  51: { row: 42, sprite: 'bell', name: 'Ride' }, 55: { row: 43, sprite: 'cymbal', name: 'Splash' },
};
const kitOf = (n) => KIT[n.gm] || KIT[42];

// What the voices can play (MIDI), clipped to C1..C8.
const STAFF_LO = 24, STAFF_HI = 108;
const PSG_LO = 45; // A2: the PSG's 10-bit tone divider cannot go lower

// The staff, like a printed score: the grand staff, and faint 15ma / 15mb staves above and below.
const TREBLE_LINES = [30, 32, 34, 36, 38]; // E4 G4 B4 D5 F5
const BASS_LINES = [18, 20, 22, 24, 26];   // G2 B2 D3 F3 A3
const TREBLE15_LINES = [44, 46, 48, 50, 52], BASS15_LINES = [4, 6, 8, 10, 12];
const LEDGERS = [42, 40, 28, 16, 14], LEDGERS15 = [56, 54, 2, 0]; // dotted: C6 A5 C4 E2 C2, C8 A7 E0 C0
const DIAT_TOP = 57, DIAT_BOT = -1;

// ---------- state ----------
const S = {
  song: null, pcm: null, modelTl: null,
  active: 0, hidden: new Set(), muted: new Set(), solo: new Set(),
  scroll: 0, vy: 0, vyMax: 0, lanes: [], colW: 8, follow: true, followHold: false,
  tool: 'select', // the arrow first
  layers: new Set(), // the tracks chosen together (Ctrl / Shift + click); empty or one = just the active track
  repMode: 'x2', // what the repeat tool does: x2 / x3 / x4 (make or set a repeat), loop (the green one), del
  playing: false, loop: false, // loop off: a song from the games goes on to the next one when it ends
  pos: 0, posAt: 0, // last reported position (samples) and performance.now()
  ctx: null, node: null, analyser: null, latency: 0,
  undo: [], redo: [], drag: null, hover: null, mixMuted: '',
  doc: null, // { kind: 'ref', dir } | { kind: 'user', id, base, name }
  dirty: false, refs: [],
  sel: new Set(), clip: null, // selected notes of the active layer; copied notes
  theme: 'light', volume: 1.6, status: '',
  sound: 'clean', // FM chip: clean (no DAC distortion, like a YM3438) or model1 (the first Mega Drive's YM2612)
  flyout: false, menu: false, dlg: null, layerScroll: 0,
  fold: { layers: false, about: false, playlist: false, side: false }, aboutPage: 0, // the left column's panels folded to their title bars (side: the whole column hidden); the Description page shown
  pl: { scroll: 0, games: null }, // the Playlist panel: its scroll and the games unfolded (null: the game of the song open)
};
window.SEGA = S; // handy for debugging in the console

const $ = (id) => document.getElementById(id);
const activeLayer = () => S.song?.layers[S.active];
let g = null; // the screen's 2D context (set in init)

// ---------- documents: reference tracks (locked) and my songs ----------
async function openDoc(doc) {
  let song, base;
  if (doc.kind === 'ref') { song = await fetchRef(doc.dir); base = doc.dir; doc = { kind: 'ref', dir: doc.dir }; }
  else if (doc.kind === 'new') {
    base = baseRef(); song = await newSongData(base); doc = { kind: 'new', base, name: 'Untitled' };
    mergeLibrary(song, await fetchRef(base));
    song.game = S.refs.find((r) => r.dir === base)?.game || '';
  } else {
    const rec = await getMine(doc.id);
    if (!rec) throw new Error('Song not found');
    song = rec.song; base = rec.base; doc = { kind: 'user', id: rec.id, base, name: rec.name };
    mergeLibrary(song, await fetchRef(base));
    song.game = S.refs.find((r) => r.dir === base)?.game || '';
  }
  const bank = withCatalog(await fetchBank(base, song.bankFile || 'pcm.bin'), song);
  S.doc = doc;
  setupSong(song, bank);
  if (doc.kind !== 'new') try { localStorage.setItem(LAST_KEY, JSON.stringify(doc.kind === 'ref' ? doc : { kind: 'user', id: doc.id })); } catch (e) { /* ignore */ }
}

// ---------- the shared sound library (project standard): any song can use any sound of any game, every channel ----------
// My sounds (IndexedDB) come first, as one more group of the library: S.mySounds[sec], entries with game MY.
const MY = 'My sounds', MY_SECS = ['fm', 'drums', 'psg', 'noise', 'samples'];
const gameCatOf = (sec) => S.catalog?.games.flatMap((g) => g[sec] || []) || [];
const catOf = (sec) => [...(S.mySounds?.[sec] || []), ...gameCatOf(sec)];
async function loadMySounds() {
  const by = Object.fromEntries(MY_SECS.map((k) => [k, []]));
  try { for (const r of await listMySounds()) by[r.type]?.push({ ...r, game: MY, my: true }); } catch (e) { console.error(e); }
  S.mySounds = by;
}
// An FM patch without what notes change: total level (volume) and pan.
const patchKey = (regs) => JSON.stringify(regs.filter(([r]) => !((r >= 0x40 && r < 0x50) || r === 0xb4)).map(([r, v]) => [r, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
// The sound a library entry gives once it is in the song (song.libUse: library key -> its instrument / macro).
function libSound(c, u) {
  const base = { i: u.i, m: u.m, d: Math.round(S.song.step * 2), lib: c.key, group: c.game };
  if (c.gm != null && c.my) return { ...base, key: 'g' + c.gm + '.' + u.i, gm: c.gm, p: c.p, sprite: spriteName(c.sprite), name: c.name };
  if (c.gm != null) return { ...base, key: 'g' + c.gm, gm: c.gm, p: c.p, sprite: KIT[c.gm]?.sprite || 'cymbal', name: KIT[c.gm]?.name || 'Drum' };
  if (c.ins) return { ...base, key: 'i' + u.i, p: c.p, sprite: spriteName(c.sprite), name: c.name };
  return { ...base, key: 'm' + u.m, p: 69, sprite: spriteName(c.sprite), name: c.name };
}
const libUsed = (c) => { const u = S.song.libUse?.[c.key]; return u && S.song.macros[u.m] && (u.i == null || S.song.instruments[u.i]) ? u : null; };
// FM / FM drum / PSG / noise sound of the library: its instrument and macro join the song when first picked.
function addCatalogSound(c) {
  let u = libUsed(c);
  if (!u) {
    const mac = structuredClone(c.mac);
    mac.pitch = mac.noise ? 60 : Array.isArray(mac.base) ? Math.round(hzMidi(fmHz(mac.base[0], mac.base[1]))) : Math.round(hzMidi(psgHz(mac.base)));
    S.song.macros.push(mac);
    u = { m: S.song.macros.length - 1 };
    if (c.ins) { S.song.instruments.push(structuredClone(c.ins)); u.i = S.song.instruments.length - 1; }
    (S.song.libUse ??= {})[c.key] = u;
  }
  return libSound(c, u);
}
// ---------- samples of the library: any song can use the samples of every example, of any game ----------
// The library's bank goes after the song's own; a song sample taken from it keeps its key (cat) and is re-pointed on load.
const catSamples = () => catOf('samples');
function catPoint(x) {
  if (x.pcm) return; // a sample of My sounds brings its bytes (myPoint)
  const c = catSamples().find((y) => y.key === x.cat);
  if (c) Object.assign(x, { off: S.catOff + c.off, len: c.len, loop: c.loop >= 0 ? S.catOff + c.loop : -1 });
}
function withCatalog(bank, song) {
  const lib = S.catalog?.bank;
  S.catOff = bank.length;
  if (!lib?.length) return bank;
  const pcm = new Uint8Array(bank.length + lib.length);
  pcm.set(bank); pcm.set(lib, bank.length);
  for (const x of song.samples || []) if (x.cat) catPoint(x);
  return withMySamples(pcm, song);
}
// Samples from My sounds keep their bytes in the song (base64 pcm): they go after the banks, the song needs nothing else.
const toB64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(t); };
const fromB64 = (t) => Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0));
function withMySamples(bank, song) {
  const own = (song.samples || []).filter((x) => x.pcm);
  if (!own.length) return bank;
  const data = own.map((x) => fromB64(x.pcm));
  const pcm = new Uint8Array(bank.length + data.reduce((a, u) => a + u.length + 1, 0)); // a 0 after each: end of sample
  pcm.set(bank);
  let at = bank.length;
  own.forEach((x, k) => {
    pcm.set(data[k], at);
    Object.assign(x, { off: at, len: data[k].length, loop: x.loopAt >= 0 ? at + x.loopAt : -1 });
    at += data[k].length + 1;
  });
  return pcm;
}
// The song's sample for a library sample (the same one by game and ROM address), or -1.
const songSampleOf = (c) => (S.song.samples || []).findIndex((x) => x.cat === c.key || (x.romAddr === c.romAddr && (S.song.game || '') === c.game));
// The game a song sample belongs to in the library (or null).
const sampleGame = (x) => catSamples().find((c) => c.key === x.cat || (c.romAddr === x.romAddr && c.game === (S.song.game || '')))?.game || null;
const SAMPLE_KEYS = ['oneShot', 'baseStep', 'pitched', 'transp', 'steps', 'voice', 'romAddr', 'dpcm', 'drumRow'];
function addCatalogSample(c) {
  let i = songSampleOf(c);
  if (i >= 0) return i;
  const x = { cat: c.key, name: c.name, sprite: c.sprite };
  for (const k of SAMPLE_KEYS) if (c[k] !== undefined) x[k] = c[k];
  if (c.pcm) {
    Object.assign(x, { pcm: toB64(c.pcm), loopAt: c.loopAt ?? -1 });
    S.pcm = withMySamples(S.pcm, { samples: [x] });
  } else catPoint(x);
  if (x.drumRow != null && S.song.samples?.some((y) => y.drumRow === x.drumRow)) delete x.drumRow; // a kit's row, if free
  (S.song.samples ??= []).push(x);
  assignSampleRows(S.song);
  return S.song.samples.length - 1;
}

// Every layer gets one of the Mega Drive tones, no two alike while there are tones left.
function assignTones(layers) {
  const used = new Set();
  for (const L of layers) {
    const order = toneOrder(L.color || '#ffff00');
    L.tone = order.find((k) => !used.has(k)) ?? order[0];
    used.add(L.tone);
    L.color = toneCss(L.tone);
  }
}

function setupSong(song, bank) {
  // md: how long a recorded note was when its register macro was taken. Its last frame already holds the next note's
  // pitch (the driver writes it early); once a note is made longer (slower tempo, a longer tail) that must not play.
  for (const L of song.layers) if (L.kind === 'fm' || L.kind === 'psg' || L.kind === 'noise') for (const n of L.notes) if (n.m != null && n.md == null && n.slide == null) n.md = n.d;
  S.song = prepareSong(song);
  S.pcm = bank;
  // bar 1 starts at song.barOffset (a game song with a pickup before it), else at step 0 (game songs, new songs)
  S.barOffset = song.barOffset ?? (song.ticksPerStep || song.uniform ? 0 : firstStep(song.layers.find((l) => l.role === 'bass') || song.layers[0]) % 16);
  assignSampleRows(song);
  assignTones(song.layers);
  for (const L of song.layers) indexLayer(L);
  for (const L of song.layers) {
    L.palette = uniqueSprites((L.palette || layerSounds(L)).map((x) => ({ ...x, sprite: spriteName(x.sprite) })));
    if (L.kind === 'fm' && !L.kit) for (const x of L.palette) { // the song's own FM patches go by their library names
      const c = x.i != null && song.instruments[x.i] && gameCatOf('fm').find((y) => patchKey(y.ins.regs) === patchKey(song.instruments[x.i].regs));
      if (c && /^(Patch|ROM) \d+$/.test(x.name || '')) Object.assign(x, { name: c.name, sprite: spriteName(c.sprite) });
    }
    L.sounds = L.palette;
    L.sel = L.sounds[0];
  }
  Object.assign(S, { undo: [], redo: [], drag: null, hover: null, dirty: false, mixMuted: '', layerScroll: 0, aboutPage: 0 });
  S.hidden.clear(); S.muted.clear(); S.solo.clear(); S.sel.clear(); S.layers = new Set();
  S.active = Math.max(0, song.layers.findIndex((l) => l.role === 'bass'));
  computeRange();
  updateTimingUI();
  updateBarTools();
  rebuildModel();
  staffGeom();
  centerOnRow((S.contentTop + S.contentBot) / 2);
  S.scroll = S.barOffset - 2;
  updateDocUI();
  S.cleanSig = docSig();
  S.pos = S.song.stepTimes[S.song.step0]; S.posAt = performance.now(); // a song opens at its start
  if (S.node) {
    post({ type: 'pause' }); S.playing = false;
    sendTimeline(S.pos); sendMute();
  }
}

const docTitle = () => (S.doc.kind === 'ref' ? S.song.title : S.doc.name);
// Saved in My songs (examples and new songs ask for a name on the first save).
const isSaved = () => S.doc.kind === 'user';
function updateDocUI() {
  document.title = `${S.dirty ? '• ' : ''}${docTitle()} · Sega Paint`;
}

// Song JSON without runtime-only fields.
const RUNTIME_KEYS = new Set(['sounds', 'sel', 'def', 'pitch', 'game', 'tone', 'group', 'pick']);
const serializeObj = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') || RUNTIME_KEYS.has(k) ? undefined : v)));
const serialize = () => serializeObj(S.song);

async function save() {
  if (!isSaved()) { openDialog({ kind: 'save', name: S.doc.kind === 'new' ? '' : `${docTitle()} copy` }); return; }
  await putMine({ id: S.doc.id, name: S.doc.name, base: S.doc.base, song: serialize() });
  S.dirty = false; S.cleanSig = docSig();
  updateDocUI();
  showStatus('Saved');
}

function saveCopyDialog() {
  if (!isSaved()) return; // nothing saved yet: Save asks for the name
  openDialog({ kind: 'copy', name: `${docTitle()} copy` });
}
// The first save of an example or a new song: it goes to My songs under this name and stays open.
async function saveAs(name) {
  const base = S.doc.kind === 'ref' ? S.doc.dir : S.doc.base;
  const id = newId();
  S.song.title = name;
  await putMine({ id, name, base, song: serialize() });
  S.doc = { kind: 'user', id, base, name };
  S.dirty = false; S.cleanSig = docSig();
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ kind: 'user', id })); } catch (e) { /* ignore */ }
  updateDocUI();
  showStatus('Saved');
}
async function saveCopy(name) {
  const base = S.doc.kind === 'ref' ? S.doc.dir : S.doc.base;
  const id = newId();
  const song = serialize();
  song.title = name;
  for (const L of song.layers) for (const n of L.notes) delete n.e; // the copy is the new baseline
  await putMine({ id, name, base, song });
  await openDoc({ kind: 'user', id });
  showStatus('Saved a copy');
}

// A new empty song on the sounds of the base example (kept in memory until it is saved).
async function newSongData(base, bpm = 120, bars = 4) {
  const ref = await fetchRef(base);
  // the sound library: every FM instrument / FM drum and PSG sound of the reference, named after its track
  const prev = S.song;
  S.song = prepareSong(ref);
  assignSampleRows(ref);
  const library = { fm: [], psg: [] };
  for (const L of ref.layers) {
    indexLayer(L);
    const sounds = layerSounds(L);
    sounds.forEach((x, k) => {
      if (L.kind === 'fm') library.fm.push(x.gm != null ? x : { ...x, name: sounds.length > 1 ? `${L.name} ${k + 1}` : L.name });
      else if (L.kind === 'psg' && !library.psg.length) library.psg.push({ ...x, name: 'Square' });
    });
  }
  library.fm.push(...(ref.library?.fm || [])); // the game's other FM patches
  S.song = prev;
  const step = 44100 * 60 / (bpm * 4);
  const steps = bars * 16;
  ref.globals = ref.globals.filter((x) => x[0] <= 1).map((x) => [0, x[1], x[2], x[3]]);
  Object.assign(ref, {
    title: 'Untitled', uniform: true, bpm, step, step0: 0, layers: [], library,
    stepTimes: Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 10) / 10),
    end: Math.round(steps * step), loopStart: -1,
  });
  delete ref.ticksPerStep;
  return serializeObj(ref);
}

// Sounds the reference got after this song was made (e.g. the game's FM patches from the ROM) join its library.
function mergeLibrary(song, ref) {
  // samples fixed in the reference since (DPCM clips: voice, guitar licks) are taken over by ROM address
  for (const x of song.samples || []) {
    const r = x.romAddr != null && ref.samples?.find((y) => y.romAddr === x.romAddr && y.dpcm);
    if (r && !x.dpcm) Object.assign(x, { off: r.off, len: r.len, loop: r.loop, dpcm: true });
  }
  const lib = (song.library ??= { fm: [], psg: [] });
  lib.fm ??= [];
  // ROM patches no example plays (sound effects) leave the picker, unless this song already plays them
  const played = new Set(song.layers.flatMap((L) => L.notes.map((n) => n.i)));
  lib.fm = lib.fm.filter((x) => x.rom == null || played.has(x.i) || ref.library?.fm?.some((y) => y.rom === x.rom));
  for (const x of ref.library?.fm || []) {
    if (x.rom == null || lib.fm.some((y) => y.rom === x.rom)) continue;
    song.instruments.push(structuredClone(ref.instruments[x.i]));
    song.macros.push(structuredClone(ref.macros[x.m]));
    lib.fm.push({ ...x, i: song.instruments.length - 1, m: song.macros.length - 1 });
  }
}

// The example new songs take their sounds from (and the one opened first).
// a game song's number in the disc order of songs/index.json, as on a CD: '02'
const trackNo = (ref) => (ref?.track ? String(ref.track).padStart(2, '0') : '');
const baseRef = () => (S.refs.find((r) => r.dir === 'cheese-grater') || S.refs[0]).dir;

const confirmDiscard = async () => !S.dirty || ask('Discard unsaved changes?', 'Discard');

async function showOpenDialog() {
  const mine = await listMine();
  const tab = S.dlg?.kind === 'open' ? S.dlg.tab : S.doc.kind === 'ref' ? 'refs' : 'mine';
  // the games' songs come folded by game, the game of the song open now unfolded
  const games = S.dlg?.kind === 'open' ? S.dlg.games : new Set(S.doc.kind === 'ref' ? [S.refs.find((r) => r.dir === S.doc.dir)?.game || ''] : []);
  openDialog({ kind: 'open', tab, mine, games, scroll: 0 });
}

async function importFile(file) {
  const song = JSON.parse(await file.text());
  if (!Array.isArray(song.layers) || !song.stepTimes) throw new Error('Not a Sega Paint song');
  const base = song.base || baseRef();
  const name = song.title || file.name.replace(/\.json$/i, '');
  const id = newId();
  await putMine({ id, name, base, song });
  closeDialog();
  await openDoc({ kind: 'user', id });
}

// ---------- export: one dialog, the format picked in it ----------
// VGM / VGZ: the song as the player plays it (every track, mutes ignored), written as VGM 1.71 (player/engine/vgm.js).
// DAC: 'pcm' plays the mix byte by byte (0x8n), every VGM player knows it; 'stream' uses DAC streams (0x90-0x95),
// about 4 times smaller, but older players (Game Music Emu: foo_gep, ffmpeg) play them without the samples.
// JSON: the song file itself, to open again with Import.
const EXPORT_FORMATS = ['vgz', 'vgm', 'json'];
function openExport() {
  let last = {};
  try { last = JSON.parse(localStorage.getItem(VGM_KEY) || '{}'); } catch (e) { /* ignore */ }
  const fmt = EXPORT_FORMATS.includes(last.fmt) ? last.fmt : 'vgz';
  openDialog({ kind: 'export', fmt, title: docTitle(), author: last.author || '', dac: last.dac === 'stream' ? 'stream' : 'pcm' });
}
function exportFieldOpts(d, key) {
  return { max: 60, onInput: (v) => { d[key] = v; }, onEnter: () => dialogOk(d), onEscape: () => closeDialog() };
}
const FORMAT_TIP = { vgz: 'For music players, packed', vgm: 'For music players', json: 'Song file: opens with Import' };
function drawExportDialog(d) {
  const T = ui.T;
  const r = dialogBox(230, 14 + 118, 'EXPORT');
  let x = r.x + 8;
  for (const f of EXPORT_FORMATS) {
    x += button(x, r.y + 6, '.' + f.toUpperCase(), { id: 'fmt' + f, w: 36, primary: d.fmt === f, tip: FORMAT_TIP[f], click: () => { d.fmt = f; } }) + 3;
  }
  text('TITLE', r.x + 8, r.y + 27, T.dim);
  field(r.x + 8, r.y + 35, r.w - 16, 'expTitle', d.title, { ...exportFieldOpts(d, 'title'), placeholder: 'Untitled' });
  if (d.fmt !== 'json') {
    text('AUTHOR', r.x + 8, r.y + 53, T.dim);
    field(r.x + 8, r.y + 61, r.w - 16, 'expAuthor', d.author, { ...exportFieldOpts(d, 'author'), placeholder: 'Your name' });
    text('SAMPLES', r.x + 8, r.y + 79, T.dim);
    x = r.x + 8;
    x += button(x, r.y + 87, 'ANY PLAYER', { id: 'vgmPcm', primary: d.dac === 'pcm', tip: 'Plays everywhere, bigger .vgm', click: () => { d.dac = 'pcm'; } }) + 3;
    button(x, r.y + 87, 'SMALLER FILE', { id: 'vgmStream', primary: d.dac === 'stream', tip: '4x smaller: VGMPlay, libvgm only', click: () => { d.dac = 'stream'; } });
  }
  const wOk = textWidth('EXPORT') + 10, wC = textWidth('CANCEL') + 10, by = r.y + r.h - 19;
  button(r.x + r.w - 8 - wOk, by, 'EXPORT', { id: 'dlgOk', primary: true, click: () => dialogOk(d) });
  button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'dlgCancel', click: () => closeDialog() });
}
const gzipBytes = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fileStem = (title) => title.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'song';
async function exportSong(d) {
  closeDialog();
  const title = d.title.trim() || docTitle(), author = d.author.trim();
  try { localStorage.setItem(VGM_KEY, JSON.stringify({ author, dac: d.dac, fmt: d.fmt })); } catch (e) { /* ignore */ }
  if (d.fmt === 'json') { exportJson(title); return; }
  const now = new Date(), date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const res = writeVGM(buildTimeline(S.song, S.pcm), { title, author, date }, { dac: d.dac });
  const bytes = d.fmt === 'vgz' ? await gzipBytes(res.bytes) : res.bytes;
  const name = `${fileStem(title)}.${d.fmt}`;
  downloadBytes(name, bytes);
  const kb = bytes.length < 1048576 ? `${Math.max(1, Math.round(bytes.length / 1024))} KB` : `${(bytes.length / 1048576).toFixed(1)} MB`;
  const loop = res.loopSamples === res.samples ? 'loops from the start' : `loop ${clock(res.loopSamples / 44100)}`;
  showStatus(`Exported ${name}: ${kb}, ${clock(res.samples / 44100)} (${loop})`);
}

function exportJson(title) {
  const song = serialize();
  song.base = S.doc.kind === 'ref' ? S.doc.dir : S.doc.base;
  const name = `${fileStem(title)}.json`;
  downloadBytes(name, new TextEncoder().encode(JSON.stringify(song)));
  showStatus(`Exported ${name}`);
}
// Back to the last saved version; a game track goes back to how it came, a new song to empty.
async function revert() {
  if (!S.dirty || !await ask(isSaved() ? 'Revert to the last saved version?' : 'Undo all changes?', 'Revert')) return;
  await openDoc(S.doc.kind === 'new' ? { kind: 'new' } : S.doc);
}
async function newSong() {
  if (!await confirmDiscard()) return;
  await openDoc({ kind: 'new' });
  showStatus('New song');
}

const firstStep = (L) => L.notes.reduce((m, n) => Math.min(m, n.s), Infinity);

function indexLayer(L) {
  const song = S.song;
  L.notes.sort((a, b) => a.s - b.s || (a.n || 0) - (b.n || 0));
  for (const n of L.notes) {
    n._t = noteTime(song, n);
    if (L.kind === 'dac') {
      const last = n.ch[n.ch.length - 1];
      n._d = last[0] + last[2] * last[3];
    } else n._d = n.d;
    n._e = timeToStep(song, n._t + n._d);
    n._slide = slideOf(L, n);
  }
  // a sample track is one DAC voice: the next note cuts the sound, so a note never reaches past it
  if (L.kind === 'sample') L.notes.forEach((n, k) => {
    const next = L.notes.slice(k + 1).find((m) => m.s > n.s);
    if (next && next._t < n._t + n._d) { n._d = next._t - n._t; n._e = next.s; }
  });
  if (L.kind !== 'dac' && L.kind !== 'sample' && !L._sprites) {
    const cnt = new Map();
    for (const n of L.notes) cnt.set(n.i, (cnt.get(n.i) || 0) + 1);
    const ranked = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
    const set = ROLE_SET[L.role] || [ROLE_SPRITE[L.role] || 'ghost'];
    L._sprites = new Map(ranked.map((i, k) => [i, set[k % set.length]]));
  }
}

// Pitch slide inside a note, in semitones (0 = none). User-set slides win; otherwise read from the
// recorded register macro, ignoring the last frame (drivers pre-write the next note's pitch there)
// and drum kits (their pitch envelopes are part of the drum sound).
// Where a note's recorded macro stops counting: its end, or the length it was recorded with if it is longer now.
const macroEnd = (n) => (n.md != null && n.d > n.md ? n.md : n.d);
function slideOf(L, n) {
  if (n.slide != null) return n.slide;
  if (n.gm != null || (L.kind !== 'fm' && L.kind !== 'psg')) return 0;
  const mac = S.song.macros[n.m];
  if (!mac) return 0;
  let last = null;
  for (const e of mac.ev) {
    if (e[0] >= macroEnd(n) - 1000) break;
    if (e[1] === 'f') last = hzMidi(fmHz(e[2], e[3])) - hzMidi(fmHz(mac.base[0], mac.base[1]));
    else if (e[1] === 't') last = hzMidi(psgHz(e[2])) - hzMidi(psgHz(mac.base));
  }
  return last != null && Math.abs(last) >= 0.75 ? Math.round(last) : 0;
}

function spriteOf(L, n) {
  if (L.kind === 'sample') return L.palette?.find((x) => x.smp === n.smp)?.sprite || S.song.samples[n.smp]?.sprite || 'guitar';
  if (n.gm != null) return L.palette?.find((x) => x.gm === n.gm)?.sprite || kitOf(n).sprite;
  return L.palette?.find((x) => x.i === n.i)?.sprite || (L._sprites && L._sprites.get(n.i)) || ROLE_SPRITE[L.role] || 'ghost';
}
// Fixed staff row for sounds without pitch: FM kit pieces, and samples on the drum voices (DAC1-3)
// or samples that are never pitched.
function drumRow(L, n) {
  if (n.gm != null) return kitOf(n).row;
  if (L.kind !== 'sample') return undefined;
  const smp = S.song.samples[n.smp];
  if (!smp) return undefined;
  return smp.pitched && (L.voice ?? MELODIC_VOICE) === MELODIC_VOICE ? undefined : smp.drumRow;
}
// Give every sample a staff row of its own (used when it plays as a drum).
const FREE_ROWS = [29, 33, 37, 39, 41, 30, 32, 34, 36, 38, 40, 42, 28, 27, 43, 26, 44, 25, 24, 23, 22, 21, 20];
function assignSampleRows(song) {
  const used = new Set((song.samples || []).map((x) => x.drumRow).filter((r) => r != null));
  for (const smp of song.samples || []) {
    if (smp.drumRow != null) continue;
    smp.drumRow = FREE_ROWS.find((r) => !used.has(r)) ?? 30;
    used.add(smp.drumRow);
  }
  (song.samples || []).forEach((smp, i) => { smp.name ??= `Sample ${i + 1}`; smp.sprite = spriteName(smp.sprite ?? SPRITE_POOL[(i * 7) % SPRITE_POOL.length]); });
}
// No two sounds in one palette share an icon.
function uniqueSprites(list) {
  const used = new Set();
  for (const snd of list) {
    if (used.has(snd.sprite)) snd.sprite = SPRITE_POOL.find((x) => !used.has(x)) || snd.sprite;
    used.add(snd.sprite);
  }
  return list;
}
const noteDiat = (L, n) => drumRow(L, n) ?? diatOf(n.p);

// Voices that cannot change pitch get a lane of their own under the staff instead of staff rows:
// drum samples (DAC1-3), noise, FM drum kits, and the premixed DAC stream of reference songs.
const isLane = (L) => L.kind === 'dac' || L.kind === 'noise' || !!L.kit || (L.kind === 'sample' && (L.voice ?? MELODIC_VOICE) !== MELODIC_VOICE);
const fixedPitch = (L, n) => isLane(L) || drumRow(L, n) != null;
// A sharp sits half a row above its natural (between two staff rows, level with its black key): no # sign.
const SHARP_UP = 2;
const isSharp = (L, n) => !fixedPitch(L, n) && IS_SHARP[n.p % 12];
const noteY = (L, n) => (isLane(L) ? laneY(L) : yOf(noteDiat(L, n)) - (isSharp(L, n) ? SHARP_UP : 0));

// Notes (MIDI) a pitched sound can play: a sample's pitch table covers 4 octaves; the PSG stops at A2.
function soundRange(L, x) {
  if (L.kind === 'sample') {
    const smp = S.song.samples[x.smp];
    if (!smp?.pitched) return null;
    const lo = 0x24 - (smp.transp || 0);
    return [Math.max(STAFF_LO, lo), Math.min(STAFF_HI, lo + 47)];
  }
  if (L.kind === 'psg') return [PSG_LO, STAFF_HI];
  return [STAFF_LO, STAFF_HI];
}

// The sounds a layer can place (the palette). Most used first.
function layerSounds(L) {
  const count = (key) => { const m = new Map(); for (const n of L.notes) m.set(key(n), (m.get(key(n)) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const durOf = (pred) => { const ds = L.notes.filter(pred).map((n) => n.d).sort((a, b) => a - b); return ds[ds.length >> 1] || 7000; };
  if (L.kind === 'sample') {
    return count((n) => n.smp).map(([smp]) => sampleSound(smp, L.notes.find((n) => n.smp === smp).p, durOf((n) => n.smp === smp)));
  }
  if (L.kit) {
    return count((n) => n.gm).map(([gm]) => {
      const first = L.notes.find((n) => n.gm === gm);
      return { key: 'g' + gm, gm, i: first.i, m: first.m, p: first.p, d: durOf((n) => n.gm === gm), sprite: KIT[gm]?.sprite || 'cymbal', name: KIT[gm]?.name || 'Drum' };
    });
  }
  if (L.kind === 'fm') {
    return count((n) => n.i).map(([i], k) => {
      const m = count((n) => (n.i === i ? n.m : -1)).find(([mm]) => mm >= 0)[0];
      return { key: 'i' + i, i, m, d: durOf((n) => n.i === i), sprite: spriteOf(L, { i }), name: `Patch ${k + 1}` };
    });
  }
  return [{ key: 'd', i: L.def.i, m: L.def.m, d: L.def.d, sprite: spriteOf(L, {}), name: L.kind === 'noise' ? 'Noise' : 'Square' }];
}

function sampleSound(i, p, d) {
  const smp = S.song.samples[i];
  return { key: 's' + i, smp: i, p: p ?? 36 + 24 - (smp.transp || 0), d: d ?? Math.round(S.song.step * 2), sprite: smp.sprite, name: smp.name };
}

// Everything a layer of this kind could play (the track settings picker).
function soundLibrary(L) {
  if (L.kind === 'sample') {
    // DAC4 resamples to pitch, so it only offers samples that have a pitch table.
    // Every sample of the library (all games), then the song's own ones the library does not have.
    const melodic = (L.voice ?? MELODIC_VOICE) === MELODIC_VOICE;
    const fits = (x) => !melodic || x.pitched;
    const out = [], seen = new Set();
    for (const c of catSamples()) {
      if (!fits(c)) continue;
      const i = songSampleOf(c);
      if (i >= 0) { seen.add(i); out.push(Object.assign(L.palette.find((x) => x.smp === i) || sampleSound(i), { group: c.game }, c.my ? { lib: c.key } : {})); } // a sample of My sounds stays one
      else out.push({ key: 'c' + c.key, cat: c, name: c.name, sprite: spriteName(c.sprite), p: 36 + 24 - (c.transp || 0), d: Math.round(S.song.step * 2), group: c.game });
    }
    S.song.samples.forEach((x, i) => { if (!seen.has(i) && fits(x)) out.push(Object.assign(L.palette.find((y) => y.smp === i) || sampleSound(i), { group: 'This song' })); });
    return out;
  }
  if (L.kind === 'psg' || L.kind === 'noise') {
    const out = [];
    for (const c of catOf(L.kind)) {
      const u = libUsed(c);
      out.push(L.palette.find((x) => x.lib === c.key) || (u ? libSound(c, u) : { key: 'c' + c.key, cat: c, name: c.name, sprite: spriteName(c.sprite), p: 69, group: c.game }));
      out.at(-1).group = c.game;
    }
    for (const x of L.palette) if (!out.includes(x)) { x.group = 'This song'; out.push(x); }
    return out;
  }
  if (L.kind === 'fm') {
    // The library's FM instruments (or FM drums for a drum track) of every game; the song's own sounds of the same
    // patch / drum stand in for them, the rest of the song's FM sounds follow.
    const kit = !!L.kit, own = new Map();
    for (const x of [...L.palette, ...S.song.layers.filter((M) => M.kind === 'fm').flatMap((M) => M.palette)]) if ((x.gm != null) === kit && !own.has(x.key)) own.set(x.key, x);
    const out = [], used = new Set();
    for (const c of catOf(kit ? 'drums' : 'fm')) {
      // a sound of My sounds is only itself; a game's sound also stands for the song's own one of the same patch / drum
      const same = (x) => x.lib === c.key || (!c.my && !x.lib?.startsWith('my:') && (kit ? x.gm === c.gm : x.i != null && S.song.instruments[x.i] && patchKey(S.song.instruments[x.i].regs) === patchKey(c.ins.regs)));
      const mine = [...own.values()].find((x) => !used.has(x.key) && same(x));
      const u = libUsed(c);
      let x;
      if (mine) { used.add(mine.key); if (/^(Patch|ROM) \d+$/.test(mine.name || '')) mine.name = c.name; x = mine; }
      else if (u) x = libSound(c, u);
      else x = { key: 'c' + c.key, cat: c, gm: c.gm, p: c.p, name: kit && !c.my ? KIT[c.gm]?.name || 'Drum' : c.name, sprite: kit && !c.my ? KIT[c.gm]?.sprite || 'cymbal' : spriteName(c.sprite) };
      x.group = c.game;
      out.push(x);
    }
    for (const x of own.values()) if (!used.has(x.key)) { x.group = 'This song'; out.push(x); }
    return out;
  }
  return L.palette;
}

// Staff rows in use (at least C2..C6): the view starts centred on them; the staff itself always shows C0..C8.
function computeRange() {
  let lo = 14, hi = 42;
  for (const L of S.song.layers) {
    if (isLane(L)) continue;
    for (const n of [...L.notes, ...(L.palette || [])]) {
      if (n.p == null && drumRow(L, n) == null) continue;
      const d = noteDiat(L, n); lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
  }
  S.contentTop = hi + 2; S.contentBot = lo - 2;
  S.lanes = S.song.layers.filter(isLane);
  S.totalSteps = Math.ceil(timeToStep(S.song, S.song.end)) + 4;
}

// ---------- edits, undo/redo, persistence ----------
function snapshot() {
  const o = { _timing: { bpm: S.song.bpm, bars: songBars(), loop: loopStep(), repeats: S.song.repeats || [] } };
  for (const L of S.song.layers) if (L.kind !== 'dac') o[L.id] = L.notes.map(({ s, n, d, md, p, i, m, e, smp, gm, slide, vol, pan }) => ({ s, n, d, md, p, i, m, e, smp, gm, slide, vol, pan }));
  return JSON.stringify(o);
}
function applySnapshot(json) {
  const o = JSON.parse(json);
  if (o._timing) {
    S.song.repeats = o._timing.repeats || [];
    setTiming(o._timing.bpm, o._timing.bars, o._timing.loop ?? loopStep());
  }
  for (const L of S.song.layers) if (o[L.id]) { L.notes = o[L.id].map((x) => ({ ...x })); indexLayer(L); }
  S.sel.clear();
}
// Unsaved changes = the song differs from how it was opened or last saved (an edit undone again is no change):
// notes and timing (as undo keeps them), tracks with their names, colours and sounds, the scale lock.
function docSig() {
  const tracks = S.song.layers.map((L) => [L.id, L.kind, L.ch, L.voice, L.name, L.tone, (L.palette || []).map((x) => x.key + ':' + x.sprite)]);
  return snapshot() + JSON.stringify(tracks) + JSON.stringify(S.song.scale || null) + JSON.stringify(S.song.layers.flatMap((L) => (L.palette || []).map((x) => S.song.instruments[x.i]?.regs))); // patches (the FM editor)
}
function markDirty() {
  S.dirty = docSig() !== S.cleanSig;
  updateDocUI();
}
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 200) S.undo.shift();
  S.redo.length = 0;
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  applySnapshot(S.undo.pop());
  afterEdit();
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  applySnapshot(S.redo.pop());
  afterEdit();
}
function afterEdit() {
  updateTimingUI();
  rebuildModel();
  markDirty();
  sendTimeline();
}
// ---------- tempo and length: any song (my songs have an even grid, examples the uneven one of the game) ----------
const songBars = () => Math.max(1, Math.round((timeToStep(S.song, S.song.end) - S.barOffset) / 16));
// Loop start in steps (-1: the song does not loop).
const loopStep = () => (S.song.loopStart < 0 ? -1 : Math.round(timeToStep(S.song, S.song.loopStart) * 1000) / 1000);
// Every song loops; the green repeat (|: on the staff, flag on the ruler) only shows where the loop starts later
// than the first bar. Without it the song starts over from the beginning.
// A song with a pickup (bars from song.barOffset) shows it at bar 1 too: the pickup plays only the first time.
const loopShown = () => loopStep() > (S.song.barOffset ? 0.01 : Math.max(0, S.barOffset) + 0.01);
function setTiming(bpm, bars, loop = loopStep()) {
  const steps = bars * 16 + (S.song.barOffset || 0);
  if (loop >= steps) loop = Math.max(0, steps - 16); // keep at least the last bar inside the repeat
  if (S.song.uniform) {
    const step = RATE * 60 / (bpm * 4);
    Object.assign(S.song, { bpm, step, end: Math.round(steps * step), stepTimes: Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 10) / 10) });
  } else setUnevenTiming(bpm, bars);
  S.song.loopStart = loop < 0 ? -1 : Math.round(stepTime(S.song, loop));
  if (S.song.repeats) S.song.repeats = S.song.repeats.filter((r) => r.from < steps).map((r) => ({ ...r, to: Math.min(r.to, steps) }));
  S.perf = null;
  for (const L of S.song.layers) indexLayer(L);
}
// An example's grid keeps the game's swing: a new tempo stretches it as a whole (from the grid it was opened with),
// more bars continue it at the even step.
function setUnevenTiming(bpm, bars) {
  const s = S.song;
  const b = (s._base ??= { times: s.stepTimes.slice(), step: s.step, bpm: s.bpm, end: s.end, bars: songBars(), globals: s.globals.map((x) => x.slice()) });
  const k = b.bpm / bpm;
  Object.assign(s, { bpm, step: b.step * k, stepTimes: b.times.map((t) => Math.round(t * k * 10) / 10), globals: b.globals.map(([t, ...r]) => [Math.round(t * k), ...r]) });
  const last = bars * 16 + (S.song.barOffset ?? ((S.barOffset + 8) % 16) - 8); // bars count from the first bar of the song
  while (s.stepTimes.length - 1 - s.step0 < last + 16) s.stepTimes.push(Math.round((s.stepTimes.at(-1) + s.step) * 10) / 10);
  s.end = bars === b.bars ? Math.round(b.end * k) : Math.round(stepTime(s, last));
}
// Loop start (the green repeat) at step st, -1 = the song does not loop; works on any grid.
function setLoopStep(st) {
  S.song.loopStart = st < 0 ? -1 : Math.round(stepTime(S.song, st));
  S.perf = null;
}
function updateTimingUI() {
  let last = 0;
  for (const L of S.song.layers) for (const n of L.notes) last = Math.max(last, n._e ?? n.s);
  S.totalSteps = Math.max(Math.ceil(timeToStep(S.song, S.song.end)), Math.ceil(last)) + 4;
}
// New tempo: notes keep their steps and their length in steps; the playhead stays on its step.
function setBpm(bpm, undoable = true) {
  bpm = Math.max(40, Math.min(300, Math.round(bpm)));
  if (!bpm || bpm === S.song.bpm) { updateTimingUI(); return; }
  if (undoable) pushUndo();
  const k = S.song.bpm / bpm, at = timeToStep(S.song, writtenTime(currentPos()));
  for (const L of S.song.layers) {
    for (const n of L.notes) { if (n.d != null) n.d = Math.max(1, Math.round(n.d * k)); if (n.n) n.n = Math.round(n.n * k); }
    for (const x of L.palette || []) if (x.d) x.d = Math.round(x.d * k);
  }
  setTiming(bpm, songBars());
  S.pos = Math.max(0, playedTime(stepTime(S.song, at))); S.posAt = performance.now();
  afterEdit();
}
function setBars(bars) {
  bars = Math.max(1, Math.min(256, bars));
  if (bars === songBars()) return;
  pushUndo();
  setTiming(S.song.bpm, bars);
  afterEdit();
}

// ---------- audio ----------
async function startAudio() {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('engine/worklet.js');
  const node = new AudioWorkletNode(ctx, 'sega-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  node.connect(ctx.destination);
  node.connect(analyser);
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'pos') { S.pos = m.pos; S.posAt = performance.now(); }
    else if (m.type === 'ended') { S.playing = false; playNext(); }
  };
  Object.assign(S, { ctx, node, analyser, latency: (ctx.outputLatency || 0) + (ctx.baseLatency || 0) });
  post({ type: 'gain', gain: S.volume });
  post({ type: 'loop', on: S.loop });
  post({ type: 'clean', on: S.sound === 'clean' });
  if (S.song) { // a click on the boot splash can come before the song is loaded: setupSong sends it then
    sendTimeline(S.song.stepTimes[S.song.step0]);
    sendMute();
  }
}
// Browsers only allow audio after a user gesture: start the engine on the first one.
let audioStarting = null;
const ensureAudio = () => (audioStarting ??= startAudio());
document.addEventListener('pointerdown', () => ensureAudio(), { capture: true });
document.addEventListener('keydown', () => ensureAudio(), { capture: true });

const post = (m, tr) => S.node && S.node.port.postMessage(m, tr || []);

function rebuildModel() {
  S.perf = null;
  S.modelTl = buildTimeline(S.song, S.pcm, mixMutedSet());
}

function sendTimeline(pos) {
  const tl = S.modelTl;
  const copy = { t: tl.t.slice(), k: tl.k.slice(), r: tl.r.slice(), v: tl.v.slice(), n: tl.n, end: tl.end, loopStart: tl.loopStart };
  post({ type: 'timeline', tl: copy, pos: pos ?? currentPos() }, [copy.t.buffer, copy.k.buffer, copy.r.buffer, copy.v.buffer]);
}

const layerOff = (i) => S.muted.has(i) || (S.solo.size > 0 && !S.solo.has(i));
// Sample layers share the one DAC channel, so muting one of them means re-mixing the DAC stream.
function mixMutedSet() {
  const set = new Set();
  S.song.layers.forEach((L, i) => { if (L.kind === 'sample' && layerOff(i)) set.add(i); });
  return set;
}
function sendMute() {
  let ym = 0, psg = 0;
  S.song.layers.forEach((L, i) => {
    if (!layerOff(i)) return;
    if (L.kind === 'fm') ym |= 1 << L.ch;
    else if (L.kind === 'dac') ym |= 0x40;
    else if (L.kind !== 'sample') psg |= 1 << L.ch;
  });
  post({ type: 'mute', ym, psg });
  const key = [...mixMutedSet()].join(',');
  if (key !== S.mixMuted) {
    S.mixMuted = key;
    rebuildModel();
    sendTimeline();
  }
}

function currentPos() {
  let p = S.pos;
  if (S.playing) p += (performance.now() - S.posAt) / 1000 * RATE;
  const tl = S.modelTl;
  if (S.loop && tl && tl.loopStart >= 0 && p >= tl.end) p = tl.loopStart + (p - tl.end);
  return p;
}
// Played time (repeats unrolled) <-> written time on the staff.
const perf = () => (S.perf ??= performSong(S.song));
const writtenTime = (p) => (repeatSpans(S.song).length ? stepTime(S.song, writtenStep(S.song, timeToStep(perf(), p))) : p);
const playedTime = (t) => (repeatSpans(S.song).length ? stepTime(perf(), playedSteps(S.song, Math.round(timeToStep(S.song, t) * 1000) / 1000)[0]) : t);
const displayPos = () => Math.max(0, currentPos() - (S.playing ? S.latency * RATE : 0));

async function togglePlay() {
  await ensureAudio();
  S.ctx.resume();
  S.playing = !S.playing;
  if (S.playing) S.followHold = false;
  post({ type: S.playing ? 'play' : 'pause' });
  S.posAt = performance.now();
}

// Back to the start. Already at the start (its first seconds, as music players do) of a song from the games: the song
// before it. Next goes to the song after it; a playing song goes on playing in the other one.
const PREV_GRACE = 3; // seconds
const refIndex = () => (S.doc.kind === 'ref' ? S.refs.findIndex((r) => r.dir === S.doc.dir) : -1);
function backToStart() {
  const i = refIndex();
  if (i > 0 && currentPos() < S.song.stepTimes[S.song.step0] + PREV_GRACE * RATE) { switchRef(i - 1); return; }
  seekToStep(0); setScroll(-2);
}
async function switchRef(i) {
  const ref = S.refs[i];
  if (!ref || !await confirmDiscard()) return;
  const was = S.playing;
  try { await openDoc({ kind: 'ref', dir: ref.dir }); } catch (e) { console.error(e); tell(`Could not open the song: ${e.message}`); return; }
  if (was) togglePlay();
}
// Loop off: a song from the games that ends goes on to the next song of its game (the last one stops there).
// Not with unsaved changes: the song being edited stays open.
async function playNext() {
  const i = refIndex(), next = S.refs[i + 1];
  if (S.loop || i < 0 || S.dirty || !next || (next.game || '') !== (S.refs[i].game || '')) return;
  try { await openDoc({ kind: 'ref', dir: next.dir }); } catch (e) { console.error(e); tell(`Could not open the song: ${e.message}`); return; }
  if (!S.playing) togglePlay();
}

function seekToStep(s) {
  const pos = Math.max(0, playedTime(stepTime(S.song, s)));
  S.followHold = false;
  S.pos = pos; S.posAt = performance.now();
  post({ type: 'seek', pos });
}

async function previewNote(L, n) {
  if (L.kind === 'dac') return;
  await ensureAudio();
  const song = S.song;
  const t = n._t ?? 0;
  const mini = {
    ...song, globals: song.globals.filter((x) => x[0] <= t).map((x) => [0, x[1], x[2], x[3]]),
    layers: [{ ...L, notes: [{ ...n, s: 0, n: 0, d: Math.min(n.d, RATE * 0.6) }] }],
    stepTimes: [0, song.step], step0: 0, end: RATE, loopStart: -1, repeats: [],
  };
  post({ type: 'preview', tl: buildTimeline(mini, S.pcm) });
}
function setVolume(v) {
  S.volume = Math.max(0, Math.min(3, v));
  post({ type: 'gain', gain: S.volume });
}

// ---------- layers ----------
function chipName(L) {
  if (L.kind === 'fm') return `FM${L.ch + 1}`;
  if (L.kind === 'sample') return `DAC${(L.voice ?? MELODIC_VOICE) + 1}`;
  if (L.kind === 'dac') return 'DAC';
  if (L.kind === 'noise') return 'NOISE';
  return `PSG${L.ch + 1}`;
}
const toggleSet = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
// A click on a track: that track alone; Ctrl+click adds / takes out one, Shift+click takes the range from the active one.
function selectLayer(i, e = {}) {
  const many = e.ctrlKey || e.metaKey, range = e.shiftKey;
  if (!multiLayer()) S.layers = new Set([S.active]);
  if (many) {
    if (S.layers.has(i) && S.layers.size > 1) { S.layers.delete(i); if (i === S.active) i = [...S.layers].at(-1); }
    else S.layers.add(i);
  } else if (range) {
    const [a, b] = [Math.min(S.active, i), Math.max(S.active, i)];
    S.layers = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
  } else S.layers = new Set([i]);
  S.active = i; S.hidden.delete(i);
  const ok = new Set(selLayers().flatMap((L) => L.notes));
  for (const n of [...S.sel]) if (!ok.has(n)) S.sel.delete(n);
  // pen, fill and pipette work on one track: with several chosen the arrow takes over
  if (multiLayer() && ONE_TRACK_TOOLS.has(S.tool)) setTool('select');
  updateBarTools();
  revealLayer(S.song.layers[i]);
}
const ONE_TRACK_TOOLS = new Set(['pen', 'fill', 'pick']);
const multiLayer = () => S.layers.size > 1 && S.layers.has(S.active);
const layerChosen = (i) => (multiLayer() ? S.layers.has(i) : i === S.active);
// The tracks the arrow and the eraser work on (shown ones; the dac stream of game tracks is not edited).
function selLayers() {
  const L = activeLayer();
  if (!multiLayer()) return L ? [L] : [];
  return [...S.layers].sort((a, b) => a - b).filter((i) => !S.hidden.has(i)).map((i) => S.song.layers[i]).filter((M) => M && M.kind !== 'dac');
}
// The chosen track of every note in them.
function noteOwners() {
  const own = new Map();
  for (const M of selLayers()) for (const n of M.notes) own.set(n, M);
  return own;
}
// Scroll the staff to a track's notes if they are out of view.
function revealLayer(L) {
  if (isLane(L) || !L.notes.length) return;
  const ds = L.notes.map((n) => noteDiat(L, n)).sort((a, b) => a - b);
  const d = ds[ds.length >> 1], y = yOf(d);
  if (y < viewTop + 10 || y > viewBot - 10) centerOnRow(d);
}

// Volume / stereo only work on some voices: elsewhere the tool falls back to the pen.
function updateBarTools() {
  if (BAR_TOOLS[S.tool] && !BAR_TOOLS[S.tool].ok(activeLayer() || {})) setTool('pen');
}

// ---------- tracks: settings (sounds, name, delete) and adding voices ----------
function showTrackDialog(L) {
  if (!L) return;
  openDialog({ kind: 'track', L, name: L.name, lib: soundLibrary(L), chosen: new Set(L.palette.map((x) => x.key)), scroll: 0,
    tone: L.tone ?? 0, iconFor: L.sel?.key, icons: new Map(L.palette.map((x) => [x.key, x.sprite])) });
}
function applyTrackDialog(d) {
  const L = d.L;
  const name = d.name.trim() || L.name;
  const palette = d.lib.filter((x) => d.chosen.has(x.key));
  if (!palette.length) return; // ADD / DONE wait for a sound
  for (const x of palette) if (d.icons.has(x.key)) x.sprite = d.icons.get(x.key); // the icons chosen here
  if (d.isNew) {
    closeDialog();
    L.name = name;
    if (d.tone !== L.tone) { L.tone = d.tone; L.color = toneCss(d.tone); }
    createTrack(L, palette);
    return;
  }
  const icons = palette.map((x) => x.sprite).join();
  const changed = name !== L.name || d.tone !== L.tone || palette.map((x) => x.key).join() !== L.palette.map((x) => x.key).join()
    || icons !== L.palette.map((x) => x.sprite).join();
  closeDialog();
  if (!changed) return;
  L.name = name;
  if (d.tone !== L.tone) { L.tone = d.tone; L.color = toneCss(d.tone); }
  L.palette = uniqueSprites(palette);
  L.sounds = L.palette;
  if (!L.sounds.includes(L.sel)) L.sel = L.sounds[0];
  trackChanged();
}

function trackChanged() {
  computeRange();
  updateBarTools();
  rebuildModel(); sendTimeline(); sendMute();
  markDirty();
}

async function deleteTrack(L) {
  if (L.notes.length && !await ask(`Delete track “${L.name}” with ${L.notes.length} notes?`, 'Delete')) return;
  const i = S.song.layers.indexOf(L);
  S.song.layers.splice(i, 1);
  S.hidden.clear(); S.muted.clear(); S.solo.clear(); S.sel.clear(); S.layers = new Set();
  S.active = Math.max(0, Math.min(S.active, S.song.layers.length - 1));
  S.undo.length = 0; S.redo.length = 0;
  trackChanged();
}

// Voices still free on the hardware.
function freeVoices() {
  const L = S.song.layers;
  const has = (pred) => L.some(pred);
  const out = [];
  for (let c = 0; c < 5; c++) if (!has((x) => x.kind === 'fm' && x.ch === c)) out.push({ kind: 'fm', ch: c, label: `FM${c + 1}`, what: 'FM synth' });
  const fmFree = out[0]?.kind === 'fm' ? out[0] : null;
  const fmDrums = catOf('drums').length > 0 || L.filter((x) => x.kind === 'fm').flatMap((x) => x.palette).some((x) => x.gm != null);
  if (fmFree && fmDrums) out.push({ ...fmFree, kit: true, what: 'FM drums' });
  for (let c = 0; c < 3; c++) if (!has((x) => x.kind === 'psg' && x.ch === c)) out.push({ kind: 'psg', ch: c, label: `PSG${c + 1}`, what: 'Square wave' });
  if (!has((x) => x.kind === 'noise')) out.push({ kind: 'noise', ch: 3, label: 'NOISE', what: 'Noise' });
  if (S.song.samples) for (let v = 0; v < 4; v++) if (!has((x) => x.kind === 'sample' && (x.voice ?? MELODIC_VOICE) === v)) {
    out.push({ kind: 'sample', ch: v, voice: v, label: `DAC${v + 1}`, what: v === MELODIC_VOICE ? 'Samples with pitch' : 'Samples (drums)' });
  }
  return out;
}

// Adding a track: the track dialog opens on a new layer that is not in the song yet; nothing is chosen for the user.
// The track is created by ADD (applyTrackDialog), Cancel leaves the song as it was.
function addTrack(v) {
  const song = S.song;
  const id = 'L' + (Math.max(-1, ...song.layers.map((x) => +x.id.slice(1) || 0)) + 1);
  const tone = LAYER_TONES.map((_, k) => k).find((k) => !song.layers.some((x) => x.tone === k)) ?? song.layers.length % LAYER_TONES.length;
  const L = { id, kind: v.kind, ch: v.ch, name: v.label, color: toneCss(tone), tone, role: v.kind === 'fm' ? 'lead' : v.kind === 'sample' ? 'sample' : v.kind === 'noise' ? 'noise' : 'psg', notes: [], palette: [] };
  if (v.kind === 'sample') L.voice = v.voice;
  if (v.kit) L.kit = true;
  if ((v.kind === 'psg' || v.kind === 'noise') && !soundLibrary(L).length) {
    // no square / noise anywhere yet: offer a plain one
    const src = song.layers.find((x) => x.kind === v.kind)?.palette?.[0] || (v.kind === 'psg' ? song.library?.psg?.[0] : null);
    let m = src?.m;
    if (m == null) {
      const mac = v.kind === 'noise' ? { noise: true, base: 4, vol: 0, ev: [], pitch: 60 } : { base: 254, vol: 0, ev: [] };
      if (!mac.noise) mac.pitch = Math.round(hzMidi(psgHz(mac.base)));
      song.macros.push(mac);
      m = song.macros.length - 1;
    }
    L.palette = [{ key: 'd', m, d: Math.round(song.step * 2), p: 69, sprite: v.kind === 'noise' ? 'star' : 'ghost', name: v.kind === 'noise' ? 'Noise' : 'Square' }];
  }
  const lib = soundLibrary(L);
  if (!lib.length) { showStatus(`No ${v.what} sounds to choose from`); return; }
  openDialog({ kind: 'track', isNew: true, L, name: L.name, lib, chosen: new Set(), scroll: 0, tone, iconFor: null, icons: new Map() });
}
function createTrack(L, palette) {
  L.palette = uniqueSprites(palette.map((x) => ({ ...x, sprite: spriteName(x.sprite) })));
  L.sounds = L.palette; L.sel = L.sounds[0];
  S.song.layers.push(L);
  indexLayer(L);
  S.active = S.song.layers.length - 1;
  S.sel.clear(); S.layers = new Set();
  trackChanged();
}

// ---------- staff geometry (in art pixels, inside the staff frame) ----------
// Gutter: piano keys | line | clefs | the first bar line. Under the staff: one lane per voice without pitch.
const RULER = 13, KEYS_W = 18, KEY_LINE = 19, CLEF_X = 20, GUTTER = 45, DAC_H = 22, LANE_H = 14, DSTEP = 4;
let SX = 0, SY = 0, SW = 100, SH = 100, staffTop = 0, viewTop = 0, viewBot = 0, lanesTop = 0, lanesEnd = 0;
const laneH = (L) => (L.kind === 'dac' ? DAC_H : LANE_H);

function staffGeom() {
  const lanes = S.lanes.reduce((a, L) => a + laneH(L), 0);
  const lanesH = lanes ? lanes + 3 : 0;
  viewTop = RULER; viewBot = SH - lanesH;
  const full = (DIAT_TOP - DIAT_BOT) * DSTEP + 8, view = viewBot - viewTop;
  staffTop = viewTop + 4 + Math.max(0, (view - full) >> 1);
  S.vyMax = Math.max(0, full - view);
  setVy(S.vy);
  lanesTop = viewBot + 3; lanesEnd = lanesTop + lanes;
}
const yOf = (d) => staffTop + (DIAT_TOP - d) * DSTEP - S.vy;
const xOf = (s) => GUTTER + Math.round((s - S.scroll) * S.colW);
const visibleSteps = () => (SW - GUTTER) / S.colW;
const stepAt = (x) => Math.floor(S.scroll + (x - GUTTER) / S.colW);
const rowAt = (y) => Math.round(DIAT_TOP - (y + S.vy - staffTop) / DSTEP);
const setVy = (v) => { S.vy = Math.max(0, Math.min(S.vyMax, Math.round(v))); };
const centerOnRow = (d) => setVy(staffTop + (DIAT_TOP - d) * DSTEP - (viewTop + viewBot) / 2);
function laneTopOf(L) {
  let y = lanesTop;
  for (const M of S.lanes) { if (M === L) return y; y += laneH(M); }
  return y;
}
const laneY = (L) => laneTopOf(L) + (laneH(L) >> 1);
function laneAt(y) {
  let top = lanesTop;
  for (const M of S.lanes) { if (y >= top && y < top + laneH(M)) return M; top += laneH(M); }
  return null;
}

// Tone colours of a layer, plain or faded.
const toneRgb = (L, k) => LAYER_TONES[L.tone ?? 0][k];
const ghostCss = (L, k) => rgbCss(snap(toneRgb(L, k).map((v, i) => v + (ui.T.ghostTo[i] - v) * 0.62)));
const toneInk = (L, ghost, k = 1) => (ghost ? ghostCss(L, k) : rgbCss(toneRgb(L, k)));

// ---------- drawing the staff ----------
function drawStaff() {
  const T = ui.T, song = S.song;
  const played = displayPos(), pos = writtenTime(played);
  const posStep = timeToStep(song, pos);
  if (S.follow && !S.followHold && S.playing && !S.drag) {
    const vis = visibleSteps();
    if (posStep < S.scroll || posStep > S.scroll + vis * 0.85) setScroll(posStep - vis * 0.1);
  }
  fill(0, 0, SW, SH, T.paper);
  const bottom = S.lanes.length ? lanesEnd : viewBot;
  drawRepeatHighlight(bottom);
  const s0 = Math.floor(S.scroll) - 1, s1 = Math.ceil(S.scroll + visibleSteps()) + 1;

  // ruler: bar numbers, ticks, flags
  const bars = [];
  g.save(); g.beginPath(); g.rect(GUTTER, 0, SW - GUTTER, SH); g.clip();
  for (let st = s0; st <= s1; st++) {
    const x = xOf(st), rel = st - S.barOffset, bar = Math.floor(rel / 16);
    if (((rel % 16) + 16) % 16 === 0) {
      bars.push(x);
      fill(x, RULER - 4, 1, 3, T.ink);
      if (bar >= 0) text(bar + 1, x + 2, 3, T.ink);
    } else if (((rel % 4) + 4) % 4 === 0) {
      fill(x, RULER - 2, 1, 1, T.dim);
      for (let y = viewTop + 1; y < bottom; y += 2) fill(x, y, 1, 1, T.beat);
    }
  }
  g.restore();
  fill(0, RULER - 1, SW, 1, T.ink);
  drawRepeatRuler();
  drawEndFlag();
  drawLoopFlag();

  // the staff scrolls vertically inside its view
  g.save();
  g.beginPath(); g.rect(0, viewTop, SW, viewBot - viewTop); g.clip();
  const span = (d0, d1) => [yOf(d0), yOf(d1) - yOf(d0) + 1];
  for (const d of LEDGERS15) { const y = yOf(d); for (let x = GUTTER - 4; x < SW; x += 2) fill(x, y, 1, 1, T.faded); }
  for (const d of LEDGERS) { const y = yOf(d); for (let x = GUTTER - 4; x < SW; x += 2) fill(x, y, 1, 1, T.staff); }
  for (const d of [...TREBLE15_LINES, ...BASS15_LINES]) fill(CLEF_X, yOf(d), SW - CLEF_X, 1, T.faded);
  for (const d of [...TREBLE_LINES, ...BASS_LINES]) fill(CLEF_X, yOf(d), SW - CLEF_X, 1, T.staff);
  const barSpans = [[52, 44, T.faded], [12, 4, T.faded], [38, 30, T.bar], [26, 18, T.bar]];
  for (const [a, b, c] of barSpans) {
    const [y, h] = span(a, b);
    fill(GUTTER - 1, y, 1, h, c);
    for (const x of bars) if (x >= GUTTER) fill(x, y, 1, h, c);
  }
  g.save(); g.beginPath(); g.rect(GUTTER, viewTop, SW - GUTTER, viewBot - viewTop); g.clip();
  drawRepeatSigns();
  // the other tracks under the chosen ones, the active one on top
  const order = song.layers.map((_, i) => i).filter((i) => i !== S.active && !S.hidden.has(i)).sort((a, b) => layerChosen(a) - layerChosen(b));
  if (activeLayer() && !S.hidden.has(S.active)) order.push(S.active);
  for (const i of order) if (!isLane(song.layers[i])) drawLayer(song.layers[i], layerChosen(i), s0, s1, pos);
  g.restore();
  drawKeys();
  drawClefs();
  drawRangeShade();
  drawScrollMarks();
  g.restore();

  drawLanes(order, s0, s1, pos);
  drawTimeShade(bottom);
  if (BAR_TOOLS[S.tool]) drawBars(BAR_TOOLS[S.tool], s0, s1);

  const L = activeLayer();
  if (S.hover?.kind === 'empty' && !S.drag && S.tool === 'pen' && L) {
    drawNoteSprite(noteSprite(S.hover.sprite, L.tone, 0, 'ghost', T), S.hover.s, S.hover.py); // on its row, as it will be placed
  }
  drawSelection(s0, s1);

  const px = xOf(posStep);
  if (px >= GUTTER && px < SW) {
    fill(px, RULER, 1, bottom - RULER, T.head);
  }
  return posStep;
}

// Sonic on the playhead, standing on the ruler and taller than it: drawn after the staff, out of its clip, so his
// head sticks out over the bar above. Stopped he taps his foot; playing he walks, one frame per eighth note (2 steps) so he keeps time.
function drawSonic(posStep) {
  const px = xOf(posStep);
  if (px < GUTTER || px >= SW) return;
  const pose = S.playing ? 'Walk' : 'Idle';
  const frames = frameCount('pictures', 'sonic' + pose) || 1;
  const k = REDUCED_MOTION ? 0 : S.playing ? Math.floor(posStep / 2) : ui.frame >> 5;
  const pic = sonic(pose, k % frames);
  g.save(); g.translate(SX, SY); g.beginPath(); g.rect(GUTTER - 8, RULER - pic.height, SW - GUTTER + 8, pic.height); g.clip();
  g.drawImage(pic, px - 8, RULER - pic.height);
  g.restore();
}

// A note picture: 12x12 cell whose 8x8 middle sits on the column and the staff row. Dithered (other tracks' notes):
// every other pixel, on the screen's checkerboard, in the shade of the areas out of play.
function drawNoteSprite(sp, s, yc, dithered = false) {
  const x = xOf(s) + (S.colW >> 1) - 6, y = yc - 6;
  g.drawImage(dithered ? checkered(sp, (x + y) & 1, ui.T.shade) : sp, x, y);
  return [x, y];
}
function drawLayer(L, active, s0, s1, pos) {
  const notes = L.notes;
  let lo = 0, hi = notes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m]._e < s0) lo = m + 1; else hi = m; }
  if (L.kind === 'dac') { drawDac(L, active, lo, s1, pos); return; }
  // other tracks are drawn dithered: every other pixel in the shade, so the chosen one stands out over them
  const tail = toneInk(L, !active), paint = active ? fill : shadeDither;
  for (let i = lo; i < notes.length && notes[i].s <= s1; i++) {
    const n = notes[i];
    const x0 = xOf(n.s) + (S.colW >> 1), x1 = xOf(n._e);
    if (n._e - n.s > 1.05 && x1 > x0) paint(x0, noteY(L, n) - 1, x1 - x0, 3, tail);
  }
  const ps = timeToStep(S.song, pos);
  for (let i = lo; i < notes.length && notes[i].s <= s1; i++) {
    const n = notes[i];
    // a long note's icon rides along its tail with the playhead, lit, until the note ends
    const long = n._e - n.s > 1.05;
    const riding = long && S.playing && pos >= n._t && ps < n._e;
    // frame 0 is the still note, the others play while it sounds. Riding, it moves on every eighth note (2 steps), so
    // it keeps time with the tempo: with 2 frames it blinks lit / still, with more it runs through the sounding ones.
    const name = spriteOf(L, n), nf = frameCount('notes', name) || 1;
    let frame = 0;
    if (riding) { const k = Math.floor((ps - n.s) / 2); frame = nf > 2 ? 1 + (k % (nf - 1)) : k % 2 === 0 ? 1 : 0; }
    else if (S.playing && pos >= n._t && pos < n._t + Math.min(n._d, RATE * 0.12)) frame = 1;
    const hotNote = S.drag?.note === n || (active && (S.tool === 'erase' || S.tool === 'fill' || S.tool === 'pick') && S.hover?.note === n);
    if (hotNote && !frame) frame = 1;
    const off = n.s > lastPlayStep();
    const faint = !active || off;
    const sp = noteSprite(name, L.tone, Math.min(frame, nf - 1), faint ? 'ghost' : 'normal', ui.T);
    const at = riding ? Math.max(n.s, Math.min(ps - 0.5, n._e - 1)) : n.s;
    const [x] = drawNoteSprite(sp, at, noteY(L, n), !active);
    if (n._slide && !riding) drawGliss(L, n, x + 10, active);
  }
}

// Glissando: a wavy pixel line from the note head to the slide target.
function drawGliss(L, n, x0, active) {
  const y0 = yOf(noteDiat(L, n));
  const y1 = yOf(diatOf(n.p + n._slide));
  const x1 = Math.max(x0 + 6, xOf(Math.min(n._e, n.s + 2)) + (S.colW >> 1));
  const c = active ? ui.T.ink : ui.T.staff;
  const len = x1 - x0;
  for (let i = 0; i <= len; i++) {
    const y = Math.round(y0 + (y1 - y0) * (i / len)) + ((i >> 1) % 2 ? 1 : 0);
    fill(x0 + i, y, 1, 2, c);
  }
  fill(x1, y1 - 1, 3, 3, c); // target dot
}

// A rectangle dithered: colour c on every other pixel, the shade of the areas out of play on the rest.
function shadeDither(x, y, w, h, c) { fill(x, y, w, h, ui.T.shade); dither(x, y, w, h, c); }

function drawDac(L, active, lo, s1, pos) {
  const notes = L.notes, top = laneTopOf(L);
  for (let i = lo; i < notes.length && notes[i].s <= s1; i++) {
    const n = notes[i];
    const x0 = xOf(n.s), w = Math.max(1, xOf(n._e) - x0 - 1);
    const sounding = S.playing && pos >= n._t && pos < n._t + n._d;
    (active ? fill : shadeDither)(x0, top + 2, w, DAC_H - 3, toneInk(L, !active, sounding ? 0 : 1));
  }
}

// Lanes of the voices without pitch: a strip each, labelled with the voice in the gutter.
function drawLanes(order, s0, s1, pos) {
  if (!S.lanes.length) return;
  const T = ui.T;
  fill(0, lanesTop - 2, SW, 1, T.ink);
  for (const L of S.lanes) {
    const top = laneTopOf(L), h = laneH(L), active = layerChosen(S.song.layers.indexOf(L));
    if (active) fill(GUTTER, top, SW - GUTTER, h, T.lane);
    for (let x = GUTTER; x < SW; x += 2) fill(x, top + h - 1, 1, 1, T.staff);
  }
  g.save(); g.beginPath(); g.rect(GUTTER, lanesTop, SW - GUTTER, lanesEnd - lanesTop); g.clip();
  for (const i of order) { const L = S.song.layers[i]; if (isLane(L)) drawLayer(L, layerChosen(i), s0, s1, pos); }
  g.restore();
  fill(GUTTER - 1, lanesTop - 1, 1, lanesEnd - lanesTop + 1, T.ink);
  for (const L of S.lanes) {
    const top = laneTopOf(L), h = laneH(L), active = L === activeLayer();
    fill(1, top + 1, 3, h - 2, toneInk(L, false));
    text(chipName(L), 6, top + (h >> 1) - 2, active ? T.ink : T.dim);
  }
}

// Bar tools: one bar per note of the active track over the staff (it does not scroll with it); drag to paint.
//  Volume: bar height = level 0..F (dotted line = F, as recorded); PSG and FM only, samples have no volume.
//  Stereo: equal bars coloured by L / C / R; top third = left, middle = centre, bottom = right. FM only:
//  the PSG is mono on the Mega Drive and all samples share the one DAC channel.
const PAN_NAME = ['?', 'R', 'L', 'C'];
const PAN_COLOR = { L: md(2, 4, 7), C: md(4, 4, 4), R: md(7, 3, 1) };
const recordedPan = (n) => PAN_NAME[((S.song.instruments[n.i]?.regs.find(([r]) => r === 0xb4)?.[1] ?? 0xc0) >> 6)] || 'C';
const BAR_TOOLS = {
  vol: {
    label: 'VOL', ok: (L) => L.kind === 'fm' || L.kind === 'psg' || L.kind === 'noise',
    why: 'Samples have no volume: the DAC just plays them as they are',
    get: (n) => n.vol ?? 15, height: (v) => v / 15, color: (v, L) => toneInk(L, false), text: (v) => v.toString(16).toUpperCase(),
    at: (f) => Math.max(0, Math.min(15, Math.round(f * 15))), set: (n, v) => { n.vol = v; },
    status: (v) => `Volume ${v.toString(16).toUpperCase()}`, line: 1,
  },
  pan: {
    label: 'PAN', ok: (L) => L.kind === 'fm',
    why: (L) => (L.kind === 'sample' ? 'All samples share one DAC channel: no stereo per note' : 'The PSG is mono on the Mega Drive'),
    get: (n) => n.pan ?? recordedPan(n), height: () => 1, color: (v) => PAN_COLOR[v], text: (v) => v,
    at: (f) => (f > 2 / 3 ? 'L' : f < 1 / 3 ? 'R' : 'C'), set: (n, v) => { n.pan = v; },
    status: (v) => ({ L: 'Left', C: 'Centre', R: 'Right' })[v], line: 0.5,
  },
};
function barGeom() {
  const base = viewBot - 9;
  return { base, max: Math.max(16, Math.min(64, Math.round((viewBot - viewTop) * 0.6))) };
}
function drawBars(Tl, s0, s1) {
  const L = activeLayer(), T = ui.T;
  if (!L || !Tl.ok(L) || S.hidden.has(S.active)) return;
  const { base, max } = barGeom();
  dither(GUTTER, viewTop, SW - GUTTER, viewBot - viewTop, T.paper);
  const ly = base - Math.round(max * Tl.line);
  for (let x = GUTTER; x < SW; x += 4) fill(x, ly, 2, 1, T.loop);
  for (const n of L.notes) {
    if (n.s < s0 || n.s > s1) continue;
    const v = Tl.get(n), h = Math.max(1, Math.round(max * Tl.height(v)));
    const x = xOf(n.s) + 1, w = Math.max(2, S.colW - 2);
    fill(x, base - h, w, h, Tl.color(v, L));
    frame(x - 1, base - h - 1, w + 2, h + 2, T.ink);
    text(Tl.text(v), x + ((w - textWidth(Tl.text(v))) >> 1), base + 3, T.ink);
  }
  fill(0, base - max - 2, GUTTER, max + 12, T.paper);
  text(Tl.label, 2, base + 3, T.ink);
  if (Tl === BAR_TOOLS.pan) { text('L', GUTTER - 6, base - max); text('R', GUTTER - 6, base - 6); }
}
// Drag: paint every column between the last mouse position and this one (fast moves skip columns).
function paintBarsTo(x, y) {
  const [x0, y0] = S.drag.last || [x, y];
  const cols = Math.max(1, Math.ceil(Math.abs(x - x0) / S.colW));
  for (let k = 1; k <= cols; k++) paintBar(x0 + (x - x0) * k / cols, y0 + (y - y0) * k / cols);
  S.drag.last = [x, y];
}
// Set the value of the note in the column under x from the height y.
function paintBar(x, y) {
  const L = activeLayer(), Tl = BAR_TOOLS[S.tool];
  if (!L || !Tl?.ok(L)) return null;
  const s = stepAt(x);
  const n = L.notes.find((m) => Math.round(m.s) === s);
  if (!n) return null;
  const { base, max } = barGeom();
  const v = Tl.at((base - y) / max);
  if (Tl.get(n) !== v) { Tl.set(n, v); n.e = 1; S.drag.moved = true; }
  showStatus(`${Tl.status(v)} · ${barBeat(n.s)}`);
  return n;
}

// Notes only play from the song start (time 0) on, and in reference songs (fixed length) until their end.
const firstPlayStep = () => Math.ceil(timeToStep(S.song, 0) - 1e-6);
const lastPlayStep = () => Math.ceil(timeToStep(S.song, S.song.end) - 1e-6) - 1;
// Finish flag on the ruler at the song end; drag it to change the length of my songs.
const endFlagX = () => xOf(lastPlayStep() + 1);
const nearEndFlag = (x, y) => y < RULER && Math.abs(x - endFlagX() - 3) <= 5;
function drawEndFlag() {
  const x = endFlagX(), T = ui.T, ink = blinks((g) => g.end) ? T.white : T.ink;
  if (x < GUTTER || x > SW) return;
  fill(x, 1, 1, RULER - 2, T.ink);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) fill(x + 1 + c * 2, 1 + r * 2, 2, 2, (r + c) % 2 ? T.paper : ink);
}
// What the mouse is over that can be dragged: a flag on the ruler, or with the repeat tool a repeat sign or the
// green |:. It blinks slowly, so it is clear it can be moved.
function grabTarget() {
  if (S.drag || S.dlg || ui.hover?.id !== 'staff' || !S.song) return null;
  const x = ui.mouse.x - SX, y = ui.mouse.y - SY;
  if (nearEndFlag(x, y)) return { end: true };
  if (nearLoopFlag(x, y)) return { loop: true };
  if (S.tool !== 'repeat') return null;
  const t = repTarget(x, y);
  return t?.kind === 'edge' ? { r: t.r, side: t.side } : t?.kind === 'loopEdge' ? { loop: true } : null;
}
const blinks = (is) => Math.floor(performance.now() / 400) % 2 === 1 && !!grabTarget() && is(grabTarget());

// ---------- repeats: |: :| (bar lines or any 16th), and the green one (the song loops from there to the end) ----------
// Bars count from S.barOffset (examples recorded from the game may start their first bar a bit later).
const barStart = (bar) => bar * 16 + S.barOffset;
const barOfStep = (st) => Math.round((st - S.barOffset) / 16);
const endStepQ = () => Math.round(timeToStep(S.song, S.song.end) * 1000) / 1000;
const repBars = () => Math.max(0, Math.floor((endStepQ() - S.barOffset) / 16 + 1e-6)); // whole bars of the song
// The repeat over step st; repeats start and end on any 16th (made over whole bars, then their signs dragged).
const repeatOver = (st) => (S.song.repeats || []).find((r) => st >= r.from && st < r.to);
const repeatInBar = (bar) => (S.song.repeats || []).find((r) => r.from < barStart(bar + 1) && r.to > barStart(bar));
const onBar = (st) => Math.abs((st - S.barOffset) / 16 - Math.round((st - S.barOffset) / 16)) < 1e-6;
// "Bars 3–4" for whole bars, else from and to as bar.beat.16th ("2.3.2–4.1")
function spanName(a, b) {
  if (onBar(a) && onBar(b)) return b - a === 16 ? `Bar ${barOfStep(a) + 1}` : `Bars ${barOfStep(a) + 1}–${barOfStep(b)}`;
  return `${barBeat(a, true)}–${barBeat(b, true)}`;
}
const REP_MODES = [
  { mode: 'x2', tip: 'Repeat x2' }, { mode: 'x3', tip: 'Repeat x3' }, { mode: 'x4', tip: 'Repeat x4' },
  { mode: 'loop', tip: 'Loop from here' }, { mode: 'del', tip: 'Remove a repeat' },
];
const repTimes = () => +S.repMode.slice(1) || 2;
// The green loop starts on any 16th of the song (the games' loops often start inside a bar), not only on a bar line:
// the step under x, or -1 at the very start (the song loops from the beginning, no green repeat).
function loopStepAt(st) {
  const first = S.song.barOffset ? 0 : Math.max(0, S.barOffset); // a pickup before bar 1 can be left out of the loop
  const k = Math.max(first, Math.min(Math.ceil(endStepQ()) - 1, Math.floor(st + 1e-6)));
  return k <= first ? -1 : k;
}
const loopName = (k) => (k < 0 ? 'the start' : barBeat(k, true));

// What the repeat tool points at on the staff: a sign to drag, a repeat, a bar, or the loop.
function repTarget(x, y) {
  if (x < GUTTER || y < RULER || !S.song) return null;
  const mode = S.repMode, ls = loopShown() ? loopStep() : -1;
  if (mode !== 'del') {
    for (const r of repeatSpans(S.song)) {
      if (Math.abs(x - xOf(r.from) - 3) <= 3) return { kind: 'edge', r, side: 'from', from: r.from, to: r.to };
      if (Math.abs(x - xOf(r.to) + 3) <= 3) return { kind: 'edge', r, side: 'to', from: r.from, to: r.to };
    }
    if (ls >= 0 && Math.abs(x - xOf(ls) - 3) <= 3) return { kind: 'loopEdge', from: ls, to: endStepQ(), loop: true };
  }
  const st = S.scroll + (x - GUTTER) / S.colW, bar = Math.floor((st - S.barOffset) / 16);
  if (bar < 0 || bar >= repBars()) {
    if (mode === 'del' && ls >= 0 && st >= ls && st < endStepQ()) return { kind: 'loop', from: ls, to: endStepQ(), loop: true };
    return null;
  }
  const r = repeatOver(st);
  if (mode === 'loop') { const k = loopStepAt(st); return { kind: 'setLoop', at: k, from: Math.max(k, 0), to: endStepQ(), loop: true }; }
  if (mode === 'del') {
    if (r) return { kind: 'rep', r, from: r.from, to: r.to };
    if (ls >= 0 && st >= ls) return { kind: 'loop', from: ls, to: endStepQ(), loop: true };
    return null;
  }
  if (r) return { kind: 'rep', r, from: r.from, to: r.to };
  if (repeatInBar(bar)) return null; // the rest of a bar a repeat starts or ends inside: drag that repeat's sign
  return { kind: 'bar', bar, from: barStart(bar), to: barStart(bar + 1) };
}
// The bars the repeat tool works on now (hover, or the repeat being made / resized).
function repHighlight() {
  if (S.tool !== 'repeat') return null;
  const d = S.drag;
  if (d?.mode === 'rep') return { from: barStart(Math.min(d.a, d.b)), to: barStart(Math.max(d.a, d.b) + 1) };
  if (d?.mode === 'repEdge') return { from: d.r.from, to: d.r.to };
  if (d?.mode === 'loop') return { from: loopStep(), to: endStepQ(), loop: true };
  if (d) return null;
  return ui.hover?.id === 'staff' && !S.dlg ? repTarget(ui.mouse.x - SX, ui.mouse.y - SY) : null;
}
const repHiColor = (hl) => (S.repMode === 'del' && !S.drag ? ui.T.hiDel : hl.loop ? ui.T.hiLoop : ui.T.hiRep);
function drawRepeatHighlight(bottom) {
  const hl = repHighlight();
  if (!hl) return;
  const x0 = Math.max(GUTTER, xOf(hl.from)), x1 = Math.min(SW, xOf(hl.to));
  if (x1 > x0) fill(x0, RULER, x1 - x0, bottom - RULER, repHiColor(hl));
}
// Inner repeats on the ruler: a bar over the repeated bars with xN.
function drawRepeatRuler() {
  const T = ui.T;
  for (const r of repeatSpans(S.song)) {
    const x0 = Math.max(GUTTER, xOf(r.from)), x1 = Math.min(SW, xOf(r.to));
    if (x1 <= x0) continue;
    fill(x0, RULER - 4, x1 - x0, 2, T.rep);
    text('x' + r.times, Math.max(x0, xOf(r.from) + 12), 3, T.rep);
  }
}

// Repeat-start flag (green) on the ruler at the loop start; drag it to a bar line.
const loopFlagX = () => xOf(loopStep());
const nearLoopFlag = (x, y) => loopShown() && y < RULER && Math.abs(x - loopFlagX() - 3) <= 5;
function drawLoopFlag() {
  if (!loopShown()) return;
  const x = loopFlagX(), T = ui.T, c = blinks((g) => g.loop) ? T.white : T.loop;
  if (x < GUTTER || x > SW) return;
  fill(x, 1, 1, RULER - 2, T.ink);
  for (let r = 0; r < 6; r++) fill(x + 1, 1 + r, Math.max(1, 7 - Math.abs(r - 2.5) * 2 | 0), 1, c);
}
// Repeat signs on the grand staff like in printed music: |: ... :| around repeated bars, a green |: at the
// loop start and :| at the end (black when the song starts over from the beginning).
function drawRepeatSigns() {
  const T = ui.T;
  const top = yOf(38), h = yOf(18) - top + 1;
  const dots = (x, c) => { for (const d of [33, 35, 21, 23]) fill(x, yOf(d) - 1, 2, 2, c); };
  const open = (x, c) => { fill(x, top, 2, h, c); fill(x + 3, top, 1, h, c); dots(x + 5, c); };
  const close = (x, c, dot = true) => { fill(x - 2, top, 2, h, c); fill(x - 4, top, 1, h, c); if (dot) dots(x - 7, c); };
  const lit = (r, side) => blinks((g) => g.r === r && g.side === side);
  for (const r of repeatSpans(S.song)) { open(xOf(r.from), lit(r, 'from') ? T.white : T.bar); close(xOf(r.to), lit(r, 'to') ? T.white : T.bar); }
  const ls = loopStep(), xe = endFlagX();
  if (loopShown()) {
    const x = xOf(ls);
    if (x >= GUTTER - 6 && x < SW) open(x, blinks((g) => g.loop) ? T.white : T.loop);
  }
  if (xe >= GUTTER && xe < SW + 6) close(xe, loopShown() ? T.loop : T.bar);
}

// Repeat tool on the staff: click a bar = a repeat of it (or drag over bars), click a repeat = its count,
// drag a sign = move that end; the palette above picks x2 / x3 / x4, the green loop or the cross.
function repeatDown(x, y) {
  const t = repTarget(x, y);
  if (!t) return;
  if (t.kind === 'edge') { pushUndo(); S.drag = { mode: 'repEdge', r: t.r, side: t.side, moved: false }; return; }
  if (t.kind === 'loopEdge') { pushUndo(); S.drag = { mode: 'loop', moved: false }; return; }
  if (t.kind === 'bar') { S.drag = { mode: 'rep', a: t.bar, b: t.bar }; return; }
  pushUndo();
  if (t.kind === 'rep' && S.repMode === 'del') {
    S.song.repeats.splice(S.song.repeats.indexOf(t.r), 1);
    showStatus('Repeat removed');
  } else if (t.kind === 'rep') {
    if (t.r.times === repTimes()) { S.undo.pop(); showStatus(`Already x${t.r.times}`); return; }
    t.r.times = repTimes();
    showStatus(`${spanName(t.r.from, t.r.to)} x${t.r.times}`);
  } else if (t.kind === 'loop') { setLoopStep(-1); showStatus('The song no longer loops'); }
  else if (t.kind === 'setLoop') { setLoopStep(t.at); showStatus(t.at >= 0 ? `Loop from ${loopName(t.at)}` : 'The song loops from the start'); }
  S.perf = null;
  afterEdit();
}
function repeatMove(x) {
  const d = S.drag, nb = repBars();
  const st = S.scroll + (x - GUTTER) / S.colW;
  if (d.mode === 'rep') {
    const bar = Math.max(0, Math.min(nb - 1, Math.floor((st - S.barOffset) / 16)));
    // stop at a neighbouring repeat: repeats do not overlap
    let b = d.a;
    while (b !== bar && !repeatInBar(b + Math.sign(bar - b))) b += Math.sign(bar - b);
    d.b = b;
    showStatus(`${spanName(barStart(Math.min(d.a, b)), barStart(Math.max(d.a, b) + 1))} x${repTimes()}`);
    return;
  }
  if (d.mode === 'repEdge') {
    // an end moves to the nearest 16th, but not past the next repeat or over its own other end
    const r = d.r, others = repeatSpans(S.song).filter((o) => o !== r);
    let k = Math.round(st);
    if (d.side === 'from') {
      const lo = Math.max(Math.max(0, S.barOffset), ...others.filter((o) => o.to <= r.from).map((o) => o.to));
      k = Math.max(lo, Math.min(r.to - 1, k));
      if (k !== r.from) { r.from = k; d.moved = true; S.perf = null; }
    } else {
      const hi = Math.min(barStart(nb), ...others.filter((o) => o.from >= r.to).map((o) => o.from));
      k = Math.min(hi, Math.max(r.from + 1, k));
      if (k !== r.to) { r.to = k; d.moved = true; S.perf = null; }
    }
    showStatus(`${spanName(r.from, r.to)} x${r.times}`);
    return;
  }
  if (d.mode === 'loop') {
    const to = loopStepAt(st + 0.5); // to the nearest 16th; back at the start the green repeat goes
    if (to !== loopStep()) { setLoopStep(to); d.moved = true; }
    showStatus(to >= 0 ? `Loop from ${loopName(to)}` : 'The song loops from the start');
  }
}

function drawTimeShade(bottom) {
  if (S.tool !== 'pen') return;
  const c = ui.T.shade;
  const x0 = Math.max(GUTTER, xOf(firstPlayStep()));
  if (x0 > GUTTER) dither(GUTTER, viewTop, x0 - GUTTER, bottom - viewTop, c);
  const x1 = Math.max(GUTTER, xOf(lastPlayStep() + 1));
  if (x1 < SW) dither(x1, viewTop, SW - x1, bottom - viewTop, c);
}

// Rows of the staff the selected sound cannot reach (shaded with a pen): staff y [top, bottom], or null.
function rangeRows(L) {
  const r = !isLane(L) && drumRow(L, L.sel) == null && soundRange(L, L.sel);
  return r ? [yOf(diatOf(r[1])) - 2, yOf(diatOf(r[0])) + 3] : null;
}
const outOfRange = (L, y) => { const r = y < lanesTop - 2 && rangeRows(L); return !!r && (y < r[0] || y > r[1]); };
// With a pen, shade the rows the selected sound cannot play (the whole staff for a lane voice).
function drawRangeShade() {
  if (S.tool !== 'pen') return;
  const L = activeLayer();
  if (!L || S.hidden.has(S.active)) return;
  const c = ui.T.shade;
  if (isLane(L)) { dither(GUTTER, viewTop, SW - GUTTER, viewBot - viewTop, c); return; }
  const r = rangeRows(L);
  if (!r) return;
  const [yHi, yLo] = r;
  if (yHi > viewTop) dither(GUTTER, viewTop, SW - GUTTER, yHi - viewTop, c);
  if (yLo < viewBot) dither(GUTTER, yLo, SW - GUTTER, viewBot - yLo, c);
}

// Little arrows on the keys when the staff continues above / below.
function drawScrollMarks() {
  const c = ui.T.head;
  const tri = (y, dir) => { for (let i = 0; i < 4; i++) fill(KEYS_W - 5 - i, y + dir * i, 2 * i + 1, 1, c); };
  if (S.vy > 0) tri(viewTop + 1, 1);
  if (S.vy < S.vyMax) tri(viewBot - 2, -1);
}

// Piano keys, drawn like the sketch: a line between white keys, a 8x3 block for each black key,
// and the octave name on every C.
function drawKeys() {
  const T = ui.T, L = activeLayer(), range = L && !S.hidden.has(S.active) ? pitchedRange(L) : null, hp = hotKey();
  // keys the pen cannot use (out of the sound's range or the scale) are shaded, the played / hovered one lit
  const state = (p) => (p === hp ? 'hot' : range && !keyOk(p, range) ? 'off' : '');
  for (let d = DIAT_BOT; d <= DIAT_TOP; d++) {
    const yc = yOf(d);
    if (yc < viewTop - 4 || yc > viewBot + 4) continue;
    const st = state(natFromDiat(d));
    if (st === 'hot') fill(0, yc - 1, KEY_LINE, 3, T.head);
    else if (st === 'off') dither(0, yc - 1, KEY_LINE, 3, T.keys);
  }
  for (let d = DIAT_BOT; d <= DIAT_TOP; d++) {
    const yc = yOf(d);
    if (yc < viewTop - 4 || yc > viewBot + 4) continue;
    const letter = ((d % 7) + 7) % 7; // 0 = C
    // the boundary above this key (to d+1): short where a C label sits
    fill(0, yc - 2, letter === 0 || letter === 6 ? 10 : KEYS_W, 1, T.keys);
    if (letter !== 2 && letter !== 6) { // black key between d and d+1
      const st = state(natFromDiat(d) + 1);
      fill(0, yc - 3, 8, 3, st === 'hot' ? T.head : st === 'off' ? T.beat : T.keys);
    }
    if (letter === 0) text('C' + Math.floor(d / 7), 11, yc - 2, T.keys);
  }
  fill(KEY_LINE, viewTop, 1, viewBot - viewTop, T.ink);
  // a pressed key draws its line across the staff
  if (S.drag?.mode === 'keys') {
    const y = Math.round(keyY(S.drag.p) + (IS_SHARP[S.drag.p % 12] ? -0.5 : 0));
    for (let x = KEY_LINE + 1; x < SW; x += 2) fill(x, y, 1, 1, T.head);
  }
}
function drawClefs() {
  const T = ui.T;
  for (const [name, top, c] of [['treble15', 52, T.faded], ['bass15', 12, T.faded], ['treble', 38, T.staff], ['bass', 26, T.staff]]) {
    const cl = clef(name, c);
    g.drawImage(cl.cv, CLEF_X + cl.dx, yOf(top) + cl.dy);
  }
}

// Selected notes: crawling dots around each; the box being dragged.
function drawSelection(s0, s1) {
  const T = ui.T, phase = (ui.frame >> 3) % 4;
  if (S.sel.size) {
    for (const [n, L] of noteOwners()) {
      if (!S.sel.has(n) || n.s < s0 || n.s > s1) continue;
      const x = xOf(n.s) + (S.colW >> 1) - 7, y = noteY(L, n) - 7;
      frame(x, y, 14, 14, T.paper);
      ants(x, y, 14, 14, T.ink, phase);
    }
  }
  const d = S.drag;
  if (d?.mode === 'marquee') {
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    ants(Math.round(x), Math.round(y), Math.round(Math.abs(d.x1 - d.x0)) + 1, Math.round(Math.abs(d.y1 - d.y0)) + 1, T.ink, phase);
  }
}

// ---------- staff interaction ----------
// Where a note of sound `snd` in layer L lands for staff row d: lane voices go to their lane, drums
// to their own row, and pitched sounds are kept inside the range the sound can play.
// ---------- scale lock: which keys the pen, the keyboard and dragged notes may use (song.scale = { id, root }) ----------
const curScale = () => findScale(S.song?.scale?.id);
const scaleRoot = () => (S.song?.scale?.id === 'white' ? 0 : S.song?.scale?.root ?? 0);
const inScale = (p) => { const sc = curScale(); return !sc.pcs || sc.pcs.includes((((p - scaleRoot()) % 12) + 12) % 12); };
const scaleLabel = () => { const sc = curScale(); return sc.pcs ? `${NAMES[scaleRoot()]} ${sc.short}` : sc.short; };
function setScale(id, root = scaleRoot()) {
  S.song.scale = { id, root };
  markDirty();
}
// Guess: how long each pitch class sounds in the melodic voices (and in the bass) picks root and scale.
function guessSongScale() {
  const hist = Array(12).fill(0), bass = Array(12).fill(0);
  for (const L of S.song.layers) {
    if (L.kind === 'dac' || isLane(L)) continue;
    for (const n of L.notes) {
      if (fixedPitch(L, n) || (L.kind === 'sample' && !S.song.samples[n.smp]?.pitched)) continue;
      const pc = ((n.p % 12) + 12) % 12;
      hist[pc] += n.d;
      if (L.role === 'bass') bass[pc] += n.d;
    }
  }
  const g = guessScale(hist, bass);
  if (!g) { showStatus('No notes to guess from'); return; }
  setScale(g.id, g.root);
  showStatus(`${NAMES[g.root]} ${findScale(g.id).name} · fits ${Math.round(g.cov * 100)}% of the notes`);
}
// Keys of a melodic voice: the pen and the keyboard go to the nearest one the scale and the sound allow.
// A black key sits between two staff rows: its note is drawn on the lower row with a sharp.
function pitchedRange(L, snd = L.sel) {
  if (!L || isLane(L) || drumRow(L, snd) != null) return null;
  return soundRange(L, snd);
}
const keyY = (p) => yOf(diatOf(p)) - (IS_SHARP[p % 12] ? 1.5 : 0);
const keyOk = (p, range, free = false) => p >= range[0] && p <= range[1] && (free || inScale(p));

// The note the pen (or a key) at staff y gives: nearest allowed key; shift ignores the scale lock.
function placeAt(L, y, free = false, snd = L.sel) {
  if (isLane(L)) return { p: snd.p, y: laneY(L), sprite: snd.sprite };
  const r = drumRow(L, snd);
  if (r != null) return { p: snd.p, d: r, y: yOf(r), sprite: snd.sprite };
  const range = soundRange(L, snd) || [STAFF_LO, STAFF_HI];
  let best = -1, bd = Infinity;
  for (const pass of free ? [true] : [false, true]) { // if the scale leaves nothing in range, fall back to all keys
    for (let p = range[0]; p <= range[1]; p++) {
      if (!keyOk(p, range, pass)) continue;
      const dd = Math.abs(y - keyY(p));
      if (dd < bd) { bd = dd; best = p; }
    }
    if (best >= 0) break;
  }
  const p = best;
  return { p, d: diatOf(p), y: yOf(diatOf(p)) - (IS_SHARP[p % 12] ? SHARP_UP : 0), sprite: snd.sprite };
}
// The key under the mouse while the keyboard is pressed, or hovered.
// The key lit on the keyboard: the one pressed, the note being dragged, or what the mouse points at on the staff.
function hotKey() {
  const d = S.drag, L = activeLayer();
  if (d?.mode === 'keys') return d.p;
  if (d?.note && !d.mode) return fixedPitch(d.L, d.note) ? null : d.note.p;
  const h = S.hover;
  if (d || !h || !L) return null;
  if (h.kind === 'key') return h.p;
  if (h.kind === 'empty' && S.tool === 'pen' && !isLane(L) && drumRow(L, L.sel) == null) return h.p;
  if (h.kind === 'note' && !fixedPitch(L, h.note)) return h.note.p;
  return null;
}

// The menu of scales, opened from the corner above the keys: roots on top, the scales, Guess at the bottom.
function drawScaleMenu() {
  const T = ui.T, x = SX, y = SY + RULER, rw = 11;
  const w = rw * 12 + 2, h = 14 + SCALE_LIST.length * 11 + 2 + 13;
  region(0, 0, ui.W, ui.H, { block: true, down: () => { S.scaleMenu = false; } });
  fill(x + 2, y + h, w, 2, T.ink); fill(x + w, y + 2, 2, h, T.ink);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, T.face);
  region(x, y, w, h, { block: true });
  // roots: C C# D ... B (the key the scale starts on); with the lock off, a root turns on Major
  const sc = curScale();
  for (let k = 0; k < 12; k++) {
    const id = 'root' + k, rx = x + 1 + k * rw, on = sc.pcs && scaleRoot() === k;
    fill(rx, y + 1, rw - 1, 11, on ? T.sel : hot(id) ? T.hover : IS_SHARP[k] ? T.beat : T.face);
    const nm = NAMES[k];
    text(nm, rx + ((rw - 1 - textWidth(nm)) >> 1), y + 4, on ? T.selInk : sc.pcs ? T.ink : T.dim);
    region(rx, y + 1, rw - 1, 11, { id, cursor: 'pointer', tip: `Root ${nm}`, click: () => setScale(sc.pcs ? sc.id : 'major', k) });
  }
  fill(x + 1, y + 12, w - 2, 1, T.off);
  SCALE_LIST.forEach((s, k) => {
    const id = 'scale-' + s.id, iy = y + 14 + k * 11, on = s === sc;
    if (on || hot(id)) fill(x + 1, iy, w - 2, 11, on ? T.sel : T.hover);
    text(s.name, x + 5, iy + 3, on ? T.selInk : T.ink);
    text(s.hint, x + w - 5 - textWidth(s.hint), iy + 3, on ? T.selInk : T.dim);
    region(x + 1, iy, w - 2, 11, { id, cursor: 'pointer', click: () => { setScale(s.id); S.scaleMenu = false; } });
  });
  const gy = y + 14 + SCALE_LIST.length * 11 + 1;
  fill(x + 1, gy, w - 2, 1, T.off);
  button(x + 2, gy + 1, 'Guess', { id: 'scaleGuess', w: w - 4, tip: 'Fit the scale to the song', click: () => { guessSongScale(); S.scaleMenu = false; } });
}
function drawScaleButton() {
  const T = ui.T, id = 'scaleBtn', on = S.scaleMenu || curScale().id !== 'off';
  const x = SX, y = SY, w = GUTTER - 1, h = RULER - 1;
  fill(x, y, w, h, S.scaleMenu ? T.sel : hot(id) ? T.hover : T.face);
  const label = scaleLabel();
  text(fitText(label, w - 2), x + Math.max(1, (w - textWidth(label)) >> 1), y + 4, S.scaleMenu ? T.selInk : on ? T.ink : T.dim);
  region(x, y, w, h, { id, cursor: 'pointer', tip: 'Scale lock · Shift: any key', click: () => { S.scaleMenu = !S.scaleMenu; S.menu = false; S.flyout = false; } });
}

function newNote(L, h) {
  const snd = L.sel || L.palette?.[0] || {}; // a track being added has no sound yet (its dialog previews sounds)
  const n = { s: h ? h.s : 0, n: 0, d: snd.d ?? Math.round(S.song.step * 2), p: h ? h.p : snd.p ?? 60, e: 1 };
  if (L.kind === 'sample') n.smp = snd.smp; else { n.i = snd.i; n.m = snd.m; }
  if (snd.gm != null) { n.gm = snd.gm; n.p = snd.p; }
  else if (!h && L.kind !== 'sample') n.p = snd.p ?? L.notes.find((x) => x.i === snd.i)?.p ?? 60;
  // Pen notes on the staff are one step long (no tail), or as long as the note the pipette took, with its slide.
  // Drums keep their natural length.
  if (h && !fixedPitch(L, n)) {
    n.d = Math.round(stepTime(S.song, n.s + (L.pick?.len || 1)) - stepTime(S.song, n.s));
    if (L.pick?.slide && L.kind !== 'sample') n.slide = L.pick.slide;
  }
  return n;
}

// The note under (x, y) in layer L, if any.
function noteAt(L, x, y) {
  const s = stepAt(x);
  let best = null, bd = 1e9;
  for (const n of L.notes) {
    if (n.s < s - 2 || n.s > s + 2) continue;
    const dx = Math.abs(xOf(n.s) + (S.colW >> 1) - x), dy = Math.abs(noteY(L, n) - y);
    if (dx <= 5 && dy <= 5 && dx + dy < bd) { bd = dx + dy; best = n; }
  }
  return best;
}

function hitTest(x, y, shift = false) {
  const L = activeLayer();
  if (y < RULER) return { kind: 'ruler', s: S.scroll + (x - GUTTER) / S.colW, x, y };
  if (!L) return { kind: 'none' };
  if (multiLayer()) { // several tracks: notes of any of them (h.L says which), the keys, the other tracks' lanes
    const inLanes = S.lanes.length && y >= lanesTop - 2;
    if (!inLanes && y <= viewBot && x < GUTTER && !isLane(L)) return { kind: 'key', ...placeAt(L, y, shift) };
    if (x < GUTTER) return { kind: 'none' };
    const s = stepAt(x);
    for (const M of selLayers()) { const n = noteAt(M, x, y); if (n) return { kind: 'note', note: n, s, L: M }; }
    const M = inLanes && laneAt(Math.max(lanesTop, y));
    if (M && !layerChosen(S.song.layers.indexOf(M))) return { kind: 'lane', li: S.song.layers.indexOf(M) };
    return { kind: 'none', s };
  }
  if (S.lanes.length && y >= lanesTop - 2) {
    const M = laneAt(Math.max(lanesTop, y));
    if (!M) return { kind: 'none' };
    if (M !== L) return { kind: 'lane', li: S.song.layers.indexOf(M) };
    if (x < GUTTER || S.hidden.has(S.active) || L.kind === 'dac') return { kind: 'none' };
  } else {
    if (y > viewBot || isLane(L)) return { kind: 'none' };
    if (x < GUTTER) return { kind: 'key', ...placeAt(L, y, shift) }; // the keys, and the clefs next to them
    if (S.hidden.has(S.active) || x < GUTTER) return { kind: 'none' };
  }
  const s = stepAt(x);
  const best = noteAt(L, x, y);
  if (best) return { kind: 'note', note: best, s };
  if (s < firstPlayStep() || s > lastPlayStep() || outOfRange(L, y)) return { kind: 'none' };
  return { kind: 'empty', s, ...placeAt(L, y, shift) };
}

// One voice plays one note at a time: a note placed in a column replaces any other note there.
function enforceColumn(L, note) {
  const before = L.notes.length;
  L.notes = L.notes.filter((n) => n === note || Math.round(n.s) !== Math.round(note.s));
  if (L.notes.length !== before) { indexLayer(L); for (const n of S.sel) if (!L.notes.includes(n)) S.sel.delete(n); }
}

// ...and a note sounds only until the next one starts: tails running into the next note are cut there.
function trimOverlaps(L, note) {
  indexLayer(L);
  const i = L.notes.indexOf(note);
  const cut = (a, b) => { if (a._t + a.d > b._t) { a.d = Math.max(1, Math.round(b._t - a._t)); a.e = 1; } };
  for (let k = 0; k < i; k++) cut(L.notes[k], note);
  if (i + 1 < L.notes.length) cut(note, L.notes[i + 1]);
  indexLayer(L);
}

// The eraser at (x, y): removes the note there, or cuts a long note's tail at the column under it.
function eraseAt(L, x, y) {
  const n = noteAt(L, x, y);
  if (n) {
    L.notes.splice(L.notes.indexOf(n), 1);
    S.sel.delete(n);
    indexLayer(L);
    return true;
  }
  const st = S.scroll + (x - GUTTER) / S.colW;
  const t = L.notes.find((m) => m._e - m.s > 1.05 && st > m.s + 1 && st < m._e && Math.abs(noteY(L, m) - y) <= 2);
  if (!t) return false;
  const cut = Math.max(Math.round(t.s) + 1, Math.floor(st));
  t.d = Math.max(1, Math.round(stepTime(S.song, cut) - t._t)); t.e = 1;
  indexLayer(L);
  return true;
}
function eraseNote(L, n) {
  pushUndo();
  L.notes.splice(L.notes.indexOf(n), 1);
  S.sel.delete(n);
  indexLayer(L);
  afterEdit();
}

// Give a note another sound of its layer (the bucket).
function applySound(L, n, snd) {
  if (L.kind === 'sample') n.smp = snd.smp;
  else { n.i = snd.i; n.m = snd.m; }
  if (snd.gm != null) { n.gm = snd.gm; n.p = snd.p; } else delete n.gm;
  if (L.kind === 'sample' && drumRow(L, n) != null) n.p = snd.p;
  n.e = 1;
}
// Notes with the same sound (what the fill swaps all at once), and that sound's name.
const soundKey = (L, n) => (L.kind === 'sample' ? 's' + n.smp : n.gm != null ? 'g' + n.gm : 'i' + n.i);
const soundName = (L, n) => (n.gm != null ? kitOf(n).name : L.kind === 'sample' ? S.song.samples[n.smp]?.name : soundOfNote(L, n)?.name) || 'sound';
// The palette sound a note was made with.
function soundOfNote(L, n) {
  return L.sounds.find((x) => (L.kind === 'sample' ? x.smp === n.smp : n.gm != null ? x.gm === n.gm : x.i === n.i));
}

function setScroll(s) { S.scroll = Math.max(-4, Math.min(S.totalSteps, s)); }

function staffDown(x, y, e) {
  const h = hitTest(x, y, e.shiftKey);
  const L = activeLayer();
  // the ruler works the same with every tool: flags, and Sonic dragged along
  if (h.kind === 'ruler' && e.button === 0) {
    if (nearEndFlag(x, y)) { pushUndo(); S.drag = { mode: 'end', moved: false }; return; }
    if (nearLoopFlag(x, y)) { pushUndo(); S.drag = { mode: 'loop', moved: false }; return; }
    S.drag = { mode: 'seek', s: Math.floor(h.s) }; seekToStep(S.drag.s); return;
  }
  // middle button or the hand: move the score around
  if (e.button === 1 || (S.tool === 'hand' && e.button === 0)) {
    S.drag = { mode: 'pan', x0: x, y0: y, scroll0: S.scroll, vy0: S.vy };
    S.followHold = true;
    return;
  }
  if (S.tool === 'repeat' && e.button === 0 && h.kind !== 'ruler') { repeatDown(x, y); return; }
  if (h.kind === 'ruler') return;
  const bars = BAR_TOOLS[S.tool];
  if (bars && x >= GUTTER && e.button === 0) {
    if (!L) return;
    if (!bars.ok(L)) { showStatus(typeof bars.why === 'function' ? bars.why(L) : bars.why); return; }
    pushUndo();
    S.drag = { mode: 'bars', L, moved: false, last: [x, y] };
    const n = paintBar(x, y);
    if (n) previewNote(L, n);
    return;
  }
  if (h.kind === 'lane') { selectLayer(h.li); return; }
  if (h.kind === 'key') { // play the key with the chosen sound; drag along the keys to play more
    S.drag = { mode: 'keys', L, p: h.p };
    previewNote(L, { ...newNote(L, null), p: h.p });
    return;
  }
  // the pipette picks from any visible layer, the active one first
  if (S.tool === 'pick' && e.button === 0) {
    const order = [S.active, ...S.song.layers.map((_, i) => i).filter((i) => i !== S.active && !S.hidden.has(i))];
    for (const i of order) {
      const M = S.song.layers[i];
      if (M.kind === 'dac' || (i === S.active && S.hidden.has(i))) continue;
      const n = noteAt(M, x, y);
      if (!n) continue;
      const snd = soundOfNote(M, n);
      if (i !== S.active) selectLayer(i);
      if (snd) M.sel = snd;
      // the pen will draw this note as it is: its sound, its length and its slide
      M.pick = { len: Math.max(1, Math.round(n._e - n.s)), slide: fixedPitch(M, n) ? 0 : n._slide || 0 };
      previewNote(M, n);
      setTool('pen');
      const extra = (fixedPitch(M, n) ? '' : ` · ${M.pick.len}/16`) + (M.pick.slide ? ` · slide ${M.pick.slide > 0 ? '+' : ''}${M.pick.slide}` : '');
      showStatus(`Picked ${snd ? snd.name : M.name}${extra}`);
      return;
    }
    return;
  }
  if (S.tool === 'select' && e.button === 0) {
    if (!L || (S.hidden.has(S.active) && !multiLayer())) return;
    const n = h.kind === 'note' ? h.note : null;
    const grab = () => { // every selected note remembers where it was and which track it is in
      const own = noteOwners();
      pushUndo();
      S.drag = { mode: 'move', L, s0: stepAt(x), d0: rowAt(y), orig: new Map([...S.sel].map((m) => [m, { s: m.s, p: m.p, L: own.get(m) || L }])), moved: false };
    };
    if (n && S.sel.has(n)) { grab(); return; }
    if (n) {
      if (!e.shiftKey) S.sel.clear();
      S.sel.add(n);
      grab();
      previewNote(h.L || L, n);
      return;
    }
    if (!e.shiftKey) S.sel.clear();
    S.drag = { mode: 'marquee', L, x0: x, y0: y, x1: x, y1: y };
    return;
  }
  if (S.tool === 'fill' && e.button === 0) {
    if (h.kind !== 'note') return;
    // the selected notes if this one is selected, otherwise every note of the track with this note's sound
    const from = soundKey(L, h.note), was = soundName(L, h.note);
    const targets = S.sel.has(h.note) ? [...S.sel] : L.notes.filter((n) => soundKey(L, n) === from);
    pushUndo();
    for (const n of targets) applySound(L, n, L.sel);
    indexLayer(L); afterEdit(); previewNote(L, h.note);
    showStatus(`${targets.length} note${targets.length > 1 ? 's' : ''}: ${S.sel.has(h.note) ? 'selected' : was} → ${L.sel.name}`);
    return;
  }
  if (S.tool === 'hand' || S.tool === 'pick' || S.tool === 'select' || S.tool === 'fill') return;
  const erase = e.button === 2 || S.tool === 'erase';
  const eraseIn = multiLayer() ? selLayers() : !S.hidden.has(S.active) && L.kind !== 'dac' ? [L] : [];
  if (erase && x >= GUTTER && eraseIn.length && (h.kind === 'note' || h.kind === 'empty' || h.kind === 'none')) {
    pushUndo();
    S.drag = { mode: 'erase', Ls: eraseIn, moved: false, lx: x, ly: y };
    for (const M of eraseIn) if (eraseAt(M, x, y)) S.drag.moved = true;
    return;
  }
  // the pen on a note: drag right / left draws its tail, up / down its slide (the first move decides which)
  if (h.kind === 'note') {
    if (erase) { eraseNote(L, h.note); return; }
    if (S.tool !== 'pen' || e.button !== 0) return;
    pushUndo();
    S.drag = { note: h.note, L, mode: 'penNote', x0: x, y0: y, moved: false, had: h.note._slide };
    previewNote(L, h.note);
  } else if (h.kind === 'empty' && !erase && e.button === 0 && S.tool === 'pen') {
    // a new note: it can still be dragged around; it takes its column (and removes what was there) on release
    pushUndo();
    const n = newNote(L, h);
    L.notes.push(n);
    indexLayer(L);
    S.drag = { note: n, L, grabS: 0, moved: true };
    previewNote(L, n);
  }
}

function staffMove(x, y, e) {
  const d = S.drag;
  if (!d) { staffHover(x, y, e); return; }
  if (d.mode === 'pan') {
    setScroll(d.scroll0 - (x - d.x0) / S.colW);
    setVy(d.vy0 - (y - d.y0));
    return;
  }
  if (d.mode === 'marquee') { d.x1 = x; d.y1 = y; return; }
  if (d.mode === 'seek') { // Sonic follows the mouse along the ruler
    const s = Math.max(0, Math.floor(S.scroll + (x - GUTTER) / S.colW));
    if (s !== d.s) { d.s = s; seekToStep(s); }
    showStatus(`Bar ${barBeat(s)}`);
    return;
  }
  if (d.mode === 'erase') { // rub along the path, so a fast stroke does not skip notes
    const k = Math.max(1, Math.ceil(Math.hypot(x - d.lx, y - d.ly) / 2));
    for (let i = 1; i <= k; i++) for (const M of d.Ls) if (eraseAt(M, d.lx + (x - d.lx) * i / k, d.ly + (y - d.ly) * i / k)) d.moved = true;
    d.lx = x; d.ly = y;
    return;
  }
  if (d.mode === 'keys') {
    const p = placeAt(d.L, y, e.shiftKey).p;
    if (p !== d.p) { d.p = p; previewNote(d.L, { ...newNote(d.L, null), p }); }
    showStatus(noteName(p));
    return;
  }
  if (d.mode === 'move') {
    const ds = stepAt(x) - d.s0, dr = rowAt(y) - d.d0;
    let changed = false;
    const touched = new Set();
    for (const [n, o] of d.orig) {
      const L = o.L;
      const s = Math.max(firstPlayStep(), Math.min(lastPlayStep(), o.s + ds));
      let p = o.p;
      if (!fixedPitch(L, n)) {
        const snd = soundOfNote(L, n) || L.sel;
        const [lo, hi] = soundRange(L, snd) || [STAFF_LO, STAFF_HI];
        p = Math.max(lo, Math.min(hi, natFromDiat(diatOf(o.p) + dr) + (IS_SHARP[o.p % 12] ? 1 : 0)));
      }
      if (s !== n.s || p !== n.p) { n.s = s; n.p = p; n.n = 0; n.e = 1; changed = true; touched.add(L); }
    }
    if (changed) { d.moved = true; for (const L of touched) indexLayer(L); }
    // how far: steps sideways, semitones up / down (of the first note that has a pitch; one note also shows its name)
    const sgn = (v) => (v > 0 ? '+' : '') + v;
    const pitched = [...d.orig].find(([n, o]) => !fixedPitch(o.L, n));
    let up = '';
    if (pitched) {
      const [n, o] = pitched, dp = n.p - o.p;
      up = ` · ${sgn(dp)} semitone${Math.abs(dp) === 1 ? '' : 's'}${S.sel.size === 1 ? ` (${noteName(o.p)} → ${noteName(n.p)})` : ''}`;
    }
    showStatus(`${S.sel.size} note${S.sel.size > 1 ? 's' : ''} · ${sgn(ds)} step${Math.abs(ds) === 1 ? '' : 's'}${up}`);
    return;
  }
  if (d.mode === 'penNote') {
    const dx = x - d.x0, dy = y - d.y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
    const canSlide = !fixedPitch(d.L, d.note) && d.L.kind !== 'sample';
    d.mode = Math.abs(dx) >= Math.abs(dy) || !canSlide ? 'tail' : 'slide';
  }
  if (d.mode === 'tail') {
    const { note, L } = d;
    const next = L.notes.find((m) => m.s > note.s); // the tail stops at the next note
    const endStep = Math.min(next ? Math.round(next.s) : Infinity, Math.max(Math.round(note.s) + 1, Math.round(S.scroll + (x - GUTTER) / S.colW)));
    const dd = Math.round(stepTime(S.song, endStep) - noteTime(S.song, note));
    if (dd !== note.d) { note.d = dd; note.e = 1; d.moved = true; indexLayer(L); }
    showStatus(`${noteName(note.p)} · ${endStep - Math.round(note.s)}/16`);
    return;
  }
  if (d.mode === 'bars') { paintBarsTo(x, y); return; }
  if (d.mode === 'rep' || d.mode === 'repEdge' || d.mode === 'loop') { repeatMove(x); return; }
  if (d.mode === 'end') {
    const bars = Math.max(1, Math.min(256, Math.round((S.scroll + (x - GUTTER) / S.colW) / 16)));
    if (bars !== songBars()) { setTiming(S.song.bpm, bars); updateTimingUI(); d.moved = true; }
    showStatus(`Song length · ${bars} bar${bars > 1 ? 's' : ''}`);
    return;
  }
  if (d.mode === 'slide') {
    const { note, L } = d;
    const target = placeAt(L, y, e.shiftKey, note).p;
    const slide = Math.max(-24, Math.min(24, target - note.p));
    if (slide !== note._slide) { note.slide = slide; note.e = 1; d.moved = true; indexLayer(L); }
    showStatus(`${noteName(note.p)} → ${noteName(note.p + slide)}`);
    return;
  }
  const { note, L } = d;
  const s = Math.max(firstPlayStep(), Math.min(lastPlayStep(), stepAt(x) - d.grabS));
  const p = fixedPitch(L, note) ? note.p : placeAt(L, y, e.shiftKey, note).p;
  if (s !== note.s || p !== note.p) {
    const pitchChanged = p !== note.p;
    note.s = s; note.p = p; note.n = 0; note.e = 1;
    d.moved = true;
    indexLayer(L);
    if (pitchChanged) previewNote(L, note);
  }
}

function staffHover(x, y, e) {
  const h = hitTest(x, y, e.shiftKey);
  S.hover = { ...h, x, y, py: h.y }; // py: the staff row the note would land on
  if (S.tool === 'repeat') S.hover.rep = repTarget(x, y);
  showStatus(staffStatus(S.hover), staffHint(S.hover));
}

function staffUp() {
  const drag = S.drag;
  if (!drag) return;
  S.drag = null;
  const { moved, mode, note, L, had } = drag;
  if (mode === 'pan' || mode === 'keys' || mode === 'seek') return;
  if (mode === 'erase') { if (moved) afterEdit(); else { S.undo.pop(); updateDocUI(); } return; }
  if (mode === 'marquee') {
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    for (const M of selLayers()) for (const n of M.notes) { // the box takes notes of every chosen track
      const cx = xOf(n.s) + (S.colW >> 1), cy = noteY(M, n);
      if (cx >= x0 - 2 && cx <= x1 + 2 && cy >= y0 - 2 && cy <= y1 + 2) S.sel.add(n);
    }
    showStatus(S.sel.size ? `${S.sel.size} note${S.sel.size > 1 ? 's' : ''} selected · drag to move, Del to delete, Ctrl+C / Ctrl+V` : '');
    return;
  }
  if (mode === 'move') {
    if (!moved) { S.undo.pop(); return; }
    for (const [n, o] of drag.orig) enforceColumnSel(o.L, n);
    for (const [n, o] of drag.orig) trimOverlaps(o.L, n);
    afterEdit();
    return;
  }
  if (mode === 'rep') {
    const { a, b } = drag;
    pushUndo();
    (S.song.repeats ??= []).push({ from: barStart(Math.min(a, b)), to: barStart(Math.max(a, b) + 1), times: repTimes() });
    afterEdit();
    return;
  }
  if (mode === 'end' || mode === 'loop' || mode === 'repEdge' || mode === 'bars') {
    if (moved) afterEdit(); else { S.undo.pop(); updateDocUI(); }
    return;
  }
  if (mode === 'penNote') { S.undo.pop(); updateDocUI(); return; } // a click on a note just plays it
  if (mode === 'tail') {
    if (moved) { trimOverlaps(L, note); afterEdit(); previewNote(L, note); } else { S.undo.pop(); updateDocUI(); }
    return;
  }
  if (mode === 'slide') {
    if (moved) { afterEdit(); previewNote(L, note); } else { S.undo.pop(); updateDocUI(); }
    return;
  }
  if (moved) { enforceColumn(L, note); trimOverlaps(L, note); afterEdit(); } else { S.undo.pop(); updateDocUI(); }
}
// Moved selection: a moved note replaces unselected notes in its column (selected ones keep theirs).
function enforceColumnSel(L, note) {
  const before = L.notes.length;
  L.notes = L.notes.filter((n) => n === note || S.sel.has(n) || Math.round(n.s) !== Math.round(note.s));
  if (L.notes.length !== before) indexLayer(L);
}

function staffWheel(e, x) {
  // Shift + wheel, or the wheel over the piano keys, scrolls the staff up and down
  if (e.shiftKey || x < GUTTER) { setVy(S.vy + (e.deltaY || e.deltaX) / 4); return; }
  const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  setScroll(S.scroll + dx / 20);
  S.followHold = true; // looking around: stop following until the next play or seek, Follow itself stays on
}

// ---------- selection: delete, copy, paste ----------
function deleteSelection() {
  if (!S.sel.size) return;
  pushUndo();
  for (const L of selLayers()) { L.notes = L.notes.filter((n) => !S.sel.has(n)); indexLayer(L); }
  const k = S.sel.size;
  S.sel.clear();
  afterEdit();
  showStatus(`Deleted ${k} note${k > 1 ? 's' : ''}`);
}
// Copy: notes of one track paste into a track of the same kind; notes of several tracks go back into those tracks.
function copySelection() {
  const L = activeLayer();
  if (!L || !S.sel.size) return;
  const notes = [...S.sel].sort((a, b) => a.s - b.s);
  const s0 = notes[0].s, own = noteOwners();
  const pick = ({ s, n, d, md, p, i, m, smp, gm, slide, vol, pan }) => ({ s: s - s0, n, d, md, p, i, m, smp, gm, slide, vol, pan });
  const tracks = new Set(notes.map((n) => own.get(n) || L));
  if (tracks.size > 1) S.clip = { parts: [...tracks].map((M) => ({ id: M.id, notes: notes.filter((n) => own.get(n) === M).map(pick) })) };
  else { const M = [...tracks][0]; S.clip = { kind: M.kind, kit: !!M.kit, voice: M.voice, notes: notes.map(pick) }; }
  showStatus(`Copied ${notes.length} note${notes.length > 1 ? 's' : ''}`);
}
function pasteClip() {
  const L = activeLayer(), c = S.clip;
  if (!L || !c) return;
  if (c.parts) { pasteParts(c); return; }
  if (c.kind !== L.kind || c.kit !== !!L.kit) { showStatus(`Copied notes are for a ${c.kind.toUpperCase()} track`); return; }
  const at = S.hover?.s ?? Math.max(firstPlayStep(), Math.ceil(S.scroll));
  pushUndo();
  S.sel.clear();
  for (const x of c.notes) {
    const n = { ...x, s: Math.round(at + x.s), e: 1 };
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
    if (n.s > lastPlayStep()) continue;
    L.notes.push(n);
    S.sel.add(n);
  }
  for (const n of S.sel) enforceColumnSel(L, n);
  indexLayer(L);
  for (const n of S.sel) trimOverlaps(L, n);
  afterEdit();
  setTool('select');
  showStatus(`Pasted ${S.sel.size} note${S.sel.size > 1 ? 's' : ''}`);
}

function pasteParts(c) {
  const at = S.hover?.s ?? Math.max(firstPlayStep(), Math.ceil(S.scroll));
  const parts = c.parts.map((p) => [S.song.layers.find((M) => M.id === p.id), p]).filter(([M]) => M);
  if (!parts.length) { showStatus('The tracks these notes came from are gone'); return; }
  pushUndo();
  S.sel.clear();
  S.layers = new Set(parts.map(([M]) => S.song.layers.indexOf(M)));
  if (!S.layers.has(S.active)) S.active = [...S.layers][0];
  for (const [M, p] of parts) {
    const added = [];
    for (const x of p.notes) {
      const n = { ...x, s: Math.round(at + x.s), e: 1 };
      for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
      if (n.s > lastPlayStep()) continue;
      M.notes.push(n); added.push(n); S.sel.add(n);
    }
    for (const n of added) enforceColumnSel(M, n);
    indexLayer(M);
    for (const n of added) trimOverlaps(M, n);
  }
  afterEdit();
  setTool('select');
  showStatus(`Pasted ${S.sel.size} note${S.sel.size > 1 ? 's' : ''} into ${parts.length} tracks`);
}

// Bar.beat of step s (bar.beat.16th with sixteenths: 3.2.2 = the second 16th of beat 2 of bar 3).
function barBeat(s, sixteenths = false) {
  const rel = s - S.barOffset, inBar = ((rel % 16) + 16) % 16;
  const sub = Math.floor(inBar % 4);
  return `${Math.floor(rel / 16) + 1}.${Math.floor(inBar / 4) + 1}${sixteenths && sub ? '.' + (sub + 1) : ''}`;
}
// The second row: the actions of the tool right here, short.
function staffHint(h) {
  const L = h?.L || activeLayer();
  if (!h) return '';
  if (h.kind === 'ruler') return nearEndFlag(h.x, h.y) || nearLoopFlag(h.x, h.y) ? 'Drag: move the flag' : 'Click or drag: move Sonic';
  if (h.kind === 'key') return 'Click: play · drag: play along';
  if (h.kind === 'lane') return 'Click: choose this track';
  if (!L || h.x < GUTTER) return '';
  const note = h.kind === 'note' ? h.note : null;
  const pitched = note && !fixedPitch(L, note) && L.kind !== 'sample';
  switch (S.tool) {
    case 'pen':
      if (note) return `Drag sideways: length${pitched ? ' · up / down: slide' : ''}`;
      return h.kind === 'empty' ? 'Click: place a note · right click: erase' : '';
    case 'select':
      if (note) return S.sel.has(note) ? 'Drag: move · Del: delete · Ctrl+C: copy' : 'Click: select · drag: move · Shift: add';
      return S.sel.size ? 'Drag: select · Ctrl+V: paste · Del: delete' : 'Drag: select a box';
    case 'erase': return note ? 'Click: erase · drag: rub out' : 'Drag: rub out notes, cut tails';
    case 'fill':
      if (!note) return '';
      return S.sel.has(note) ? `Click: selected notes → ${L.sel.name}` : `Click: all ${soundName(L, note)} → ${L.sel.name}`;
    case 'pick': return note ? 'Click: take sound, length, slide' : '';
    case 'hand': return 'Drag: move the score';
  }
  return '';
}
function staffStatus(h) {
  const L = h?.L || activeLayer();
  if (!h || (!L && h.kind !== 'ruler')) return '';
  if (S.tool === 'repeat' && h.rep) {
    const t = h.rep, bars = spanName;
    if (t.kind === 'edge') return `${bars(t.from, t.to)} x${t.r.times} · drag the sign`;
    if (t.kind === 'loopEdge') return `Loop from ${loopName(t.from)} · drag the sign`;
    if (t.kind === 'bar') return `Bar ${t.bar + 1} · click: x${repTimes()}, or drag over bars`;
    if (t.kind === 'rep') return `${bars(t.from, t.to)} x${t.r.times} · click: ${S.repMode === 'del' ? 'remove' : 'x' + repTimes()}`;
    if (t.kind === 'loop') return `Loop from ${loopName(t.from)} · click: remove`;
    if (t.kind === 'setLoop') return t.at >= 0 ? `Click: loop from ${loopName(t.at)}` : 'Click: loop from the start (no green repeat)';
  }
  if (h.kind === 'ruler' && nearEndFlag(h.x, h.y)) return 'End of song · drag to change the length';
  if (h.kind === 'ruler' && nearLoopFlag(h.x, h.y)) return 'The song loops from here · drag to move';
  if (h.kind === 'ruler') return `Bar ${barBeat(Math.floor(h.s))}`;
  if (h.kind === 'key') return noteName(h.p);
  if (h.kind === 'lane') return `Select ${S.song.layers[h.li].name}`;
  if (h.kind === 'note') {
    const n = h.note, drum = fixedPitch(L, n);
    const what = n.gm != null ? kitOf(n).name : L.kind === 'sample' ? S.song.samples[n.smp].name : soundOfNote(L, n)?.name || L.sel.name;
    const slide = n._slide ? ` → ${noteName(n.p + n._slide)}` : '';
    return `${drum ? '' : noteName(n.p) + slide + ' · '}${what} · ${barBeat(n.s)}`;
  }
  if (h.kind === 'empty') return `${fixedPitch(L, L.sel) ? L.sel.name : noteName(h.p)} · ${barBeat(h.s)}`;
  return '';
}

// ---------- tools ----------
const TOOLS = [
  { tool: 'select', icon: 'arrow', tip: 'Arrow: select and move notes · A' },
  { tool: 'pen', icon: 'pen', tip: 'Pen: draw notes · Q' },
  { tool: 'erase', icon: 'eraser', tip: 'Eraser: erase notes · W' },
  { tool: 'fill', icon: 'bucket', tip: 'Fill: swap a sound for the picked one · B' },
  { tool: 'pick', icon: 'pipette', tip: 'Pipette: take a note to draw with · I' },
  { tool: 'hand', icon: 'hand', tip: 'Hand: move the score · D' },
];
// Tools needed now and then: under the ⋯ button.
const MORE_TOOLS = [
  { tool: 'vol', icon: 'speaker', tip: 'Volume of notes · V' },
  { tool: 'pan', icon: 'phones', tip: 'Stereo of notes · P' },
  { tool: 'repeat', icon: 'repeat', tip: 'Repeats · X' },
];
function toolDisabled(t) {
  if (multiLayer() && ONE_TRACK_TOOLS.has(t)) return true;
  if (BAR_TOOLS[t]) return !activeLayer() || !BAR_TOOLS[t].ok(activeLayer());
  return false;
}
function setTool(t) {
  if (multiLayer() && ONE_TRACK_TOOLS.has(t)) { showStatus('Pen, fill and pipette work on one track: click a single track'); return; }
  if (BAR_TOOLS[t] && !BAR_TOOLS[t].ok(activeLayer() || {})) return;
  S.tool = t;
}
function setFollow(on) { S.follow = on; S.followHold = false; }
function setLoop(on) { S.loop = on; post({ type: 'loop', on }); }
const ZOOMS = [4, 6, 8, 10, 12, 16];
function zoom(dir) {
  const i = ZOOMS.indexOf(S.colW);
  const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + dir));
  const center = S.scroll + visibleSteps() / 2;
  S.colW = ZOOMS[ni];
  setScroll(center - visibleSteps() / 2);
}
function setTheme(name) {
  S.theme = name;
  ui.T = THEMES[name];
  document.body.style.background = ui.T.bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ui.T.bg);
  try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* ignore */ }
}

// ---------- status line ----------
// The status line has two rows: what is under the mouse, and (dim, under it) what can be done there.
function showStatus(t, hint = '') { S.status = t || ''; S.hint = hint || ''; }

// ---------- dialogs (drawn on the screen too) ----------
function openDialog(d) {
  blurField();
  S.menu = false; S.flyout = false;
  S.dlg = d;
  if (d.kind === 'export') setTimeout(() => focusField('expTitle', d.title, { ...exportFieldOpts(d, 'title'), selectAll: true }));
  if (d.kind === 'save' || d.kind === 'copy' || d.kind === 'myName') setTimeout(() => focusField('dlgName', d.name, { ...nameFieldOpts(d), ...(d.kind === 'myName' && { max: 24 }), selectAll: true }));
}
function closeDialog(result) {
  const d = S.dlg;
  if (!d) return;
  if (d.kind === 'fmEdit') {
    fmKeyUp(d);
    if (!result && !d.discard && fmChanged(d)) { fmCancel(d); return; } // CANCEL, the cross, Esc: ask first
  }
  if (d.kind === 'smpImport') { d.held = null; smpStop(d); }
  blurField();
  S.dlg = d.parent || null; // a dialog opened from another one goes back to it
  if (d.kind === 'bpm' && !d.done) { // the tempo dialog cancelled: the song as it was (exact, examples have odd tempos)
    applySnapshot(S.undo.pop());
    updateTimingUI(); rebuildModel(); sendTimeline();
    markDirty();
  }
  d.resolve?.(!!result);
}
// A question with a verb / Cancel (resolves true / false).
function ask(msg, ok, parent = null) {
  return new Promise((resolve) => openDialog({ kind: 'ask', text: msg, ok, resolve, parent }));
}
// A message with one CLOSE button.
function tell(msg, parent = null) {
  return new Promise((resolve) => openDialog({ kind: 'ask', text: msg, ok: 'CLOSE', info: true, resolve, parent }));
}
function nameFieldOpts(d) {
  return { max: 40, onInput: (v) => { d.name = v; }, onEnter: () => dialogOk(d), onEscape: () => closeDialog() };
}
async function dialogOk(d = S.dlg) {
  if (!d) return;
  if (d.kind === 'save') { closeDialog(); await saveAs(d.name.trim() || 'Untitled'); }
  else if (d.kind === 'copy') { closeDialog(); await saveCopy(d.name.trim() || 'Untitled'); }
  else if (d.kind === 'track') applyTrackDialog(d);
  else if (d.kind === 'myName') { closeDialog(); await renameMySound(d.parent, d.c, d.name.trim() || d.c.name); }
  else if (d.kind === 'patches') await importPatches(d);
  else if (d.kind === 'fmEdit') await fmSave(d);
  else if (d.kind === 'smpImport') await smpSave(d);
  else if (d.kind === 'ask') closeDialog(true);
  else if (d.kind === 'export') await exportSong(d);
  else if (d.kind === 'bpm') { d.done = true; if (!d.changed) S.undo.pop(); closeDialog(); }
  else closeDialog();
}

function wrapText(t, w) {
  const lines = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (textWidth(next) > w && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Dialog box: a frame with a title bar and a close button; everything else is blocked meanwhile.
function dialogBox(w, h, title) {
  const T = ui.T;
  w = Math.min(w, ui.W - 8); h = Math.min(h, ui.H - 8);
  const x = (ui.W - w) >> 1, y = (ui.H - h) >> 1;
  S.dlgBox = { x, y, w, h };
  region(0, 0, ui.W, ui.H, { block: true, down: () => {} });
  dither(0, 0, ui.W, ui.H, T.shade);
  fill(x + 2, y + h, w, 2, T.ink); fill(x + w, y + 2, 2, h, T.ink);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, T.face);
  fill(x + 1, y + 1, w - 2, 12, T.sel);
  text(title, x + 4, y + 4, T.selInk);
  fill(x, y + 13, w, 1, T.ink);
  strip(x + w - 14, y, [{ id: 'dlgClose', icon: 'close', tip: 'Close · Esc', click: () => closeDialog() }], SMALL);
  return { x, y: y + 14, w, h: h - 14 };
}

// The status line is under the dialog's shade: a dialog shows the tip of what is hovered right under its box.
function drawDialogTip() {
  const tip = ui.hover?.tip, b = S.dlgBox, T = ui.T;
  if (!tip || !b) return;
  const lines = wrapText(tip, Math.max(60, b.w - 8));
  const h = lines.length * 8 + 5, w = Math.min(b.w, Math.max(...lines.map(textWidth)) + 8);
  const x = b.x + ((b.w - w) >> 1), y = Math.min(ui.H - h - 1, b.y + b.h + 5);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, T.face);
  lines.forEach((l, i) => text(l, x + 4, y + 3 + i * 8, T.ink));
}
function drawDialog() {
  const d = S.dlg, T = ui.T;
  if (d.kind === 'ask') {
    const lines = wrapText(d.text, 180);
    const r = dialogBox(196, 14 + 10 + lines.length * 8 + 22, 'SEGA PAINT');
    lines.forEach((l, i) => text(l, r.x + 8, r.y + 8 + i * 8, T.ink));
    const by = r.y + r.h - 19;
    const wOk = textWidth(d.ok) + 10, wC = textWidth('CANCEL') + 10;
    button(r.x + r.w - 8 - wOk, by, d.ok, { id: 'askOk', primary: true, click: () => closeDialog(true) });
    if (!d.info) button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'askCancel', click: () => closeDialog(false) });
    return;
  }
  if (d.kind === 'save' || d.kind === 'copy') {
    const r = dialogBox(200, 14 + 52, d.kind === 'save' ? 'SAVE' : 'SAVE A COPY');
    text('NAME', r.x + 8, r.y + 7, T.dim);
    field(r.x + 8, r.y + 15, r.w - 16, 'dlgName', d.name, { ...nameFieldOpts(d), placeholder: 'My riff…' });
    const wOk = textWidth('SAVE') + 10, wC = textWidth('CANCEL') + 10, by = r.y + r.h - 19;
    button(r.x + r.w - 8 - wOk, by, 'SAVE', { id: 'dlgOk', primary: true, click: () => dialogOk(d) });
    button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'dlgCancel', click: () => closeDialog() });
    return;
  }
  if (d.kind === 'myName') {
    const r = dialogBox(200, 14 + 52, 'RENAME SOUND');
    text('NAME', r.x + 8, r.y + 7, T.dim);
    field(r.x + 8, r.y + 15, r.w - 16, 'dlgName', d.name, { ...nameFieldOpts(d), max: 24 });
    const wOk = textWidth('RENAME') + 10, wC = textWidth('CANCEL') + 10, by = r.y + r.h - 19;
    button(r.x + r.w - 8 - wOk, by, 'RENAME', { id: 'dlgOk', primary: true, click: () => dialogOk(d) });
    button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'dlgCancel', click: () => closeDialog() });
    return;
  }
  if (d.kind === 'myIcon') { drawMyIconDialog(d); return; }
  if (d.kind === 'export') { drawExportDialog(d); return; }
  if (d.kind === 'patches') { drawPatchDialog(d); return; }
  if (d.kind === 'fmEdit') { drawFmEditor(d); return; }
  if (d.kind === 'smpImport') { drawSampleImport(d); return; }
  if (d.kind === 'open') { drawOpenDialog(d); return; }
  if (d.kind === 'bpm') { drawBpmDialog(d); return; }
  if (d.kind === 'settings') { drawSettingsDialog(d); return; }
  if (d.kind === 'add') { drawAddDialog(d); return; }
  if (d.kind === 'track') drawTrackDialog(d);
}

// Tempo: +/- and the usual tempos; the song plays the new tempo at once, Cancel puts the old one back.
const BPM_PRESETS = [60, 80, 90, 100, 110, 120, 128, 135, 140, 150, 160, 175];
function openBpmDialog() {
  pushUndo(); // one undo step for everything done in the dialog
  openDialog({ kind: 'bpm', was: S.song.bpm, dirty: S.dirty, changed: false });
}
function drawBpmDialog(d) {
  const T = ui.T;
  const r = dialogBox(176, 14 + 90, 'TEMPO');
  const set = (v) => { setBpm(v, false); d.changed = true; };
  const cur = Math.round(S.song.bpm), n = String(cur);
  // the number between - and +
  const cy = r.y + 8;
  let bx = r.x + 8;
  bx += button(bx, cy, '-10', { id: 'bpmM10', w: 22, tip: 'Slower by 10', click: () => set(cur - 10) }) + 2;
  bx += button(bx, cy, '-1', { id: 'bpmM1', w: 18, tip: 'Slower', click: () => set(cur - 1) }) + 2;
  const nw = r.x + r.w - 8 - 22 - 2 - 18 - 2 - bx - 2;
  frame(bx, cy, nw, 13, T.ink); fill(bx + 1, cy + 1, nw - 2, 11, T.lcd);
  text(n, bx + ((nw - textWidth(n)) >> 1), cy + 4, T.lcdInk);
  region(bx, cy, nw, 13, { id: 'bpmNum', tip: 'BPM · wheel to change', wheel: (e) => set(cur + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)) });
  bx += nw + 2;
  bx += button(bx, cy, '+1', { id: 'bpmP1', w: 18, tip: 'Faster', click: () => set(cur + 1) }) + 2;
  button(bx, cy, '+10', { id: 'bpmP10', w: 22, tip: 'Faster by 10', click: () => set(cur + 10) });
  // the usual tempos
  text('USUAL TEMPOS', r.x + 8, r.y + 28, T.dim);
  const per = 6, pw = Math.floor((r.w - 16 - (per - 1) * 2) / per);
  BPM_PRESETS.forEach((v, k) => {
    button(r.x + 8 + (k % per) * (pw + 2), r.y + 36 + Math.floor(k / per) * 15, String(v), { id: 'bpmPre' + v, w: pw, primary: cur === v, click: () => set(v) });
  });
  const by = r.y + r.h - 19, wOk = textWidth('SET') + 10, wC = textWidth('CANCEL') + 10;
  button(r.x + r.w - 8 - wOk, by, 'SET', { id: 'bpmOk', primary: true, click: () => dialogOk(d) });
  button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'bpmCancel', click: cancelBpm });
}
const cancelBpm = () => closeDialog(); // Cancel, the cross and Esc put the old tempo back (closeDialog)

// A list of rows inside a dialog: clipped, scrolled with the wheel.
function listRows(x, y, w, h, rows, d, rowH = 13, idp = '') {
  const T = ui.T;
  frame(x, y, w, h);
  const inner = h - 2, total = rows.length * rowH;
  d.scroll = Math.max(0, Math.min(Math.max(0, total - inner), d.scroll || 0));
  region(x, y, w, h, { wheel: (e) => { d.scroll += e.deltaY > 0 ? rowH * 2 : -rowH * 2; } });
  g.save(); g.beginPath(); g.rect(x + 1, y + 1, w - 2, inner); g.clip();
  rows.forEach((row, i) => {
    const ry = y + 1 + i * rowH - d.scroll;
    if (ry + rowH < y || ry > y + h) return;
    const id = idp + 'row' + i;
    const rw = w - 2 - (row.del ? rowH : 0);
    const bg = row.sel ? T.sel : hot(id) ? T.hover : row.current ? T.soft : T.face;
    fill(x + 1, ry, w - 2, rowH, bg);
    fill(x + 1, ry + rowH - 1, w - 2, 1, T.hover);
    const meta = row.meta ? fitText(row.meta, 90) : '';
    const mw = meta ? textWidth(meta) + 6 : 0;
    // a group's header (a game): ▸ folded, ▾ open, like the sound groups; its rows go in under it
    if (row.fold) {
      if (!hot(id)) fill(x + 1, ry, w - 2, rowH - 1, T.bg);
      const tri = (tx, ty) => { for (let k = 0; k < 4; k++) row.fold === 'open' ? fill(tx + k, ty + k, 7 - 2 * k, 1, T.ink) : fill(tx + k, ty + k, 1, 7 - 2 * k, T.ink); };
      row.fold === 'open' ? tri(x + 4, ry + 4) : tri(x + 5, ry + 3);
    }
    const ix = x + 5 + (row.fold || row.inGroup ? 9 : 0);
    // a song from the games: its number on the "disc" first, in a column of its own
    const nw = row.num ? textWidth('00') + 5 : 0;
    if (row.num) text(row.num, ix, ry + 4, row.sel ? T.selInk : T.dim);
    text(fitText(row.label, x + rw - 3 - mw - ix - nw), ix + nw, ry + 4, row.sel ? T.selInk : row.dim ? T.dim : T.ink);
    if (meta) text(meta, x + 1 + rw - 3 - textWidth(meta), ry + 4, row.sel ? T.selInk : T.dim);
    const vis = Math.max(ry, y + 1), visH = Math.min(ry + rowH, y + 1 + inner) - vis;
    if (visH > 0 && row.click) region(x + 1, vis, rw, visH, { id, cursor: 'pointer', tip: row.tip, click: row.click, dbl: row.dbl, wheel: (e) => { d.scroll += e.deltaY > 0 ? rowH * 2 : -rowH * 2; } });
    if (row.del) {
      const dx = x + w - 1 - rowH, did = idp + 'del' + i;
      fill(dx, ry, 1, rowH, T.hover);
      g.drawImage(smallIcon('trash', hot(did) ? T.red : T.dim), dx + 1, ry);
      if (visH > 0) region(dx, vis, rowH, visH, { id: did, cursor: 'pointer', tip: 'Delete', click: row.del });
    }
  });
  g.restore();
}

// Open: a click picks a song and shows what it is, Open (or a double click) opens it.
function drawOpenDialog(d) {
  const T = ui.T;
  const r = dialogBox(280, 236, 'OPEN');
  let x = r.x + 8;
  const tab = (t) => () => { d.tab = t; d.scroll = 0; d.pick = null; };
  x += button(x, r.y + 6, 'MY SONGS', { id: 'tabMine', primary: d.tab === 'mine', click: tab('mine') }) + 3;
  button(x, r.y + 6, 'FROM THE GAMES', { id: 'tabRefs', primary: d.tab === 'refs', click: tab('refs') });
  const cur = S.doc;
  const pick = (target, key) => () => { d.pick = { target, key }; loadSongInfo(d, target, key); };
  const opener = (target) => async () => {
    if (!await confirmDiscard()) return;
    closeDialog();
    try { await openDoc(target); } catch (e) { console.error(e); tell(`Could not open the song: ${e.message}`); }
  };
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
  let rows;
  if (d.tab === 'refs') { // one folded group per game; a song shows who wrote it
    rows = [];
    for (const game of new Set(S.refs.map((ref) => ref.game || ''))) {
      const songs = S.refs.filter((ref) => (ref.game || '') === game), open = d.games.has(game);
      rows.push({ fold: open ? 'open' : 'shut', label: game || 'Other', meta: `${songs.length} songs`, tip: open ? 'Fold' : 'Show the songs',
        click: () => { if (open) d.games.delete(game); else d.games.add(game); } });
      if (open) for (const ref of songs) {
        const target = { kind: 'ref', dir: ref.dir }, key = 'r:' + ref.dir;
        rows.push({ inGroup: true, num: trackNo(ref), label: ref.title, meta: ref.composer, sel: d.pick?.key === key, current: cur.kind === 'ref' && cur.dir === ref.dir, click: pick(target, key), dbl: opener(target) });
      }
    }
  } else {
    rows = d.mine.map((m) => {
      const target = { kind: 'user', id: m.id }, key = 'u:' + m.id;
      return {
        label: m.name, meta: fmt.format(m.updated), sel: d.pick?.key === key, current: cur.kind === 'user' && cur.id === m.id, click: pick(target, key), dbl: opener(target),
        del: async () => {
          if (!await ask(`Delete “${m.name}”? This cannot be undone.`, 'Delete')) { showOpenDialog(); return; }
          await deleteMine(m.id);
          if (cur.kind === 'user' && cur.id === m.id) await openDoc({ kind: 'ref', dir: baseRef() });
          showOpenDialog();
        },
      };
    });
    if (!rows.length) rows = [{ label: 'No songs yet.', dim: true }];
  }
  const infoH = 26, footer = 20;
  listRows(r.x + 8, r.y + 23, r.w - 16, r.h - 23 - infoH - footer, rows, d);
  // what the picked song is
  const iy = r.y + r.h - footer - infoH + 4;
  const info = d.pick && d.info?.[d.pick.key];
  if (!d.pick) text('Pick a song', r.x + 8, iy + 4, T.dim);
  else if (!info) text('…', r.x + 8, iy + 4, T.dim);
  else {
    text(fitText(info.title, r.w - 16), r.x + 8, iy, T.ink);
    text(fitText(info.line, r.w - 16), r.x + 8, iy + 9, T.dim);
  }
  const by = r.y + r.h - 18, wO = textWidth('OPEN') + 14, wC = textWidth('CANCEL') + 10;
  if (d.tab === 'mine') button(r.x + 8, by, 'FROM FILE…', { id: 'import', click: () => $('importFile').click() });
  button(r.x + r.w - 8 - wO, by, 'OPEN', { id: 'openOk', primary: !!d.pick, disabled: !d.pick, click: () => d.pick && opener(d.pick.target)() });
  button(r.x + r.w - 8 - wO - 4 - wC, by, 'CANCEL', { id: 'openCancel', click: () => closeDialog() });
}
// The line under the Open list: game, tempo, bars, length, tracks (read from the song once).
async function loadSongInfo(d, target, key) {
  d.info ??= {};
  if (d.info[key]) return;
  try {
    let song, title, when = '';
    if (target.kind === 'ref') { song = await fetchRef(target.dir); title = song.title; }
    else {
      const rec = await getMine(target.id);
      song = rec.song; title = rec.name;
      song.game = S.refs.find((x) => x.dir === rec.base)?.game || '';
      when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(rec.updated);
    }
    const sec = Math.round(song.end / RATE), bars = Math.max(1, Math.round(timeToStep(song, song.end) / 16));
    const parts = [song.game, `${Math.round(song.bpm)} BPM`, `${bars} bars`, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, `${song.layers.length} tracks`, when];
    d.info[key] = { title, line: parts.filter(Boolean).join(' · ') };
  } catch (e) {
    d.info[key] = { title: 'Could not read this song', line: e.message };
  }
}

function setSound(name) {
  S.sound = name;
  post({ type: 'clean', on: name === 'clean' });
  try { localStorage.setItem(SOUND_KEY, name); } catch (e) { /* ignore */ }
}
function drawSettingsDialog() {
  const T = ui.T;
  const r = dialogBox(200, 14 + 136, 'SETTINGS');
  text('SCREEN SIZE', r.x + 8, r.y + 7, T.dim);
  let x = r.x + 8;
  for (const k of SCALES) {
    x += button(x, r.y + 15, 'x' + k, { id: 'scale' + k, w: 23, primary: ui.scale === k, tip: k > ui.fit ? 'Too big for this window: shown smaller' : `Pixels x${k}`, click: () => setPixelScale(k) }) + 3;
  }
  if (ui.scale > ui.fit) text(`WINDOW TOO SMALL: x${ui.SC}`, r.x + 8, r.y + 31, T.red);
  text('THEME', r.x + 8, r.y + 43, T.dim);
  x = r.x + 8;
  x += button(x, r.y + 51, 'LIGHT', { id: 'themeLight', primary: S.theme === 'light', click: () => setTheme('light') }) + 3;
  button(x, r.y + 51, 'DARK', { id: 'themeDark', primary: S.theme === 'dark', click: () => setTheme('dark') });
  text('SOUND', r.x + 8, r.y + 71, T.dim);
  x = r.x + 8;
  x += button(x, r.y + 79, 'CLEAN', { id: 'soundClean', primary: S.sound === 'clean', tip: 'No DAC grit', click: () => setSound('clean') }) + 3;
  button(x, r.y + 79, 'MODEL 1', { id: 'soundModel1', primary: S.sound === 'model1', tip: 'First Mega Drive, gritty DAC', click: () => setSound('model1') });
  const wDone = textWidth('DONE') + 10;
  text('VERSION', r.x + 8, r.y + 99, T.dim);
  text(VERSION, r.x + 8 + textWidth('VERSION') + 6, r.y + 99, T.ink);
  if (LOCAL) button(r.x + 8, r.y + r.h - 19, 'EDIT ART', { id: 'editArt', tip: 'Open the art editor', click: () => window.open('art.html', 'segapaint-art') });
  button(r.x + r.w - 8 - wDone, r.y + r.h - 19, 'DONE', { id: 'setDone', primary: true, click: () => closeDialog() });
}
function setPixelScale(k) {
  ui.scale = k;
  try { localStorage.setItem(SCALE_KEY, String(k)); } catch (e) { /* ignore */ }
  resizeScreen();
}

function drawAddDialog(d) {
  const r = dialogBox(220, 180, 'ADD TRACK');
  text('FREE VOICES', r.x + 8, r.y + 7, ui.T.dim);
  const free = freeVoices();
  const rows = free.length ? free.map((v) => ({ label: v.label, meta: v.what, click: () => { closeDialog(); addTrack(v); } }))
    : [{ label: 'All voices are in use.', dim: true }];
  listRows(r.x + 8, r.y + 15, r.w - 16, r.h - 23, rows, d);
}

function drawTrackDialog(d) {
  const T = ui.T, L = d.L;
  const r = dialogBox(316, 290, `${d.isNew ? 'ADD TRACK' : 'TRACK'} · ${chipName(L)}`);
  text('NAME', r.x + 8, r.y + 7, T.dim);
  field(r.x + 8, r.y + 15, 140, 'trackName', d.name, { max: 24, onInput: (v) => { d.name = v; }, onEnter: () => applyTrackDialog(d) });
  // the track's colour: one of the Mega Drive tones (other tracks' colours can be taken too)
  text('COLOUR', r.x + 156, r.y + 7, T.dim);
  LAYER_TONES.forEach((t, k) => {
    const sx = r.x + 156 + k * 12, sy = r.y + 15, id = 'tone' + k;
    fill(sx, sy, 11, 11, T.ink);
    fill(sx + 1, sy + 1, 9, 9, rgbCss(t[1]));
    if (d.tone === k) { fill(sx + 3, sy + 3, 5, 5, rgbCss(t[2])); fill(sx + 4, sy + 4, 3, 3, rgbCss(t[0])); }
    region(sx, sy, 11, 11, { id, cursor: 'pointer', tip: S.song.layers.some((M) => M !== L && M.tone === k) ? 'Colour of another track too' : 'Track colour',
      click: () => { d.tone = k; } });
  });
  // the icon of one chosen sound (the one clicked last): only the icons of the chosen sounds, so what the track
  // shows is what it plays; picking one swaps it with the sound that had it
  const target = d.lib.find((x) => x.key === d.iconFor && d.chosen.has(x.key)) || d.lib.find((x) => d.chosen.has(x.key));
  const iconOf = (x) => d.icons.get(x.key) || x.sprite;
  const choices = [...new Set(d.lib.filter((x) => d.chosen.has(x.key)).map(iconOf))];
  const iy = r.y + r.h - 24 - 30;
  text(target ? `ICON OF ${target.name.toUpperCase()}` : 'ICON: CLICK A SOUND', r.x + 8, iy, T.dim);
  if (target) {
    const curIcon = d.icons.get(target.key) || target.sprite, per = Math.floor((r.w - 16) / 13);
    choices.forEach((nm, k) => {
      const ix = r.x + 8 + (k % per) * 13, iy2 = iy + 7 + Math.floor(k / per) * 13, id = 'icon' + nm, on = nm === curIcon;
      fill(ix, iy2, 13, 13, on ? T.sel : hot(id) ? T.hover : T.face);
      g.drawImage(noteSprite(nm, d.tone, on ? 1 : 0, 'normal', T), ix, iy2);
      region(ix, iy2, 13, 13, { id, cursor: 'pointer', tip: nm, click: () => {
        // a sound keeps its own icon: one taken from another sound of the track goes over to that one
        const other = d.lib.find((x) => x !== target && d.chosen.has(x.key) && (d.icons.get(x.key) || x.sprite) === nm);
        if (other) d.icons.set(other.key, curIcon);
        d.icons.set(target.key, nm);
        previewNote(L, { ...newNote(L, null), ...(L.kind === 'sample' ? { smp: target.smp, p: target.p } : { i: target.i, m: target.m, p: target.p, gm: target.gm }) });
      } });
    });
  }
  text('SOUNDS IN PALETTE', r.x + 8, r.y + 34, T.dim);
  // grid of sounds: click to put in / take out of the palette. Sounds come in groups by game, folded at first.
  const gx = r.x + 8, gy = r.y + 42, gw = r.w - 16, gh = r.h - 42 - 24 - 36;
  const cw = 97, ch = 14, hh = 13, cols = Math.max(1, Math.floor((gw - 1) / cw));
  const grouped = true;
  d.open ??= new Set([MY]);
  const groupOf = (snd) => snd.group || 'This song';
  const groups = [{ name: MY, items: [] }]; // My sounds is always there, first
  const canImport = L.kind === 'fm' && !L.kit; // FM patch files (patches.js) become FM sounds
  const canSample = L.kind === 'sample'; // audio files become samples (sampler.js)
  if (canSample) { // what the song's samples take, against the budget of one song
    const kb = songSampleBytes() / 1024, t = `SONG SAMPLES ${kb.toFixed(1)} OF ${SONG_BUDGET_KB} KB`;
    text(t, r.x + r.w - 8 - textWidth(t), r.y + 34, kb > SONG_BUDGET_KB ? T.red : T.dim);
  }
  d.lib.forEach((snd, k) => {
    const name = grouped ? groupOf(snd) : '';
    let grp = groups.find((x) => x.name === name);
    if (!grp) groups.push((grp = { name, items: [] }));
    grp.items.push({ snd, k });
  });
  // layout: a header row per group, then its cells when open
  const rows = [];
  let yy = 0;
  for (const grp of groups) {
    const open = !grouped || d.open.has(grp.name);
    if (grouped) { rows.push({ head: grp, y: yy, open }); yy += hh + 1; }
    if (open && !grp.items.length) { rows.push({ hint: 'Empty', y: yy }); yy += ch + 3; }
    if (open) {
      grp.items.forEach((it, n) => rows.push({ cell: it, x: (n % cols) * cw, y: yy + Math.floor(n / cols) * ch }));
      yy += Math.ceil(grp.items.length / cols) * ch + (grouped ? 3 : 0);
    }
  }
  d.scroll = Math.max(0, Math.min(Math.max(0, yy - gh), d.scroll || 0));
  const wheel = (e) => { d.scroll += e.deltaY > 0 ? 28 : -28; };
  region(gx, gy, gw, gh, { wheel });
  g.save(); g.beginPath(); g.rect(gx, gy, gw, gh); g.clip();
  for (const row of rows) {
    const ry = gy + row.y - d.scroll;
    const h = row.head ? hh : ch;
    if (ry + h < gy || ry > gy + gh) continue;
    const vis = Math.max(ry, gy), visH = Math.min(ry + h, gy + gh) - vis;
    if (row.hint) { text(row.hint, gx + 13, ry + 4, T.dim); continue; }
    if (row.head) {
      const grp = row.head, id = 'grp' + grp.name;
      const n = grp.items.filter((it) => d.chosen.has(it.snd.key)).length;
      fill(gx, ry, gw, hh, hot(id) ? T.hover : T.bg);
      const tri = (x, y) => { for (let k = 0; k < 4; k++) row.open ? fill(x + k, y + k, 7 - 2 * k, 1, T.ink) : fill(x + k, y + k, 1, 7 - 2 * k, T.ink); };
      row.open ? tri(gx + 3, ry + 4) : tri(gx + 4, ry + 3);
      text(grp.name.toUpperCase(), gx + 13, ry + 4, T.ink);
      const cnt = `${n}/${grp.items.length}`;
      text(cnt, gx + gw - 4 - textWidth(cnt), ry + 4, T.dim);
      if (visH > 0) region(gx, vis, gw, visH, { id, cursor: 'pointer', wheel, tip: row.open ? 'Fold' : 'Show the sounds',
        click: () => { if (d.open.has(grp.name)) d.open.delete(grp.name); else d.open.add(grp.name); } });
      if (grp.name === MY && visH === hh) {
        const wI = textWidth('IMPORT…') + 8, ix = gx + gw - 4 - textWidth(cnt) - 6 - wI;
        fill(ix, ry + 1, wI, hh - 2, hot('myImport') ? T.hover : T.face); frame(ix, ry + 1, wI, hh - 2);
        text('IMPORT…', ix + 4, ry + 4, T.ink);
        region(ix, ry + 1, wI, hh - 2, { id: 'myImport', cursor: 'pointer', tip: 'Sound file · or drop it here', click: () => $('anyFile').click() });
      }
      if (grp.name === MY && canImport && visH === hh) {
        const ix = gx + gw - 4 - textWidth(cnt) - 6 - textWidth('IMPORT…') - 8;
        const wN = textWidth('NEW…') + 8, nx = ix - 3 - wN;
        fill(nx, ry + 1, wN, hh - 2, hot('myNew') ? T.hover : T.face); frame(nx, ry + 1, wN, hh - 2);
        text('NEW…', nx + 4, ry + 4, T.ink);
        region(nx, ry + 1, wN, hh - 2, { id: 'myNew', cursor: 'pointer', tip: 'New FM sound',
          click: () => openFmEditor(d, null, blankFmRecord(), true) });
      }
      continue;
    }
    const { snd, k } = row.cell, cx = gx + row.x;
    const on = d.chosen.has(snd.key), id = 'snd' + k;
    frame(cx, ry, cw - 2, ch + 1);
    fill(cx + 1, ry + 1, cw - 4, ch - 1, on ? T.sel : hot(id) ? T.hover : T.face);
    g.drawImage(noteSprite(d.icons.get(snd.key) || snd.sprite, d.tone, 0, on ? 'normal' : 'ghost', T), cx + 1, ry + 1);
    if (snd.key === d.iconFor) fill(cx + 1, ry + ch - 1, cw - 4, 1, T.head);
    text(fitText(snd.name, cw - 20), cx + 15, ry + 5, on ? T.selInk : T.ink);
    if (visH > 0) region(cx, vis, cw - 2, visH, {
      id, cursor: 'pointer', wheel,
      tip: `${snd.name} · ${on ? 'click: take out' : 'click: add'} · right click: more`,
      dbl: () => { const c = myEntryOf(L, snd); if (c?.ins && L.kind === 'fm') openFmEditor(d, c, myRec(c)); },
      click: (m, e) => {
        if (e?.button === 2) { d.ctxAt = { x: m.x, y: m.y }; d.ctx = { ...d.ctxAt, items: mySoundMenu(d, snd) }; return; }
        let x = snd;
        if (x.cat) { // a library sound joins the song when it is first picked
          if (L.kind === 'sample') {
            const i = addCatalogSample(x.cat);
            d.lib = soundLibrary(L);
            x = d.lib.find((y) => y.smp === i);
          } else {
            const snd = addCatalogSound(x.cat);
            d.lib = soundLibrary(L);
            x = d.lib.find((y) => y.key === snd.key) || snd;
          }
        }
        if (d.chosen.has(x.key)) { d.chosen.delete(x.key); if (d.iconFor === x.key) d.iconFor = null; } else { d.chosen.add(x.key); d.iconFor = x.key; }
        previewNote(L, { ...newNote(L, null), ...(L.kind === 'sample' ? { smp: x.smp, p: x.p } : { i: x.i, m: x.m, p: x.p, gm: x.gm }) });
      },
    });
  }
  g.restore();
  // Windows-style: Cancel forgets everything clicked here; ADD / DONE need at least one sound
  const by = r.y + r.h - 19, okLabel = d.isNew ? 'ADD' : 'DONE', none = !d.chosen.size;
  const wOk = textWidth(okLabel) + 14, wC = textWidth('CANCEL') + 10;
  button(r.x + r.w - 8 - wOk, by, okLabel, { id: 'trackDone', primary: !none, disabled: none, tip: none ? 'Choose a sound first' : '', click: () => applyTrackDialog(d) });
  button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'trackCancel', click: () => closeDialog() });
  if (!d.isNew) button(r.x + 8, by, 'DELETE TRACK', { id: 'trackDel', disabled: S.song.layers.length <= 1, click: () => { closeDialog(); deleteTrack(L); } });
  if (d.ctx) popMenu(d.ctx.x, d.ctx.y, d.ctx.items, () => { d.ctx = null; });
}

// ---------- My sounds: any sound can be copied there; there it can be renamed, get a new icon, be duplicated, go ----------
// Songs keep their own copy of a sound (libUse), so nothing here changes how a saved song sounds.
const mySec = (L) => (L.kind === 'sample' ? 'samples' : L.kit ? 'drums' : L.kind);
// The library entry (a game's or My sounds') behind a sound of the track dialog; null for the song's own sounds.
const catEntryOf = (L, x) => x.cat || (x.lib && catOf(mySec(L)).find((c) => c.key === x.lib)) || null;
const myEntryOf = (L, x) => { const c = catEntryOf(L, x); return c?.my ? c : null; };
const myRec = ({ game, my, key, created, updated, ...r }) => r; // a My sounds entry as it is stored
const fitName = (t) => t.slice(0, 24);
// A sound as a record of My sounds: from the song when it is in it, else from the library.
function soundRecord(L, x) {
  const type = mySec(L), c = catEntryOf(L, x);
  const rec = { type, name: fitName(x.name || c?.name || 'Sound'), sprite: spriteName(x.sprite || c?.sprite) };
  if (type === 'samples') {
    const smp = x.smp != null ? S.song.samples[x.smp] : c;
    if (!smp) return null;
    for (const k of SAMPLE_KEYS) if (k !== 'romAddr' && k !== 'drumRow' && smp[k] !== undefined) rec[k] = structuredClone(smp[k]);
    if (x.smp == null && c.pcm) Object.assign(rec, { pcm: c.pcm.slice(), loopAt: c.loopAt ?? -1 });
    else {
      const bank = x.smp != null ? S.pcm : S.catalog.bank; // the song's samples are in its bank, the library's in theirs
      Object.assign(rec, { pcm: bank.slice(smp.off, smp.off + smp.len), loopAt: smp.loop >= 0 ? smp.loop - smp.off : -1 });
    }
    return rec;
  }
  if (x.m != null && S.song.macros[x.m]) {
    rec.mac = structuredClone(S.song.macros[x.m]); delete rec.mac.pitch;
    if (x.i != null && S.song.instruments[x.i]) rec.ins = structuredClone(S.song.instruments[x.i]);
    if (x.p != null) rec.p = x.p;
  } else if (c) {
    rec.mac = structuredClone(c.mac);
    if (c.ins) rec.ins = structuredClone(c.ins);
    if (c.p != null) rec.p = c.p;
  } else return null;
  if (type === 'fm' && !rec.ins) return null;
  if (type === 'drums') { rec.gm = x.gm ?? c?.gm; if (rec.gm == null || !rec.ins) return null; }
  return rec;
}
async function refreshMySounds(d) {
  await loadMySounds();
  if (!d?.L) return;
  d.lib = soundLibrary(d.L);
  d.open.add(MY);
}
function mySoundMenu(d, snd) {
  const L = d.L, c = myEntryOf(L, snd);
  if (!c) {
    const rec = soundRecord(L, snd);
    return [{ label: 'Copy to My sounds', disabled: !rec, click: async () => {
      await putMySound({ ...rec, id: newId() });
      await refreshMySounds(d);
      showStatus(`Copied “${rec.name}” to My sounds`);
    } }, ...(L.kind === 'fm' ? [{ label: 'Edit a copy…', disabled: !rec?.ins, click: () => openFmEditor(d, null, rec) }] : []),
    exportItem(d, rec)];
  }
  return [
    ...(c.ins ? [{ label: 'Edit…', click: () => openFmEditor(d, c, myRec(c)) }] : []),
    { label: 'Rename…', click: () => openDialog({ kind: 'myName', name: c.name, c, parent: d }) },
    { label: 'Change icon…', click: () => openDialog({ kind: 'myIcon', c, parent: d }) },
    { label: 'Duplicate', click: async () => {
      await putMySound({ ...myRec(c), id: newId(), name: fitName(`${c.name} copy`) });
      await refreshMySounds(d);
    } },
    exportItem(d, myRec(c)),
    null,
    { label: 'Delete…', click: async () => {
      if (!await ask(`Delete “${c.name}” from My sounds? Songs that use it keep their copy.`, 'Delete', d)) return;
      await deleteMySound(c.id);
      await refreshMySounds(d);
      showStatus(`Deleted “${c.name}”`);
    } },
  ];
}
// Export… of a sound's right-click menu opens the formats where it was: the sound, its FM patch, the whole palette.
function exportItem(d, rec) {
  const items = [
    { label: '.spsound', click: () => exportSound(rec) },
    ...(rec?.ins ? [
      { label: '.tfi', click: () => downloadBytes(`${rec.name}.tfi`, regsToTfi(rec.ins.regs)) },
      { label: '.dmp', click: () => downloadBytes(`${rec.name}.dmp`, regsToDmp(rec.ins.regs)) },
    ] : []),
    null,
    { label: 'Palette as .spkit', disabled: !d.chosen.size, click: () => exportKit(d) },
  ];
  return { label: 'Export…', disabled: !rec, click: () => { d.ctx = { ...d.ctxAt, items }; } };
}
async function renameMySound(d, c, name) {
  await putMySound({ ...myRec(c), name: fitName(name) });
  for (const M of S.song.layers) for (const x of M.palette || []) if (x.lib === c.key) x.name = fitName(name); // this song's copy too
  await refreshMySounds(d);
}
async function setMySoundIcon(d, c, sprite) {
  await putMySound({ ...myRec(c), sprite });
  const x = d.lib.find((y) => y.lib === c.key && d.chosen.has(y.key));
  if (x) d.icons.set(x.key, sprite); // in this track at once (DONE keeps it)
  await refreshMySounds(d);
}
function drawMyIconDialog(d) {
  const T = ui.T, tone = d.parent?.tone ?? 0;
  const per = 16, rowsN = Math.ceil(SPRITE_POOL.length / per);
  const r = dialogBox(per * 13 + 16, 14 + 6 + rowsN * 13 + 6 + 22, `ICON · ${d.c.name.toUpperCase()}`);
  SPRITE_POOL.forEach((nm, k) => {
    const ix = r.x + 8 + (k % per) * 13, iy = r.y + 6 + Math.floor(k / per) * 13, id = 'myIcon' + nm, on = nm === spriteName(d.c.sprite);
    fill(ix, iy, 13, 13, on ? T.sel : hot(id) ? T.hover : T.face);
    g.drawImage(noteSprite(nm, tone, on ? 1 : 0, 'normal', T), ix, iy);
    region(ix, iy, 13, 13, { id, cursor: 'pointer', tip: nm, click: async () => { closeDialog(); await setMySoundIcon(d.parent, d.c, nm); } });
  });
  const wC = textWidth('CANCEL') + 10;
  button(r.x + r.w - 8 - wC, r.y + r.h - 19, 'CANCEL', { id: 'dlgCancel', click: () => closeDialog() });
}

// ---------- FM patch files (patches.js): import into My sounds, export my FM sounds ----------
// Every file of a pick or a drop goes into one list: each patch with a tick (all on at first), a click on a name
// plays it, IMPORT keeps the ticked ones as FM sounds of My sounds.
const FM_C4 = [3, 1288]; // block / F-number of C4 (MIDI 60): the base of an imported patch's macro, as in the library
async function openPatchFiles(files, parent = null) {
  const items = [], errors = [];
  for (const f of files) {
    try {
      const { patches, bank } = await readPatchFile(f.name, new Uint8Array(await f.arrayBuffer()));
      for (const x of patches) items.push({ ...x, file: f.name, bank, on: true });
    } catch (e) { errors.push(`${f.name}: ${e.message}`); }
  }
  if (!items.length) { await tell(errors.join(' · ') || 'No FM patches found', parent); return; }
  openDialog({ kind: 'patches', items, errors, parent, scroll: 0, cur: -1 });
}
// A bare patch on FM1: `sec` seconds long (the FM editor holds a long one while its key is down), `lfo` a value for
// register 22 to hear the LFO when the song has it off.
async function previewPatch(regs, p = 60, { sec = 0.6, lfo = null, base = FM_C4 } = {}) {
  await ensureAudio();
  const song = S.song, L = song.layers.find((M) => M.kind === 'fm' && !M.kit) || {};
  const n = { s: 0, n: 0, d: RATE * sec, p, e: 1, i: 0, m: 0 };
  const globals = song.globals.filter((x) => x[0] <= 0).map((x) => [0, x[1], x[2], x[3]]);
  if (lfo != null) globals.push([0, 0, 0x22, lfo]);
  const mini = {
    ...song, instruments: [{ regs, ops: 0xf0 }], macros: [{ base, ev: [], pitch: Math.round(hzMidi(fmHz(base[0], base[1]))) }], samples: undefined,
    globals, layers: [{ ...L, kind: 'fm', ch: 0, kit: false, notes: [n] }],
    stepTimes: [0, song.step], step0: 0, end: RATE * (sec + 1), loopStart: -1, repeats: [],
  };
  post({ type: 'preview', tl: buildTimeline(mini, S.pcm) });
}
// A picture for an imported patch: by its name, else the one My sounds uses least.
function patchSprite(name, used) {
  const s = guessSprite(name);
  if (s && SPRITE_POOL.includes(s)) return s;
  return SPRITE_POOL.reduce((a, b) => ((used.get(b) || 0) < (used.get(a) || 0) ? b : a));
}
async function importPatches(d) {
  const keep = d.items.filter((x) => x.on);
  if (!keep.length) return;
  const used = new Map();
  for (const x of S.mySounds?.fm || []) used.set(x.sprite, (used.get(x.sprite) || 0) + 1);
  const now = Date.now();
  for (let k = 0; k < keep.length; k++) {
    const x = keep[k], sprite = patchSprite(x.name, used);
    used.set(sprite, (used.get(sprite) || 0) + 1);
    await putMySound({ id: newId(), created: now + k, type: 'fm', name: fitName(x.name), sprite, ins: { regs: x.regs, ops: 0xf0 }, mac: { base: FM_C4, ev: [] }, p: guessNote(x.name) });
  }
  closeDialog();
  await refreshMySounds(d.parent);
  showStatus(`Imported ${keep.length} FM sound${keep.length > 1 ? 's' : ''} to My sounds`);
}
// ---------- sound files (soundfile.js): .spsound is one sound, .spkit several (a drum kit with its staff rows) ----------
function exportSound(rec) {
  downloadBytes(`${rec.name}.spsound`, writeSound(rec, mixRateOf()));
  showStatus(`Exported “${rec.name}”`);
}
// The ticked sounds of the track dialog, as they are in this song (a sample keeps its staff row, a drum its note).
function exportKit(d) {
  const L = d.L, recs = [];
  for (const x of d.lib.filter((y) => d.chosen.has(y.key))) {
    const rec = soundRecord(L, x);
    if (!rec) continue;
    rec.sprite = spriteName(d.icons.get(x.key) || rec.sprite);
    const c = myEntryOf(L, x);
    if (c) rec.id = c.id;
    const row = x.smp != null ? S.song.samples[x.smp]?.drumRow : null;
    if (row != null) rec.drumRow = row;
    recs.push(rec);
  }
  if (!recs.length) return;
  const name = d.name.trim() || L.name || 'Kit';
  downloadBytes(`${name}.spkit`, writeKit(name, recs, mixRateOf()));
  showStatus(`Exported the kit “${name}”: ${recs.length} sound${recs.length > 1 ? 's' : ''}`);
}
// .spsound / .spkit files -> My sounds. A sound keeps its id while My sounds has no other one with it, so a sound
// exported, deleted and imported is the one the songs knew.
async function importSoundFiles(files, parent = null) {
  const recs = [], skipped = [];
  for (const f of files) {
    try {
      const r = readSoundFile(f.name, await f.text(), mixRateOf());
      recs.push(...r.sounds); skipped.push(...r.skipped);
    } catch (e) { skipped.push(e.message); }
  }
  const ids = new Set(MY_SECS.flatMap((k) => (S.mySounds?.[k] || []).map((x) => x.id)));
  const now = Date.now();
  for (const [k, rec] of recs.entries()) {
    const id = rec.id && !ids.has(rec.id) ? rec.id : newId();
    ids.add(id);
    await putMySound({ ...rec, id, created: now + k });
  }
  await refreshMySounds(parent?.kind === 'track' ? parent : null);
  const kinds = [...new Set(recs.map((x) => x.type))].map((t) => ({ fm: 'FM', drums: 'FM drums', psg: 'PSG', noise: 'noise', samples: 'samples' })[t]);
  if (recs.length) showStatus(`Imported ${recs.length} sound${recs.length > 1 ? 's' : ''} to My sounds (${kinds.join(', ')})`);
  if (skipped.length) await tell(`${recs.length ? 'Some sounds were not imported' : 'Nothing imported'}: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '…' : ''}`, parent);
}
function downloadBytes(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  Object.assign(document.createElement('a'), { href: url, download: name.replace(/[\/:*?"<>|]+/g, '_') }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function drawPatchDialog(d) {
  const T = ui.T, n = d.items.filter((x) => x.on).length;
  const r = dialogBox(300, 250, `IMPORT FM PATCHES · ${d.items.length} FOUND`);
  const lx = r.x + 8, ly = r.y + 6, lw = r.w - 16, lh = r.h - 6 - 26, rowH = 13;
  const rows = [...d.items.map((x, k) => ({ x, k })), ...d.errors.map((e) => ({ err: e }))];
  frame(lx, ly, lw, lh);
  const inner = lh - 2, wheel = (e) => { d.scroll += e.deltaY > 0 ? rowH * 4 : -rowH * 4; };
  d.scroll = Math.max(0, Math.min(Math.max(0, rows.length * rowH - inner), d.scroll || 0));
  region(lx, ly, lw, lh, { wheel });
  g.save(); g.beginPath(); g.rect(lx + 1, ly + 1, lw - 2, inner); g.clip();
  rows.forEach((row, i) => {
    const ry = ly + 1 + i * rowH - d.scroll;
    if (ry + rowH < ly || ry > ly + lh) return;
    const vis = Math.max(ry, ly + 1), visH = Math.min(ry + rowH, ly + 1 + inner) - vis;
    if (row.err) { fill(lx + 1, ry, lw - 2, rowH, T.face); text(fitText(row.err, lw - 12), lx + 5, ry + 4, T.red); return; }
    const { x, k } = row, id = 'pat' + k, tid = 'patOn' + k, cur = d.cur === k;
    fill(lx + 1, ry, lw - 2, rowH, cur ? T.sel : hot(id) ? T.hover : T.face);
    fill(lx + 1, ry + rowH - 1, lw - 2, 1, T.hover);
    // the tick
    frame(lx + 4, ry + 2, 9, 9, cur ? T.selInk : T.ink);
    fill(lx + 5, ry + 3, 7, 7, hot(tid) ? T.hover : T.face);
    if (x.on) fill(lx + 6, ry + 4, 5, 5, T.ink);
    const meta = fitText(x.file + (x.drum ? ' · drum' : ''), 90), mw = textWidth(meta);
    text(fitText(x.name, lw - 30 - mw), lx + 18, ry + 4, cur ? T.selInk : T.ink);
    text(meta, lx + lw - 5 - mw, ry + 4, cur ? T.selInk : T.dim);
    if (visH > 0) {
      region(lx + 16, vis, lw - 17, visH, { id, cursor: 'pointer', wheel, tip: 'Play it', click: () => { d.cur = k; previewPatch(x.regs, guessNote(x.name)); } });
      region(lx + 1, vis, 15, visH, { id: tid, cursor: 'pointer', wheel, tip: x.on ? 'Leave it out' : 'Keep it', click: () => { x.on = !x.on; } });
    }
  });
  g.restore();
  const by = r.y + r.h - 19, ok = n ? `IMPORT ${n}` : 'IMPORT';
  const wOk = textWidth(ok) + 14, wC = textWidth('CANCEL') + 10;
  button(r.x + r.w - 8 - wOk, by, ok, { id: 'dlgOk', primary: !!n, disabled: !n, tip: n ? 'Add them to My sounds' : 'Tick a patch first', click: () => dialogOk(d) });
  button(r.x + r.w - 8 - wOk - 4 - wC, by, 'CANCEL', { id: 'dlgCancel', click: () => closeDialog() });
  let bx = r.x + 8;
  bx += button(bx, by, 'ALL', { id: 'patAll', click: () => { for (const x of d.items) x.on = true; } }) + 3;
  button(bx, by, 'NONE', { id: 'patNone', click: () => { for (const x of d.items) x.on = false; } });
}

// ---------- sample import (sampler.js): an audio file becomes a sample of My sounds, as small as the game's ----------
// The window shows the wave with its start / end (and loop) handles; the sample is made as it is edited: mono, trimmed,
// faded, normalised, filtered and resampled to the mixer's rate, 8 bit. A drum plays on DAC1-3 at its own speed, a melodic
// sample on DAC4 by notes (the Skitchin' pitch table around its base note). BEFORE plays the trimmed sound itself,
// AFTER plays the bytes through the chip, as a song will.
const SAMPLE_EXT = ['wav', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'aif', 'aiff', 'm4a', 'webm'];
const isSampleFile = (name) => SAMPLE_EXT.includes(name.split('.').pop().toLowerCase());
const SMP_MAX_SEC = 60; // longer files are cut here (a sample is seconds long at most)
const BEFORE_GAIN = 0.26; // the source straight to the speakers, as loud as the chip plays it (peak 0.26 at volume 1.6)
const kbOf = (bytes) => (bytes / 1024).toFixed(1);
const mixRateOf = () => S.song.mixRate || 11303.7;
// Bytes of the samples a song plays (the ones its tracks use); DPCM clips count at their packed size.
function songSampleBytes(song = S.song) {
  const used = new Set();
  for (const L of song.layers) if (L.kind === 'sample') for (const x of [...L.notes, ...(L.palette || [])]) if (x.smp != null) used.add(x.smp);
  let n = 0;
  for (const i of used) { const x = song.samples?.[i]; if (x) n += x.dpcm ? Math.ceil(x.len / 2) : x.len; }
  return n;
}
async function openSampleFile(file, parent = null) {
  let src;
  try { src = await decodeAudio(new Uint8Array(await file.arrayBuffer())); } catch (e) { await tell(`Can't read ${file.name} as audio`, parent); return; }
  if (!src.mono.length) { await tell(`${file.name} has no sound in it`, parent); return; }
  const dur = src.mono.length / src.rate;
  if (dur > SMP_MAX_SEC) src.mono = src.mono.slice(0, SMP_MAX_SEC * src.rate);
  const [start, end] = trimSilence(src.mono, src.rate);
  const pitch = guessPitch(src.mono, src.rate, start, end);
  // the type: the track it was imported for, else a short or unpitched sound is a drum
  const voice = parent?.L?.kind === 'sample' ? parent.L.voice ?? MELODIC_VOICE : null;
  const melodic = voice != null ? voice === MELODIC_VOICE : pitch != null && (end - start) / src.rate > 0.3;
  const name = fitName(file.name.replace(/\.[^.]*$/, '') || 'Sample');
  const used = new Map();
  for (const x of S.mySounds?.samples || []) used.set(x.sprite, (used.get(x.sprite) || 0) + 1);
  const d = {
    kind: 'smpImport', parent, file: file.name, src, cut: dur > SMP_MAX_SEC, name, sprite: patchSprite(name, used),
    melodic, base: pitch ?? 60, guess: pitch, o: { start, end, fade: 0.02, loop: -1, compress: false },
    mode: 'after', held: null, oct: 3, drag: null,
  };
  smpType(d, melodic);
  if (S.dlg?.kind === 'smpImport') smpStop(S.dlg); // a file dropped on the window over another one
  openDialog(d);
}
// Drum or melodic: the budget kind follows (a drum by its length), a drum has no loop.
function smpType(d, melodic) {
  d.melodic = melodic;
  const sec = (d.o.end - d.o.start) / d.src.rate;
  d.budget = melodic ? (sec > 1.2 ? 'phrase' : 'melodic') : sec <= 0.35 ? 'drum' : sec <= 0.7 ? 'long' : 'phrase';
  if (!melodic) d.o.loop = -1;
  d.oct = Math.max(0, Math.min(6, Math.floor(d.base / 12) - 2));
  smpRender(d);
}
const smpBudget = (d) => SMP_BUDGETS.find((b) => b.id === d.budget) || budgetsFor(d.melodic)[0];
function smpRender(d) {
  d.res = renderSample(d.src.mono, d.src.rate, mixRateOf(), d.o);
}
// A clamped change of the trim (start / end / loop / fade / compress), made at once.
function smpSet(d, patch) {
  smpStop(d);
  const o = Object.assign(d.o, patch), N = d.src.mono.length, r = d.src.rate;
  const minLen = Math.round(r * 0.01), minLoop = Math.round(r * 0.01);
  o.start = Math.max(0, Math.min(o.start, N - minLen));
  o.end = Math.max(o.start + minLen, Math.min(N, o.end));
  if (o.loop >= 0) o.loop = Math.max(o.start, Math.min(o.loop, o.end - minLoop));
  smpRender(d);
}
// The loop start on the nearest rising zero crossing (within 5 ms), so the jump back does not click.
function snapZero(x, i, lo, hi, reach) {
  for (let k = 0; k < reach; k++) for (const j of [i - k, i + k]) if (j > lo && j < hi && x[j - 1] <= 0 && x[j] > 0) return j;
  return i;
}
// The sample as a song keeps it (without its bytes).
function smpSample(d) {
  const m = d.melodic;
  return { oneShot: !m || d.res.loopAt < 0, baseStep: 256, pitched: m, transp: m ? 60 - d.base : 0, voice: m ? MELODIC_VOICE : 0, ...(m && { steps: SMP_STEPS.slice() }) };
}
// Plays note p (a drum ignores it): AFTER through the chip on its voice (DAC1 / DAC4), BEFORE the source itself.
async function smpPlay(d, p = d.base, sec = 10) {
  await ensureAudio();
  smpStop(d);
  if (S.dlg !== d) return;
  const { pcm, loopAt, before } = d.res, rate = d.src.rate;
  const smp = smpSample(d), looped = loopAt >= 0;
  const k = d.melodic ? Math.pow(2, (p - d.base) / 12) : 1;
  if (d.mode === 'before') {
    const buf = S.ctx.createBuffer(1, before.length, rate);
    buf.copyToChannel(before, 0);
    const node = S.ctx.createBufferSource(), gain = S.ctx.createGain();
    node.buffer = buf; node.playbackRate.value = k;
    if (looped) Object.assign(node, { loop: true, loopStart: (d.o.loop - d.o.start) / rate, loopEnd: before.length / rate });
    gain.gain.value = BEFORE_GAIN * S.volume / 1.6;
    node.connect(gain).connect(S.ctx.destination);
    node.start();
    d.source = node;
    return;
  }
  const mixRate = mixRateOf(), song = S.song, voice = smp.voice;
  const step = sampleStep(smp, p, voice);
  if (!step) return; // outside the pitch table's 4 octaves
  const bank = new Uint8Array(pcm.length + 1); // a 0 after it: the end of the sample
  bank.set(pcm);
  const len = looped ? sec : pcm.length / mixRate / (step / 256);
  const mini = {
    ...song, samples: [{ ...smp, off: 0, len: pcm.length, loop: loopAt }],
    globals: song.globals.filter((x) => x[0] <= 0).map((x) => [0, x[1], x[2], x[3]]),
    layers: [{ id: 'P', kind: 'sample', voice, notes: [{ s: 0, n: 0, d: RATE * len, p, smp: 0 }], palette: [] }],
    stepTimes: [0, song.step], step0: 0, end: Math.round(RATE * (len + 0.3)), loopStart: -1, repeats: [],
  };
  post({ type: 'preview', tl: buildTimeline(mini, bank) });
  d.playing = true;
}
function smpStop(d) {
  if (d.source) { try { d.source.stop(); } catch (e) { /* already ended */ } d.source = null; }
  if (d.playing) { post({ type: 'previewOff' }); d.playing = false; }
}
// The keys: a looped sound plays while its key is held, one without a loop plays to its end (as in a song).
function smpKeyDown(d, p) { d.held = p; smpPlay(d, p); }
function smpKeyUp(d) {
  if (d.held == null) return;
  d.held = null; d.heldCode = null;
  if (d.res.loopAt >= 0) smpStop(d);
}
async function smpSave(d) {
  smpStop(d);
  smpRender(d);
  const b = smpBudget(d), bytes = d.res.pcm.length, name = fitName(d.name.trim() || 'Sample');
  if (bytes > b.kb * 1024 && !await ask(`“${name}” takes ${kbOf(bytes)} KB, over the ${b.label.toLowerCase()} budget of ${b.kb} KB. Keep it anyway?`, 'Keep', d)) return;
  await putMySound({ id: newId(), type: 'samples', name, sprite: d.sprite, budget: b.id, ...smpSample(d), pcm: d.res.pcm, loopAt: d.res.loopAt });
  closeDialog(true);
  await refreshMySounds(d.parent);
  const L = d.parent?.L, hidden = L?.kind === 'sample' && (L.voice ?? MELODIC_VOICE) === MELODIC_VOICE && !d.melodic;
  showStatus(`Added to My sounds: “${name}”${hidden ? ' (a drum: it plays on DAC1-3)' : ''}`);
}
function smpSlider(id, x, y, w, val, lo, hi, set, opts = {}) {
  const T = ui.T, h = 13, f = (val - lo) / (hi - lo);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, hot(id) ? T.hover : T.face);
  const bw = Math.round((w - 2) * f);
  if (bw > 0) fill(x + 1, y + 1, bw, h - 2, T.soft);
  const s = opts.fmt ? opts.fmt(val) : String(val);
  text(s, x + ((w - textWidth(s)) >> 1), y + 4, T.ink);
  const at = (m) => lo + Math.max(0, Math.min(1, (m.x - x - 1) / (w - 3))) * (hi - lo);
  region(x, y, w, h, { id, cursor: 'pointer', tip: opts.tip, down: (m) => set(at(m), false), move: (m) => set(at(m), false), up: (m) => set(at(m), true),
    wheel: (e) => set(Math.max(lo, Math.min(hi, val + (e.deltaY < 0 ? 1 : -1) * (opts.step || (hi - lo) / 20))), true) });
}
// A bar: `n` of `max` filled, red past it.
function budgetBar(x, y, w, n, max, label) {
  const T = ui.T, over = n > max;
  frame(x, y, w, 13);
  fill(x + 1, y + 1, w - 2, 11, T.face);
  const bw = Math.round((w - 2) * Math.min(1, n / max));
  if (bw > 0) fill(x + 1, y + 1, bw, 11, over ? T.red : T.soft);
  text(fitText(label, w - 6), x + 3, y + 4, over ? T.white : T.ink);
}
function drawSampleImport(d) {
  const T = ui.T, o = d.o, rate = d.src.rate, N = d.src.mono.length, mixRate = mixRateOf();
  const r = dialogBox(432, 232, `IMPORT SAMPLE · ${d.file.toUpperCase()}`);
  const L = r.x + 8, W = r.w - 16;
  // the bar: type, name, cancel / import
  let x = L, ty = r.y + 4;
  const type = (m) => () => { if (d.melodic !== m) { smpStop(d); smpType(d, m); } };
  x += button(x, ty, 'DRUM · DAC1-3', { id: 'smpDrum', primary: !d.melodic, tip: 'Own pitch, DAC1-3, own staff row', click: type(false) }) + 2;
  x += button(x, ty, 'MELODIC · DAC4', { id: 'smpMel', primary: d.melodic, tip: 'Played by notes on DAC4', click: type(true) }) + 6;
  const wOk = textWidth('IMPORT') + 14, wC = textWidth('CANCEL') + 10;
  button(L + W - wOk, ty, 'IMPORT', { id: 'smpOk', primary: true, tip: 'Add it to My sounds', click: () => smpSave(d) });
  button(L + W - wOk - 3 - wC, ty, 'CANCEL', { id: 'smpCancel', click: () => closeDialog() });
  text('NAME', x, ty + 4, T.dim);
  const nx = x + textWidth('NAME') + 4, nw = L + W - wOk - 3 - wC - 6 - nx;
  if (nw > 30) field(nx, ty, nw, 'smpName', d.name, { max: 24, onInput: (v) => { d.name = v; }, onEnter: () => blurField(), onEscape: () => {} });

  // the wave: all of the file; the part kept is dark, the fade shaded, the loop start a green line
  const wy = r.y + 21, wh = 62, cols = W - 2;
  if (d.peaksW !== cols) { // drawn as loud as it fits: the sample gets normalised anyway
    d.peaks = wavePeaks(d.src.mono, cols); d.peaksW = cols;
    const p = Math.max(...d.peaks.hi, ...d.peaks.lo.map((v) => -v)) || 1;
    for (const a of [d.peaks.hi, d.peaks.lo]) for (let c = 0; c < cols; c++) a[c] /= p;
  }
  const xOfI = (i) => L + 1 + Math.round(i / N * (cols - 1));
  const iOfX = (px) => Math.round(Math.max(0, Math.min(1, (px - L - 1) / (cols - 1))) * N);
  frame(L, wy, W, wh);
  fill(L + 1, wy + 1, cols, wh - 2, T.paper);
  const mid = wy + (wh >> 1), amp = (wh - 4) / 2;
  const xs = xOfI(o.start), xe = xOfI(o.end);
  for (let c = 0; c < cols; c++) {
    const px = L + 1 + c, a = Math.round(mid - d.peaks.hi[c] * amp), b = Math.round(mid - d.peaks.lo[c] * amp);
    fill(px, a, 1, Math.max(1, b - a + 1), px >= xs && px <= xe ? T.ink : T.off);
  }
  fill(L + 1, mid, cols, 1, T.off);
  if (o.loop < 0 && o.fade > 0) { const fx = xOfI(Math.max(o.start, o.end - o.fade * rate)); dither(fx, wy + 1, xe - fx, wh - 2, T.shade); }
  if (o.start > 0) dither(L + 1, wy + 1, xs - L - 1, wh - 2, T.shade);
  if (xe < L + cols) dither(xe + 1, wy + 1, L + cols - xe, wh - 2, T.shade);
  const handle = (hx, c, flagLeft) => { fill(hx, wy + 1, 1, wh - 2, c); fill(flagLeft ? hx - 3 : hx + 1, wy + 1, 3, 5, c); };
  handle(xs, T.head, false); handle(xe, T.head, true);
  if (o.loop >= 0) { const lx = xOfI(o.loop); handle(lx, T.loop, false); text('LOOP', Math.min(lx + 5, L + W - 22), wy + 2, T.loop); }
  const sec = (i) => (i / rate).toFixed(2);
  region(L, wy, W, wh, {
    id: 'smpWave', cursor: 'pointer',
    tip: `Drag the ends · ${sec(o.end - o.start)} of ${sec(N)} s`,
    down: (m) => {
      const hs = [['start', o.start], ['end', o.end], ...(o.loop >= 0 ? [['loop', o.loop]] : [])];
      d.drag = hs.reduce((a, b) => (Math.abs(xOfI(b[1]) - m.x) < Math.abs(xOfI(a[1]) - m.x) ? b : a))[0];
      smpStop(d);
      o[d.drag] = iOfX(m.x);
    },
    move: (m) => { if (d.drag) o[d.drag] = iOfX(m.x); },
    up: () => {
      if (!d.drag) return;
      if (d.drag === 'loop') o.loop = snapZero(d.src.mono, o.loop, o.start, o.end, Math.round(rate * 0.005));
      if (o.start > o.end) [o.start, o.end] = [o.end, o.start];
      d.drag = null;
      smpSet(d, {});
      smpPlay(d, d.base, 1.5);
    },
  });

  // trim, fade, loop, base note, compressor
  let y = wy + wh + 4;
  x = L;
  x += button(x, y, 'TRIM SILENCE', { id: 'smpTrim', tip: 'Cut silence at both ends', click: () => { const [a, b] = trimSilence(d.src.mono, rate); smpSet(d, { start: a, end: b }); } }) + 2;
  x += button(x, y, 'ALL', { id: 'smpAll', tip: 'Whole file', click: () => smpSet(d, { start: 0, end: N }) }) + 6;
  text('FADE', x, y + 4, o.loop >= 0 ? T.off : T.dim);
  x += textWidth('FADE') + 3;
  smpSlider('smpFade', x, y, 58, o.fade, 0, 0.5, (v, fin) => { o.fade = Math.round(v * 100) / 100; if (fin) smpSet(d, {}); },
    { fmt: (v) => (o.loop >= 0 ? 'LOOPED' : v ? `${Math.round(v * 1000)} MS` : 'OFF'), step: 0.01, tip: 'Fade out at the end' });
  x += 58 + 6;
  x += button(x, y, 'COMPRESS', { id: 'smpComp', primary: o.compress, tip: 'Louder, less punch', click: () => smpSet(d, { compress: !o.compress }) }) + 6;
  if (d.melodic) {
    x += button(x, y, o.loop >= 0 ? 'LOOP ON' : 'LOOP OFF', { id: 'smpLoop', primary: o.loop >= 0, tip: 'Loop while held: green line to end', click: () => {
      if (o.loop >= 0) smpSet(d, { loop: -1 });
      else smpSet(d, { loop: snapZero(d.src.mono, Math.round(o.start + (o.end - o.start) * 0.6), o.start, o.end, Math.round(rate * 0.005)) });
    } }) + 6;
    text('BASE', x, y + 4, T.dim);
    x += textWidth('BASE') + 3;
    const setBase = (p) => { d.base = Math.max(24, Math.min(96, p)); smpStop(d); };
    x += button(x, y, '<', { id: 'smpBaseDn', w: 13, tip: 'Base note down', click: () => setBase(d.base - 1) }) + 1;
    const nl = noteName(d.base), bw2 = 26;
    frame(x, y, bw2, 13); fill(x + 1, y + 1, bw2 - 2, 11, T.lcd);
    text(nl, x + ((bw2 - textWidth(nl)) >> 1), y + 4, T.lcdInk);
    region(x, y, bw2, 13, { id: 'smpBase', tip: `Base note${d.guess != null ? ` · heard ${noteName(d.guess)}` : ''}`,
      wheel: (e) => setBase(d.base + (e.deltaY < 0 ? 1 : -1)) });
    x += bw2 + 1;
    button(x, y, '>', { id: 'smpBaseUp', w: 13, tip: 'Base note up', click: () => setBase(d.base + 1) });
  }

  // what it becomes, before / after
  y += 17;
  x = L;
  text('HEAR', x, y + 4, T.dim);
  x += textWidth('HEAR') + 4;
  const mode = (m) => () => { smpStop(d); d.mode = m; };
  x += button(x, y, 'BEFORE', { id: 'smpBefore', primary: d.mode === 'before', tip: 'The file as it is', click: mode('before') }) + 2;
  x += button(x, y, 'AFTER', { id: 'smpAfter', primary: d.mode === 'after', tip: 'As the song will play it', click: mode('after') }) + 2;
  x += button(x, y, 'PLAY', { id: 'smpPlay', tip: d.melodic ? 'Play the base note' : 'Play it', click: () => smpPlay(d, d.base, 1.5) }) + 2;
  x += button(x, y, 'STOP', { id: 'smpStop', click: () => smpStop(d) }) + 8;
  const info = `${(rate / 1000).toFixed(1)} KHZ ${d.src.channels > 1 ? 'STEREO' : 'MONO'} → ${(mixRate / 1000).toFixed(1)} KHZ MONO 8 BIT`;
  text(fitText(info, L + W - x), x, y + 4, T.dim);

  // the budget: the sample's kind and size, what fits it when it is too big
  y += 17;
  x = L;
  text('BUDGET', x, y + 4, T.dim);
  x += textWidth('BUDGET') + 4;
  for (const b of budgetsFor(d.melodic)) x += button(x, y, `${b.label} ${b.kb}K`, { id: 'smpB' + b.id, primary: smpBudget(d) === b, tip: b.tip, click: () => { d.budget = b.id; } }) + 2;
  x += 4;
  const b = smpBudget(d), max = b.kb * 1024;
  const bytes = d.drag ? bytesFor(Math.abs(o.end - o.start), rate, mixRate) : d.res.pcm.length;
  budgetBar(x, y, L + W - x, bytes, max, `${kbOf(bytes)} OF ${b.kb} KB · ${(bytes / mixRate).toFixed(2)} S`);
  y += 16;
  const fits = d.drag ? [] : fitOptions(o, rate, mixRate, max);
  if (fits.length) {
    x = L;
    text('TOO BIG:', x, y + 4, T.ink);
    x += textWidth('TOO BIG:') + 4;
    for (const f of fits) x += button(x, y, f.label, { id: 'smpFit' + f.id, tip: f.tip, click: () => { smpSet(d, f.set); smpPlay(d, d.base, 1.5); } }) + 2;
  } else text(bytes > max ? 'TOO BIG' : 'FITS THE BUDGET', L, y + 4, bytes > max ? T.ink : T.dim);
  // all the samples of the song with this one
  y += 16;
  const song = songSampleBytes();
  text('SONG', L, y + 4, T.dim);
  budgetBar(L + textWidth('SONG') + 4, y, W - textWidth('SONG') - 4, song + bytes, SONG_BUDGET_KB * 1024,
    `${kbOf(song)} + ${kbOf(bytes)} OF ${SONG_BUDGET_KB} KB`);

  // the keys (a melodic sample) play it by notes
  const ky = r.y + r.h - 30;
  if (d.melodic) drawFmKeys(d, L, ky, W, 26, { down: smpKeyDown, up: smpKeyUp });
}
// The computer keyboard as keys too (Z S X… and Q 2 W…), as in the FM editor.
function smpImportKey(d, e) {
  const k = FM_KEYMAP.indexOf(e.code);
  if (!d.melodic || e.ctrlKey || e.metaKey || e.altKey || k < 0) return false;
  e.preventDefault();
  if (!e.repeat && d.heldCode !== e.code) { smpKeyDown(d, (d.oct + 2) * 12 + k); d.heldCode = e.code; }
  return true;
}

// ---------- FM editor (fmedit.js): an FM sound of My sounds, simple (a type and five knobs) or expert (every register) ----------
// The window edits a copy of the voice; DONE writes it to My sounds and to this song's copy of the sound, CANCEL forgets
// it. A game's sound (or the empty template) becomes a new sound of My sounds on DONE. Its own undo / redo; the keys at
// the bottom (or Z S X D C… / Q 2 W 3 E… on the keyboard) play the sound as it is edited.
const FMMODE_KEY = 'segapaint:fmMode';
const VOICE_REGS = new Set(voiceToRegs(FM_BLANK).map(([r]) => r));
const FM_LFO = 0x0b; // LFO on at about 6 Hz, for trying AMS / FMS / AM when the song has it off
const blankFmRecord = () => ({ type: 'fm', name: 'New sound', sprite: 'star', ins: { regs: voiceToRegs(FM_BLANK), ops: 0xf0 }, mac: { base: FM_C4, ev: [] }, p: 60 });
function openFmEditor(parent, c, rec, autoName = false) {
  let mode = 'simple';
  try { if (localStorage.getItem(FMMODE_KEY) === 'expert') mode = 'expert'; } catch (e) { /* ignore */ }
  const voice = regsToVoice(rec.ins.regs), p = rec.p ?? 60;
  openDialog({
    kind: 'fmEdit', parent, c, rec, voice, start: JSON.stringify(voice), extra: rec.ins.regs.filter(([r]) => !VOICE_REGS.has(r)),
    name: rec.name, sprite: rec.sprite, p, autoName, mode, undo: [], redo: [], held: null, lastP: p, lfo: false,
    oct: Math.max(0, Math.min(6, Math.floor(p / 12) - 2)),
  });
}
const fmRegs = (d) => [...voiceToRegs(d.voice), ...d.extra];
const fmChanged = (d) => JSON.stringify(d.voice) !== d.start || d.name !== d.rec.name;
const fmOpts = (d, sec) => ({ sec, lfo: d.lfo ? FM_LFO : null, base: d.rec.mac?.base || FM_C4 });
function fmBegin(d) {
  d.undo.push(fmClone(d.voice));
  if (d.undo.length > 200) d.undo.shift();
  d.redo.length = 0; d.wheelId = null;
}
let fmTimer = 0;
function fmSet(d, v, audition = false) {
  d.voice = v;
  if (d.held != null) post({ type: 'previewRegs', regs: fmRegs(d) }); // the held note changes at once
  else if (audition) { clearTimeout(fmTimer); fmTimer = setTimeout(() => { if (S.dlg === d && d.held == null) previewPatch(fmRegs(d), d.lastP, fmOpts(d)); }, 150); }
}
const fmEdit = (d, v) => { fmBegin(d); fmSet(d, v, true); };
// The wheel: notches in a row on one control are one undo step.
function fmWheel(d, id, v) {
  if (d.wheelId !== id || performance.now() - d.wheelAt > 700) { fmBegin(d); d.wheelId = id; }
  d.wheelAt = performance.now();
  fmSet(d, v, true);
}
function fmUndo(d) { if (!d.undo.length) return; d.redo.push(d.voice); fmSet(d, d.undo.pop(), true); d.wheelId = null; }
function fmRedo(d) { if (!d.redo.length) return; d.undo.push(d.voice); fmSet(d, d.redo.pop(), true); d.wheelId = null; }
async function fmKeyDown(d, p) {
  d.held = p; d.lastP = p;
  await ensureAudio();
  if (d.held === p) previewPatch(fmRegs(d), p, fmOpts(d, 10));
}
function fmKeyUp(d) {
  if (d.held == null) return;
  d.held = null; d.heldCode = null;
  post({ type: 'previewOff' });
}
function fmPickType(d, t) {
  fmEdit(d, { ...fmClone(t.voice), ams: d.voice.ams, fms: d.voice.fms });
  d.type = t;
  if (d.autoName) { d.name = t.label[0] + t.label.slice(1).toLowerCase(); d.sprite = t.sprite; d.p = t.note; }
  d.lastP = t.note; d.oct = Math.max(0, Math.min(6, Math.floor(t.note / 12) - 2));
}
async function fmSave(d) {
  fmKeyUp(d);
  const regs = fmRegs(d), ins = { ...d.rec.ins, regs }, name = fitName(d.name.trim() || d.rec.name);
  const rec = { ...d.rec, ins, name, sprite: d.sprite, p: d.p, id: d.c?.id || newId() };
  if (d.c) rec.created = d.c.created;
  await putMySound(rec);
  // this song's copy of the sound plays the new patch too (other saved songs keep theirs)
  const key = 'my:' + rec.id, u = S.song.libUse?.[key];
  if (u?.i != null && S.song.instruments[u.i]) S.song.instruments[u.i] = { ...S.song.instruments[u.i], regs };
  for (const M of S.song.layers) for (const x of M.palette || []) if (x.lib === key) x.name = name;
  d.discard = true;
  closeDialog(true);
  rebuildModel(); sendTimeline(); markDirty();
  await refreshMySounds(d.parent);
  showStatus(`${d.c ? 'Saved' : 'Added to My sounds:'} “${name}”`);
}
async function fmCancel(d) {
  if (await ask('Forget the changes to this sound?', 'Forget', d)) { d.discard = true; closeDialog(); }
}

// A value as a little horizontal slider: click or drag along it, or the wheel. Two-value ones (AM) toggle on a click.
// make(k) is the voice with the value k.
function fmSlider(d, id, x, y, w, val, lo, hi, make, opts = {}) {
  const T = ui.T, h = 10, f = (val - lo) / (hi - lo);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, hot(id) ? T.hover : T.face);
  const bw = Math.round((w - 2) * (opts.invert ? 1 - f : f));
  if (bw > 0) fill(x + 1, y + 1, bw, h - 2, T.soft);
  const s = opts.fmt ? opts.fmt(val) : String(val);
  text(s, x + w - 3 - textWidth(s), y + 3, T.ink);
  const at = (m) => {
    const k = Math.max(0, Math.min(1, (m.x - x - 1) / (w - 3)));
    return lo + Math.round((opts.invert ? 1 - k : k) * (hi - lo));
  };
  region(x, y, w, h, {
    id, cursor: 'pointer', tip: opts.tip,
    down: (m) => { fmBegin(d); fmSet(d, make(hi - lo === 1 ? lo + hi - val : at(m))); },
    move: (m) => { if (hi - lo > 1) fmSet(d, make(at(m))); },
    up: () => fmSet(d, d.voice, true),
    wheel: (e) => fmWheel(d, id, make(Math.max(lo, Math.min(hi, val + (e.deltaY < 0 ? 1 : -1) * (opts.invert ? -1 : 1) * (e.shiftKey ? 8 : 1))))),
  });
}
// The algorithm as a picture: numbered operators, the ones heard filled, arrows to the output; a loop on 1 (feedback).
function drawAlg(x, y, alg, ink, bg) {
  const G = ALG_GRAPH[alg], bx = (o) => x + 2 + G.pos[o - 1][0] * 10, by = (o) => y + 3 + G.pos[o - 1][1] * 8;
  const outX = x + 42, outs = [];
  for (const [a, b] of G.links) {
    const ax = bx(a) + 7, ay = by(a) + 3;
    if (b === 0) {
      if (alg === 7) { const yb = y + 12; fill(bx(a) + 3, by(a) + 7, 1, yb - by(a) - 7, ink); fill(bx(a) + 3, yb, outX - bx(a) - 3, 1, ink); outs.push(yb); }
      else { fill(ax, ay, outX - ax, 1, ink); outs.push(ay); }
      continue;
    }
    const mx = bx(b) - 2, ty = by(b) + 3;
    fill(ax, ay, mx - ax + 1, 1, ink);
    fill(mx, Math.min(ay, ty), 1, Math.abs(ty - ay) + 1, ink);
    fill(mx, ty, bx(b) - mx, 1, ink);
  }
  const y0 = Math.min(...outs), y1 = Math.max(...outs), ym = (y0 + y1) >> 1;
  fill(outX, y0, 1, y1 - y0 + 1, ink);
  fill(outX + 1, ym, 3, 1, ink); fill(outX + 2, ym - 1, 1, 3, ink); // the arrow out
  for (let o = 1; o <= 4; o++) {
    const car = isCarrier(alg, SLOT_OF_OP[o - 1]);
    frame(bx(o), by(o), 7, 7, ink);
    fill(bx(o) + 1, by(o) + 1, 5, 5, car ? ink : bg);
    text(String(o), bx(o) + 2, by(o) + 1, car ? bg : ink);
  }
  fill(bx(1) + 1, by(1) - 2, 5, 1, ink); fill(bx(1) + 1, by(1) - 2, 1, 2, ink); fill(bx(1) + 5, by(1) - 2, 1, 2, ink);
}
// An operator's envelope: loudness over about 2 s, the key let go at the dotted line.
function drawEnv(x, y, w, h, o, ink) {
  const T = ui.T, n = w - 3, pts = fmEnvelope(o, 1, 2, n);
  frame(x, y, w, h); fill(x + 1, y + 1, w - 2, h - 2, T.face);
  const rx = x + 1 + Math.round(Math.sqrt(0.5) * n);
  for (let yy = y + 1; yy < y + h - 1; yy += 2) fill(rx, yy, 1, 1, T.off);
  pts.forEach((lv, i) => {
    const top = y + 1 + Math.round(lv * (h - 3));
    if (lv >= 1) return;
    dither(x + 1 + i, top + 1, 1, y + h - 2 - top, ink);
    fill(x + 1 + i, top, 1, 1, ink);
  });
}
function drawKnob(d, k, x, y) {
  const T = ui.T, id = 'fmKnob' + k.id, live = fmKnobLive(k, d.voice);
  const val = d.drag?.k === k ? d.drag.t : k.measure(d.voice);
  const cx = x + 28, cy = y + 20, R = 8, ink = live ? T.ink : T.off;
  text(k.label, cx - (textWidth(k.label) >> 1), y, ink);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const q = dx * dx + dy * dy;
    if (q <= R * R + R) fill(cx + dx, cy + dy, 1, 1, q > (R - 1) * (R - 1) + R - 1 ? ink : hot(id) ? T.hover : T.face);
  }
  const ang = (t) => (135 + t * 270) * Math.PI / 180;
  for (let i = 0; i <= 10; i++) { // the scale around it
    const a = ang(i / 10);
    fill(cx + Math.round(Math.cos(a) * (R + 3)), cy + Math.round(Math.sin(a) * (R + 3)), 1, 1, live && i / 10 <= val + 1e-6 ? T.sel : T.off);
  }
  if (live) for (let rr = 2; rr <= R - 2; rr++) { const a = ang(val); fill(cx + Math.round(Math.cos(a) * rr), cy + Math.round(Math.sin(a) * rr), 1, 1, ink); }
  text(k.lo, x + 2, y + 33, T.dim);
  text(k.hi, x + 55 - textWidth(k.hi), y + 33, T.dim);
  region(x, y, 56, 40, {
    id, cursor: 'pointer', disabled: !live, tip: live ? `${k.tip} · drag up / down or the wheel` : `${k.tip} · this algorithm has no operators for it`,
    down: (m) => { fmBegin(d); d.drag = { k, base: fmClone(d.voice), t0: k.measure(d.voice), t: k.measure(d.voice), mx: m.x, my: m.y }; },
    move: (m) => {
      const g = d.drag; if (!g) return;
      g.t = Math.max(0, Math.min(1, g.t0 + (g.my - m.y + m.x - g.mx) / 70));
      fmSet(d, setKnob(k, g.base, g.t));
    },
    up: () => { d.drag = null; fmSet(d, d.voice, true); },
    wheel: (e) => fmWheel(d, id, nudgeKnob(k, d.voice, e.deltaY < 0 ? 1 : -1)),
  });
}
function drawFmEditor(d) {
  const T = ui.T, tone = d.parent?.tone ?? 0;
  const r = dialogBox(432, 232, `FM EDITOR · ${d.name.toUpperCase()}`);
  const L = r.x + 8, W = r.w - 16;
  // the bar: modes, undo / redo, name, cancel / done
  let x = L, ty = r.y + 4;
  const mode = (m) => () => { d.mode = m; try { localStorage.setItem(FMMODE_KEY, m); } catch (e) { /* ignore */ } };
  x += button(x, ty, 'SIMPLE', { id: 'fmSimple', primary: d.mode === 'simple', tip: 'Type and five knobs', click: mode('simple') }) + 2;
  x += button(x, ty, 'EXPERT', { id: 'fmExpert', primary: d.mode === 'expert', tip: 'Every register', click: mode('expert') }) + 6;
  x += button(x, ty, 'UNDO', { id: 'fmUndo', disabled: !d.undo.length, tip: 'Ctrl+Z', click: () => fmUndo(d) }) + 2;
  x += button(x, ty, 'REDO', { id: 'fmRedo', disabled: !d.redo.length, tip: 'Ctrl+Y', click: () => fmRedo(d) }) + 6;
  const wOk = textWidth('DONE') + 14, wC = textWidth('CANCEL') + 10;
  button(L + W - wOk, ty, 'DONE', { id: 'fmDone', primary: true, tip: d.c ? 'Keep changes' : 'Add to My sounds', click: () => fmSave(d) });
  button(L + W - wOk - 3 - wC, ty, 'CANCEL', { id: 'fmCancel', click: () => closeDialog() });
  const nx = x + textWidth('NAME') + 4, nw = L + W - wOk - 3 - wC - 6 - nx;
  text('NAME', x, ty + 4, T.dim);
  if (nw > 30) field(nx, ty, nw, 'fmName', d.name, { max: 24, onInput: (v) => { d.name = v; d.autoName = false; }, onEnter: () => blurField(), onEscape: () => {} });
  const by = r.y + 22, ky = r.y + r.h - 30;
  if (d.mode === 'simple') drawFmSimple(d, L, by, W, tone); else drawFmExpert(d, L, by, W);
  drawFmKeys(d, L, ky, W, 26);
}
function drawFmSimple(d, L, by, W, tone) {
  const T = ui.T, v = d.voice, cur = d.type; // the type picked here (a voice does not say which type it came from)
  text('TYPE', L, by, T.dim);
  FM_TYPES.forEach((t, k) => {
    const x = L + k * 42, y = by + 8, id = 'fmType' + t.id, on = cur === t;
    frame(x, y, 40, 30);
    fill(x + 1, y + 1, 38, 28, on ? T.sel : hot(id) ? T.hover : T.face);
    g.drawImage(noteSprite(t.sprite, tone, on ? 1 : 0, 'normal', T), x + 14, y + 4);
    text(t.label, x + 20 - (textWidth(t.label) >> 1), y + 21, on ? T.selInk : T.ink);
    region(x, y, 40, 30, { id, cursor: 'pointer', tip: `${t.label[0]}${t.label.slice(1).toLowerCase()} · algorithm ${t.voice.alg}`, click: () => fmPickType(d, t) });
  });
  // what is inside: the algorithm and the loudness of the last operator (always heard)
  const ix = L + 262;
  text('INSIDE', ix, by, T.dim);
  frame(ix, by + 8, 50, 30); fill(ix + 1, by + 9, 48, 28, T.face);
  drawAlg(ix + 2, by + 9, v.alg, T.ink, T.face);
  region(ix, by + 8, 50, 30, { tip: `Algorithm ${v.alg}: filled ones are heard` });
  drawEnv(ix + 54, by + 8, W - 262 - 54, 30, v.ops[3], T.ink);
  region(ix + 54, by + 8, W - 262 - 54, 30, { tip: 'Loudness over 2 s · dots: key up' });
  text('SHAPE', L, by + 48, T.dim);
  FM_KNOBS.forEach((k, i) => drawKnob(d, k, L + i * 62, by + 58));
  const mx = L + 5 * 62 + 6, mw = W - 5 * 62 - 6;
  button(mx, by + 66, 'MUTATE', { id: 'fmMutate', w: mw, tip: 'Small random change · Undo to go back', click: () => fmEdit(d, fmMutate(d.voice)) });
}
function drawFmExpert(d, L, by, W) {
  const T = ui.T, v = d.voice;
  // the algorithms
  for (let a = 0; a < 8; a++) {
    const x = L + (a % 2) * 48, y = by + Math.floor(a / 2) * 28, id = 'fmAlg' + a, on = v.alg === a;
    frame(x, y, 47, 28);
    const bg = on ? T.sel : hot(id) ? T.hover : T.face;
    fill(x + 1, y + 1, 45, 26, bg);
    drawAlg(x + 1, y, a, on ? T.selInk : T.ink, bg);
    region(x, y, 47, 28, { id, cursor: 'pointer', tip: `Algorithm ${a}: filled ones are heard`, click: () => { if (!on) fmEdit(d, { ...fmClone(v), alg: a }); } });
  }
  let y = by + 115;
  for (const p of FM_VOICE_PARAMS) {
    text(p.label, L, y + 3, T.ink);
    fmSlider(d, 'fmV' + p.key, L + 20, y, 75, v[p.key], p.lo, p.hi, (k) => ({ ...fmClone(d.voice), [p.key]: k }), { tip: p.tip });
    y += 11;
  }
  // the song's LFO is off in every example: a switch to hear AMS / FMS / AM here
  const id = 'fmLfo';
  frame(L, y + 1, 9, 9); fill(L + 1, y + 2, 7, 7, hot(id) ? T.hover : T.face);
  if (d.lfo) fill(L + 2, y + 3, 5, 5, T.ink);
  text('TRY LFO', L + 13, y + 3, T.ink);
  region(L, y, 60, 11, { id, cursor: 'pointer', tip: 'Hear AM / AMS / FMS with the LFO on',
    click: () => { d.lfo = !d.lfo; fmSet(d, d.voice, true); } });
  // the operators, as numbered (1, 2, 3, 4)
  for (let op = 1; op <= 4; op++) {
    const s = SLOT_OF_OP[op - 1], o = v.ops[s], x = L + 100 + (op - 1) * 80, car = isCarrier(v.alg, s);
    text(`OP${op}`, x, by + 1, T.ink);
    const tag = car ? 'HEARD' : 'MODULATES';
    text(tag, x + 76 - textWidth(tag), by + 1, car ? T.sel : T.dim);
    drawEnv(x, by + 9, 76, 28, o, car ? T.ink : T.dim);
    region(x, by + 9, 76, 28, { tip: `OP${op} level over 2 s · dots: key up` });
    FM_OP_PARAMS.forEach((p, i) => {
      const yy = by + 40 + i * 11;
      text(p.label, x, yy + 3, T.ink);
      const fmt = p.key === 'mul' ? (k) => (k ? String(k) : '.5') : p.key === 'dt' ? (k) => (k > 0 ? '+' + k : String(k)) : p.key === 'am' ? (k) => (k ? 'ON' : 'OFF') : p.key === 'ssg' ? (k) => (k ? String(k) : 'OFF') : null;
      fmSlider(d, `fmO${op}${p.key}`, x + 16, yy, 60, fmGetParam(p, o), p.lo, p.hi, (k) => {
        const n = fmClone(d.voice); fmSetParam(p, n.ops[s], k); return n;
      }, { tip: `OP${op} ${p.tip}`, invert: p.invert, fmt });
    });
  }
}
// The mini keyboard: three octaves from C of d.oct; hold a key to hear the sound as it is edited.
const FM_KEYMAP = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'];
// `keys`: what a key does (the FM editor's by default; the sample import plays its sample there).
function drawFmKeys(d, x, y, w, h, keys = { down: fmKeyDown, up: fmKeyUp }) {
  const T = ui.T, c0 = (d.oct + 1) * 12;
  const lab = noteName(c0);
  text(lab, x + 13 - (textWidth(lab) >> 1), y + 3, T.ink);
  const oct = (k) => () => { d.oct = Math.max(0, Math.min(6, d.oct + k)); };
  button(x, y + 12, '<', { id: 'fmOctDn', w: 13, disabled: d.oct <= 0, tip: 'An octave down', click: oct(-1) });
  button(x + 14, y + 12, '>', { id: 'fmOctUp', w: 13, disabled: d.oct >= 6, tip: 'An octave up', click: oct(1) });
  const kx = x + 31, n = 21, kw = Math.floor((w - 31) / n), bw = Math.max(3, Math.round(kw * 0.6)), bh = Math.round(h * 0.6);
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  frame(kx, y, kw * n + 1, h);
  for (let i = 0; i < n; i++) {
    const p = c0 + Math.floor(i / 7) * 12 + WHITE[i % 7], xx = kx + i * kw;
    fill(xx + 1, y + 1, kw - 1, h - 2, d.held === p ? T.sel : T.face);
    fill(xx + kw, y, 1, h, T.ink);
    if (i % 7 === 0) text(noteName(p), xx + 2, y + h - 7, d.held === p ? T.selInk : T.dim);
  }
  const blacks = [];
  for (let i = 0; i < n; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) {
    const p = c0 + Math.floor(i / 7) * 12 + WHITE[i % 7] + 1, xx = kx + (i + 1) * kw - (bw >> 1);
    blacks.push({ p, xx });
    fill(xx, y, bw, bh, T.ink);
    if (d.held === p) fill(xx + 1, y + 1, bw - 2, bh - 2, T.sel);
  }
  const keyAt = (m) => {
    if (m.y >= y && m.y < y + bh) { const b = blacks.find((k) => m.x >= k.xx && m.x < k.xx + bw); if (b) return b.p; }
    const i = Math.floor((m.x - kx) / kw);
    return i >= 0 && i < n ? c0 + Math.floor(i / 7) * 12 + WHITE[i % 7] : null;
  };
  region(kx, y, kw * n + 1, h, {
    id: 'fmKeys', cursor: 'pointer', tip: 'Play · or Z S X… Q 2 W… keys',
    down: (m) => { const p = keyAt(m); if (p != null) keys.down(d, p); },
    move: (m) => { const p = keyAt(m); if (p != null && p !== d.held) keys.down(d, p); },
    up: () => keys.up(d),
  });
}

// ---------- the menu (songs, saving, theme) ----------
function menuItems() {
  return [
    { label: 'New song', click: newSong },
    { label: 'Open…', key: 'Ctrl+O', click: showOpenDialog },
    { label: isSaved() ? 'Save' : 'Save…', key: 'Ctrl+S', click: save },
    { label: 'Save a copy…', key: 'Ctrl+Shift+S', disabled: !isSaved(), click: saveCopyDialog },
    { label: 'Revert', disabled: !S.dirty, click: revert },
    null,
    { label: 'Import…', key: 'Ctrl+I', click: () => $('anyFile').click() },
    { label: 'Export…', key: 'Ctrl+E', click: openExport },
  ];
}
function drawMenu(x, y) { popMenu(x, y, menuItems(), () => { S.menu = false; }); }
// A pop-up menu (null items: separators); close() runs on a pick or a click elsewhere.
function popMenu(x, y, items, close) {
  const T = ui.T;
  const w = Math.max(...items.filter(Boolean).map((it) => textWidth(it.label) + (it.key ? textWidth(it.key) + 12 : 0))) + 12, h = items.reduce((a, it) => a + (it ? 11 : 3), 2);
  x = Math.max(0, Math.min(x, ui.W - w - 2)); y = Math.max(0, Math.min(y, ui.H - h - 2));
  region(0, 0, ui.W, ui.H, { block: true, down: close });
  fill(x + 2, y + h, w, 2, T.ink); fill(x + w, y + 2, 2, h, T.ink);
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, T.face);
  let yy = y + 1;
  items.forEach((it, k) => {
    if (!it) { fill(x + 1, yy + 1, w - 2, 1, T.off); yy += 3; return; }
    const id = 'menu' + k, on = hot(id) && !it.disabled;
    if (on) fill(x + 1, yy, w - 2, 11, T.sel);
    const ink = it.disabled ? T.off : on ? T.selInk : T.ink;
    text(it.label, x + 5, yy + 3, ink);
    if (it.key) text(it.key, x + w - 5 - textWidth(it.key), yy + 3, it.disabled ? T.off : on ? T.selInk : T.dim);
    region(x + 1, yy, w - 2, 11, { id, cursor: it.disabled ? 'default' : 'pointer', disabled: it.disabled, click: () => { close(); it.click(); } });
    yy += 11;
  });
}

// ---------- the screen ----------
const MARGIN = 2, LPW = 128, TB_H = BIG.h + 2;
let lastPosStep = 0;

function draw() {
  const T = ui.T, W = ui.W, H = ui.H;
  beginFrame();
  fill(0, 0, W, H, T.bg);
  if (!S.song) { endFrame(); requestAnimationFrame(draw); return; }

  const row2 = MARGIN + TB_H + 2;
  const trY = H - MARGIN - TB_H;
  const showLayers = W >= 420 && !S.fold.side;
  const lpw = showLayers ? LPW : 0;
  const sx = MARGIN + lpw + (showLayers ? 2 : 0), sw = W - MARGIN - sx;
  const ovH = 12;
  const st = { x: sx, y: row2 + 14 + 2, w: sw, h: trY - 2 - ovH - 2 - (row2 + 16) };

  // the staff first, so everything drawn later is on top of it
  frame(st.x, st.y, st.w, st.h);
  SX = st.x + 1; SY = st.y + 1;
  if (SW !== st.w - 2 || SH !== st.h - 2 || S._lanes !== S.lanes.length) { SW = st.w - 2; SH = st.h - 2; S._lanes = S.lanes.length; staffGeom(); }
  g.save(); g.translate(SX, SY); g.beginPath(); g.rect(0, 0, SW, SH); g.clip();
  lastPosStep = drawStaff();
  g.restore();
  region(SX, SY, SW, SH, {
    id: 'staff', cursor: 'none',
    down: (m, e) => staffDown(m.x - SX, m.y - SY, e),
    move: (m, e) => staffMove(m.x - SX, m.y - SY, e),
    hoverMove: (m, e) => staffHover(m.x - SX, m.y - SY, e),
    up: () => staffUp(),
    wheel: (e, m) => staffWheel(e, m.x - SX),
  });

  drawScaleButton();
  drawSonic(lastPosStep);
  drawOverview(sx, st.y + st.h + 2, sw, ovH, lastPosStep);
  if (showLayers) { // the left column: LAYERS, the song's Description (songs from the games), the Playlist in the rest
    const colH = trY - 2 - row2, info = songInfo();
    const aboutH = info ? (S.fold.about ? PANEL_HEAD : ABOUT_H) + 2 : 0;
    const plMin = S.refs.length ? (S.fold.playlist ? PANEL_HEAD : PL_MIN) + 2 : 0;
    const lh = drawLayers(MARGIN, row2, lpw, colH - aboutH - plMin);
    if (info) drawAbout(MARGIN, row2 + lh + 2, lpw, info);
    if (plMin) drawPlaylist(MARGIN, row2 + lh + 2 + aboutH, lpw, colH - lh - 2 - aboutH);
  }
  drawPalette(sx, row2, sw);
  drawToolbar(MARGIN);
  drawTransport(trY);

  if (S.flyout) drawFlyout();
  if (S.menu) drawMenu(S.menuX, MARGIN + TB_H - 1);
  if (S.scaleMenu) drawScaleMenu();
  if (S.dlg) { drawDialog(); drawDialogTip(); }
  endFrame();
  if (ui.hover?.id !== 'staff' && !S.drag) S.hover = null;
  if (ui.hover?.id === 'staff' && !S.dlg) drawCursor();
  else drawPointer();
  requestAnimationFrame(draw);
}

function drawToolbar(y) {
  const T = ui.T;
  let x = MARGIN;
  x += strip(x, y, [{ id: 'side', icon: 'panels', on: !S.fold.side, tip: S.fold.side ? 'Show the panels' : 'Hide the panels', click: () => togglePanel('side') }]) + 2;
  S.menuX = x;
  x += strip(x, y, [{ id: 'menu', icon: 'menu', on: S.menu, tip: 'File', click: () => { S.menu = !S.menu; S.flyout = false; } }]) + 2;
  x += strip(x, y, [
    { id: 'undo', icon: 'undo', disabled: !S.undo.length, tip: 'Undo · Ctrl+Z', click: undo },
    { id: 'redo', icon: 'redo', disabled: !S.redo.length, tip: 'Redo · Ctrl+Y', click: redo },
  ]) + 2;
  x += strip(x, y, TOOLS.map((t) => ({
    id: 'tool-' + t.tool, icon: S.drag?.mode === 'pan' && t.tool === 'hand' ? 'fist' : t.icon, on: S.tool === t.tool, disabled: toolDisabled(t.tool), tip: t.tip,
    click: () => { S.flyout = false; setTool(t.tool); },
  })));
  // ⋯ stays ⋯; it is lit while one of its tools is in use
  const more = MORE_TOOLS.find((t) => t.tool === S.tool);
  S.moreX = x + 1;
  x += strip(x + 1, y, [{ id: 'tool-more', icon: 'more', on: !!more || S.flyout, tip: 'More tools', click: () => { S.flyout = !S.flyout; S.menu = false; } }]) + 3;
  x += strip(x, y, [{ id: 'gear', icon: 'gear', on: S.dlg?.kind === 'settings', tip: 'Settings', click: () => openDialog({ kind: 'settings' }) }]) + 2;
  x += strip(x, y, [
    { id: 'zoomout', icon: 'zoomout', disabled: S.colW === ZOOMS[0], tip: 'Zoom out · −', click: () => zoom(-1) },
    { id: 'zoomin', icon: 'zoomin', disabled: S.colW === ZOOMS[ZOOMS.length - 1], tip: 'Zoom in · +', click: () => zoom(1) },
    { id: 'follow', icon: S.follow ? 'eye' : 'eyeShut', tip: S.follow ? 'Following the playhead · F' : 'Not following the playhead · F', click: () => setFollow(!S.follow) },
  ]) + 2;
  // the song title in the space left
  const tw = ui.W - MARGIN - x - 6;
  if (tw > 30) {
    const locked = S.doc.kind === 'ref';
    let tx = x + 4;
    if (locked) {
      g.drawImage(smallIcon('lock', T.ink), tx - 2, y + 1);
      region(tx, y + 2, 9, 9, { tip: 'From the game · Save makes a copy' });
      tx += 11;
    }
    text(fitText(docTitle(), x + 4 + tw - tx), tx, y + 4, T.ink);
    // second row: the game it comes from, and UNSAVED while there are changes not saved
    let sx = x + 4;
    const no = locked ? trackNo(S.refs.find((r) => r.dir === S.doc.dir)) : '';
    const game = [S.song.game, no && 'Track ' + no].filter(Boolean).join(' · ');
    if (locked && game) sx += text(fitText(game, tw), sx, y + 12, T.dim) + (S.dirty ? 4 : 0);
    if (S.dirty) {
      if (sx > x + 4) sx += text('·', sx, y + 12, T.dim) + 4;
      text(fitText('UNSAVED', x + 4 + tw - sx), sx, y + 12, T.head);
    }
  }
}

function drawLcd(x, y, w) {
  const T = ui.T, h = TB_H;
  frame(x, y, w, h, T.ink);
  fill(x + 1, y + 1, w - 2, h - 2, T.lcd);
  const rel = Math.floor(lastPosStep) - S.barOffset;
  const bar = Math.floor(rel / 16) + 1, beat = Math.floor((((rel % 16) + 16) % 16) / 4) + 1;
  const sec = Math.floor(displayPos() / RATE);
  const cols = [['BAR', `${bar}.${beat}`, 4], ['TIME', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 28]];
  for (const [l, v, dx] of cols) { text(l, x + dx, y + 4, T.lcdDim); text(v, x + dx, y + 12, T.lcdInk); }
  text('BPM', x + 52, y + 4, T.lcdDim);
  text(String(Math.round(S.song.bpm)), x + 52, y + 12, hot('bpm') ? T.white : T.lcdInk);
  region(x + 50, y + 2, 20, h - 4, { id: 'bpm', cursor: 'pointer', tip: 'Tempo · click to change',
    click: () => openBpmDialog(),
    wheel: (e) => setBpm(S.song.bpm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)) });
  drawScope(x + 72, y + 3, w - 76, h - 6);
}

const scopeBuf = { a: null };
function drawScope(x, y, w, h) {
  const T = ui.T;
  for (let i = 0; i < w; i += 2) fill(x + i, y + (h >> 1), 1, 1, T.lcdDim);
  if (!S.analyser) return;
  if (!scopeBuf.a) scopeBuf.a = new Float32Array(S.analyser.fftSize);
  S.analyser.getFloatTimeDomainData(scopeBuf.a);
  const step = Math.floor(scopeBuf.a.length / w), mid = h >> 1;
  let prev = null;
  for (let i = 0; i < w; i++) {
    const v = Math.max(-1, Math.min(1, scopeBuf.a[i * step] * 1.4));
    const yy = Math.round(mid - v * (mid - 1));
    const a = prev == null ? yy : prev;
    fill(x + i, y + Math.min(a, yy), 1, Math.abs(a - yy) + 1, T.lcdInk);
    prev = yy;
  }
}

// The rare tools, dropping down from the ⋯ button.
function drawFlyout() {
  const y = MARGIN + TB_H - 1;
  region(0, 0, ui.W, ui.H, { block: true, down: () => { S.flyout = false; } });
  MORE_TOOLS.forEach((t, k) => {
    strip(S.moreX, y + k * (BIG.h + 1), [{ id: 'fly-' + t.tool, icon: t.icon, on: S.tool === t.tool, disabled: toolDisabled(t.tool), tip: t.tip, click: () => { setTool(t.tool); S.flyout = false; } }]);
  });
}

// ---------- the left column's panels: a title bar with − (fold to the bar) / + (unfold), like Photoshop's ----------
const PANEL_HEAD = 14, ABOUT_H = 116, PIC_W = 124, PIC_H = 86;
function togglePanel(key) {
  S.fold[key] = !S.fold[key];
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(S.fold)); } catch (e) { /* ignore */ }
}
// Draws the panel's frame and title bar; returns true when it is folded (then only the bar is drawn).
function panelHead(x, y, w, h, title, key) {
  const T = ui.T, open = !S.fold[key];
  frame(x, y, w, open ? h : PANEL_HEAD);
  fill(x + 1, y + 1, w - 2, (open ? h : PANEL_HEAD) - 2, T.face);
  text(title, x + 4, y + 5, T.ink);
  region(x + 1, y + 1, w - 15, PANEL_HEAD - 2, { id: 'bar-' + key, tip: open ? `${title} · click to fold` : `${title} · click to unfold`, click: () => togglePanel(key) });
  strip(x + w - 14, y, [{ id: 'fold-' + key, icon: open ? 'minus' : 'plus', tip: open ? 'Fold' : 'Unfold', click: () => togglePanel(key) }], SMALL);
  if (open) fill(x, y + PANEL_HEAD - 1, w, 1, T.ink);
  return !open;
}

// LAYERS: as tall as its tracks (scrolling past maxH), with + / trash / gear under them. Returns its height.
function drawLayers(x, y, w, maxH) {
  const T = ui.T, song = S.song, rowH = 13, n = song.layers.length;
  const add = () => openDialog({ kind: 'add', scroll: 0 });
  if (!n) {
    if (panelHead(x, y, w, PANEL_HEAD + 34, 'LAYERS', 'layers')) return PANEL_HEAD;
    const label = '+ ADD TRACK';
    button(x + ((w - textWidth(label) - 10) >> 1), y + PANEL_HEAD + 10, label, { id: 'addTrackBig', primary: true, click: add });
    return PANEL_HEAD + 34;
  }
  const rows = Math.max(1, Math.min(n, Math.floor((maxH - 2 * PANEL_HEAD + 1) / rowH)));
  const areaH = rows * rowH, h = PANEL_HEAD + areaH - 1 + PANEL_HEAD;
  if (panelHead(x, y, w, h, 'LAYERS', 'layers')) return PANEL_HEAD;
  const top = y + PANEL_HEAD;
  S.layerScroll = Math.max(0, Math.min(n * rowH - areaH, S.layerScroll));
  region(x, top, w, areaH, { wheel: (e) => { S.layerScroll += e.deltaY > 0 ? rowH : -rowH; } });
  g.save(); g.beginPath(); g.rect(x, top, w, areaH); g.clip();
  const pos = writtenTime(displayPos());
  song.layers.forEach((L, i) => {
    const ry = top + i * rowH - S.layerScroll;
    if (ry + rowH < top || ry > top + areaH) return;
    drawLayerRow(L, i, x, ry, w, pos, top, areaH);
  });
  g.restore();
  // the tool strip under the tracks: they act on the chosen track (one track: several chosen ones are not deleted at once)
  const by = y + h - PANEL_HEAD, L = activeLayer(), one = !!L && !multiLayer();
  fill(x, by, w, 1, T.ink);
  text(n === 1 ? '1 TRACK' : `${n} TRACKS`, x + 4, by + 5, T.dim);
  const cells = [
    { id: 'addTrack', icon: 'plus', tip: 'Add a track', click: add },
    { id: 'delTrack', icon: 'trash', disabled: !one || n <= 1, tip: one ? `Delete “${L.name}”` : 'Delete the track · choose one track', click: () => deleteTrack(L) },
    { id: 'editTrack', icon: 'gear', disabled: !one, tip: one ? `Track settings · ${L.name}` : 'Track settings · choose one track', click: () => showTrackDialog(L) },
  ];
  strip(x + w - stripW(cells.length, SMALL), by, cells, SMALL);
  return h;
}

// ---------- Description: pictures and pages about a song from the games (meta.json "info", tools/song_info.py) ----------
const songInfo = () => (S.doc?.kind === 'ref' && S.song.info?.pages?.length ? S.song.info : null);
const infoPics = new Map();
function infoPicture(url) {
  let im = infoPics.get(url);
  if (!im) { im = new Image(); im.src = url; infoPics.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}
// Does a text page fit the picture box? Same layout as drawAbout: title 10 px, lines 7 px, 3 px between paragraphs.
function aboutFits(title, t) {
  let ty = 3 + (title ? 10 : 0), last = 0;
  for (const para of String(t || '').split('\n')) {
    for (const _ of wrapText(para, PIC_W - 4)) { last = ty; ty += 7; }
    ty += 3;
  }
  return last + 5 <= PIC_H;
}
// The pages as shown: a text too long for one box goes on over the next ones under the same title,
// broken between sentences (between words only for a sentence longer than a box).
const aboutLaid = new WeakMap();
function aboutPages(info) {
  let out = aboutLaid.get(info);
  if (out) return out;
  out = [];
  for (const p of info.pages) {
    if (p.picture || aboutFits(p.title, p.text)) { out.push(p); continue; }
    let cur = '';
    const add = (u, sep) => {
      const cand = cur ? cur + sep + u : u;
      if (aboutFits(p.title, cand)) cur = cand;
      else if (cur) { out.push({ ...p, text: cur }); cur = ''; add(u, sep); }
      else if (/\s/.test(u)) for (const word of u.split(/ +/)) add(word, ' ');
      else cur = u;
    };
    for (const s of String(p.text).split(/(?<=[.!?]['"’”)]?) +/)) add(s, ' ');
    if (cur) out.push({ ...p, text: cur });
  }
  aboutLaid.set(info, out);
  return out;
}
function drawAbout(x, y, w, info) {
  const T = ui.T, pages = aboutPages(info), n = pages.length;
  if (panelHead(x, y, w, ABOUT_H, 'DESCRIPTION', 'about')) return;
  const k = S.aboutPage = Math.max(0, Math.min(n - 1, S.aboutPage || 0)), p = pages[k];
  const turn = (d) => { S.aboutPage = (S.aboutPage + d + n) % n; };
  const px = x + ((w - PIC_W) >> 1), py = y + PANEL_HEAD + 1;
  if (p.picture) {
    const im = infoPicture(info.base + p.picture);
    if (im) g.drawImage(im, px, py, PIC_W, PIC_H); else dither(px, py, PIC_W, PIC_H, T.dim);
  } else {
    let ty = py + 3;
    if (p.title) { text(fitText(p.title, PIC_W - 4), px + 2, ty, T.head); ty += 10; }
    for (const para of String(p.text || '').split('\n')) {
      for (const line of wrapText(para, PIC_W - 4)) { if (ty + 5 <= py + PIC_H) text(line, px + 2, ty, T.ink); ty += 7; }
      ty += 3;
    }
  }
  region(px, py, PIC_W, PIC_H, { id: 'aboutPage', cursor: 'pointer', tip: 'Next page', click: () => turn(1), wheel: (e) => turn(e.deltaY > 0 ? 1 : -1) });
  // ◀ 2/5 · caption ▶
  const ny = y + ABOUT_H - PANEL_HEAD;
  fill(x, ny, w, 1, T.ink);
  strip(x, ny, [{ id: 'aboutPrev', icon: 'left', tip: 'Previous page', click: () => turn(-1) }], SMALL);
  strip(x + w - 14, ny, [{ id: 'aboutNext', icon: 'right', tip: 'Next page', click: () => turn(1) }], SMALL);
  const num = `${k + 1}/${n}`, cap = p.caption || p.title || '';
  const label = cap ? `${num} · ${fitText(cap, w - 36 - textWidth(num) - 8)}` : num;
  text(label, x + ((w - textWidth(label)) >> 1), ny + 5, T.dim);
}

// ---------- Playlist: the songs from the games, folded by game; a click plays one ----------
const PL_MIN = PANEL_HEAD + 4 * 13 + 1;
async function playRef(dir) {
  if (S.doc.kind !== 'ref' || S.doc.dir !== dir) {
    if (!await confirmDiscard()) return;
    try { await openDoc({ kind: 'ref', dir }); } catch (e) { console.error(e); tell(`Could not open the song: ${e.message}`); return; }
  }
  if (!S.playing) togglePlay();
}
function drawPlaylist(x, y, w, h) {
  const d = S.pl, cur = S.doc.kind === 'ref' ? S.doc.dir : null;
  const curGame = cur && (S.refs.find((r) => r.dir === cur)?.game || '');
  d.games ??= new Set(cur ? [curGame] : []);
  // another song opened (the next one, Open, ◀ ▶): its game unfolds and its row comes into view
  const opened = d.shown !== cur;
  if (opened) { d.shown = cur; if (cur) d.games.add(curGame); }
  if (panelHead(x, y, w, h, 'PLAYLIST', 'playlist')) return;
  const rows = [];
  for (const game of new Set(S.refs.map((ref) => ref.game || ''))) {
    const songs = S.refs.filter((ref) => (ref.game || '') === game), open = d.games.has(game);
    rows.push({ fold: open ? 'open' : 'shut', label: game || 'Other', meta: String(songs.length), tip: open ? 'Fold' : 'Show the songs',
      click: () => { if (open) d.games.delete(game); else d.games.add(game); } });
    if (open) for (const ref of songs) rows.push({ inGroup: true, num: trackNo(ref), label: ref.title, sel: ref.dir === cur, tip: ref.dir === cur && S.playing ? 'Playing' : 'Play', click: () => playRef(ref.dir) });
  }
  if (opened && cur) {
    const k = rows.findIndex((r) => r.sel), inner = h - PANEL_HEAD - 1;
    if (k >= 0 && (k * 13 < d.scroll || (k + 1) * 13 > d.scroll + inner)) d.scroll = k * 13 - ((inner - 13) >> 1);
  }
  listRows(x, y + PANEL_HEAD - 1, w, h - PANEL_HEAD + 1, rows, d, 13, 'pl');
}

function layerSounding(L, i, pos) {
  if (!S.playing || layerOff(i)) return false;
  const ns = L.notes;
  let lo = 0, hi = ns.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m]._t <= pos) lo = m + 1; else hi = m; }
  for (let k = lo - 1; k >= Math.max(0, lo - 3); k--) if (pos < ns[k]._t + Math.min(ns[k]._d, RATE * 0.25)) return true;
  return false;
}

// One layer row: number | picture | name + voice | eye | M | S, cells sharing 1 px lines.
function drawLayerRow(L, i, x, y, w, pos, clipTop, clipH) {
  const T = ui.T;
  const active = layerChosen(i), hidden = S.hidden.has(i);
  const cy = y + 0, ch = 12;
  const nameX = x + 27, nameW = w - 67;
  const cells = [x + w - 39, x + w - 26, x + w - 13]; // the last one ends at the panel's frame
  // number on the layer colour
  fill(x + 1, cy, 12, ch, toneInk(L, false));
  const num = String((i + 1) % 10);
  text(num, x + 1 + ((12 - textWidth(num)) >> 1), cy + 4, md(0, 0, 0));
  fill(x + 13, cy, 1, ch, T.ink);
  const playing = layerSounding(L, i, pos);
  const rowId = 'layer' + i;
  fill(x + 14, cy, 12, ch, active ? T.sel : hot(rowId) ? T.hover : T.face);
  g.drawImage(noteSprite(L.sel?.sprite || 'star', L.tone, playing ? 1 : 0, hidden ? 'ghost' : 'normal', T), x + 14, cy);
  fill(x + 26, cy, 1, ch, T.ink);
  fill(nameX, cy, nameW, ch, active ? T.sel : hot(rowId) ? T.hover : T.face);
  const ink = active ? T.selInk : hidden ? T.dim : T.ink;
  const chip = chipName(L);
  const cw = textWidth(chip);
  text(fitText(L.name, nameW - cw - 8), nameX + 3, cy + 4, ink);
  text(chip, nameX + nameW - 3 - cw, cy + 4, active ? T.selInk : T.dim);
  const vis = Math.max(y, clipTop), visH = Math.min(y + 13, clipTop + clipH) - vis;
  if (visH > 0) region(x + 1, vis, nameX + nameW - x - 1, visH, { id: rowId, cursor: 'pointer', tip: `${L.name} · double-click: edit`, click: (m, e) => selectLayer(i, e), dbl: () => showTrackDialog(L), wheel: (e) => { S.layerScroll += e.deltaY > 0 ? 13 : -13; } });
  const btns = [
    { id: 'eye' + i, on: false, ink: T.ink, icon: hidden ? 'eyeShut' : 'eye', tip: hidden ? 'Hidden on the staff · H' : 'Shown on the staff · H', click: () => toggleSet(S.hidden, i) },
    { id: 'mute' + i, on: S.muted.has(i), icon: 'mute', face: T.red, ink: T.white, tip: 'Mute · M', click: () => { toggleSet(S.muted, i); sendMute(); } },
    { id: 'solo' + i, on: S.solo.has(i), icon: 'solo', face: T.green, ink: md(0, 0, 0), tip: 'Solo · S', click: () => { toggleSet(S.solo, i); sendMute(); } },
  ];
  btns.forEach((b, k) => {
    const bx = cells[k];
    fill(bx - 1, cy, 1, ch, T.ink);
    fill(bx, cy, 12, ch, b.on ? b.face : hot(b.id) ? T.hover : T.face);
    g.drawImage(smallIcon(b.icon, b.on ? b.ink : hidden && b.id.startsWith('eye') ? T.dim : T.ink), bx, cy); // art/small
    if (visH > 0) region(bx, vis, 12, visH, { id: b.id, cursor: 'pointer', tip: b.tip, click: b.click, wheel: (e) => { S.layerScroll += e.deltaY > 0 ? 13 : -13; } });
  });
  fill(x, cy + ch, w, 1, T.ink);
}

// The sounds of the active layer, as cells with their note pictures.
// Small pictures of the repeat tool's modes (palette cells and the cursor badge).
function drawRepMode(mode, x, y, ink) {
  const T = ui.T;
  if (mode === 'loop') { // a green |:
    const c = ink === T.selInk ? ink : T.loop;
    fill(x + 3, y + 2, 2, 8, c); fill(x + 6, y + 2, 1, 8, c); fill(x + 8, y + 4, 1, 1, c); fill(x + 8, y + 7, 1, 1, c);
  } else if (mode === 'del') { // a cross
    for (let i = 0; i < 6; i++) { fill(x + 3 + i, y + 3 + i, 1, 1, ink); fill(x + 8 - i, y + 3 + i, 1, 1, ink); }
  } else text(mode, x + ((12 - textWidth(mode)) >> 1) + 1, y + 4, ink);
}
function drawPalette(x, y, w) {
  const T = ui.T, L = activeLayer();
  if (S.tool === 'repeat') {
    const cells = REP_MODES.map((m) => ({
      id: 'rep-' + m.mode, on: S.repMode === m.mode, tip: m.tip,
      draw: (cx, cy, cw, ch, ink) => drawRepMode(m.mode, cx, cy, ink),
      click: () => { S.repMode = m.mode; },
    }));
    const sw = strip(x, y, cells, SMALL);
    const label = { loop: 'Loop · click where the song repeats from (bar 1: from the start)', del: 'Remove · click a repeat or the loop' }[S.repMode]
      || `Repeat ${S.repMode} · click a bar or drag over bars · drag |: :| to resize`;
    text(fitText(label, w - sw - 8), x + sw + 5, y + 5, T.ink);
    return;
  }
  if (!L) { frame(x, y, w, 14); fill(x + 1, y + 1, w - 2, 12, T.face); text('No tracks', x + 5, y + 5, T.dim); return; }
  const max = Math.max(1, Math.floor((w - 60) / 13));
  const cells = L.sounds.slice(0, max).map((snd, k) => ({
    id: 'snd-' + k, on: L.sel === snd, tip: snd.name,
    draw: (cx, cy) => g.drawImage(noteSprite(snd.sprite, L.tone, 0, 'normal', T), cx, cy),
    click: () => { L.sel = snd; L.pick = null; if (S.tool !== 'fill') setTool(S.tool === 'pick' || S.tool === 'erase' || S.tool === 'select' || S.tool === 'hand' ? 'pen' : S.tool); previewNote(L, newNote(L, null)); },
  }));
  const sw = strip(x, y, cells, SMALL);
  const label = `${L.sel.name} · ${L.name} · ${chipName(L)}`;
  text(fitText(label, w - sw - 8), x + sw + 5, y + 5, T.ink);
}

function drawTransport(y) {
  const T = ui.T, ri = refIndex(); // a song from the games has the songs before and after it
  let x = MARGIN;
  x += strip(x, y, [
    { id: 'start', icon: 'start', tip: ri >= 0 ? 'Back to the start, at the start: the song before · Home' : 'Back to the start · Home', click: backToStart },
    { id: 'play', icon: S.playing ? 'pause' : 'play', on: S.playing, tip: 'Play / pause · Space', click: togglePlay },
    ...(ri >= 0 ? [{ id: 'next', icon: 'next', disabled: ri >= S.refs.length - 1, tip: 'Next song', click: () => switchRef(ri + 1) }] : []),
    { id: 'loop', icon: 'loop', on: S.loop, tip: 'Loop · L', click: () => setLoop(!S.loop) },
  ]) + 2;
  x += strip(x, y, [
    { id: 'barMinus', icon: 'minus', disabled: songBars() <= 1, tip: 'Remove the last bar', click: () => setBars(songBars() - 1) },
    { id: 'bars', tip: 'Bars in the song', draw: (cx, cy, cw) => {
      text('BARS', cx + ((cw - textWidth('BARS')) >> 1), cy + 3, T.dim);
      const n = String(songBars());
      text(n, cx + ((cw - textWidth(n)) >> 1), cy + 11, T.ink);
    } },
    { id: 'barPlus', icon: 'plus', disabled: songBars() >= 256, tip: 'Add a bar at the end', click: () => setBars(songBars() + 1) },
  ]) + 6;
  // volume on the right
  const lcdW = 112, lx = ui.W - MARGIN - lcdW;
  drawLcd(lx, y, lcdW);
  const vw = 40, vx = lx - 6 - vw - 14;
  g.drawImage(smallIcon('vol', T.ink), vx, y + 4);
  const tx = vx + 14, ty = y + 10;
  fill(tx, ty, vw, 1, T.ink);
  for (let i = 0; i <= 4; i++) fill(tx + Math.round(i * (vw - 1) / 4), ty + 2, 1, 2, T.dim);
  const kx = tx + Math.round(S.volume / 3 * (vw - 1));
  frame(kx - 2, ty - 4, 5, 9, T.ink); fill(kx - 1, ty - 3, 3, 7, hot('vol') || ui.capture?.id === 'vol' ? T.sel : T.face);
  const setFrom = (m) => setVolume((m.x - tx) / (vw - 1) * 3);
  region(tx - 3, y + 2, vw + 6, TB_H - 4, { id: 'vol', cursor: 'pointer', tip: `Volume ${Math.round(S.volume / 3 * 100)}`, down: setFrom, move: setFrom, wheel: (e) => setVolume(S.volume + (e.deltaY < 0 ? 0.1 : -0.1)) });
  // status line: the button under the mouse, or what the staff says
  const tip = S.dlg ? null : ui.hover?.tip; // a dialog shows its tips itself
  let msg = tip || S.status, key = '';
  const hint = tip ? '' : S.hint;
  if (tip) { const k = tip.lastIndexOf(' · '); if (k > 0 && tip.length - k < 18) { msg = tip.slice(0, k); key = tip.slice(k + 3); } }
  const room = vx - 6 - x, sy = hint ? y + 3 : y + 8; // one row in the middle, or two
  if (key) {
    const kw = textWidth(key) + 6;
    msg = fitText(msg, room - kw - 6);
    const mw = text(msg, x, sy, T.ink);
    frame(x + mw + 5, sy - 3, kw, 11, T.ink); fill(x + mw + 6, sy - 2, kw - 2, 9, T.face);
    text(key, x + mw + 8, sy, T.ink);
  } else text(fitText(msg, room), x, sy, T.ink);
  if (hint) text(fitText(hint, room), x, y + 12, T.dim);
}

function drawOverview(x, y, w, h, posStep) {
  const T = ui.T;
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, T.face);
  const iw = w - 2, ih = h - 2, total = S.totalSteps, sx = iw / total;
  const layers = S.song.layers;
  const lane = Math.max(1, Math.floor(ih / Math.max(1, layers.length)));
  for (let s = S.barOffset; s < total; s += 32) dither(x + 1 + Math.floor(s * sx), y + 1, Math.max(1, Math.ceil(16 * sx)), ih, T.hover);
  const hl = repHighlight();
  if (hl) fill(x + 1 + Math.floor(hl.from * sx), y + 1, Math.max(1, Math.round((hl.to - hl.from) * sx)), ih, repHiColor(hl));
  layers.forEach((L, li) => {
    if (S.hidden.has(li)) return;
    const c = toneInk(L, li !== S.active);
    const yy = y + 1 + Math.min(ih - 1, li * ih / layers.length | 0);
    for (const n of L.notes) fill(x + 1 + Math.floor(n.s * sx), yy, Math.max(1, Math.ceil((n._e - n.s) * sx)), lane, c);
  });
  if (loopShown()) fill(x + 1 + Math.floor(timeToStep(S.song, S.song.loopStart) * sx), y + 1, 1, ih, T.loop);
  for (const r of repeatSpans(S.song)) {
    const x0 = x + 1 + Math.floor(r.from * sx), x1 = x + 1 + Math.floor(r.to * sx);
    fill(x0, y + 1, 1, ih, T.ink); fill(Math.max(x0 + 1, x1 - 1), y + 1, 1, ih, T.ink); fill(x0, y + h - 2, Math.max(1, x1 - x0), 1, T.ink);
  }
  const vx = x + 1 + Math.max(0, Math.floor(S.scroll * sx)), vw = Math.max(3, Math.round(visibleSteps() * sx));
  frame(vx, y, Math.min(vw, x + w - vx), h, T.ink);
  fill(x + 1 + Math.floor(posStep * sx), y + 1, 1, ih, T.head);
  const seek = (m) => {
    const s = Math.max(0, (m.x - x - 1) / iw * total);
    setScroll(s - visibleSteps() * 0.3);
    S.followHold = true; // the view stays where it was put, even while playing
  };
  region(x, y, w, h, { id: 'overview', cursor: 'pointer', tip: 'Whole song · click to look there', down: seek, move: seek });
}

// The mouse pointer over the staff: the tool's own picture (art/cursors) where the tool works, the pointing hand over
// what clicks (ruler, keys and clefs, other tracks' lanes), the arrow where nothing can be drawn.
const CURSOR_PIC = { select: 'select', pen: 'pen', erase: 'eraser', fill: 'bucket', pick: 'pipette', hand: 'hand', vol: 'speaker', pan: 'phones', repeat: 'repeat' };
const toolCursor = () => CURSOR_PIC[S.tool] || 'pen'; // the arrow tool stays the black mouse while it selects and moves
function staffCursor() {
  const d = S.drag, h = S.hover;
  // dragging something (the score, a flag, Sonic, a repeat sign): the closed hand
  if (d) return ['pan', 'seek', 'end', 'loop', 'repEdge'].includes(d.mode) ? 'fist' : d.mode === 'keys' ? 'pointer' : toolCursor();
  if (!h) return 'arrow';
  if (h.kind === 'ruler' || h.kind === 'key' || h.kind === 'lane') return 'pointer';
  if (S.tool === 'hand') return 'hand';
  if (S.tool === 'repeat') return h.rep ? 'repeat' : 'arrow';
  if (S.tool === 'select' || BAR_TOOLS[S.tool]) return h.x >= GUTTER ? toolCursor() : 'arrow';
  return h.kind === 'note' || h.kind === 'empty' ? toolCursor() : 'arrow';
}
function drawCursor() {
  const m = ui.mouse;
  const x = Math.floor(m.x), y = Math.floor(m.y);
  const ink = md(0, 0, 0), halo = md(7, 7, 7);
  const name = staffCursor();
  const c = pointerIcon(name, m.buttons && hasFrame('cursors', name, 1) ? 1 : 0); // frame 2 while a button is down
  const [hx, hy] = c.hot;
  g.drawImage(c.cv, x - hx, y - hy);
  if (name === 'repeat') { // what the click will do: x2 / x3 / x4, the green loop or the cross
    const bx = x - hx + c.cv.width - 3, by = y - hy + c.cv.height - 5;
    fill(bx, by, 12, 12, halo); frame(bx, by, 12, 12, ink);
    drawRepMode(S.repMode, bx, by, ink);
  }
}

// The pixel mouse pointer off the staff: the pointing hand over what can be clicked, else the arrow.
function drawPointer() {
  const m = ui.mouse;
  if (!m.inside || ui.hover?.cursor === 'text') return;
  const name = ui.hover?.cursor === 'pointer' ? 'pointer' : 'arrow';
  const p = pointerIcon(name, m.buttons && hasFrame('cursors', name, 1) ? 1 : 0); // frame 2 while a button is down
  g.drawImage(p.cv, Math.floor(m.x) - p.hot[0], Math.floor(m.y) - p.hot[1]);
}

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  const typing = (e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'TEXTAREA';
  if (!S.song || typing) return;
  const k = e.key, code = e.code;
  const mod = e.ctrlKey || e.metaKey;
  if (S.dlg?.kind === 'fmEdit' && fmEditorKey(S.dlg, e)) return;
  if (S.dlg?.kind === 'smpImport' && smpImportKey(S.dlg, e)) return;
  if (S.dlg) {
    if (k === 'Escape') { e.preventDefault(); closeDialog(); }
    else if (k === 'Enter') { e.preventDefault(); dialogOk(); }
    return;
  }
  if (S.menu || S.flyout || S.scaleMenu) {
    if (k === 'Escape') { S.menu = false; S.flyout = false; S.scaleMenu = false; return; }
    S.menu = false; S.flyout = false; S.scaleMenu = false;
  }
  if (mod && code === 'KeyS') { e.preventDefault(); e.shiftKey ? saveCopyDialog() : save(); return; }
  if (mod && code === 'KeyO') { e.preventDefault(); showOpenDialog(); return; }
  if (mod && code === 'KeyI') { e.preventDefault(); $('anyFile').click(); return; }
  if (mod && code === 'KeyE') { e.preventDefault(); openExport(); return; }
  if (mod && code === 'KeyC') { if (S.sel.size) { e.preventDefault(); copySelection(); } return; }
  if (mod && code === 'KeyX') { if (S.sel.size) { e.preventDefault(); copySelection(); deleteSelection(); } return; }
  if (mod && code === 'KeyV') { if (S.clip) { e.preventDefault(); pasteClip(); } return; }
  if (mod && code === 'KeyA') {
    e.preventDefault();
    const L = activeLayer();
    if (L && (multiLayer() || !S.hidden.has(S.active))) { setTool('select'); S.sel = new Set(selLayers().flatMap((M) => M.notes)); showStatus(`${S.sel.size} notes selected`); }
    return;
  }
  // Space is always play / pause
  if (k === ' ') { e.preventDefault(); document.activeElement?.blur?.(); if (!e.repeat) togglePlay(); }
  else if (mod && code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && code === 'KeyY') { e.preventDefault(); redo(); }
  else if (mod) return;
  else if ((k === 'Delete' || k === 'Backspace') && S.sel.size) { e.preventDefault(); deleteSelection(); }
  else if (k === 'Escape') { S.sel.clear(); showStatus(''); }
  else if (k === 'Home') backToStart();
  else if (/^Digit\d$/.test(code)) {
    const i = (+code.slice(5) + 9) % 10;
    if (i < S.song.layers.length) selectLayer(i);
  }
  else if (code === 'KeyQ') setTool('pen');
  else if (code === 'KeyW') setTool('erase');
  else if (code === 'KeyB') setTool('fill');
  else if (code === 'KeyI') setTool('pick');
  else if (code === 'KeyA') setTool('select');
  else if (code === 'KeyD') setTool('hand');
  else if (code === 'KeyV') setTool('vol');
  else if (code === 'KeyP') setTool('pan');
  else if (code === 'KeyX') setTool('repeat');
  else if (code === 'KeyH') toggleSet(S.hidden, S.active);
  else if (code === 'KeyM') { toggleSet(S.muted, S.active); sendMute(); }
  else if (code === 'KeyS') { toggleSet(S.solo, S.active); sendMute(); }
  else if (code === 'KeyF') setFollow(!S.follow);
  else if (code === 'KeyL') setLoop(!S.loop);
  else if (k === 'ArrowRight') setScroll(S.scroll + 16);
  else if (k === 'ArrowLeft') setScroll(S.scroll - 16);
  else if (k === 'ArrowUp') setVy(S.vy - 8);
  else if (k === 'ArrowDown') setVy(S.vy + 8);
  else if (k === '+' || k === '=') zoom(1);
  else if (k === '-') zoom(-1);
});
// The FM editor: undo / redo of its own, and the computer keyboard as a piano (two rows: Z S X… and Q 2 W…).
function fmEditorKey(d, e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? fmRedo(d) : fmUndo(d); return true; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); fmRedo(d); return true; }
  const k = FM_KEYMAP.indexOf(e.code);
  if (mod || e.altKey || k < 0) return false;
  e.preventDefault();
  if (!e.repeat && d.heldCode !== e.code) { fmKeyDown(d, (d.oct + 2) * 12 + k); d.heldCode = e.code; }
  return true;
}
window.addEventListener('keyup', (e) => {
  const d = S.dlg;
  if (d?.kind === 'fmEdit' && d.heldCode === e.code) fmKeyUp(d);
  if (d?.kind === 'smpImport' && d.heldCode === e.code) smpKeyUp(d);
});
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (file) importFile(file).catch((err) => tell(`Import failed: ${err.message}`));
});
const SOUND_ACCEPT = SOUND_EXT.map((x) => '.' + x);
// Import (menu, Ctrl+I) and files dropped on the window go the same way: sound files (.spsound .spkit) to My sounds
// as they are, FM patch files through the import list, an audio file through the sample import, a .json is a song.
function importFiles(files) {
  const parent = S.dlg?.kind === 'track' ? S.dlg : null;
  const sounds = files.filter((f) => isSoundFile(f.name)), patches = files.filter((f) => isPatchFile(f.name)), song = files.find((f) => /\.json$/i.test(f.name));
  const audio = files.find((f) => isSampleFile(f.name));
  if (sounds.length) importSoundFiles(sounds, parent);
  if (patches.length) openPatchFiles(patches, parent);
  else if (sounds.length) return;
  else if (audio) openSampleFile(audio, parent);
  else if (song && !parent) importFile(song).catch((err) => tell(`Import failed: ${err.message}`));
  else tell(`Can't open ${files[0].name}: not a song, sound or audio file.`);
}
$('anyFile').accept = ['.json', ...SOUND_ACCEPT, ...PATCH_EXT.map((x) => '.' + x), 'audio/*', ...SAMPLE_EXT.map((x) => '.' + x)].join(',');
$('anyFile').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (files.length) importFiles(files);
});
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  if (S.song) importFiles(files); // not while still loading
});

// ---------- boot screen: the SEGA logo as Alien 3 shows it (art/pictures/segaLogo, frame lengths in 1/60 s) ----------
// A 320x224 Mega Drive screen, scaled by a whole number to fit the window. Click or any key skips it; the app shows
// once the logo is done and the song has loaded.
function playSplash(ready) {
  const box = $('splash'), cv = $('splashCv'), c = cv.getContext('2d');
  const n = frameCount('pictures', 'segaLogo');
  if (!n) { ready.then(() => box.remove()); return; }
  const ticks = artInfo('pictures', 'segaLogo').ticks || [];
  const len = (k) => (REDUCED_MOTION ? (k ? 0 : 90) : ticks[k] || 3);
  const total = Array.from({ length: n }, (_, k) => len(k)).reduce((a, b) => a + b, 0) + 20; // a little black at the end
  const fit = () => {
    const k = Math.max(1, Math.floor(Math.min(innerWidth / 320, innerHeight / 224)));
    cv.style.width = 320 * k + 'px'; cv.style.height = 224 * k + 'px';
  };
  fit(); addEventListener('resize', fit);
  let skip = false, done = false;
  const stop = () => { skip = true; };
  addEventListener('keydown', stop, { once: true }); box.addEventListener('mousedown', stop, { once: true });
  const t0 = performance.now();
  const frame = () => {
    const t = Math.floor((performance.now() - t0) / (1000 / 60));
    c.fillStyle = '#000'; c.fillRect(0, 0, 320, 224);
    if (!skip && t < total) {
      let k = 0, acc = len(0);
      while (k < n - 1 && t >= acc) acc += len(++k);
      if (t < acc) { const p = picture('segaLogo', k); c.drawImage(p, (320 - p.width) >> 1, (224 - p.height) >> 1); }
      requestAnimationFrame(frame);
      return;
    }
    if (done) return;
    done = true;
    ready.then(() => { removeEventListener('resize', fit); removeEventListener('keydown', stop); box.remove(); });
  };
  requestAnimationFrame(frame);
}

async function init() {
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  setTheme(theme === 'dark' || theme === 'light' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try { const k = +localStorage.getItem(SCALE_KEY); if (SCALES.includes(k)) ui.scale = k; } catch (e) { /* ignore */ }
  try { if (localStorage.getItem(SOUND_KEY) === 'model1') S.sound = 'model1'; } catch (e) { /* ignore */ }
  try { Object.assign(S.fold, JSON.parse(localStorage.getItem(FOLD_KEY)) || {}); } catch (e) { /* ignore */ }
  await loadArt('art/');
  let loaded;
  playSplash(new Promise((r) => { loaded = r; }));
  initScreen($('screen'), $('ti'));
  g = ui.g;
  requestAnimationFrame(draw);
  [S.refs, S.catalog] = await Promise.all([listRefs(), fetchCatalog(), loadMySounds()]);
  let doc = null;
  try { doc = JSON.parse(localStorage.getItem(LAST_KEY)); } catch (e) { /* ignore */ }
  try { await openDoc(doc || { kind: 'ref', dir: baseRef() }); }
  catch (e) { console.error(e); await openDoc({ kind: 'ref', dir: baseRef() }); }
  loaded();
}
init().catch((err) => {
  $('splash')?.remove(); // never hide an error behind the logo
  console.error(err);
  showStatus(`Load error: ${err.message}`);
});
