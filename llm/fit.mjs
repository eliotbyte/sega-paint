// fit: the numbers of a patch tuned to a target by search. The model picks the structure (algorithm, mul / dt,
// which operators to free); the search moves the free parameters (by default every TL and envelope) to lower the
// distance of compare (hear.mjs). A discrete pattern search: first each parameter alone across its range, then each
// a step up and down (with 2-3 parameters moved at once by random amounts on the threads left idle), the best move
// taken (and all good single moves together), the steps halved when nothing helps; at a local optimum a new scan,
// then jumps from the best point. The renders run in parallel on worker threads; it stops at the budget of renders,
// at the time limit, or when the sound is the same.
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { RATE, UserError, noteName } from './core.mjs';
import { renderPatch, soundRecord, carrierOps, SLOT_OF_OP, OPF, ALIAS, dtRaw, dtShown, ssgRaw, ssgShown } from './patch.mjs';
import { features, distance, isWav, loadTarget, prepareTarget, renderLike, closestHold, withHold, compareWords, doubtLine } from './hear.mjs';
import { summarize, noiseOf } from './analyze.mjs';

// ---------- the parameters: where each one lives in the registers (shown values, as in the .spp) ----------
const id = (x) => x;
const OPBITS = { // register base, mask, shift, shown <-> raw
  mul: [0x30, 0x0f, 0], dt: [0x30, 0x70, 4, dtShown, dtRaw], tl: [0x40, 0x7f, 0], ks: [0x50, 0xc0, 6], ar: [0x50, 0x1f, 0],
  am: [0x60, 0x80, 7], dr: [0x60, 0x1f, 0], sr: [0x70, 0x1f, 0], sl: [0x80, 0xf0, 4], rr: [0x80, 0x0f, 0], ssg: [0x90, 0x0f, 0, ssgShown, ssgRaw],
};
const CHBITS = { fb: [0xb0, 0x38, 3, 0, 7], ams: [0xb4, 0x30, 4, 0, 3], fms: [0xb4, 0x07, 0, 0, 7] };
const CHBITS_ALG = { reg: 0xb0, mask: 0x07, shift: 0, shown: id }; // alg (not free: the carriers)
export const ENV = ['ar', 'dr', 'sl', 'sr', 'rr'];
function param(name) {
  let m;
  if ((m = /^op([1-4])\.(\w+)$/.exec(name))) {
    const f = ALIAS[m[2]] || m[2], def = OPF.find(([n]) => n === f), b = OPBITS[f];
    if (!def) throw new UserError(`--free: "${name}": no field "${m[2]}" (${OPF.map(([n]) => n).join(' ')})`);
    return { name: `op${m[1]}.${f}`, field: f, op: +m[1], reg: b[0] + 4 * SLOT_OF_OP[+m[1] - 1], mask: b[1], shift: b[2], shown: b[3] || id, raw: b[4] || id, lo: def[1], hi: def[2] };
  }
  const b = CHBITS[name];
  return { name, field: name, op: 0, reg: b[0], mask: b[1], shift: b[2], shown: id, raw: id, lo: b[3], hi: b[4] };
}
// "op1.tl,op1.d1r,op3,tl,env,fb": op3 = its TL and envelope; tl / env / ar ... = that on all four operators
export function parseFree(spec = 'tl,env') {
  const names = [];
  for (const t0 of String(spec).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const t = ALIAS[t0] || t0;
    let m;
    if (t === 'alg') throw new UserError('--free: alg is the structure of the patch: choose it yourself in the .spp (sp patch explain), then fit the numbers');
    if (CHBITS[t]) names.push(t);
    else if (t === 'env') for (let k = 1; k <= 4; k++) names.push(...ENV.map((f) => `op${k}.${f}`));
    else if (OPBITS[t]) for (let k = 1; k <= 4; k++) names.push(`op${k}.${t}`);
    else if ((m = /^op([1-4])$/.exec(t))) names.push(...['tl', ...ENV].map((f) => `op${m[1]}.${f}`));
    else if (/^op[1-4]\.\w+$/.test(t)) names.push(t);
    else throw new UserError(`--free: "${t0}"? e.g. op1.tl,op3.dr,fb  or  tl,env  or  op2 (its TL and envelope)`);
  }
  const seen = new Set(), out = [];
  for (const n of names) { const p = param(n); if (!seen.has(p.name)) { seen.add(p.name); out.push(p); } }
  if (!out.length) throw new UserError('--free: nothing to fit');
  return out;
}
export function getParam(regs, P) {
  const r = regs.find(([x]) => x === P.reg);
  return P.shown(((r?.[1] ?? 0) & P.mask) >> P.shift);
}
export function setParam(regs, P, v) {
  const raw = (P.raw(v) << P.shift) & P.mask;
  let hit = false;
  const out = regs.map(([r, x]) => { if (r !== P.reg) return [r, x]; hit = true; return [r, (x & ~P.mask) | raw]; });
  if (!hit) out.push([P.reg, raw]);
  return out;
}
const withValues = (regs, params, vals) => params.reduce((r, P, i) => setParam(r, P, vals[i]), regs);
// semitones from the note played to the common fundamental of the four operators (mul 0 is x0.5)
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function mulShift(regs) {
  const g = [1, 2, 3, 4].map((k) => getParam(regs, param(`op${k}.mul`))).map((m) => (m ? 2 * m : 1)).reduce(gcd);
  return Math.round(12 * Math.log2(g / 2));
}

