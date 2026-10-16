// Section 6 checks: nearest finds every FM sound of the library first from a WAV render of it; the summaries of a
// bass and a pad differ the way a person would put it; compare of a sound with itself is ~0 and with others is not;
// a one-note song render (not a hear render) is found too: its key-up is read from the WAV.
// usage: node llm/tests/s6-hear.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { ROOT, allSounds, outPath, noteName, writeWav, renderSong, loadSongObject } from '../core.mjs';
import { buildFile } from '../sps.mjs';
import { soundRecord, renderPatch } from '../patch.mjs';
import { summarize, formatSummary } from '../analyze.mjs';
import { nearest, compare, writeMono, hear } from '../hear.mjs';

const t0 = performance.now();
let ok = 0;
const regsOf = (k) => JSON.stringify([soundRecord(k).ins, soundRecord(k).mac]);
for (const c of allSounds().filter((x) => x.ins)) {
  const rec = soundRecord(c.key);
  const wav = outPath(`target-${c.key.replace(/[^a-z0-9]/gi, '_')}.wav`);
  writeMono(wav, renderPatch(rec, rec.p, { hold: 1, release: 0.6 }));
  const { list } = nearest(wav, { n: 3 });
  // a sound with the same registers and macro sounds the same: either may come first
  const first = list[0], same = first.key === c.key || (regsOf(first.key) === regsOf(c.key));
  console.log(`${c.key.padEnd(16)} -> 1. ${first.key} (${first.d.toFixed(3)})  2. ${list[1].key} (${list[1].d.toFixed(3)})${same ? '' : '  WRONG'}`);
  assert.ok(same, `${c.key}: nearest gave ${first.key}`);
  ok++;
}
console.log(`nearest: ${ok}/${ok} library FM sounds found first from a 16-bit WAV of their own render [${((performance.now() - t0) / 1000).toFixed(0)} s]`);

// bass vs pad, as a person would describe them
const bass = soundRecord("Skitchin':f0"), pad = soundRecord(path.join(ROOT, 'llm', 'examples', 'soft-pad.spp'));
const sb = summarize(renderPatch(bass, bass.p, { hold: 1, release: 0.6 }), { hold: 1 });
const sp = summarize(renderPatch(pad, pad.p, { hold: 1, release: 1.2 }), { hold: 1 });
console.log('\n' + formatSummary(`bass ${noteName(bass.p)}`, sb) + '\n' + formatSummary(`pad ${noteName(pad.p)}`, sp));
assert.ok(sb.attack < 10 && sp.attack > 80, 'the bass starts at once, the pad swells in');
assert.ok(sp.release == null || sp.release > 3 * sb.release, 'the pad rings on after the key is up, the bass stops');
assert.ok(sb.f0 < 100 && sp.f0 > 200, 'the bass is low, the pad in the middle');
console.log('bass: starts at once, low, stops at the key-up; pad: swells in, higher, rings on: as a person would say');

// compare: itself ~0, another sound far, with words
const self = compare("Skitchin':f1", outPath("target-Skitchin__f1.wav"));
const other = compare("Skitchin':f0", outPath("target-Skitchin__f1.wav"));
console.log(`\ncompare Lead with its own WAV: ${self.d.toFixed(3)}; Bass with the Lead WAV: ${other.d.toFixed(3)}\n${other.text}`);
assert.ok(self.d < 0.05 && other.d > 0.5);

// a target that is not a hear render: one note of a 1-bar song (sp render), held 0.75 s, a long silence after.
// nearest / compare find its key-up in the WAV (no --hold) and the sound first.
for (const [key, note] of [["Skitchin':f0", 'C2/6'], ["Skitchin':f1", 'A4/3'], ["Skitchin':d45", 'x']]) {
  const sps = outPath(`song-target-${key.replace(/[^a-z0-9]/gi, '_')}.sps`), wav = sps.replace(/\.sps$/, '.wav');
  fs.writeFileSync(sps, `song "Target"  bpm 120  4/4  grid 16\nbase skitchin\nsound s = "${key}"\npattern a 1:\n  FM1 s : ${note}\n`);
  const { L, R } = renderSong(loadSongObject(buildFile(sps), sps));
  writeWav(wav, L, R);
  const { target, list } = nearest(wav, { n: 2 }), c = compare(key, wav);
  console.log(`song render of ${key} (${note}): key-up at ${target.holds.join(' or ')} s -> 1. ${list[0].key} (${list[0].d.toFixed(3)})  2. ${list[1].key} (${list[1].d.toFixed(3)}); compare ${c.d.toFixed(3)}`);
  assert.ok(list[0].key === key || regsOf(list[0].key) === regsOf(key), `${key} from a song render: nearest gave ${list[0].key}`);
  if (key === "Skitchin':f0") assert.ok(Math.abs(target.hold - 0.75) < 0.03, `the bass key-up found at ${target.hold} s, not 0.75`);
  assert.ok(c.d < 0.1, `${key} compared with its song render: ${c.d.toFixed(3)}`);
}
console.log('\n' + hear("Skitchin':d41", { png: true, out: (n) => outPath(`floor-tom-${n}.png`) }));
console.log('section 6: OK');
