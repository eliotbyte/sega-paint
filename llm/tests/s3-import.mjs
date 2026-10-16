// Section 3 checks: every song of player/songs goes import -> build with the same timeline, bit for bit (buildTimeline
// before and after, both through the app's loading path and through the engine alone); a song made in Sega Paint comes
// out as a readable .sps with patterns.
// usage: node llm/tests/s3-import.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { prepareSong, buildTimeline } from '../../player/engine/song.js';
import { SONGS, ROOT, refList, readJson, fetchBank, loadSongFile, loadSongObject, outPath } from '../core.mjs';
import { parseSps, buildSong, serializeSong, buildFile } from '../sps.mjs';
import { importSong, sameTimeline } from '../import.mjs';
import { extract, line } from './appsrc.mjs';

const engineTl = (json, base) => buildTimeline(prepareSong(structuredClone(json)), fetchBank(base, json.bankFile || 'pcm.bin'));
let total = 0;
for (const { dir } of process.env.QUICK ? [] : refList()) {
  const file = path.join(SONGS, dir, 'song.json');
  const t0 = performance.now();
  const { text, plain } = importSong(file);
  const out = outPath(`${dir}.sps`);
  fs.writeFileSync(out, text);
  const built = buildFile(out);
  const a = loadSongFile(file), b = loadSongObject(built, 'built.json');
  assert.ok(sameTimeline(buildTimeline(a.song, a.pcm), buildTimeline(b.song, b.pcm)), `${dir}: app path timeline differs`);
  assert.ok(sameTimeline(engineTl(readJson(file), dir), engineTl(built, dir)), `${dir}: engine timeline differs`);
  const notes = (j) => j.layers.reduce((x, L) => x + L.notes.length, 0);
  assert.equal(notes(built), notes(readJson(file)));
  const lines = text.split('\n').findIndex((l) => l.startsWith('exact:'));
  console.log(`${dir.padEnd(22)} ${plain ? 'plain' : 'exact'}: ${(text.match(/^pattern /gm) || []).length} patterns, ${lines} lines + exact block; ${notes(built)} notes; timeline identical (app path and engine) [${((performance.now() - t0) / 1000).toFixed(1)} s]`);
  total++;
}
console.log(`${total} songs: import -> build bit for bit`);

// A song as Sega Paint exports it (exportJson): built from the examples, then loaded the way setupSong does (md on
// every note), edited with the pen (e: 1) and serialized by app.js serializeObj with its base.
const { serializeObj } = extract(['RUNTIME_KEYS', 'serializeObj']);
const mdLine = new Function('song', line('if (L.kind === \'fm\' || L.kind === \'psg\' || L.kind === \'noise\') for (const n of L.notes) if (n.m != null && n.md == null'));
for (const f of ['neon-alley.sps', 'night-ride.sps']) {
  const made = buildFile(path.join(ROOT, 'llm', 'examples', f));
  mdLine(made);
  for (const L of made.layers) for (const n of L.notes) n.e = 1;
  const exported = serializeObj({ ...made, base: made.base });
  const file = outPath(f.replace('.sps', '-app.json'));
  fs.writeFileSync(file, JSON.stringify(exported));
  const { text, plain } = importSong(file);
  fs.writeFileSync(outPath(f.replace('.sps', '-app.sps')), text);
  assert.ok(plain, `${f}: a song made of library sounds on the even grid should import plain`);
  assert.ok(!text.includes('{') || !/\{(m|i|d|s|S)=/.test(text), `${f}: exact attributes in a plain import`);
  const back = loadSongObject(buildSong(parseSps(text, 'x.sps')), 'x.json'), orig = loadSongObject(exported, file);
  assert.ok(sameTimeline(buildTimeline(orig.song, orig.pcm), buildTimeline(back.song, back.pcm)));
  const bars = Math.round(exported.end / exported.step / 16), pats = (text.match(/^pattern /gm) || []).length;
  console.log(`${f} made in the app: plain .sps, ${bars} bars in ${pats} patterns, ${text.split('\n').length} lines; ${text.match(/^arrange: .*/m)[0]}`);
  // the same song with a patch changed in the FM editor: exact mode, the patterns still fold
  const edited = structuredClone(exported);
  edited.instruments[0].regs = edited.instruments[0].regs.map(([r, v]) => [r, r === 0xb0 ? (v & 0x38) | 4 : v]);
  const file2 = outPath(f.replace('.sps', '-edited.json'));
  fs.writeFileSync(file2, JSON.stringify(edited));
  const r2 = importSong(file2);
  assert.ok(!r2.plain);
  console.log(`  with an FM patch edited: exact mode, ${(r2.text.match(/^pattern /gm) || []).length} patterns; ${r2.text.match(/^arrange: .*/m)[0]}`);
}
console.log('section 3: OK');
