// Section 7 checks: the parameters fit moves are the .spp fields (read and written in the registers as the .spp
// does); a library patch with 5 TL / envelope numbers spoiled comes back to a distance near zero within a minute,
// from the library key and from a WAV of it; the structure (alg) cannot be freed.
// usage: node llm/tests/s7-fit.mjs
import fs from 'node:fs'; import assert from 'node:assert/strict';
import { allSounds, outPath } from '../core.mjs';
import { soundRecord, renderPatch, regsToVoice, SLOT_OF_OP, writeSpp, parseSpp } from '../patch.mjs';
import { writeMono, compare } from '../hear.mjs';
import { fit, formatFit, parseFree, getParam, setParam, ENV } from '../fit.mjs';

// 1. getParam / setParam = the fields of regsToVoice, on every FM sound of the library
const all = parseFree('tl,env,mul,dt,ks,am,ssg,fb,ams,fms');
assert.equal(all.length, 4 * 11 + 3);
for (const c of allSounds().filter((x) => x.ins)) {
  const regs = c.ins.regs, v = regsToVoice(regs);
  for (const P of all) {
    const val = getParam(regs, P);
    if (P.op) { const o = v.ops[SLOT_OF_OP[P.op - 1]], spp = parseSpp(writeSpp(soundRecord(c.key))); assert.equal(getParam(spp.ins.regs, P), val, `${c.key} ${P.name}`); assert.ok(val >= P.lo && val <= P.hi); if (P.field === 'tl') assert.equal(val, o.tl); }
    else assert.equal(val, v[P.field], `${c.key} ${P.name}`);
    // set to another value and back: only that field changes
    const other = val === P.hi ? P.lo : val + 1, r2 = setParam(regs, P, other);
    assert.equal(getParam(r2, P), other);
    for (const Q of all) if (Q !== P) assert.equal(getParam(r2, Q), getParam(regs, Q), `${P.name} moved ${Q.name}`);
    if (P.field !== 'dt' && P.field !== 'ssg') assert.deepEqual(setParam(r2, P, val), regs); // (dt -0 and ssg off-bits are shown as 0)
  }
}
assert.deepEqual(parseFree('op1.d1r,op3,fb').map((P) => P.name), ['op1.dr', 'op3.tl', ...ENV.map((f) => 'op3.' + f), 'fb']);
assert.equal(parseFree().length, 24);
assert.throws(() => parseFree('alg'), /structure/);
assert.throws(() => parseFree('op5.tl'), /--free/);
console.log(`getParam / setParam: ${all.length} fields on every library FM sound, each moves only itself; --free parsed`);

// 2. spoil 5 TL / envelope numbers, fit them back
let rnd = 11;
const R = (n) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
const cases = [["Skitchin':f1", 'key'], ["Skitchin':f0", 'wav'], ["Skitchin':f47", 'key'], ["Skitchin':d41", 'wav']];
for (const [key, how] of cases) {
  const rec = soundRecord(key), free = parseFree('tl,env');
  let target = key, pick, regs, f0;
  if (how === 'wav') { target = outPath(`fit-target-${key.replace(/[^a-z0-9]/gi, '_')}.wav`); writeMono(target, renderPatch(rec, rec.p, { hold: 1, release: 0.6 })); }
  do { // 5 numbers spoilt so that it is heard (compare: distance over 0.15)
    pick = [];
    while (pick.length < 5) { const P = free[R(free.length)]; if (!pick.includes(P)) pick.push(P); }
    regs = rec.ins.regs;
    for (const P of pick) { const v = getParam(regs, P), span = P.hi - P.lo; let w; do w = P.lo + R(span + 1); while (Math.abs(w - v) < span / 4); regs = setParam(regs, P, w); }
    f0 = outPath(`fit-spoilt-${key.replace(/[^a-z0-9]/gi, '_')}.spp`);
    fs.writeFileSync(f0, writeSpp({ ...rec, ins: { ...rec.ins, regs }, name: rec.name + ' spoilt' }));
  } while (compare(f0, target).d < 0.15);
  const bad = soundRecord(f0);
  const r = await fit(bad, target, { free: pick.map((P) => P.name).join(','), time: 60 });
  console.log('\n' + formatFit(r, target) + `\n  spoilt: ${pick.map((P) => `${P.name} ${getParam(rec.ins.regs, P)}→${getParam(regs, P)}`).join(', ')}`);
  assert.ok(r.d < 0.05, `${key}: fit ended at ${r.d}`);
  assert.ok(r.secs < 75, `${key}: ${r.secs} s`);
  // the result saved as .spp gives the same distance in compare
  const f = outPath(`fit-${key.replace(/[^a-z0-9]/gi, '_')}.spp`);
  fs.writeFileSync(f, writeSpp(r.rec));
  const c = compare(f, target);
  assert.ok(Math.abs(c.d - r.d) < 0.01, `compare ${c.d} vs fit ${r.d}`);
}
console.log('\nsection 7: OK');
