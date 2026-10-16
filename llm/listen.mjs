// sp listen: "ears" for a song. A text report: piano roll, chords and key, clashes, how busy each voice is, and, from
// a render through the engine, loudness, peaks, clipping, stereo balance and voices buried under the others.
import { performSong, noteTime, timeToStep, stepTime, buildTimeline, MELODIC_VOICE } from '../player/engine/song.js';
import { voiceOf, noteName, NAMES, barOffset, songBars, renderSong, STEPS_PER_BAR, RATE, fail } from './core.mjs';
import { power, centroid, rms, peak, dbAmp } from './dsp.mjs';

const BS = STEPS_PER_BAR;
const isPitched = (L, n) => (L.kind === 'fm' && !L.kit && n.gm == null) || L.kind === 'psg' || (L.kind === 'sample' && (L.voice ?? MELODIC_VOICE) === MELODIC_VOICE);
const CHORDS = [ // name suffix, intervals (root first)
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['5', [0, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
];
// Krumhansl-Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], mpent: [0, 2, 4, 7, 9], npent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10], harmin: [0, 2, 3, 5, 7, 8, 11] };
const pc = (p) => ((p % 12) + 12) % 12;
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < 12; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
};
// "1-16" | "5" -> [from, to] bars (from 1)
export function parseBars(t, total) {
  if (t == null || t === true) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(t));
  if (!m) fail(`--bars: "${t}" is not a range like 1-16`);
  const a = +m[1], b = m[2] ? +m[2] : a;
  if (a < 1 || b < a || a > total) fail(`--bars ${t}: the song has ${total} bars`);
  return [a, Math.min(b, total)];
}

// Notes as the song plays them (repeats unrolled), with start / end in steps.
function playedNotes(song) {
  const P = performSong(song);
  const out = [];
  P.layers.forEach((L, li) => {
    if (L.kind === 'dac') return;
    const ns = L.notes.slice().sort((a, b) => noteTime(P, a) - noteTime(P, b));
    ns.forEach((n, i) => {
      const T = noteTime(P, n), next = i + 1 < ns.length ? noteTime(P, ns[i + 1]) : Infinity;
      const s = timeToStep(P, T), e = timeToStep(P, Math.min(T + n.d, next, P.end));
      if (e > s) out.push({ L, li, n, s, e, p: n.p, pitched: isPitched(L, n) });
    });
  });
  return { P, notes: out };
}

export function keyOf(notes, declared) {
  const hist = new Array(12).fill(0);
  for (const x of notes) if (x.pitched) hist[pc(x.p)] += x.e - x.s;
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best = null;
  for (let r = 0; r < 12; r++) for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
    const c = corr(hist, prof.map((_, i) => prof[(i - r + 12) % 12]));
    if (!best || c > best.c) best = { root: r, mode, c };
  }
  const use = declared && SCALES[declared.id] ? { root: declared.root, mode: declared.id } : best;
  const sc = SCALES[use.mode].map((x) => (x + use.root) % 12);
  const fit = sc.reduce((a, k) => a + hist[k], 0) / total;
  return { guess: best, use, scale: sc, fit, hist, total };
}

