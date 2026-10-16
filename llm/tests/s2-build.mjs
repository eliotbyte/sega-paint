// Section 2 checks: .sps -> song.json against the code of app.js itself (sounds copied as libUse / addCatalogSound /
// addCatalogSample do it, timing as setTiming, notes as newNote, loading as importFile -> openDoc), errors with
// line and column, the example song passes check, and the app's VGM export of it plays like sp render.
// usage: node llm/tests/s2-build.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { prepareSong, buildTimeline, stepTime, timeToStep, hzMidi, fmHz, psgHz, MELODIC_VOICE } from '../../player/engine/song.js';
import { writeVGM, parseVGM } from '../../player/engine/vgm.js';
import { ROOT, PLAYER, readJson, fetchRef, fetchBank, loadSongObject, renderSong, renderTimeline, spriteName, spritePool } from '../core.mjs';
import { parseSps, buildSong, serializeSong, SpsError } from '../sps.mjs';
import { checkSong } from '../check.mjs';
import { extract, source, line } from './appsrc.mjs';
import { maxDiff, bandDiff } from './util.mjs';

const SECS = ['samples', 'fm', 'drums', 'psg', 'noise'];
// library.js fetchCatalog, on its own copy
function appCatalog() {
  const cat = readJson(path.join(PLAYER, 'library', 'sounds.json'));
  for (const g of cat.games) for (const sec of SECS) for (const x of g[sec] || []) x.game = g.game;
  return { games: cat.games, bank: new Uint8Array(fs.readFileSync(path.join(PLAYER, 'library', 'samples.bin'))) };
}
const APP_NAMES = ['KIT', 'kitOf', 'patchKey', 'libSound', 'libUsed', 'addCatalogSound', 'gameCatOf', 'catOf', 'catSamples', 'catPoint', 'withCatalog',
  'toB64', 'fromB64', 'withMySamples', 'songSampleOf', 'SAMPLE_KEYS', 'addCatalogSample', 'FREE_ROWS', 'assignSampleRows', 'sampleSound',
  'mergeLibrary', 'RUNTIME_KEYS', 'serializeObj', 'setTiming', 'newNote', 'drumRow', 'isLane', 'fixedPitch'];
function app(S) {
  return extract(APP_NAMES, {
    S, hzMidi, fmHz, psgHz, stepTime, MELODIC_VOICE, spriteName, SPRITE_POOL: spritePool(), RATE: 44100, indexLayer: () => {}, loopStep: () => -1,
  });
}