// ---------- one render scored (the same in a worker and here) ----------
// d: the distance; top: the level (dB); noise: the share of the energy off the harmonics (when a limit is set)
function scorer({ rec, hold, release, len, tf, noise }) {
  return ({ regs, p }) => {
    const x = renderPatch({ ...rec, ins: { ...rec.ins, regs } }, p, { hold, release });
    const F = features(x, len);
    return { d: distance(F, tf), top: F.top, noise: noise ? noiseOf(x) : 0 };
  };
}
if (!isMainThread && workerData?.fit) {
  const score = scorer(workerData.fit);
  parentPort.on('message', ({ id: n, job }) => parentPort.postMessage({ id: n, ...score(job) }));
}
// a pool of workers (or the main thread alone when threads = 1); run([{ regs, p }]) -> [{ d, top, noise }]
function pool(job, threads) {
  if (threads <= 1) { const score = scorer(job); return { run: async (all) => all.map(score), close: async () => {} }; }
  const ws = Array.from({ length: threads }, () => new Worker(new URL(import.meta.url), { workerData: { fit: job } }));
  const wait = new Map();
  let next = 0, failed = null;
  for (const w of ws) {
    w.on('message', (m) => { wait.get(m.id)(m); wait.delete(m.id); });
    w.on('error', (e) => { failed = e; for (const f of wait.values()) f(null); });
  }
  return {
    async run(all) {
      const res = await Promise.all(all.map((x, i) => new Promise((ok) => { const n = next++; wait.set(n, ok); ws[i % ws.length].postMessage({ id: n, job: x }); })));
      if (failed) throw failed;
      return res;
    },
    close: () => Promise.all(ws.map((w) => w.terminate())),
  };
}