// The chord of a span of steps: pitch classes weighted by how long they sound (each voice the same in all), the root
// in the bass voice preferred.
// A chord needs its root and its third or fifth; otherwise the span is named by its main note in brackets: (E).
export function chordOf(notes, a, b) {
  const w = new Array(12).fill(0), byVoice = new Map();
  for (const x of notes) {
    if (!x.pitched || Math.min(b, x.e) <= Math.max(a, x.s)) continue;
    // sounding at each step: a beat counts 2, an eighth 1.5, the rest 1
    let o = 0;
    for (let st = Math.ceil(a - 1e-9); st < b; st++) if (x.s <= st + 0.5 && x.e > st + 0.5) o += st % 4 === 0 ? 2 : st % 2 === 0 ? 1.5 : 1;
    if (!o) continue;
    const v = byVoice.get(x.li) || { ps: [], w: new Array(12).fill(0) };
    v.ps.push(x.p); v.w[pc(x.p)] += o;
    byVoice.set(x.li, v);
  }
  // every voice counts the same, so a held bass does not drown an arpeggio
  for (const v of byVoice.values()) { const t = v.w.reduce((p, q) => p + q, 0); for (let k = 0; k < 12; k++) w[k] += v.w[k] / t; }
  const total = w.reduce((p, q) => p + q, 0);
  if (!total) return '-';
  const low = [...byVoice.values()].sort((p, q) => p.ps.reduce((s, y) => s + y, 0) / p.ps.length - q.ps.reduce((s, y) => s + y, 0) / q.ps.length)[0];
  const bass = low.w.indexOf(Math.max(...low.w));
  const has = (k) => w[k] >= total * 0.06;
  let best = null;
  for (let r = 0; r < 12; r++) {
    if (!has(r)) continue;
    for (const [suf, iv] of CHORDS) {
      const tones = iv.map((k) => (r + k) % 12);
      const core = iv.filter((k) => k !== 0 && k !== 10 && k !== 11);
      if (!core.some((k) => has((r + k) % 12))) continue;
      if ((suf === '5' || suf.startsWith('sus')) && !has((r + 7) % 12)) continue;
      if (iv.length > 3 && !has(tones[3])) continue;
      let s = 0;
      for (let k = 0; k < 12; k++) s += tones.includes(k) ? w[k] : -0.7 * w[k];
      s -= total * (0.35 * tones.filter((k) => !has(k)).length + 0.05 * (iv.length - 3) + (suf === 'aug' || suf === 'dim' ? 0.1 : 0)) - (r === bass ? 0.2 * total : 0);
      if (!best || s > best.s) best = { s, name: NAMES[r] + suf, root: r, tones };
    }
  }
  if (!best) return `(${NAMES[bass]})`;
  return best.name + (best.root !== bass && best.tones.includes(bass) ? '/' + NAMES[bass] : '');
}

