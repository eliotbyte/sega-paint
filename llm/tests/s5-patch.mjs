// Section 5 checks: the .spp text keeps every FM sound of the library (get -> save -> the app's import of the
// .spsound -> the same registers the chip reads, the same sound bit for bit); the conversions are those of
// player/patches.js and player/fmedit.js; explain prints its words for a human to judge; .spp sounds work in a .sps.
// usage: node llm/tests/s5-patch.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { readSoundFile } from '../../player/soundfile.js';
import { allSounds, outPath, loadSongObject } from '../core.mjs';
import { soundRecord, writeSpp, parseSpp, sppToSound, explainPatch, renderPatch, regsToVoice, voiceToRegs, usedBits, carrierOps, ALG_LINKS, OP_OF_SLOT } from '../patch.mjs';
import { parseSps, buildSong, serializeSong } from '../sps.mjs';
import { extract } from './appsrc.mjs';
import { maxDiff } from './util.mjs';

// 1. the conversions against patches.js and fmedit.js themselves
const P = extract(['SLOT_ORDER', 'OP_REGS', 'dtFromMid', 'op', 'voiceFromRaw', 'rawOfVoice', 'voiceToRegs', 'regsToVoice'], {}, '', 'patches.js');
const F = extract(['OP_OF_SLOT', 'CAR', 'carrierSlots', 'ALG_GRAPH'], {}, '', 'fmedit.js');
let rnd = 7;
const R = (n) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
const voices = allSounds().filter((c) => c.ins).map((c) => c.ins.regs);
for (let k = 0; k < 500; k++) voices.push([...Array(30).keys()].map((i) => [[0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60, 0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0x90, 0x98, 0x94, 0x9c, 0xb0, 0xb4][i], R(256)]));
for (const regs of voices) {
  assert.deepEqual(regsToVoice(regs), P.regsToVoice(regs));
  assert.deepEqual(voiceToRegs(regsToVoice(regs)), P.voiceToRegs(P.regsToVoice(regs)));
}
for (let alg = 0; alg < 8; alg++) {
  assert.deepEqual(carrierOps(alg), F.carrierSlots(alg).map((s) => F.OP_OF_SLOT[s]).sort());
  assert.deepEqual(ALG_LINKS[alg], F.ALG_GRAPH[alg].links);
}
assert.deepEqual(OP_OF_SLOT, F.OP_OF_SLOT);
console.log(`voice conversions = patches.js on ${voices.length} patches; carriers and links = fmedit.js for the 8 algorithms`);

// 2. every FM sound of the library: get -> .spp -> save -> .spsound read by the app (soundfile.js readSoundFile)
let n = 0, junk = 0;
for (const c of allSounds().filter((x) => x.ins)) {
  const rec = soundRecord(c.key), text = writeSpp(rec);
  const back = parseSpp(text, c.key + '.spp');
  const json = sppToSound(back);
  const { sounds, skipped } = readSoundFile('x.spsound', json, 11300);
  assert.equal(skipped.length, 0);
  const app = sounds[0];
  assert.equal(app.type, c.type); assert.equal(app.p, c.p); assert.equal(app.gm, c.gm);
  assert.deepEqual(app.mac, c.mac, `${c.key}: macro`);
  assert.equal(app.ins.ops, c.ins.ops);
  assert.deepEqual(app.ins.regs.map(([r]) => r), c.ins.regs.map(([r]) => r), `${c.key}: register order`);
  app.ins.regs.forEach(([r, v], i) => {
    assert.equal(usedBits(r, v), usedBits(r, c.ins.regs[i][1]), `${c.key}: register ${r.toString(16)}`);
    if (v !== c.ins.regs[i][1]) junk++;
  });
  for (const p of [c.p, c.p + 12, c.p - 12]) assert.equal(maxDiff(renderPatch(app, p, { hold: 0.5, release: 0.3 }), renderPatch(c, p, { hold: 0.5, release: 0.3 })), 0, `${c.key}: sound at ${p}`);
  n++;
}
console.log(`${n} FM sounds of the library: get -> save -> app import: the chip's registers the same, the sound the same bit for bit at 3 notes (${junk} register values differ only in bits the chip ignores)`);

// 3. explain, for a human to judge
for (const k of ["Skitchin':f0", "Skitchin':f1", "Skitchin':f47", "Skitchin':d41", "Skitchin':d42"]) console.log('\n' + explainPatch(soundRecord(k)));

// 4. a .spp as a sound of a .sps: the song plays exactly that patch
const spp = outPath('test-organ.spp');
fs.writeFileSync(spp, 'patch "Test organ" alg 7 fb 0 ams 0 fms 0\n' + [1, 2, 3, 4].map((k) => `  op${k} mul ${k} dt 0 tl ${k === 1 ? 10 : 30} ar 31 dr 0 sl 0 sr 0 rr 8 ks 0 am 0 ssg 0`).join('\n') + '\nnote C4\n');
const sps = outPath('test-organ.sps');
fs.writeFileSync(sps, 'song "Organ test" bpm 120\nsound org = "test-organ.spp"\npattern a 1:\n  FM1 org : C4/4 E4/4 G4/8\n');
const json = serializeSong(buildSong(parseSps(fs.readFileSync(sps, 'utf8'), sps)));
assert.deepEqual(json.instruments[0].regs, parseSpp(fs.readFileSync(spp, 'utf8')).ins.regs);
assert.equal(json.layers[0].palette[0].lib, 'my:test-organ');
loadSongObject(json, 'x.json');
console.log('\na .sps with sound org = "test-organ.spp" builds; the song carries that patch (libUse my:test-organ)');

// 5. errors
for (const [t, want] of [['patch "x" alg 9', ':1:15: alg'], ['patch "x"\n  op1 tl 300', ':2:10: op1 tl'], ['patch "x"\n  op5 tl 3', ':2:3: unknown line'], ['patch "x"\n  op1 xx 3', 'unknown operator field'], ['patch "x"\n  op1 tl 3', 'operators missing: op2, op3, op4']]) {
  let e = null;
  try { parseSpp(t, 'bad.spp'); } catch (x) { e = x; }
  assert.ok(e && e.message.includes(want), `${t}: ${e?.message}`);
}
console.log('errors: 5 broken patches give line:column and the field');
console.log('section 5: OK');
