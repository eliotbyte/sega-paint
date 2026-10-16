// The sound library as a table: the keys a .sps names its sounds by.
import { catOf, SECTIONS, noteName, loadCatalog, soundName, UserError } from './core.mjs';
import { soundRecord } from './patch.mjs';
import { pitchShift } from './hear.mjs';

const MIX_RATE = 11300; // the Skitchin' DAC mixer runs at about 11.3 kHz (song.mixRate)

// Where a library sound can play, as the track dialog offers it (app.js soundLibrary / freeVoices).
export function voicesOf(c) {
  if (c.type === 'fm') return 'FM1-5';
  if (c.type === 'drums') return 'FM1-5 kit';
  if (c.type === 'psg') return 'PSG1-3';
  if (c.type === 'noise') return 'NOISE';
  return c.pitched ? 'DAC1-3, DAC4 pitched' : 'DAC1-3';
}
// An FM sound whose patch sounds off the written note (a modulator under the carrier: an octave lower, a carrier at
// MUL 2: higher), as measured through the engine: write the note that much the other way
export const offsetWords = (s) => (!s ? '' : `, sounds ${Math.abs(s) === 12 ? 'an octave' : Math.abs(s) === 24 ? 'two octaves' : Math.abs(s) + ' semitones'} ${s < 0 ? 'lower' : 'higher'} than written`);
export function soundInfo(c) {
  if (c.type === 'samples') {
    const ms = Math.round(c.len / MIX_RATE * 1000);
    const lo = 0x24 - (c.transp || 0);
    const bits = [`${ms} ms`, c.loop >= 0 ? 'loops' : c.oneShot ? 'oneShot' : 'held', c.pitched ? `pitched ${noteName(Math.max(24, lo))}-${noteName(Math.min(108, lo + 47))}, own pitch ${noteName(60 - (c.transp || 0))}` : 'no pitch'];
    return bits.join(', ');
  }
  if (c.type === 'drums') return `drum gm ${c.gm}, plays ${noteName(c.p)}`;
  if (c.type === 'fm') return `default note ${noteName(c.p ?? 60)}${offsetWords(pitchShift(soundRecord(c.key)))}`;
  if (c.type === 'psg') return `volume ${15 - (c.mac.vol ?? 0)}/15`;
  return '';
}
export function listSounds({ game, kind, find } = {}) {
  if (kind && !SECTIONS.includes(kind)) throw new UserError(`--kind: one of ${SECTIONS.join(', ')}`);
  const rows = [];
  for (const sec of kind ? [kind] : SECTIONS) for (const c of catOf(sec)) {
    if (game && !c.game.toLowerCase().includes(game.toLowerCase())) continue;
    if (find && !`${c.key} ${soundName(c)} ${sec}`.toLowerCase().includes(find.toLowerCase())) continue;
    rows.push([c.key, soundName(c), sec, voicesOf(c), soundInfo(c)]);
  }
  return rows;
}
export function formatTable(rows, head) {
  const all = [head, ...rows];
  const w = head.map((_, k) => Math.max(...all.map((r) => String(r[k]).length)));
  return all.map((r) => r.map((x, k) => (k === r.length - 1 ? String(x) : String(x).padEnd(w[k]))).join('  ').trimEnd()).join('\n');
}
export const gameNames = () => loadCatalog().games.map((g) => g.game);