function compareWithApp(file) {
  const ast = parseSps(fs.readFileSync(file, 'utf8'), file);
  const built = buildSong(ast), json = serializeSong(built), maker = built._maker;
  const ref = fetchRef(json.base);
  // 1. the sounds, copied in the same order by the app's code
  const S = { song: { ...structuredClone(json), instruments: [], macros: [], samples: [], layers: [], game: ref.game }, catalog: appCatalog(), mySounds: {} };
  delete S.song.libUse;
  S.catOff = fetchBank(json.base, ref.bankFile).length;
  const A = app(S);
  // a file sound (sound x = "bass.spp") is one of My sounds in the app, which come first in its library (loadMySounds, catOf)
  for (const c of maker.log) if (c.my && !(S.mySounds[c.type] ||= []).includes(c)) S.mySounds[c.type].push(c);
  const appC = (c) => SECS.flatMap((sec) => A.catOf(sec)).find((x) => x.key === c.key);
  for (const c of maker.log) { const x = appC(c); if (S.catalog.games.some((g) => (g.samples || []).includes(x))) A.addCatalogSample(x); else A.addCatalogSound(x); }
  const app1 = A.serializeObj(S.song);
  for (const k of ['instruments', 'macros', 'samples', 'libUse']) assert.deepEqual(json[k], app1[k], `${k} differ from app.js`);
  // 2. palettes: app.js libSound / sampleSound
  for (const L of json.layers) for (const x of L.palette) {
    const want = x.smp != null ? A.sampleSound(x.smp) : (() => { const c = appC({ key: x.lib }); const { group, ...r } = A.libSound(c, S.song.libUse[c.key]); return r; })();
    assert.deepEqual(x, A.serializeObj(want), `palette entry ${x.name}`);
  }
  // 3. timing: app.js setTiming / setLoopStep on a new (uniform) song
  const bars = Math.round(timeToStep(json, json.end) / 16), loop = json.loopStart < 0 ? -1 : Math.round(timeToStep(json, json.loopStart));
  const T = { song: { uniform: true, bpm: json.bpm, step0: 0, layers: [] } }; // as newSongData
  extract(['setTiming'], { S: T, RATE: 44100, stepTime, indexLayer: () => {}, loopStep: () => -1 }).setTiming(json.bpm, bars, loop);
  for (const k of ['step', 'stepTimes', 'end', 'loopStart']) assert.deepEqual(json[k], T.song[k], `timing: ${k}`);
  // 4. notes: app.js newNote with the note's palette sound (a pen note one step long; longer notes are dragged out)
  let n1 = 0, nLong = 0;
  const unit = 16 / ast.grid;
  for (const L of json.layers) {
    const LL = { ...L, notes: [] };
    for (const n of L.notes) {
      const snd = L.palette.find((x) => (L.kind === 'sample' ? x.smp === n.smp : n.gm != null ? x.gm === n.gm : x.m === n.m && x.i === n.i));
      LL.sel = snd;
      const { e, ...a } = A.serializeObj(A.newNote(LL, { s: n.s, p: A.fixedPitch(LL, { ...n, gm: snd.gm }) ? snd.p : n.p }));
      const { vol, pan, slide, ...mine } = n;
      if (a.d === mine.d) { assert.deepEqual(mine, a, `note at step ${n.s} of ${L.name}`); n1++; continue; }
      const len = [...Array(64 * 16).keys()].find((k) => Math.round(stepTime(json, n.s + k * unit) - stepTime(json, n.s)) === mine.d);
      assert.ok(len > 1, `note at step ${n.s} of ${L.name}: length ${mine.d} is no whole number of steps`);
      assert.deepEqual({ ...mine, d: a.d }, a, `note at step ${n.s} of ${L.name}`);
      nLong++;
    }
  }
  // 5. loading: importFile -> openDoc (mergeLibrary, withCatalog, setupSong's md) vs llm/core.mjs
  const S2 = { catalog: appCatalog(), mySounds: {} };
  const B = app(S2);
  const asImported = JSON.parse(JSON.stringify(json));
  assert.ok(Array.isArray(asImported.layers) && asImported.stepTimes, 'importFile would refuse it');
  B.mergeLibrary(asImported, fetchRef(asImported.base));
  asImported.game = ref.game;
  const bank = B.withCatalog(fetchBank(asImported.base, asImported.bankFile || 'pcm.bin'), asImported);
  new Function('song', line('if (L.kind === \'fm\' || L.kind === \'psg\' || L.kind === \'noise\') for (const n of L.notes) if (n.m != null && n.md == null'))(asImported);
  const tlApp = buildTimeline(prepareSong(asImported), bank);
  const doc = loadSongObject(json, 'x.json');
  const tlMine = buildTimeline(doc.song, doc.pcm);
  assert.equal(tlApp.n, tlMine.n);
  for (const k of ['t', 'k', 'r', 'v']) assert.equal(maxDiff(tlApp[k], tlMine[k]), 0, `timeline ${k}`);
  assert.equal(tlApp.end, tlMine.end); assert.equal(tlApp.loopStart, tlMine.loopStart);
  return { json, doc, tlApp, n1, nLong };
}