export function listen(doc, { bars = null, render = true, all = false, roll = null } = {}) {
  const song = doc.song;
  const { P, notes } = playedNotes(song);
  const off = barOffset(song), total = songBars(P);
  const [b0, b1] = bars || (total <= 32 ? [1, total] : [1, 16]);
  const S0 = off + (b0 - 1) * BS, S1 = off + b1 * BS;
  const inRange = notes.filter((x) => x.e > S0 && x.s < S1);
  const barOf = (s) => Math.floor((s - off) / BS) + 1;
  const pos = (s) => { const b = barOf(s); return `${b}.${+(s - off - (b - 1) * BS + 1).toFixed(2)}`; };
  const out = [];
  const say = (...l) => out.push(...l);
  const layers = P.layers.map((L, li) => ({ L, li, v: voiceOf(L) })).filter((x) => x.L.kind !== 'dac');
  const nb = b1 - b0 + 1;
  say(`LISTEN "${song.title || 'song'}": bars ${b0}-${b1} of ${total}${!bars && total > 32 ? ' (--bars a-b for others)' : ''}, ${((stepTime(P, S1) - stepTime(P, S0)) / RATE).toFixed(1)} s, ${song.bpm} bpm`);

  // key
  const key = keyOf(inRange, song.scale);
  if (key) {
    const g = key.guess, u = key.use;
    const name = (k) => `${NAMES[k.root]} ${k.mode}`;
    say(`key: ${name(u)}${song.scale ? ' (declared)' : ''}, ${Math.round(key.fit * 100)}% of the note time in it${song.scale && (g.root !== u.root || g.mode !== u.mode) ? `; the notes suggest ${name(g)}` : ''}`);
  } else say('key: no pitched notes');

  // voices
  const vinfo = layers.map(({ L, li, v }) => {
    const ns = inRange.filter((x) => x.li === li), ps = ns.filter((x) => x.pitched).map((x) => x.p);
    const barsOn = new Set(ns.map((x) => barOf(x.s)));
    const range = ps.length ? `${noteName(Math.min(...ps))}-${noteName(Math.max(...ps))}` : L.kit ? 'drums' : L.kind === 'noise' ? 'noise' : ns.length ? 'hits' : '';
    return { L, li, v, ns, range, barsOn: [...barsOn].filter((b) => b >= b0 && b <= b1).length, median: ps.length ? ps.sort((a, b) => a - b)[ps.length >> 1] : null };
  });
  say('voices: ' + vinfo.map((x) => `${x.v} ${x.L.name || ''}${x.range ? ` ${x.range}` : ''} (${x.barsOn}/${nb} bars)`).join(' · '));

  // piano roll: 1 char per step, 4 bars a row
  const rollBars = roll || (nb <= 16 ? [b0, b1] : [b0, b0 + 15]);
  say('', `ROLL bars ${rollBars[0]}-${rollBars[1]}${nb > 16 && !roll ? ' (--roll a-b for others)' : ''}: letter = a note starts (lowercase = sharp: c d f g a), - held, x hit, . silence`);
  for (let b = rollBars[0]; b <= rollBars[1]; b += 4) {
    const be = Math.min(rollBars[1], b + 3);
    let head = '          ';
    for (let k = b; k <= be; k++) head += '|' + String(k).padEnd(BS);
    say(head);
    for (const x of vinfo) {
      if (!x.ns.length) continue;
      let row = '';
      for (let k = b; k <= be; k++) {
        row += '|';
        for (let st = 0; st < BS; st++) {
          const s = off + (k - 1) * BS + st;
          const on = x.ns.find((y) => y.s >= s - 1e-6 && y.s < s + 1 - 1e-6);
          if (on) { row += on.pitched ? (NAMES[pc(on.p)].length > 1 ? NAMES[pc(on.p)][0].toLowerCase() : NAMES[pc(on.p)]) : 'x'; continue; }
          row += x.ns.some((y) => y.s < s && y.e > s + 0.5) ? (x.ns.find((y) => y.s < s && y.e > s + 0.5).pitched ? '-' : ' ') : '.';
        }
      }
      if (/[^|. ]/.test(row)) say(`${(x.v + ' ').padEnd(5)} ${(x.L.name || '').slice(0, 4).padEnd(4)}${row}`);
    }
  }

  // chords by half bar
  const chords = [];
  for (let b = b0; b <= b1; b++) {
    const s = off + (b - 1) * BS;
    const c1 = chordOf(inRange, s, s + BS / 2), c2 = chordOf(inRange, s + BS / 2, s + BS);
    chords.push(`${b}:${c1}${c2 !== c1 ? ' ' + c2 : ''}`);
  }
  say('', 'CHORDS (bar: first half, second half if it changes)');
  for (let i = 0; i < chords.length; i += 8) say('  ' + chords.slice(i, i + 8).map((c) => c.padEnd(13) + ' ').join('').trimEnd());

  // harmony problems
  const probs = [];
  const lim = all ? Infinity : 6;
  const list = (title, xs) => { if (xs.length) probs.push(`  ${title} (${xs.length}): ${xs.slice(0, lim).join('; ')}${xs.length > lim ? ` ... (--all)` : ''}`); };
  if (key) {
    // in a minor key the raised 7th (harmonic minor: the major V chord) is not a wrong note
    const ok = key.use.mode === 'minor' ? [...key.scale, (key.use.root + 11) % 12] : key.scale;
    const odd = inRange.filter((x) => x.pitched && !ok.includes(pc(x.p)) && key.hist[pc(x.p)] < key.total * 0.04 && x.s >= S0);
    list(`out of ${NAMES[key.use.root]} ${key.use.mode}`, odd.map((x) => `${pos(x.s)} ${voiceOf(x.L)} ${noteName(x.p)}`));
  }
  const pitched = inRange.filter((x) => x.pitched);
  const clash = [];
  const seen = new Set();
  for (let i = 0; i < pitched.length; i++) for (let j = i + 1; j < pitched.length; j++) {
    const a = pitched[i], b = pitched[j];
    if (a.li === b.li) continue;
    const o = Math.min(a.e, b.e) - Math.max(a.s, b.s);
    if (o < 0.75) continue;
    const d = Math.abs(a.p - b.p);
    if (d !== 1 && d !== 6) continue;
    const at = Math.max(a.s, b.s), key2 = `${Math.floor(at)}|${a.li}|${b.li}`;
    if (seen.has(key2)) continue;
    seen.add(key2);
    clash.push(`${pos(at)} ${voiceOf(a.L)} ${noteName(a.p)} / ${voiceOf(b.L)} ${noteName(b.p)} ${d === 1 ? 'minor 2nd' : 'tritone'}`);
  }
  list('clashes in one register', clash);
  const mel = vinfo.filter((x) => x.median != null).sort((a, b) => a.median - b.median);
  if (mel.length >= 2) {
    const bass = mel[0], top = mel.at(-1), bad = new Set();
    for (const a of bass.ns) for (const b of top.ns) if (a.pitched && b.pitched && Math.min(a.e, b.e) - Math.max(a.s, b.s) > 0.5 && Math.abs(a.p - b.p) < 12) bad.add(barOf(Math.max(a.s, b.s)));
    list(`bass (${bass.v}) and melody (${top.v}) less than an octave apart`, ranges([...bad]));
  }
  const same = [];
  for (let b = b0; b <= b1; b++) {
    const s = off + (b - 1) * BS;
    const masks = vinfo.map((x) => x.ns.filter((y) => y.s >= s && y.s < s + BS).map((y) => Math.round((y.s - s) * 4)).join(',')).filter(Boolean);
    if (masks.length >= 3 && masks.every((m) => m === masks[0])) same.push(b);
  }
  list('every voice plays the same rhythm', ranges(same));
  say('', 'HARMONY', ...(probs.length ? probs : ['  no out-of-key notes, clashes or doubled rhythms']));

  // load
  const ld = [];
  const silent = vinfo.filter((x) => !x.ns.length).map((x) => `${x.v} ${x.L.name || ''}`.trim());
  if (silent.length) ld.push(`  silent voices: ${silent.join(', ')}`);
  const empty = [];
  for (let b = b0; b <= b1; b++) if (!inRange.some((x) => barOf(x.s) === b || (x.s < off + (b - 1) * BS && x.e > off + (b - 1) * BS + 1))) empty.push(b);
  if (empty.length) ld.push(`  empty bars (nothing plays): ${ranges(empty).join(', ')}`);
  const thin = [], busy = [];
  for (let b = b0; b <= b1; b++) {
    const on = vinfo.filter((x) => x.ns.some((y) => barOf(y.s) === b)).length;
    if (on === 1) thin.push(b);
    let most = 0;
    for (let st = 0; st < BS; st++) {
      const s = off + (b - 1) * BS + st + 0.5;
      most = Math.max(most, inRange.filter((x) => x.L.kind === 'sample' && x.s <= s && x.e > s).length);
    }
    if (most >= 3) busy.push(b);
  }
  if (thin.length) ld.push(`  one voice alone: bars ${ranges(thin).join(', ')}`);
  if (busy.length) ld.push(`  3+ samples at once on the DAC (each gets quieter, the mix clips): bars ${ranges(busy).join(', ')}`);
  // the DAC mixer sums the samples that play at once and clamps to 8 bits; the game's own songs clamp ~3% of the bytes
  const tl = buildTimeline(song, doc.pcm), dacN = new Map(), dacClip = new Map();
  for (let i = 0; i < tl.n; i++) {
    if (tl.k[i] !== 0 || tl.r[i] !== 0x2a) continue;
    const b = barOf(timeToStep(P, tl.t[i]));
    if (b < b0 || b > b1) continue;
    dacN.set(b, (dacN.get(b) || 0) + 1);
    if (tl.v[i] === 0 || tl.v[i] === 255) dacClip.set(b, (dacClip.get(b) || 0) + 1);
  }
  for (const [b, c] of dacClip) if (c < dacN.get(b) * 0.08) dacClip.delete(b);
  if (dacClip.size) ld.push(`  DAC mix clipped (samples summed past 8 bits, over 8% of the bytes; the games' songs: ~3%): bars ${ranges([...dacClip.keys()]).join(', ')}`);
  say('', 'LOAD', ...(ld.length ? ld : ['  every voice plays; no empty bars; the DAC mixer has room']));

  if (render) say('', ...soundReport(doc, P, vinfo, { b0, b1, off, all }));
  return out.join('\n');
}

