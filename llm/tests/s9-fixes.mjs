// Fixes after the first composing agents: a BOM before a .sps / .spp, the pitch of chord samples (and a doubt when
// it is unclear), fit kept off noise and on the target's level, listen of bars after a render that starts between
// two samples, hear --out, build on a song without a loop point, sp sounds showing a patch that sounds off its note.
// usage: node llm/tests/s9-fixes.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT, SONGS, RATE, outPath, loadSongFile, noteName } from '../core.mjs';
import { parseSps, buildFile } from '../sps.mjs';
import { parseSpp, soundRecord, renderPatch, carrierOps } from '../patch.mjs';
import { writeMono, loadTarget, pitchOfWav, features } from '../hear.mjs';
import { fit, parseFree, getParam, setParam } from '../fit.mjs';
import { listen } from '../listen.mjs';
import { listSounds } from '../sounds.mjs';

const SP = path.join(ROOT, 'llm', 'sp.mjs');
const sp = (...a) => execFileSync(process.execPath, [SP, ...a], { encoding: 'utf8' });
const BOM = String.fromCharCode(0xfeff);

// 1. a BOM (Notepad's "UTF-8 with BOM") before a .sps and a .spp is not text
const ex = path.join(ROOT, 'llm', 'examples');
const spsText = fs.readFileSync(path.join(ex, 'neon-alley.sps'), 'utf8');
assert.deepEqual(parseSps(BOM + spsText, 'x.sps').title, parseSps(spsText, 'x.sps').title);
const sppText = fs.readFileSync(path.join(ex, 'soft-pad.spp'), 'utf8');
assert.deepEqual(parseSpp(BOM + sppText).ins.regs, parseSpp(sppText).ins.regs);
const bomSps = outPath('s9-bom.sps');
fs.writeFileSync(bomSps, BOM + spsText);
assert.deepEqual(buildFile(bomSps), buildFile(path.join(ex, 'neon-alley.sps')));
console.log('a BOM before a .sps / .spp: read as without it');

// 2. pitch: a power chord (root and fifth repeat together an octave under the root) is read at its root; a triad
// (4:5:6: a common period two octaves under, where nothing sounds) and a noisy sound get a doubt; an FM sound none
const tone = (hzs, sec = 1, noise = 0) => {
  const x = new Float32Array(Math.round(sec * RATE));
  let s = 7, last = 0;
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (const f of hzs) for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * i / RATE) / h;
    s = (s * 1103515245 + 12345) % 2147483648;
    const r = s / 1073741824 - 1;
    x[i] = 0.1 * v + noise * (r - last); // hiss: white noise differentiated (its energy high up, as an 8-bit sample's)
    last = r;
  }
  return x;
};
const wavOf = (name, x) => { const f = outPath(`s9-${name}.wav`); writeMono(f, x); return loadTarget(f); };
const G2 = 98, A3 = 220;
const power = pitchOfWav(wavOf('power', tone([G2, G2 * 1.5]))), triad = pitchOfWav(wavOf('triad', tone([A3, A3 * 1.25, A3 * 1.5])));
const hiss = pitchOfWav(wavOf('hiss', tone([A3], 1, 0.16)));
const lead = soundRecord("Skitchin':f1"), pl = pitchOfWav(wavOf('lead', renderPatch(lead, lead.p, { hold: 1, release: 0.3 })));
console.log(`power chord on G2: ${noteName(power.note)}${power.doubt ? ' (' + power.doubt + ')' : ''}; triad A3 C#4 E4: ${noteName(triad.note)}, ${triad.doubt}; ` +
  `A3 in hiss: ${noteName(hiss.note)}, ${hiss.doubt}; FM lead: ${noteName(pl.note)}, ${pl.doubt ?? 'sure'}`);
assert.equal(noteName(power.note), 'G2');
assert.ok(triad.doubt && /chord/.test(triad.doubt));
assert.ok(hiss.doubt && /noise/.test(hiss.doubt));
assert.equal(pl.note, lead.p); assert.equal(pl.doubt, null);
const words = sp('compare', "Skitchin':f1", outPath('s9-triad.wav'));
assert.ok(/is a guess.*--note/.test(words), words);

