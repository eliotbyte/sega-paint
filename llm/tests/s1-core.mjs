// Section 1 checks: every example passes check; sp render is the player's sound; check finds planted faults.
// usage: node llm/tests/s1-core.mjs [seconds per song, default 20]
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import assert from 'node:assert/strict';
import { parseVGM } from '../../player/engine/vgm.js';
import { prepareSong, buildTimeline } from '../../player/engine/song.js';
import { SONGS, refList, loadSongFile, loadSongObject, renderSong, renderTimeline, readJson } from '../core.mjs';
import { checkSong } from '../check.mjs';
import { bandDiff, maxDiff } from './util.mjs';

const secs = +process.argv[2] || 20;
let worst = 0;
for (const { dir } of refList()) {
  const file = path.join(SONGS, dir, 'song.json');
  const doc = loadSongFile(file);
  const res = checkSong(doc.song);
  assert.equal(res.errors.length, 0, `${dir}: ${res.errors.join('; ')}`);
  // sp render vs the player's own path (tools/vgm_export.mjs: prepareSong + buildTimeline on the song's bank)
  const raw = prepareSong(readJson(file));
  const bank = new Uint8Array(fs.readFileSync(path.join(SONGS, dir, raw.bankFile || 'pcm.bin')));
  const ptl = buildTimeline(raw, bank);
  const mine = renderSong(doc, { maxSeconds: secs });
  const n = Math.min(mine.L.length, Math.round(secs * 44100));
  const [pL, pR] = renderTimeline(ptl, Math.max(0, raw.stepTimes[raw.step0]), n / 44100);
  let diff = 0;
  for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(mine.L[i] - pL[i]), Math.abs(mine.R[i] - pR[i]));
  assert.equal(diff, 0, `${dir}: sp render differs from the player's timeline by ${diff}`);
  // both against the original recording, as tools/verify2.mjs compares the player with it
  let line = `${dir.padEnd(22)} check: ${res.warnings.length} warning(s); render = player (bit exact, ${(n / 44100).toFixed(0)} s)`;
  const vgz = path.join(SONGS, dir, 'original.vgz');
  if (fs.existsSync(vgz)) {
    const orig = parseVGM(new Uint8Array(zlib.gunzipSync(fs.readFileSync(vgz))));
    const [oL] = renderTimeline(orig, Math.max(0, raw.stepTimes[raw.step0]), n / 44100);
    const a = bandDiff(oL, mine.L.subarray(0, n)), b = bandDiff(oL, pL);
    assert.equal(a, b);
    worst = Math.max(worst, a);
    line += `; vs original.vgz: band diff ${a.toFixed(2)} dB (player ${b.toFixed(2)} dB)`;
  }
  console.log(line);
}
console.log(`worst band diff against the originals: ${worst.toFixed(2)} dB`);

// --solo: FM1 and DAC1 alone = the player with the other voices muted (app.js sendMute / mixMutedSet)
{
  const doc = loadSongFile(path.join(SONGS, 'cheese-grater', 'song.json'));
  const solo = renderSong(doc, { fromBar: 5, bars: 2, solo: ['FM1', 'DAC1'] });
  const mixMuted = new Set(doc.song.layers.flatMap((L, i) => (L.kind === 'sample' && L.voice !== 0 ? [i] : [])));
  const tl = buildTimeline(doc.song, doc.pcm, mixMuted);
  const [L] = renderTimeline(tl, solo.from, solo.L.length / 44100, { mute: [0x3f & ~1, 0xf] });
  assert.equal(maxDiff(L, solo.L), 0);
  console.log(`--solo FM1,DAC1 --from 5 --bars 2: = the player with the rest muted (${(solo.L.length / 44100).toFixed(2)} s)`);
}

// planted faults
const base = readJson(path.join(SONGS, 'cheese-grater', 'song.json'));
const broken = structuredClone(base);
const fm = broken.layers.find((L) => L.kind === 'fm' && !L.kit), psg = broken.layers.find((L) => L.kind === 'psg');
const dac4 = broken.layers.find((L) => L.kind === 'sample' && L.voice === 3), dac1 = broken.layers.find((L) => L.kind === 'sample' && L.voice === 0);
broken.layers.push({ ...structuredClone(fm), id: 'X1', ch: 5, name: 'six' });       // FM6
broken.layers.push({ ...structuredClone(psg), id: 'X2', name: 'again' });            // PSG1 twice
fm.notes[3].vol = 20;                                                                 // volume out of range
fm.notes[4].pan = 'X';
psg.notes[2].p = 40;                                                                  // below A2
dac4.notes[5].p = 100;                                                                // out of the sample's range
dac1.notes[1].vol = 8;                                                                // samples have no volume
psg.notes[3].pan = 'L';                                                               // PSG is mono
fm.notes.push({ ...fm.notes[10] });                                                   // two notes at once
dac1.notes.push({ ...dac1.notes[0], smp: dac4.notes[0].smp, p: 70 });                 // pitch on DAC1
const r = checkSong(loadSongObject(broken, 'broken.json').song);
const all = [...r.errors, ...r.warnings].join('\n');
for (const want of ['FM6 is not available', 'two tracks on one voice', 'volume 20 out of 0-15', 'pan "X"', 'too low for the PSG',
  'out of the range', 'samples have no volume', 'the PSG is mono', 'two notes at once', 'pitch changes only on DAC4']) {
  assert.ok(all.includes(want), `check did not find: ${want}\n${all}`);
}
console.log(`planted faults: all 10 found (${r.errors.length} errors, ${r.warnings.length} warnings)`);
console.log('section 1: OK');