for (const f of fs.readdirSync(path.join(ROOT, 'llm', 'examples')).filter((x) => x.endsWith('.sps'))) {
  const file = path.join(ROOT, 'llm', 'examples', f);
  const { json, doc, tlApp, n1, nLong } = compareWithApp(file);
  const res = checkSong(doc.song);
  assert.equal(res.errors.length, 0, res.errors.join('\n'));
  // the app's VGM export (exportSong: writeVGM of buildTimeline) read back and played, against sp render
  const vgm = parseVGM(writeVGM(tlApp, { title: json.title, author: 'test', date: '2026/10/16' }, { dac: 'pcm' }).bytes);
  const secs = json.end / 44100;
  const mine = renderSong(doc);
  const [vL] = renderTimeline(vgm, 0, secs);
  const exact = parseVGM(writeVGM(tlApp, {}, { dac: 'pcm', dedup: false }).bytes);
  const noDac = (T) => { const keep = []; for (let i = 0; i < T.n; i++) if (!(T.k[i] === 0 && T.r[i] === 0x2a)) keep.push(i); const pick = (X, fn = (x) => x) => X.constructor.from(keep, (i) => fn(X[i])); return { t: pick(T.t, (x) => Math.max(0, Math.round(x))), k: pick(T.k), r: pick(T.r), v: pick(T.v), n: keep.length, end: T.end, loopStart: T.loopStart }; };
  const fmA = renderTimeline(noDac(tlApp), 0, secs)[0], fmB = renderTimeline(noDac(exact), 0, secs)[0];
  console.log(`${f}: ${json.layers.length} tracks, ${n1 + nLong} notes = app.js newNote (${nLong} dragged longer); sounds, palettes, timing = app.js;`);
  console.log(`  loaded as Import: timeline = app.js openDoc path (${tlApp.n} writes); check: ${res.warnings.length} warnings`);
  console.log(`  app VGM export vs sp render: band diff ${bandDiff(mine.L, vL).toFixed(2)} dB; FM+PSG with every write kept: max diff ${maxDiff(fmA, fmB)}`);
}

// errors: line, column, words
const head = 'song "T" bpm 120\nsound b = "Skitchin\':f0"\nsound k = "Skitchin\':s16c225"\nsound g = "Skitchin\':s168b9e"\nsound h = "Skitchin\':d42"\n';
const bad = [
  ['pattern p 1:\n  FM1 b : A2/4 Q2/4\n', '7:16', 'not a note'],
  ['pattern p 1:\n  FM6 b : A2/4\n', '7:3', 'FM6 is not available'],
  ['pattern p 1:\n  DAC1 k : A2/4\n', '7:12', 'pitch changes only on DAC4'],
  ['pattern p 1:\n  DAC4 k : A2/4\n', '7:8', 'no pitch'],
  ['pattern p 1:\n  FM1 b : A2/12 A2/8\n', '7:17', 'past the end'],
  ['pattern p 1:\n  FM1 b : A2/4\n  FM1 b : C3/4\n', '8:11', 'two notes at once'],
  ['pattern p 1:\n  FM1 x : A2/4\n', '7:7', 'no sound "x"'],
  ['pattern p 1:\n  PSG1 b : A2/4\n', '7:8', 'plays square waves'],
  ['pattern p 1:\n  DAC1 k : x...\n  DAC1 vol 3\n', '8:8', 'samples have no volume'],
  ['pattern p 1:\n  FM1 b : A2/4\n  FM1 h : x...\n', '8:7', 'mixes FM drums'],
  ['pattern p 1:\n  FM1 b : A2/4{vol=20}\n', '7:11', 'vol=20'],
  ['pattern p 1:\n  FM1 b : A2/4\narrange: p q\n', '8:12', 'no pattern or section "q"'],
  ['pattern p 1:\n  FM1 b : A2/4\nloop: q\n', '8:7', 'does not play'],
  ['song "T" bpm 120 3/4\n', '6:18', 'only 4/4'],
];
for (const [text, at, words] of bad) {
  let err = null;
  try { buildSong(parseSps(head + text, 'bad.sps')); } catch (e) { err = e; }
  assert.ok(err instanceof SpsError, `no error for:\n${text}`);
  assert.ok(err.message.includes(`bad.sps:${at}:`) && err.message.includes(words), `expected ${at} "${words}", got: ${err.message}`);
}
console.log(`errors: ${bad.length} broken snippets give the right line:column and message`);
console.log('section 2: OK');