// 3. fit to a hissy target stays harmonic (the default limit); 4. fit matches the level when the carriers' TLs are
// free: the lead with its carriers 12 dB down (TL +16), fitted to itself
const r3 = await fit(lead, outPath('s9-hiss.wav'), { time: 20, note: 57 });
console.log(`fit to A3 in hiss: noise ${Math.round(r3.noise * 100)}% (limit ${Math.round(r3.maxNoise * 100)}%), distance ${r3.d.toFixed(3)}`);
assert.ok(r3.noise <= r3.maxNoise + 0.05, `fit went noisy: ${r3.noise}`);
const target = outPath('s9-lead.wav');
let regs = lead.ins.regs;
const alg = getParam(regs, { reg: 0xb0, mask: 7, shift: 0, shown: (v) => v });
const car = carrierOps(alg).map((k) => parseFree(`op${k}.tl`)[0]);
for (const P of car) regs = setParam(regs, P, Math.min(127, getParam(regs, P) + 16));
const quiet = { ...lead, ins: { ...lead.ins, regs } };
const r4 = await fit(quiet, target, { free: car.map((P) => P.name).join(','), time: 20 });
const lv = features(renderPatch(r4.rec, lead.p, { hold: 1, release: 0.3 })).top - features(loadTarget(target)).top;
console.log(`level: the quiet lead fitted back, ${lv.toFixed(1)} dB off the target (distance ${r4.d.toFixed(3)})`);
assert.ok(Math.abs(lv) < 1.5, `level ${lv} dB off`);

// 5. listen of bars 17-20 of a song whose render starts between two samples: every bar sounds
const jc = loadSongFile(path.join(SONGS, 'jerky-curtains', 'song.json'));
const rep = listen(jc, { bars: [17, 20] });
const rms = /rms\s+([-\d\s]+)dBFS/.exec(rep)[1].trim().split(/\s+/).map(Number);
console.log(`jerky-curtains bars 17-20 rms: ${rms.join(' ')} dB`);
assert.ok(rms.every((v) => v > -60) && !/NaN/.test(rep), rep);

// 6. hear --out: a file, a file for several notes, a folder
const dir = outPath('s9-out');
fs.rmSync(dir, { recursive: true, force: true });
sp('hear', outPath('s9-lead.wav'), '--png', '--out', path.join(dir, 'lead.png'));
sp('hear', path.join(ex, 'soft-pad.spp'), '--notes', 'C3,C4', '--png', '--out', path.join(dir, 'pad.png'));
sp('hear', path.join(ex, 'soft-pad.spp'), '--notes', 'C4', '--wav', '--out', path.join(dir, 'sub') + '/');
for (const f of ['lead.png', 'pad-C3.png', 'pad-C4.png', 'sub/soft-pad-C4.wav']) assert.ok(fs.existsSync(path.join(dir, f)), f);
console.log('hear --out: a file, a file per note, a folder');

// 7. build on "loop off": no loop point (every Sega Paint song repeats from the start)
const nl = outPath('s9-noloop.sps');
fs.writeFileSync(nl, 'song "No loop"  bpm 120  4/4  grid 16\nbase skitchin\nsound s = "Skitchin\':f0"\npattern a 1:\n  FM1 s : C2/4\nloop off\n');
const b = sp('build', nl);
assert.ok(/no loop point/.test(b) && JSON.parse(fs.readFileSync(nl.replace(/\.sps$/, '.json'), 'utf8')).loopStart === -1, b);

// 8. sp sounds: the bass sounds an octave under its written note
const bass = listSounds({ kind: 'fm' }).find((r) => r[0] === "Skitchin':f0");
assert.ok(/an octave lower/.test(bass[4]), bass[4]);
console.log(`sp sounds: ${bass[0]} ${bass[4]}`);
console.log('section 9: OK');
