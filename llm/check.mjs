// Hardware rules of a song, in words: what the chip cannot play, what the app would not let a mouse do.
// The rules follow app.js (freeVoices: "All voices are in use", soundRange, BAR_TOOLS, enforceColumn) and the
// engine (engine/song.js: one note per voice, DAC pitch only on DAC4, PSG down to A2).
import { noteTime, sampleStep, MELODIC_VOICE } from '../player/engine/song.js';
import { voiceOf, where, noteName } from './core.mjs';

const PSG_LO = 45, STAFF_LO = 24, STAFF_HI = 108; // app.js: A2 is the PSG's lowest key; the staff is C1..C8

// -> { errors: [{ msg }], warnings: [{ msg }] }; errors make a song wrong, warnings only surprise.
export function checkSong(song) {
  const errors = [], warnings = [];
  const err = (msg) => errors.push(msg), warn = (msg) => warnings.push(msg);
  const at = (n, L, msg) => `${where(song, n.s)}: ${voiceOf(L)} - ${msg}`;
  const hasMixer = !!song.samples;
  const seen = new Map();
  song.layers.forEach((L, li) => {
    const v = voiceOf(L), name = `${v} (track "${L.name || L.id || li}")`;
    if (L.kind === 'dac') return; // the premixed DAC stream of an old song: nothing to check
    if (!['fm', 'psg', 'noise', 'sample'].includes(L.kind)) { err(`track ${L.name || li}: unknown kind "${L.kind}"`); return; }
    if (seen.has(v)) err(`${v}: two tracks on one voice ("${seen.get(v)}" and "${L.name || L.id || li}") - the chip has one ${v}; move one to a free voice`);
    seen.set(v, L.name || L.id || li);
    if (L.kind === 'fm' && L.ch === 5) err(`${name}: FM6 is not available - it is given to the DAC (samples); use FM1-FM5`);
    else if (L.kind === 'fm' && !(L.ch >= 0 && L.ch <= 4)) err(`${name}: no such FM channel (${L.ch}); use FM1-FM5`);
    if (L.kind === 'psg' && !(L.ch >= 0 && L.ch <= 2)) err(`${name}: no such PSG channel (${L.ch}); use PSG1-PSG3`);
    if (L.kind === 'noise' && L.ch !== 3) err(`${name}: the noise voice is PSG channel 4 (ch 3), not ${L.ch}`);
    if (L.kind === 'sample' && !hasMixer) err(`${name}: the song has no samples (no DAC mixer)`);
    if (L.kind === 'sample' && !((L.voice ?? MELODIC_VOICE) >= 0 && (L.voice ?? MELODIC_VOICE) <= 3)) err(`${name}: no such DAC voice; use DAC1-DAC4`);
    const melodic = L.kind === 'sample' && (L.voice ?? MELODIC_VOICE) === MELODIC_VOICE;
    const late = [], dacPitch = [], vols = [], pans = [], twice = [];
    const notes = L.notes.slice().sort((a, b) => noteTime(song, a) - noteTime(song, b));
    let prevT = null;
    for (const n of notes) {
      const T = noteTime(song, n);
      if (prevT != null && T === prevT) twice.push(n);
      prevT = T;
      if (T >= song.end - 1) late.push(n);
      if (!Number.isFinite(n.s)) { err(`${v}: a note without a step`); continue; }
      if (!(n.d > 0)) err(at(n, L, `length ${n.d}: a note must last at least 1 sample`));
      if (n.vol != null && !(Number.isInteger(n.vol) && n.vol >= 0 && n.vol <= 15)) err(at(n, L, `volume ${n.vol} out of 0-15`));
      else if (n.vol != null && n.vol !== 15 && L.kind === 'sample') vols.push(n);
      if (n.pan != null && !['L', 'C', 'R'].includes(n.pan)) err(at(n, L, `pan "${n.pan}": only L, C or R`));
      else if (n.pan != null && L.kind !== 'fm') pans.push(n);
      if (n.slide != null && !Number.isFinite(n.slide)) err(at(n, L, `slide "${n.slide}" is not a number of semitones`));
      if (L.kind === 'sample') {
        const smp = song.samples?.[n.smp];
        if (!smp) { err(at(n, L, `sample #${n.smp} is not in the song`)); continue; }
        if (melodic && smp.pitched && !sampleStep(smp, n.p)) {
          const lo = 0x24 - (smp.transp || 0);
          err(at(n, L, `${noteName(n.p)} is out of the range of "${smp.name || 'sample'}" (${noteName(lo)}-${noteName(lo + 47)}): it would not play`));
        }
        if (!melodic && smp.pitched && n.p !== 60 - (smp.transp || 0) && n.p !== smp.base) dacPitch.push(n);
        continue;
      }
      if (!song.macros[n.m]) { err(at(n, L, `macro #${n.m} is not in the song`)); continue; }
      if (L.kind === 'fm' && !song.instruments[n.i]) { err(at(n, L, `instrument #${n.i} is not in the song`)); continue; }
      if (L.kind === 'fm' && L.kit && n.gm == null) warn(at(n, L, 'a note on an FM drum track without a drum (gm)'));
      if (L.kind === 'psg' && n.p < PSG_LO) err(at(n, L, `${noteName(n.p)} is too low for the PSG (lowest A2): it would sound out of tune`));
      if (L.kind === 'fm' && n.gm == null && (n.p < STAFF_LO || n.p > STAFF_HI)) warn(at(n, L, `${noteName(n.p)} is off the staff (C1-C8)`));
      if (L.kind === 'psg' && n.p > STAFF_HI) warn(at(n, L, `${noteName(n.p)} is off the staff (above C8)`));
    }
    const some = (list, msg) => { if (list.length) warn(`${list.slice(0, 3).map((n) => where(song, n.s)).join('; ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}: ${v} - ${msg}`); };
    // the engine keeps the last of them (the game drivers did it too), so it is a warning, not an error
    some(twice, 'two notes at once: one voice plays one note at a time, only the last one sounds');
    some(late, 'notes at or after the song end are not played (more bars?)');
    some(dacPitch, 'pitch changes only on DAC4: these notes play at the sample\'s own pitch');
    some(vols, 'samples have no volume (the DAC plays them as they are): vol is ignored');
    some(pans, L.kind === 'sample' ? 'all samples share one DAC channel: no stereo per note, pan is ignored' : 'the PSG is mono: pan is ignored');
  });
  return { errors, warnings };
}

export function formatCheck({ errors, warnings }, max = 40) {
  const out = [];
  const list = (title, xs) => {
    if (!xs.length) return;
    out.push(`${title} (${xs.length}):`);
    for (const x of xs.slice(0, max)) out.push('  ' + x);
    if (xs.length > max) out.push(`  ... and ${xs.length - max} more`);
  };
  list('ERRORS', errors);
  list('warnings', warnings);
  if (!errors.length && !warnings.length) out.push('ok: no problems');
  else if (!errors.length) out.push('ok: no errors');
  return out.join('\n');
}
