// song.json -> .sps: repeats folded into patterns, everything the plain notation cannot say kept as exact
// attributes ({d=9625,m=4}) and an exact: block, so that sp build gives back the same chip writes.
// A song made in Sega Paint from the library's sounds on its even grid comes out without exact: (plain mode).
import path from 'node:path';
import { prepareSong, buildTimeline, stepTime, timeToStep } from '../player/engine/song.js';
import {
  SONGS, readJson, fetchRef, baseRef, loadSongObject, loadSongFile, catOf, allSounds, voiceOf, noteName, barOffset,
  soundName, STEPS_PER_BAR, fail,
} from './core.mjs';
import { parseSps, buildSong, serializeSong } from './sps.mjs';

const BS = STEPS_PER_BAR;
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10000) / 10000)); // a length
const most = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); let b = null, n = 0; for (const [k, v] of c) if (v > n) { b = k; n = v; } return b; };
const slug = (t) => (t || 'snd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's$1').slice(0, 16) || 'snd';
const ATTR_ORDER = ['vol', 'pan', 'slide', 'm', 'i', 'gm', 'smp', 'n', 'd', 'md', 'p', 's', 'S'];
const LANE_VOICES = (L) => L.kind === 'noise' || L.kit || (L.kind === 'sample' && (L.voice ?? 3) !== 3);

// Where a song file comes from: an example of player/songs (with its meta.json, as the app opens it) or any file.
function source(file) {
  const rel = path.relative(SONGS, path.resolve(file)).split(path.sep);
  const dir = rel.length === 2 && rel[1] === 'song.json' && !rel[0].startsWith('..') ? rel[0] : null;
  if (dir) return { raw: fetchRef(dir), base: dir };
  const raw = readJson(file);
  if (!Array.isArray(raw.layers) || !raw.stepTimes) fail(`${file}: not a Sega Paint song (no layers / stepTimes)`);
  return { raw, base: raw.base || baseRef() };
}

// The sounds of the notes. plain: library keys (the song must use them unchanged), else song:i3/m40 etc.
function soundsOf(song, plain) {
  const lines = new Map(); // layer index -> note -> { key, ref }
  const defs = new Map(); // ref -> { name, ref }
  const names = new Set();
  const nameFor = (want) => { let n = slug(want), k = 2; while (names.has(n)) n = slug(want).slice(0, 13) + '_' + k++; names.add(n); return n; };
  const lib = allSounds();
  const same = (a, b) => { const j = (x) => JSON.stringify(x, (k, v) => (k === 'pitch' ? undefined : v)); return j(a) === j(b); }; // pitch: prepareSong's
  song.layers.forEach((L, li) => {
    if (L.kind === 'dac') return;
    const groups = new Map();
    for (const n of L.notes) {
      let key;
      if (L.kind === 'sample') key = 's' + n.smp;
      else if (n.gm != null) key = `g${n.gm}/i${n.i}`;
      else if (L.kind === 'fm') key = 'i' + n.i;
      else key = 'psg';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    const map = new Map();
    for (const [key, ns] of groups) {
      const m = most(ns.map((n) => n.m)), p = most(ns.map((n) => n.p));
      let ref, name, defP = null;
      if (plain) {
        // the library sound this is: song.libUse points at its instrument / macro, and they are unchanged
        let c = null;
        if (L.kind === 'sample') {
          const x = song.samples?.[ns[0].smp];
          c = x?.cat && !x.pcm && lib.find((y) => y.key === x.cat && y.type === 'samples');
        } else {
          const k = Object.entries(song.libUse || {}).find(([, u]) => u.m === m && (u.i ?? null) === (ns[0].i ?? null))?.[0];
          c = k && lib.find((y) => y.key === k && y.type !== 'samples');
          if (c && (!same(c.mac, song.macros[m]) || (c.ins && !same(c.ins, song.instruments[ns[0].i])) || ns.some((n) => n.m !== m || n.i !== ns[0].i))) c = null;
          if (c && c.gm != null && (c.gm !== ns[0].gm || ns.some((n) => n.p !== c.p))) c = null;
        }
        if (!c) { lines.set(li, null); return; }
        ref = c.key; name = soundName(c);
      } else {
        if (L.kind === 'sample') { ref = 'song:s' + ns[0].smp; name = song.samples?.[ns[0].smp]?.name || 'sample'; }
        else if (key === 'psg') { ref = 'song:m' + m; name = L.kind === 'noise' ? 'noise' : (L.name || 'psg'); }
        else {
          const i = ns[0].i;
          ref = (ns[0].gm != null ? `song:g${ns[0].gm}/` : 'song:') + `i${i}/m${m}`;
          const patch = catOf('fm').find((c) => same(c.ins?.regs, song.instruments[i]?.regs));
          name = ns[0].gm != null ? `drum${ns[0].gm}` : patch ? patch.name : `${L.name || voiceOf(L)} ${i}`;
        }
        if (LANE_VOICES(L) || ns[0].gm != null) { defP = p; ref += ',p=' + p; }
      }
      if (!defs.has(ref)) defs.set(ref, { name: nameFor(name), ref, comment: plain ? '' : name });
      map.set(key, { name: defs.get(ref).name, m, defP, ref });
    }
    if (lines.has(li)) return;
    lines.set(li, { groups: map, keyOf: (n) => (L.kind === 'sample' ? 's' + n.smp : n.gm != null ? `g${n.gm}/i${n.i}` : L.kind === 'fm' ? 'i' + n.i : 'psg') });
  });
  for (const v of lines.values()) if (!v) return null;
  return { lines, defs };
}

export function importSong(file, { plain = 'auto' } = {}) {
  const { raw, base } = source(file);
  const song = prepareSong(structuredClone(raw)); // macro pitches
  const off = barOffset(song);
  const ref = fetchRef(base);
  const uniform = !!song.uniform && song.step0 === 0 && song.stepTimes.every((t, i) => t === Math.round(i * song.step * 10) / 10)
    && JSON.stringify(song.globals) === JSON.stringify(ref.globals.filter((x) => x[0] <= 1).map((x) => [0, x[1], x[2], x[3]]))
    && !song.layers.some((L) => L.kind === 'dac') && off === 0;
  const tries = plain === 'auto' ? (uniform ? [true, false] : [false]) : [plain];
  const want = timeline(raw, file);
  for (const p of tries) {
    const text = write(song, raw, base, p, off);
    if (!text) continue;
    let got = null;
    try { got = timeline(serializeSong(buildSong(parseSps(text, 'import.sps'))), null); } catch (e) { if (!p) throw e; }
    if (got && sameTimeline(want, got)) return { text, plain: p };
    if (!p) fail(`${file}: the imported .sps does not give back the same timeline (a bug of sp import)`);
  }
  fail(`${file}: cannot import`);
}
const timeline = (json, file) => { const doc = file ? loadSongFile(file) : loadSongObject(json, 'built.json'); return buildTimeline(doc.song, doc.pcm); };
export function sameTimeline(a, b) {
  if (a.n !== b.n || a.end !== b.end || a.loopStart !== b.loopStart) return false;
  for (let i = 0; i < a.n; i++) if (a.t[i] !== b.t[i] || a.k[i] !== b.k[i] || a.r[i] !== b.r[i] || a.v[i] !== b.v[i]) return false;
  return true;
}

function write(song, raw, base, plain, off) {
  const snd = soundsOf(song, plain);
  if (!snd) return null;
  const endStep = timeToStep(song, song.end) - off;
  let maxS = 0;
  for (const L of song.layers) for (const n of L.notes) if (L.kind !== 'dac') maxS = Math.max(maxS, n.s - off);
  const nBars = Math.max(1, plain ? Math.round(endStep / BS) : Math.ceil(endStep / BS - 1e-6), Math.floor(maxS / BS + 1e-9) + 1);
  if (plain && (Math.abs(endStep - nBars * BS) > 1e-6)) return null;
  // notes by bar, with their line (sound and tie lane: notes of one voice at one step keep their order)
  const byBar = Array.from({ length: nBars }, () => []);
  song.layers.forEach((L, li) => {
    if (L.kind === 'dac') return;
    const lane = new Map(), info = snd.lines.get(li);
    L.notes.forEach((n, ni) => {
      const k = lane.get(n.s) || 0;
      lane.set(n.s, k + 1);
      const g = info.groups.get(info.keyOf(n));
      byBar[Math.floor((n.s - off) / BS + 1e-9)].push({ L, li, n, g, lane: k, order: ni });
    });
  });
  const stepDur = song.step;
  const drumD = Math.round(song.step * 2); // a library drum's length in a plain song (app.js libSound d)

  // a block of bars as pattern lines; transp: semitones taken off the pitched notes (to compare with another block)
  function render(b, B, transp = 0) {
    const S0 = off + b * BS, notes = [];
    for (let k = b; k < b + B; k++) notes.push(...byBar[k]);
    // vol / pan the same on every note of a voice here: one line (FM1 vol 12) instead of an attribute on each
    const common = new Map();
    for (const x of notes) {
      const v = voiceOf(x.L), c = common.get(v) || { vol: x.n.vol, pan: x.n.pan };
      if (c.vol !== x.n.vol) c.vol = undefined;
      if (c.pan !== x.n.pan) c.pan = undefined;
      common.set(v, c);
    }
    const lines = new Map();
    for (const x of notes) {
      const key = `${String(x.li).padStart(2, '0')}|${x.lane}|${x.g.name}`;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(x);
    }
    const out = [];
    for (const key of [...lines.keys()].sort((a, c) => { const [la, na] = a.split('|'), [lc, nc] = c.split('|'); return na - nc || la.localeCompare(lc); })) {
      const xs = lines.get(key).sort((a, c) => a.n.s - c.n.s || a.order - c.order);
      const { L, g } = xs[0];
      const lane = LANE_VOICES(L), toks = [];
      let k = 0; // the builder's position in steps (grid 16), followed float for float
      const rest = (len) => { if (len > 1e-9) { toks.push({ rest: len, at: k }); k += +fmt(len); } };
      xs.forEach((x, j) => {
        const n = x.n, r = n.s - S0;
        const drum = lane || n.gm != null;
        let gap = r - k;
        if (gap > 1e-9 && Number.isInteger(r) && Number.isInteger(k)) rest(gap);
        else if (gap > 1e-9) rest(Math.floor(gap * 10000) / 10000);
        const attrs = {};
        if (S0 + k !== n.s) { if (S0 + r === n.s) attrs.s = r; else attrs.S = n.s; k = r; }
        const next = j + 1 < xs.length ? xs[j + 1].n.s - S0 : B * BS;
        const avail = next - k;
        // length: the one whose regular d is the note's (then no d attribute)
        const dOf = (len) => (drum && plain ? drumD : Math.round(stepTime(song, n.s + len) - stepTime(song, n.s)));
        let len = 0;
        if (drum) len = 1;
        else for (let L2 = 1; L2 <= Math.max(1, Math.floor(avail + 1e-9)); L2++) if (dOf(L2) === n.d) { len = L2; break; }
        if (!len) len = Math.max(1, Math.min(Math.floor(avail + 1e-9) || 1, Math.round(n.d / stepDur) || 1));
        if (avail < 1 - 1e-9 && avail > 1e-9) len = +fmt(avail);
        if (dOf(len) !== n.d) attrs.d = n.d;
        for (const a of ['vol', 'pan', 'slide']) if (n[a] != null && common.get(voiceOf(L))[a] == null) attrs[a] = n[a];
        if (n.n) attrs.n = n.n;
        if (n.md != null && n.md !== n.d) attrs.md = n.md;
        if (!plain) {
          if (L.kind !== 'sample' && n.m !== g.m) attrs.m = n.m;
          if (L.kind !== 'sample' && L.kind !== 'fm' && n.i != null) attrs.i = n.i;
          if (drum && n.p !== g.defP) attrs.p = n.p;
        }
        const pitch = drum ? 'x' : noteName(n.p - transp);
        toks.push({ pitch, len, attrs, drum, at: k });
        k += len;
      });
      // text: hits and one-step rests of drum lines as x... strings, the rest as tokens; | between bars
      const words = [];
      let run = '', runAt = 0, bar = 0; // a drum string, spaced at the beats
      const flush = () => { if (run) { words.push([...run].map((c, j) => ((runAt + j) % 4 === 0 && j ? ' ' : '') + c).join('')); run = ''; } };
      const barLine = (at) => { const b = Math.floor(at / BS + 1e-9); if (b > bar) { flush(); words.push('|'); bar = b; } };
      const add = (t, c) => { for (let j = 0; j < c.length; j++) { barLine(t.at + j); if (!run) runAt = t.at + j; run += c[j]; } };
      for (const t of toks) {
        const at = t.rest != null ? '' : Object.keys(t.attrs).sort((a, c) => ATTR_ORDER.indexOf(a) - ATTR_ORDER.indexOf(c)).map((a) => `${a}=${t.attrs[a]}`).join(',');
        if (t.rest != null) {
          if (lane && Number.isInteger(t.rest) && Number.isInteger(t.at)) { add(t, '.'.repeat(t.rest)); continue; }
          barLine(t.at); flush(); words.push(t.rest === 1 ? '-' : `-/${fmt(t.rest)}`); continue;
        }
        if (t.drum && t.len === 1 && !at && Number.isInteger(t.at)) { add(t, 'x'); continue; }
        barLine(t.at); flush();
        words.push(`${t.pitch}${t.len === 1 ? '' : '/' + fmt(t.len)}${at ? `{${at}}` : ''}`);
      }
      flush();
      // a drum string of one character reads as a note: write it as a token
      const body = words.map((w) => (/^[x.]$/.test(w) ? (w === 'x' ? 'x' : '-') : w)).join(' ');
      out.push(`  ${voiceOf(L).padEnd(5)} ${g.name.padEnd(8)}: ${body}`);
    }
    for (const [v, c] of common) for (const a of ['vol', 'pan']) if (c[a] != null) out.push(`  ${v.padEnd(5)} ${a} ${c[a]}`);
    return out.join('\n');
  }

  // patterns: a bar that comes back (as it is or transposed) is a pattern of its own; bars that never come back go
  // together, up to 4 at a time. Then sections: runs of patterns that come back.
  const sigs = new Map();
  const sig = (b, B) => { const k = b + ':' + B; if (!sigs.has(k)) sigs.set(k, render(b, B)); return sigs.get(k); };
  const firstPitch = (b, B) => { for (let k = b; k < b + B; k++) for (const x of byBar[k]) if (!LANE_VOICES(x.L) && x.n.gm == null) return x.n.p; return null; };
  const transposed = (b, c) => { // bar b = bar c moved by k semitones? -> k
    const f = firstPitch(b, 1), g = firstPitch(c, 1);
    return f != null && g != null && f !== g && render(b, 1, f - g) === sig(c, 1) ? f - g : null;
  };
  const recurs = (b) => { for (let c = 0; c < nBars; c++) if (c !== b && (sig(c, 1) === sig(b, 1) || transposed(b, c) != null)) return true; return false; };
  const blocks = [];
  for (let i = 0; i < nBars;) {
    let B = 1;
    if (!recurs(i)) while (B < 4 && i + B < nBars && !recurs(i + B)) B++;
    blocks.push({ b: i, B });
    i += B;
  }
  const pats = [];
  const letters = (k) => (k < 26 ? String.fromCharCode(97 + k) : 'p' + (k + 1));
  const toks = [];
  for (const x of blocks) {
    const text = sig(x.b, x.B);
    let p = pats.find((y) => y.B === x.B && y.text === text), transp = 0;
    if (!p && x.B === 1) for (const y of pats) { const k = y.B === 1 ? transposed(x.b, y.b) : null; if (k != null) { p = y; transp = k; break; } }
    if (!p) { p = { name: letters(pats.length), B: x.B, b: x.b, text }; pats.push(p); }
    toks.push({ id: p.name + (transp ? (transp > 0 ? ' +' : ' ') + transp : ''), p, transp, bars: x.B });
  }
  // sections: the run of patterns (2 or more) that comes back most, again and again; then the next one
  const secs = [];
  let seq = toks.map((t) => ({ ...t }));
  for (let round = 0; round < 12; round++) {
    let best = null;
    for (let len = Math.min(16, seq.length >> 1); len >= 2; len--) {
      for (let i = 0; i + len <= seq.length; i++) {
        if (seq.slice(i, i + len).some((t) => t.sec)) continue;
        const key = seq.slice(i, i + len).map((t) => t.id).join(',');
        let occ = 0;
        for (let j = 0; j + len <= seq.length;) { if (seq.slice(j, j + len).map((t) => t.id).join(',') === key) { occ++; j += len; } else j++; }
        const bars = seq.slice(i, i + len).reduce((a, t) => a + t.bars, 0);
        const score = (occ - 1) * bars;
        if (occ >= 2 && bars >= 2 && (!best || score > best.score)) best = { key, len, items: seq.slice(i, i + len), score };
      }
    }
    if (!best) break;
    const name = String.fromCharCode(65 + secs.length);
    secs.push({ name, items: best.items });
    const next = [];
    for (let j = 0; j < seq.length;) {
      if (j + best.len <= seq.length && seq.slice(j, j + best.len).map((t) => t.id).join(',') === best.key) { next.push({ id: name, sec: true, bars: best.items.reduce((a, t) => a + t.bars, 0) }); j += best.len; } else next.push(seq[j++]);
    }
    seq = next;
  }
  const listOf = (items) => { // a b b b -> a, b x3
    const out = [];
    for (const t of items) { const last = out.at(-1); if (last && last.id === t.id) last.times++; else out.push({ id: t.id, times: 1 }); }
    return out.map((x) => x.id.replace(/^(\S+)( [+-]\d+)?$/, (m, a, tr) => a + (x.times > 1 ? ` x${x.times}` : '') + (tr || ''))).join(', ');
  };

  // the file
  const o = [];
  o.push(`# Imported from ${raw.title ? `"${raw.title}"` : 'a song'} by sp import (${plain ? 'plain' : 'exact'} mode): sp build gives back the same song.`);
  if (!plain) o.push('# {m=..} {d=..} {n=..} {s=..} are exact data of the recording; song:... sounds and the exact: block at the end are the song\'s own. Leave them be.');
  const bpm = plain ? song.bpm : raw.bpm;
  o.push(`song "${(raw.title || 'Untitled').replace(/"/g, "'")}"  bpm ${bpm}  4/4  grid 16${off ? `  offset ${off}` : ''}`);
  o.push(`base ${base}`);
  const KEYS = { major: 'major', minor: 'minor', mpent: 'major-pent', npent: 'minor-pent', blues: 'blues', dorian: 'dorian', mixo: 'mixolydian', phryg: 'phrygian', harmin: 'harmonic-minor' };
  if (raw.scale && KEYS[raw.scale.id]) o.push(`key ${noteName(60 + raw.scale.root).replace(/\d+$/, '')} ${KEYS[raw.scale.id]}`);
  o.push('');
  for (const d of snd.defs.values()) o.push(`sound ${d.name.padEnd(8)} = "${d.ref}"${d.comment && slug(d.comment) !== d.name ? `  # ${d.comment}` : ''}`);
  o.push('');
  for (const L of song.layers) if (L.kind !== 'dac' && L.name && L.notes.length) o.push(`track ${voiceOf(L).padEnd(5)} "${L.name.replace(/"/g, "'")}"`);
  o.push('');
  for (const p of pats) o.push(`pattern ${p.name} ${p.B}:` + (p.text ? '\n' + p.text : ''), '');
  for (const x of secs) o.push(`section ${x.name} = ${listOf(x.items)}`);
  o.push('arrange: ' + listOf(seq));
  if (plain) {
    if (song.loopStart >= 0) {
      const ls = timeToStep(song, song.loopStart) / BS;
      if (Math.abs(ls - Math.round(ls)) > 1e-6) return null;
      o.push(`loop: bar ${Math.round(ls) + 1}`);
    }
  } else {
    const ex = structuredClone(raw);
    delete ex.title; delete ex.base; delete ex.game;
    for (const L of ex.layers) if (L.kind !== 'dac') delete L.notes;
    o.push('', 'exact: {');
    const keys = Object.keys(ex);
    keys.forEach((k, i) => o.push(`${JSON.stringify(k)}: ${JSON.stringify(ex[k])}${i < keys.length - 1 ? ',' : ''}`));
    o.push('}');
  }
  return o.join('\n') + '\n';
}