// "1,2,3,7,9,10" -> ["1-3", "7", "9-10"]
export function ranges(xs) {
  xs = [...new Set(xs)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length;) { let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++; out.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`); i = j + 1; }
  return out;
}

function soundReport(doc, P, vinfo, { b0, b1, off, all }) {
  const out = ['SOUND (rendered through the engine)'];
  const mix = renderSong(doc, { fromBar: b0, bars: b1 - b0 + 1 });
  const at = (b) => Math.round(stepTime(P, off + (b - 1) * BS)) - mix.from;
  const rows = { rms: [], peak: [] };
  let clipBars = [], clipN = 0, sumL = 0, sumR = 0;
  for (let b = b0; b <= b1; b++) {
    const a = Math.max(0, at(b)), e = Math.min(mix.L.length, at(b + 1));
    const r = Math.sqrt((rms(mix.L, a, e) ** 2 + rms(mix.R, a, e) ** 2) / 2), pk = Math.max(peak(mix.L, a, e), peak(mix.R, a, e));
    rows.rms.push(dbAmp(r, -99)); rows.peak.push(dbAmp(pk, -99));
    let c = 0; for (let i = a; i < e; i++) if (Math.abs(mix.L[i]) >= 0.999 || Math.abs(mix.R[i]) >= 0.999) c++;
    if (c) { clipBars.push(b); clipN += c; }
    sumL += rms(mix.L, a, e) ** 2; sumR += rms(mix.R, a, e) ** 2;
  }
  for (let i = 0; i < rows.rms.length; i += 16) {
    const bs = []; for (let b = b0 + i; b <= Math.min(b1, b0 + i + 15); b++) bs.push(b);
    out.push(`  bar   ${bs.map((b) => String(b).padStart(4)).join('')}`);
    out.push(`  rms   ${rows.rms.slice(i, i + 16).map((x) => String(Math.round(x)).padStart(4)).join('')}  dBFS`);
    out.push(`  peak  ${rows.peak.slice(i, i + 16).map((x) => String(Math.round(x)).padStart(4)).join('')}  dBFS`);
  }
  out.push(`  clipping: ${clipN ? `${clipN} samples at full scale in bars ${ranges(clipBars).join(', ')} - lower vol of the loudest voices` : 'none'}`);
  const bal = 10 * Math.log10((sumL + 1e-12) / (sumR + 1e-12));
  out.push(`  stereo balance: ${Math.abs(bal) < 1 ? 'centred' : bal > 0 ? `left louder by ${bal.toFixed(1)} dB` : `right louder by ${(-bal).toFixed(1)} dB`}`);
  // each voice alone: level and brightness per bar; buried = far under the mix and next to a louder voice in brightness
  const solo = [];
  for (const x of vinfo) {
    if (!x.ns.length) continue;
    const r = renderSong(doc, { fromBar: b0, bars: b1 - b0 + 1, solo: [x.v] });
    const per = [];
    for (let b = b0; b <= b1; b++) {
      const a = Math.max(0, at(b)), e = Math.min(r.L.length, at(b + 1));
      const lv = dbAmp(Math.sqrt((rms(r.L, a, e) ** 2 + rms(r.R, a, e) ** 2) / 2), -99);
      let cen = 0, w = 0;
      for (let s = a; s + 2048 <= e; s += 4096) { const p = power(r.L, s, 2048); const e2 = p.reduce((q, y) => q + y, 0); cen += centroid(p, RATE) * e2; w += e2; }
      per.push({ lv, cen: w ? cen / w : 0 });
    }
    const on = per.filter((y) => y.lv > -70);
    const lvAvg = on.length ? dbAmp(Math.sqrt(on.reduce((a, y) => a + 10 ** (y.lv / 10), 0) / on.length)) : -99;
    const cenAvg = on.length ? on.reduce((a, y) => a + y.cen, 0) / on.length : 0;
    solo.push({ ...x, per, lvAvg, cenAvg });
  }
  out.push('  voices alone (rms when playing, brightness): ' + solo.map((x) => `${x.v} ${Math.round(x.lvAvg)} dB ${x.cenAvg >= 1000 ? (x.cenAvg / 1000).toFixed(1) + ' kHz' : Math.round(x.cenAvg) + ' Hz'}`).join(' · '));
  const buried = [];
  for (const x of solo) {
    const bad = [];
    let by = null;
    x.per.forEach((y, i) => {
      if (y.lv < -70) return;
      const mixLv = rows.rms[i];
      const rival = solo.find((z) => z !== x && z.per[i].lv > y.lv + 10 && Math.abs(Math.log2((z.per[i].cen + 1) / (y.cen + 1))) < 0.6);
      if (y.lv < mixLv - 15 && rival) { bad.push(b0 + i); by = rival; }
    });
    if (bad.length) buried.push(`${x.v} under ${by.v} in bars ${ranges(bad).join(', ')} (${Math.round(x.lvAvg - by.lvAvg)} dB, same brightness)`);
  }
  out.push(`  buried: ${buried.length ? buried.slice(0, all ? 99 : 4).join('; ') : 'no voice is lost under another'}`);
  return out;
}