// ---------- the search ----------
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// What the search lowers: the distance, plus
// - the level off the target's, when a carrier's TL is free: the chip's output is quantised (a 9-bit DAC), so a quiet
//   patch has more grain and a loud one clips: level is not quite out of the distance, and a search free to drift
//   in level ends where it is cheapest (it was found ~11 dB too loud), and matching it after costs distance. 0.015 a
//   dB over 1 dB: the carriers' TLs follow the target's level along the way.
// - noise over maxNoise (share of the energy off the harmonics), 2 a unit: a target with hiss (8-bit samples) made
//   the search turn patches into 90 % noise, though such targets measure 10-25 %. Default for an FM sound: the most
//   of 30 %, the start's noise + 5 % and the target's + 10 % (a cymbal target, all noise: no limit); none for a
//   drum. maxNoise 1 turns it off.
const LEVEL_W = 0.015, NOISE_W = 2;
// rec: the start patch; target: a WAV, a key, a .spp; opts: free (spec), budget (renders), time (s), note, hold, seed,
// threads, maxNoise (0..1; null: the default above)
export async function fit(rec, targetRef, { free = 'tl,env', budget = 2000, time = 60, note = null, hold = null, seed = 1, threads = 0, maxNoise = null, log = null } = {}) {
  const t0 = performance.now(), secs = () => (performance.now() - t0) / 1000;
  const params = parseFree(free);
  const tx = isWav(targetRef) ? loadTarget(targetRef) : (() => { const r = soundRecord(targetRef); return renderPatch(r, note ?? r.p, { hold: hold ?? 1, release: 0.6 }); })();
  // the target's key-up: --hold, else the one of those seen in it that suits the start patch best
  const T0 = prepareTarget(tx, { note, hold: isWav(targetRef) ? hold : hold ?? 1 }), T = withHold(T0, closestHold(rec, T0, note).hold);
  const { p: pc, x: x0 } = renderLike(rec, T, note);
  // the note to play. compare measures how far the patch sounds from the note it plays, but a spoilt patch can sound
  // an octave off; the operators' frequencies (mul) tell it from the structure: the patch sounds at their common
  // fundamental. The target's pitch and its octaves are tried at each local optimum. A drum or --note keeps its note.
  const fixed = note != null || rec.type === 'drums' || T.note == null;
  const p0 = fixed ? pc : T.note - mulShift(rec.ins.regs);
  const notes = fixed ? [p0] : [...new Set([p0, pc, T.note, T.note - 12, T.note + 12])].filter((q) => q >= 12 && q <= 108);
  const carT = params.map((P1, i) => [P1, i]).filter(([P1]) => P1.field === 'tl' && carrierOps(getParam(rec.ins.regs, CHBITS_ALG)).includes(P1.op));
  if (maxNoise == null) maxNoise = rec.type === 'drums' ? 1 : Math.max(0.3, noiseOf(x0) + 0.05, noiseOf(T.x) + 0.1);
  const job = { rec: { ...rec, ins: { ...rec.ins } }, hold: T.hold, release: x0.length / RATE - T.hold, len: T.x.length, tf: T.f, noise: maxNoise < 1 };
  const score = (r) => r.d + (carT.length ? LEVEL_W * Math.max(0, Math.abs(r.top - T.f.top) - 1) : 0) + NOISE_W * Math.max(0, r.noise - maxNoise);
  threads = threads || Math.max(1, Math.min(12, os.availableParallelism() - 1));
  const P = pool(job, threads);
  const cache = new Map(), key = (v, q) => q + ':' + v.join(',');
  let evals = 0, p = p0;
  const evalAll = async (list, q = p) => {
    const todo = [...new Map(list.filter((v) => !cache.has(key(v, q))).map((v) => [key(v, q), v])).values()].slice(0, Math.max(0, budget - evals));
    const res = await P.run(todo.map((v) => ({ regs: withValues(rec.ins.regs, params, v), p: q })));
    todo.forEach((v, i) => cache.set(key(v, q), res[i]));
    evals += todo.length;
    return list.map((v) => { const r = cache.get(key(v, q)); return r ? score(r) : Infinity; });
  };
  const bestNote = async (v) => { // [note, score] of a point at the best of the notes
    const ds = await Promise.all(notes.map((q) => evalAll([v], q).then(([d]) => d)));
    const k = ds.indexOf(Math.min(...ds));
    return [notes[k], ds[k]];
  };
  const clamp = (P1, v) => Math.max(P1.lo, Math.min(P1.hi, v));
  const start = params.map((P1) => getParam(rec.ins.regs, P1));
  const random = rng(seed);
  let cur = start, dCur;
  [p, dCur] = await bestNote(start); // from the note that suits the start best (compare's, the structure's, octaves)
  const dStart = cache.get(key(start, p)).d, path = [{ d: dStart, evals, t: secs() }];
  let best = cur, dBest = dCur, restarts = 0;
  const wide = (P1) => Math.max(1, Math.round((P1.hi - P1.lo) / 8));
  let steps = params.map(wide);
  const levels = Math.max(1, Math.min(4, Math.floor(3 * threads / (2 * params.length))));
  const done = () => evals >= budget || secs() >= time || dBest < 0.001; // < 0.001: the same sound
  // dBest / dCur: scores; the path: the distances of the best points
  const better = (d) => { if (d < dBest - 1e-9) { best = cur; dBest = d; const dd = cache.get(key(cur, p))?.d ?? d; path.push({ d: dd, evals, t: secs() }); log?.(`  ${dd.toFixed(3)} after ${evals} renders, ${secs().toFixed(1)} s`); } };
  try {
    let scan = true, scanned = null;
    while (!done()) {
      const nb = [], seen = new Set();
      const add = (i, n) => { const k = n.join(','); if (!seen.has(k)) { seen.add(k); nb.push([i, n]); } };
      if (scan) {
        // at the start and at a local optimum: each parameter alone across its whole range (9 values)
        params.forEach((P1, i) => { for (let j = 0; j <= 8; j++) { const v = Math.round(P1.lo + (P1.hi - P1.lo) * j / 8); if (v !== cur[i]) { const n = cur.slice(); n[i] = v; add(i, n); } } });
        scanned = key(cur, p); scan = false; steps = params.map(wide);
      } else {
        // each parameter a step up and down, and (to keep every thread busy when few are free) half and quarter steps
        params.forEach((P1, i) => {
          for (let l = 0, s = steps[i]; l < levels && s >= 1 && (l === 0 || s < steps[i]); l++, s >>= 1) for (const sg of [s, -s]) {
            const v = clamp(P1, cur[i] + sg);
            if (v !== cur[i]) { const n = cur.slice(); n[i] = v; add(i, n); }
          }
        });
      }
      // and, on the threads left idle by this round (at least a few), 2 or 3 parameters at once by random amounts,
      // small to large: a TL and a rate, a sustain level and its rate trade off, one alone does not get there
      const room = Math.max(nb.length + Math.ceil(threads / 2), Math.ceil(nb.length / threads) * threads);
      for (let k = 0; params.length > 1 && k < 8 * threads && nb.length < room; k++) {
        const n = cur.slice(), m = 2 + (params.length > 2 && random() < 0.4 ? 1 : 0);
        for (let c = 0; c < m; c++) {
          const i = Math.floor(random() * params.length), span = params[i].hi - params[i].lo;
          n[i] = clamp(params[i], n[i] + (random() < 0.5 ? -1 : 1) * Math.max(1, Math.round(Math.exp(random() * Math.log(span / 2)))));
        }
        if (n.some((v, i) => v !== cur[i])) add(-1, n);
      }
      const ds = await evalAll(nb.map(([, n]) => n));
      let bi = -1;
      ds.forEach((d, k) => { if (d < dCur - 1e-9 && (bi < 0 || d < ds[bi])) bi = k; });
      if (bi >= 0) {
        // every single parameter whose move helped, moved together (its better direction)
        const good = new Map();
        ds.forEach((d, k) => { const i = nb[k][0]; if (i >= 0 && d < dCur - 1e-9 && (!good.has(i) || d < good.get(i)[0])) good.set(i, [d, nb[k][1][i]]); });
        let nx = nb[bi][1], dn = ds[bi];
        if (good.size > 1 && !done()) {
          const all = cur.slice();
          for (const [i, [, v]] of good) all[i] = v;
          const [da] = await evalAll([all]);
          if (da < dn) { nx = all; dn = da; }
        }
        cur = nx; dCur = dn;
        better(dCur);
      } else if (steps.some((s) => s > 1)) steps = steps.map((s) => Math.max(1, s >> 1));
      else {
        // a local optimum: done if it is the same sound; else check the note, jump from the best point, search again
        if (dBest < 0.005) break;
        if (notes.length > 1) {
          const [q, d] = await bestNote(best);
          if (q !== p && d < dBest - 1e-9) { log?.(`  plays at ${noteName(q)} now`); p = q; cur = best; better(d); }
        }
        if (scanned !== key(best, p)) { cur = best.slice(); dCur = dBest; scan = true; continue; } // a scan from here first
        restarts++;
        cur = best.slice();
        const k = 1 + Math.floor(random() * Math.min(3, params.length));
        for (let j = 0; j < k; j++) { const i = Math.floor(random() * params.length), r = Math.max(2, Math.round((params[i].hi - params[i].lo) / 4)); cur[i] = clamp(params[i], cur[i] + Math.round((random() * 2 - 1) * r)); }
        [dCur] = await evalAll([cur]);
        better(dCur);
        steps = params.map((P1) => Math.max(1, wide(P1) >> 1));
      }
    }
    // the level, last: the carriers' TLs moved together onto the target's (a TL step is 0.75 dB; the chip's grain and
    // clipping make it a little less, hence a few tries) while that keeps the score
    const lvl = () => cache.get(key(best, p)).top - T.f.top, from = lvl();
    for (let k = 0; k < 3 && carT.length; k++) {
      const shift = Math.round(lvl() / 0.75);
      if (Math.abs(shift) < 2) break;
      const lv = best.slice();
      for (const [P1, i] of carT) lv[i] = clamp(P1, lv[i] + shift);
      budget = Math.max(budget, evals + 1);
      const [dl] = await evalAll([lv]);
      if (!(dl <= dBest + 0.005)) break;
      best = lv; dBest = dl; path.push({ d: cache.get(key(lv, p)).d, evals, t: secs() });
    }
    const level = Math.abs(lvl() - from) > 0.5 ? { from, to: lvl() } : null;
    const regs = withValues(rec.ins.regs, params, best);
    // the result at each key-up seen in the target, as compare plays it: the closest one counts
    const fin = closestHold({ ...rec, ins: { ...rec.ins, regs } }, T0, p), T1 = withHold(T0, fin.hold);
    if (fin.d < path[path.length - 1].d - 1e-9) path.push({ d: fin.d, evals, t: secs() });
    const words = compareWords(summarize(fin.x, { hold: T1.hold }), T1.sum, features(fin.x, T1.x.length).top - T1.f.top);
    const moved = params.map((P1, i) => ({ name: P1.name, from: start[i], to: best[i] })).filter((m) => m.from !== m.to);
    return { rec: { ...rec, ins: { ...rec.ins, regs }, key: undefined, file: undefined }, p, p0, dStart, d: fin.d, path, moved, evals, restarts, secs: secs(), threads, params, level, words, maxNoise, noise: maxNoise < 1 ? noiseOf(fin.x) : null, doubt: isWav(targetRef) ? doubtLine(T0) : null };
  } finally { await P.close(); }
}

