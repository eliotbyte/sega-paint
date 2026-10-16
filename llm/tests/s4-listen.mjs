// Section 4 checks: sp listen finds planted mistakes (a note out of key, clipping, a silent voice), its report of 16
// bars stays short, and the chords it names on Skitchin' tracks are printed for a human to compare by ear.
// usage: node llm/tests/s4-listen.mjs
import path from 'node:path'; import assert from 'node:assert/strict';
import { ROOT, SONGS, loadSongObject, loadSongFile } from '../core.mjs';
import { buildFile } from '../sps.mjs';
import { listen } from '../listen.mjs';

const song = buildFile(path.join(ROOT, 'llm', 'examples', 'neon-alley.sps'));
const clean = listen(loadSongObject(song, 'x.json'), { bars: [1, 16] });
const lines = clean.split('\n').length;
console.log(`neon-alley, 16 bars: ${lines} lines`);
assert.ok(lines <= 80, 'the report of 16 bars is longer than 80 lines');
assert.ok(/clipping: none/.test(clean) && !/silent voices/.test(clean) && !/out of E minor/.test(clean), clean);

// 1. one wrong note: an F natural in the E minor lead (bar 11)
const s1 = structuredClone(song);
const lead = s1.layers.find((L) => L.name === 'Lead');
const n = lead.notes.find((x) => x.s >= 160 && x.s < 176 && x.p === 71);
n.p = 77; // B4 -> F5
const r1 = listen(loadSongObject(s1, 'x.json'), { bars: [1, 16], render: false });
const m1 = /out of E minor \(\d+\): ([^\n]*)/.exec(r1);
assert.ok(m1 && /FM3 F5/.test(m1[1]), r1);
console.log(`wrong note found: "out of E minor: ${m1[1]}"`);

// 2. clipping: three more FM voices on a loud organ patch (algorithm 7, every operator at full level) in unison
const s2 = structuredClone(song);
const regs = [];
for (const base of [0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90]) for (const sl of [0, 8, 4, 12]) regs.push([base + sl, { 0x30: 1, 0x40: 0, 0x50: 31, 0x60: 0, 0x70: 0, 0x80: 0x0f, 0x90: 0 }[base]]);
regs.push([0xb0, 7], [0xb4, 0xc0]);
s2.instruments.push({ regs, ops: 240 });
const ins = s2.instruments.length - 1, bass = s2.layers.find((L) => L.name === 'Bass');
for (const ch of [3, 4]) s2.layers.push({ id: 'X' + ch, kind: 'fm', ch, name: 'Organ', notes: bass.notes.map((x) => ({ ...x, i: ins, p: x.p + 12 })) });
const r2 = listen(loadSongObject(s2, 'x.json'), { bars: [3, 6] });
const m2 = /clipping: (\d+) samples at full scale in bars ([^ ]*)/.exec(r2);
assert.ok(m2, r2);
console.log(`clipping found: "${m2[0]}"`);

// 3. a voice that never plays, and one that stops
const s3 = structuredClone(song);
s3.layers.push({ id: 'X9', kind: 'psg', ch: 2, name: 'Forgotten', notes: [] });
s3.layers.find((L) => L.name === 'Drums').notes = s3.layers.find((L) => L.name === 'Drums').notes.filter((x) => x.s < 64);
const r3 = listen(loadSongObject(s3, 'x.json'), { bars: [1, 16], render: false });
assert.ok(/silent voices: PSG3 Forgotten/.test(r3), r3);
assert.ok(/FM2 Drums drums \(4\/16 bars\)/.test(r3), r3);
console.log(`silent voice found: "${/silent voices: [^\n]*/.exec(r3)[0]}"; the drums that stop after bar 4: "${/FM2 Drums drums \(4\/16 bars\)/.exec(r3)[0]}"`);

// chords of Skitchin' tracks, for a human to check by ear
for (const [dir, bars] of [['cheese-grater', [9, 24]], ['tastes-like-chicken', [1, 16]], ['loser', [1, 16]]]) {
  const r = listen(loadSongFile(path.join(SONGS, dir, 'song.json')), { bars, render: false });
  console.log(`\n${dir} bars ${bars.join('-')}: ${/^key: [^\n]*/m.exec(r)[0]}`);
  console.log(r.slice(r.indexOf('CHORDS'), r.indexOf('\nHARMONY')).trim());
}
console.log('\nsection 4: OK');