// the path in a few lines
export function formatFit(r, targetRef) {
  const o = [];
  if (r.doubt) o.push(`note: ${r.doubt}`);
  const way = r.path.length <= 8 ? r.path : [...r.path.slice(0, 4), ...r.path.slice(-4)];
  o.push(`fit "${r.rec.name}" to ${targetRef} at ${noteName(r.p)}${r.p !== r.p0 ? ` (not ${noteName(r.p0)}: this octave fits)` : ''}: ${r.params.length} free (${r.params.map((x) => x.name).join(' ')})`);
  o.push(`distance ${r.dStart.toFixed(3)} → ${r.d.toFixed(3)}${r.d < 0.05 ? ' (the same sound)' : r.d < 0.3 ? ' (close)' : r.d < 0.8 ? ' (related)' : ' (still different)'}` +
    `  [${r.evals} renders, ${r.restarts} restarts, ${r.secs.toFixed(1)} s on ${r.threads} threads]`);
  o.push(`  path: ${way.map((x) => x.d.toFixed(3)).join(' → ')}`);
  o.push(r.moved.length ? `  moved: ${r.moved.map((m) => `${m.name} ${m.from}→${m.to}`).join(', ')}` : '  moved: nothing (the start is the best found)');
  if (r.level) o.push(`  level matched with the carriers' TL: ${r.level.from > 0 ? '+' : ''}${r.level.from.toFixed(1)} → ${r.level.to > 0 ? '+' : ''}${r.level.to.toFixed(1)} dB`);
  if (r.noise != null) o.push(`  noise: ${Math.round(r.noise * 100)}% off the harmonics (kept under ${Math.round(r.maxNoise * 100)}%; --max-noise sets it, 1 = no limit)`);
  if (r.words.length) o.push('  still differs: ' + r.words.join('; '));
  return o.join('\n');
}
